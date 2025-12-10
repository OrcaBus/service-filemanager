//! Crawl S3 using list operations and ingest into the database.
//!

use crate::clients::aws::s3::Client;
use crate::database::entities::sea_orm_active_enums::Reason;
use crate::error::Result;
use crate::events::aws::message::{EventType, default_version_id, quote_e_tag};
use crate::events::aws::{FlatS3EventMessage, FlatS3EventMessages};
use crate::uuid::UuidGenerator;
use aws_sdk_s3::types::ObjectVersion;
use chrono::Utc;

/// Represents crawl operations.
#[derive(Debug)]
pub struct Crawl {
    client: Client,
}

impl Crawl {
    /// Create a new crawl.
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    /// Create a new crawl with a default s3 client.
    pub async fn with_defaults() -> Self {
        Self::new(Client::with_defaults().await)
    }

    /// Crawl S3 and produce the event messages that should be ingested.
    pub async fn crawl_s3(
        self,
        bucket: &str,
        prefix: Option<String>,
    ) -> Result<FlatS3EventMessages> {
        let list = self.client.list_objects(bucket, prefix).await?;
        let versions = list.versions.unwrap_or_default();

        // We only want to crawl current objects.
        let messages: Vec<FlatS3EventMessage> = versions
            .into_iter()
            .filter(|object| object.is_latest.is_some_and(|latest| latest))
            .map(|object| FlatS3EventMessage::from(object).with_bucket(bucket.to_string()))
            .collect();

        Ok(FlatS3EventMessages(messages))
    }
}

impl From<ObjectVersion> for FlatS3EventMessage {
    fn from(object: ObjectVersion) -> Self {
        let ObjectVersion {
            key,
            e_tag,
            size,
            restore_status,
            version_id,
            ..
        } = object;

        let reason = match restore_status.and_then(|status| status.restore_expiry_date) {
            Some(_) => Reason::CrawlRestored,
            _ => Reason::Crawl,
        };

        Self {
            s3_object_id: UuidGenerator::generate(),
            event_time: Some(Utc::now()),
            // This is set later.
            bucket: "".to_string(),
            key: key.unwrap_or_default(),
            size,
            e_tag: e_tag.map(quote_e_tag),
            // Set this to null to generate a sequencer.
            sequencer: None,
            version_id: version_id.unwrap_or_else(default_version_id),
            // Head fields are fetched later.
            storage_class: None,
            last_modified_date: None,
            sha256: None,
            // A crawl record is a created event
            event_type: EventType::Created,
            is_current_state: true,
            is_delete_marker: false,
            reason,
            archive_status: None,
            ingest_id: None,
            attributes: None,
            number_duplicate_events: 0,
            number_reordered: 0,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::database;
    use crate::database::Ingest;
    use crate::database::aws::ingester::tests::test_ingester;
    use crate::database::aws::migration::tests::MIGRATOR;
    use crate::database::entities::prelude::S3Object;
    use crate::database::entities::s3_object::{ActiveModel, Column, Entity};
    use crate::database::entities::sea_orm_active_enums;
    use crate::database::entities::sea_orm_active_enums::ArchiveStatus;
    use crate::env::Config;
    use crate::events::Collect;
    use crate::events::EventSourceType;
    use crate::events::aws::StorageClass::{IntelligentTiering, Standard};
    use crate::events::aws::collecter::CollecterBuilder;
    use crate::events::aws::collecter::tests::{
        expected_put_object_tagging, get_tagging_expectation, head_expectation, mock_s3,
        put_tagging_expectation, test_collecter,
    };
    use crate::events::aws::message::EventType::{Created, Deleted};
    use crate::events::aws::tests::{EXPECTED_QUOTED_E_TAG, EXPECTED_SHA256};
    use crate::events::aws::{StorageClass, TransposedS3EventMessages};
    use crate::routes::crawl::tests::crawl_expectations;
    use aws_sdk_s3::operation::get_object_tagging::GetObjectTaggingOutput;
    use aws_sdk_s3::operation::head_object::HeadObjectOutput;
    use aws_sdk_s3::operation::list_object_versions::ListObjectVersionsOutput;
    use aws_sdk_s3::types;
    use aws_sdk_s3::types::Tag;
    use aws_smithy_mocks::{Rule, RuleMode};
    use aws_smithy_mocks::{mock, mock_client};
    use itertools::Itertools;
    use sea_orm::{EntityTrait, QueryOrder};
    use sea_orm::{NotSet, Set};
    use serde_json::json;
    use sqlx::{Executor, PgPool, Row};
    use std::str::FromStr;
    use uuid::Uuid;

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_messages(pool: PgPool) {
        let client = database::Client::from_pool(pool);
        let config = Config::default();
        let mut collecter = test_collecter(&config, &client).await;
        collecter.set_client(crawl_expectations());
        collecter.set_crawl_bucket("bucket".to_string());

        let result = Crawl::new(collecter.client().clone())
            .crawl_s3("bucket", None)
            .await
            .unwrap()
            .into_inner();

        assert_crawl_event(
            result.iter().find(|r| r.key == "key").unwrap().clone(),
            &Created,
            None,
            Some(1),
            default_version_id(),
        );
        assert_crawl_event(
            result.iter().find(|r| r.key == "key1").unwrap().clone(),
            &Created,
            None,
            Some(2),
            default_version_id(),
        );

        collecter.set_raw_events(FlatS3EventMessages(result));
        let result = collecter.collect().await.unwrap();
        client.ingest(result.event_type).await.unwrap();

        let results = fetch_results(&client).await;
        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some(
                "000000000000000000000000000000-0100000000000000".to_string(),
            ))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        assert_eq!(results.len(), 2);
        assert_eq_crawl_event(results[0].clone(), event.with_reason(Reason::Crawl));
        assert_eq_crawl_event(results[1].clone(), expected_unaffected_record_two());
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_messages_existing_entry(pool: PgPool) {
        let client = database::Client::from_pool(pool);

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 2);
        assert_eq_crawl_event(results[0].clone(), event);
        assert_eq_crawl_event(results[1].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()))
            .with_reason(Reason::CreatedCopy);
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 2);
        assert_eq_crawl_event(results[0].clone(), event);
        assert_eq_crawl_event(results[1].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()))
            .with_event_time(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()));

        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 2);
        assert_eq_crawl_event(results[0].clone(), event);
        assert_eq_crawl_event(results[1].clone(), expected_unaffected_record_two());
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_messages_update_field(pool: PgPool) {
        let client = database::Client::from_pool(pool);

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(None)
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_reason(Reason::Crawl)
                .with_storage_class(Some(StorageClass::IntelligentTiering)),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(None)
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_reason(Reason::Crawl)
                .with_ingest_id(Some(Uuid::default())),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(None)
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_reason(Reason::Crawl)
                .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess)),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(None)
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_reason(Reason::Crawl)
                .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string())),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(None)
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
                .with_reason(Reason::Crawl),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(None)
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_size(Some(1))
                .with_reason(Reason::Crawl),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(None);
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], event.clone().with_is_current_state(false));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_reason(Reason::Crawl)
                .with_sha256(Some(EXPECTED_SHA256.to_string())),
        );
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        // Attributes carry over from existing events in the database.
        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(Some(StorageClass::IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()))
            .with_attributes(Some(json!({ "attribute": "1" })));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 2);
        assert_eq!(results[0], event.clone());
        assert_eq_crawl_event(
            results[1].clone(),
            expected_unaffected_record_two()
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string(),
                ))
                .with_reason(Reason::Crawl)
                .with_attributes(Some(json!({ "attribute": "1" }))),
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_messages_delete_from_database(pool: PgPool) {
        let client = database::Client::from_pool(pool);

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key2".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some("000000000000000000000000000000".to_string()))
            .with_storage_class(None)
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));
        let results = ingest_crawl(client.clone(), event.clone()).await;
        assert_eq!(results.len(), 4);
        assert_eq!(results[0], event.clone().with_is_current_state(false));

        assert_eq_crawl_event(results[1].clone(), expected_unaffected_record_one());
        assert_eq_crawl_event(results[2].clone(), expected_unaffected_record_two());

        let mut deleted = results[3].clone();
        assert!(deleted.event_time.is_some());
        deleted.event_time = None;
        deleted.s3_object_id = event.s3_object_id;

        assert_eq!(
            deleted,
            event
                .clone()
                .with_event_type(Deleted)
                .with_is_current_state(false)
                .with_sequencer(Some(
                    "000000000000000000000000000000-0100000000000000".to_string()
                ))
                .with_reason(Reason::Crawl)
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_messages_existing_entry_null_sequencer(pool: PgPool) {
        let client = database::Client::from_pool(pool);

        // Mimic old database logic by ingesting a null sequencer directly.
        let event = ActiveModel {
            s3_object_id: Set(UuidGenerator::generate()),
            event_type: Set(sea_orm_active_enums::EventType::Created),
            key: Set("key".to_string()),
            bucket: Set("bucket".to_string()),
            sequencer: NotSet,
            storage_class: Set(Some(sea_orm_active_enums::StorageClass::IntelligentTiering)),
            ingest_id: Set(Some(Uuid::default())),
            archive_status: Set(Some(ArchiveStatus::DeepArchiveAccess)),
            e_tag: Set(Some(EXPECTED_QUOTED_E_TAG.to_string())),
            last_modified_date: Set(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap())),
            version_id: Set(default_version_id()),
            size: Set(Some(1)),
            is_current_state: Set(true),
            sha256: Set(Some(EXPECTED_SHA256.to_string())),
            ..Default::default()
        };
        Entity::insert(event)
            .exec(client.connection_ref())
            .await
            .unwrap();

        let config = Config::default();
        let mut collecter = test_collecter(&config, &client).await;
        collecter.set_client(crawl_expectations());
        collecter.set_crawl_bucket("bucket".to_string());

        let result = Crawl::new(collecter.client().clone())
            .crawl_s3("bucket", None)
            .await
            .unwrap()
            .into_inner();

        collecter.set_raw_events(FlatS3EventMessages(result));
        let result = collecter.collect().await.unwrap();
        client.ingest(result.event_type).await.unwrap();

        let event = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some(
                "000000000000000000000000000000-0100000000000000".to_string(),
            ))
            .with_storage_class(Some(IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()));

        let results = fetch_results(&client).await;
        assert_eq!(results.len(), 3);
        assert_eq_crawl_event(results[0].clone(), event.clone().with_reason(Reason::Crawl));
        assert_eq_crawl_event(
            results[1].clone(),
            event
                .clone()
                .with_key("key1".to_string())
                .with_size(Some(2))
                .with_reason(Reason::Crawl),
        );
        assert_eq_crawl_event(
            results[2].clone(),
            event.with_sequencer(None).with_is_current_state(false),
        );
    }

    fn assert_eq_crawl_event(mut left: FlatS3EventMessage, right: FlatS3EventMessage) {
        left.s3_object_id = right.s3_object_id;
        left.event_time = right.event_time;
        assert_eq!(left, right);
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_message_always_latest(pool: PgPool) {
        test_crawl_record_states(pool, None).await
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_message_always_latest_version_id(pool: PgPool) {
        test_crawl_record_states(pool, Some("version_id".to_string())).await
    }

    async fn test_crawl_record_states(pool: PgPool, version_id: Option<String>) {
        let default_version_id = version_id.clone().unwrap_or(default_version_id());
        let records = crawl_record_states(default_version_id.clone());
        for record in records.into_iter() {
            let ingester = test_ingester(pool.clone());
            ingester
                .ingest(EventSourceType::S3(FlatS3EventMessages(record).into()))
                .await
                .unwrap();

            let message = FlatS3EventMessages(vec![
                FlatS3EventMessage::from(
                    ObjectVersion::builder()
                        .key("key".to_string())
                        .set_version_id(version_id.clone())
                        .build(),
                )
                .with_bucket("bucket".to_string()),
            ]);

            let head = HeadObjectOutput::builder()
                .storage_class(types::StorageClass::StandardIa)
                .set_version_id(version_id.clone())
                .build();
            let tagging = GetObjectTaggingOutput::builder()
                .set_tag_set(Some(vec![
                    Tag::builder()
                        .key("ingest_id")
                        .value("00000000-0000-0000-0000-000000000001")
                        .build()
                        .unwrap(),
                ]))
                .build()
                .unwrap();
            let s3_client = mock_s3(&[
                head_expectation("key".to_string(), default_version_id.clone(), head),
                put_tagging_expectation(
                    "key".to_string(),
                    default_version_id.clone(),
                    expected_put_object_tagging(),
                ),
                get_tagging_expectation("key".to_string(), default_version_id.clone(), tagging),
            ]);
            let crawl_event = CollecterBuilder::default()
                .with_s3_client(s3_client)
                .build(
                    message,
                    &Default::default(),
                    &database::Client::from_pool(pool.clone()),
                )
                .await
                .collect()
                .await
                .unwrap()
                .into_inner()
                .0;

            ingester.ingest(crawl_event).await.unwrap();
            let s3_object_results = sqlx::query("select * from s3_object order by sequencer")
                .fetch_all(&pool.clone())
                .await
                .unwrap();

            let (result, _): (Vec<_>, Vec<_>) = s3_object_results
                .iter()
                .partition(|row| row.get::<bool, _>("is_current_state"));
            assert_eq!(result.len(), 1);
            let result = result.first().unwrap();

            assert_eq!("bucket".to_string(), result.get::<String, _>("bucket"));
            assert_eq!("key".to_string(), result.get::<String, _>("key"));
            assert_eq!(default_version_id, result.get::<String, _>("version_id"));
            assert_eq!(
                StorageClass::StandardIa,
                result.get::<StorageClass, _>("storage_class")
            );
            assert_eq!(
                Uuid::from_str("00000000-0000-0000-0000-000000000001").unwrap(),
                result.get::<Uuid, _>("ingest_id")
            );
            assert!(result.get::<Option<String>, _>("sequencer").is_some());

            // Clean up for next iteration.
            pool.execute("truncate s3_object").await.unwrap();
        }
    }

    fn expected_unaffected_record_one() -> FlatS3EventMessage {
        FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some(
                "000000000000000000000000000000-0100000000000000".to_string(),
            ))
            .with_storage_class(Some(IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(1))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()))
            .with_reason(Reason::Crawl)
    }

    fn expected_unaffected_record_two() -> FlatS3EventMessage {
        FlatS3EventMessage::new_with_generated_id()
            .with_key("key1".to_string())
            .with_bucket("bucket".to_string())
            .with_sequencer(Some(
                "000000000000000000000000000000-0100000000000000".to_string(),
            ))
            .with_storage_class(Some(IntelligentTiering))
            .with_ingest_id(Some(Uuid::default()))
            .with_archive_status(Some(ArchiveStatus::DeepArchiveAccess))
            .with_e_tag(Some(EXPECTED_QUOTED_E_TAG.to_string()))
            .with_last_modified_date(Some("1970-01-01 00:00:00.000000 +00:00".parse().unwrap()))
            .with_version_id(default_version_id())
            .with_size(Some(2))
            .with_is_current_state(true)
            .with_sha256(Some(EXPECTED_SHA256.to_string()))
            .with_reason(Reason::Crawl)
    }

    async fn ingest_crawl(
        client: database::Client,
        event: FlatS3EventMessage,
    ) -> Vec<FlatS3EventMessage> {
        client
            .ingest(EventSourceType::S3(TransposedS3EventMessages::from(
                FlatS3EventMessages(vec![event]),
            )))
            .await
            .unwrap();

        let config = Config::default();
        let mut collecter = test_collecter(&config, &client).await;
        collecter.set_client(crawl_expectations());
        collecter.set_crawl_bucket("bucket".to_string());

        let result = Crawl::new(collecter.client().clone())
            .crawl_s3("bucket", None)
            .await
            .unwrap()
            .into_inner();

        collecter.set_raw_events(FlatS3EventMessages(result));
        let result = collecter.collect().await.unwrap();
        client.ingest(result.event_type).await.unwrap();

        let results = fetch_results(&client).await;
        client.pool().execute("truncate s3_object").await.unwrap();

        results
    }

    async fn fetch_results(client: &database::Client) -> Vec<FlatS3EventMessage> {
        S3Object::find()
            .order_by_asc(Column::Sequencer)
            .order_by_asc(Column::Key)
            .order_by_asc(Column::VersionId)
            .all(client.connection_ref())
            .await
            .unwrap()
            .into_iter()
            .map(FlatS3EventMessage::from)
            .collect_vec()
    }

    fn assert_crawl_event(
        event: FlatS3EventMessage,
        event_type: &EventType,
        sequencer: Option<String>,
        size: Option<i64>,
        version_id: String,
    ) {
        assert_eq!(&event.event_type, event_type);
        assert_eq!(event.bucket, "bucket");
        assert_eq!(event.version_id, version_id);
        assert_eq!(event.size, size);
        assert_eq!(event.e_tag, Some(EXPECTED_QUOTED_E_TAG.to_string()));
        assert_eq!(event.sequencer, sequencer);
        assert_eq!(event.storage_class, None);
        assert_eq!(event.last_modified_date, None);
        assert!(!event.is_delete_marker);
        assert!(event.is_current_state);
    }

    fn crawl_record_states(version_id: String) -> Vec<Vec<FlatS3EventMessage>> {
        let generate_record = || {
            FlatS3EventMessage::new_with_generated_id()
                .with_bucket("bucket".to_string())
                .with_key("key".to_string())
                .with_version_id(version_id.clone())
                .with_is_current_state(true)
        };
        vec![
            generate_record()
                .with_event_type(Created)
                .with_sequencer(Some("1".to_string())),
            generate_record()
                .with_event_type(Deleted)
                .with_sequencer(Some("2".to_string())),
            generate_record()
                .with_event_type(Created)
                .with_sequencer(None),
            generate_record()
                .with_event_type(Deleted)
                .with_sequencer(None),
            generate_record()
                .with_event_type(Created)
                .with_sequencer(Some("5".to_string()))
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Deleted)
                .with_sequencer(Some("6".to_string()))
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Created)
                .with_sequencer(None)
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Deleted)
                .with_sequencer(None)
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Created)
                .with_sequencer(Some("7".to_string()))
                .with_ingest_id(Some(Uuid::default()))
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Deleted)
                .with_sequencer(Some("8".to_string()))
                .with_ingest_id(Some(Uuid::default()))
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Created)
                .with_sequencer(None)
                .with_ingest_id(Some(Uuid::default()))
                .with_storage_class(Some(Standard)),
            generate_record()
                .with_event_type(Deleted)
                .with_sequencer(None)
                .with_ingest_id(Some(Uuid::default()))
                .with_storage_class(Some(Standard)),
        ]
        .into_iter()
        .powerset()
        .collect::<Vec<_>>()
    }

    pub(crate) fn list_object_expectations(rules: &[Rule]) -> Client {
        Client::new(mock_client!(
            aws_sdk_s3,
            RuleMode::MatchAny,
            &[
                &[mock!(aws_sdk_s3::Client::list_object_versions)
                    .match_requests(|req| req.bucket() == Some("bucket") && req.prefix().is_none())
                    .then_output(move || {
                        ListObjectVersionsOutput::builder()
                            .versions(
                                ObjectVersion::builder()
                                    .key("key")
                                    .size(1)
                                    .is_latest(true)
                                    .e_tag(EXPECTED_QUOTED_E_TAG)
                                    .build(),
                            )
                            .versions(
                                ObjectVersion::builder()
                                    .key("key1")
                                    .size(2)
                                    .is_latest(true)
                                    .e_tag(EXPECTED_QUOTED_E_TAG)
                                    .build(),
                            )
                            .build()
                    }),],
                rules
            ]
            .concat()
        ))
    }
}
