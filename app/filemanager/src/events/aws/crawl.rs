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
        &self,
        bucket: &str,
        prefix: Option<String>,
    ) -> Result<FlatS3EventMessages> {
        let list = self.client.list_objects(bucket, prefix).await?;

        let Some(versions) = list.versions else {
            return Ok(FlatS3EventMessages::default());
        };

        // We only want to crawl current objects.
        Ok(FlatS3EventMessages(
            versions
                .into_iter()
                .filter(|object| object.is_latest.is_some_and(|latest| latest))
                .map(|object| FlatS3EventMessage::from(object).with_bucket(bucket.to_string()))
                .collect(),
        ))
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
    use crate::database::aws::ingester::tests::{
        assert_row, expected_message, fetch_results_ordered, test_ingester,
    };
    use crate::database::aws::migration::tests::MIGRATOR;
    use crate::events::Collect;
    use crate::events::EventSourceType;
    use crate::events::aws::StorageClass;
    use crate::events::aws::StorageClass::Standard;
    use crate::events::aws::collecter::CollecterBuilder;
    use crate::events::aws::collecter::tests::{
        expected_get_object_tagging, expected_head_object, expected_put_object_tagging,
        get_tagging_expectation, head_expectation, mock_s3, put_tagging_expectation,
        s3_client_expectations, sqs_client_expectations,
    };
    use crate::events::aws::message::EventType::{Created, Deleted};
    use crate::events::aws::tests::assert_flat_without_time;
    use crate::events::aws::tests::{EXPECTED_QUOTED_E_TAG, EXPECTED_SHA256, EXPECTED_VERSION_ID};
    use aws_sdk_s3::operation::get_object_tagging::GetObjectTaggingOutput;
    use aws_sdk_s3::operation::head_object::HeadObjectOutput;
    use aws_sdk_s3::operation::list_object_versions::ListObjectVersionsOutput;
    use aws_sdk_s3::primitives::DateTimeFormat;
    use aws_sdk_s3::types::Tag;
    use aws_sdk_s3::{primitives, types};
    use aws_smithy_mocks::{Rule, RuleMode};
    use aws_smithy_mocks::{mock, mock_client};
    use chrono::Duration;
    use itertools::Itertools;
    use sea_orm::Iden;
    use sqlx::__rt::sleep;
    use sqlx::{Executor, PgPool, Row};
    use std::str::FromStr;
    use uuid::Uuid;

    #[tokio::test]
    async fn crawl_messages() {
        let client = list_object_expectations(&[]);

        let result = Crawl::new(client)
            .crawl_s3("bucket", Some("prefix".to_string()))
            .await
            .unwrap()
            .into_inner();

        assert_flat_without_time(
            result[0].clone(),
            &Created,
            None,
            Some(1),
            default_version_id(),
            false,
            true,
        );
        assert_flat_without_time(
            result[1].clone(),
            &Created,
            None,
            Some(2),
            default_version_id(),
            false,
            true,
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn crawl_message_always_latest(pool: PgPool) {
        test_crawl_record_states(pool, None).await
    }

    // #[sqlx::test(migrator = "MIGRATOR")]
    // async fn crawl_message_always_latest_version_id(pool: PgPool) {
    //     test_crawl_record_states(pool, Some("version_id".to_string())).await
    // }

    async fn test_crawl_record_states(pool: PgPool, version_id: Option<String>) {
        let default_version_id = version_id.clone().unwrap_or(default_version_id());
        let records = crawl_record_states(default_version_id.clone());
        for (i, record) in records.into_iter().enumerate() {
            println!("{:#?}", i);
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
                head_expectation(default_version_id.clone(), head),
                put_tagging_expectation(default_version_id.clone(), expected_put_object_tagging()),
                get_tagging_expectation(default_version_id.clone(), tagging),
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
                    .match_requests(
                        |req| req.bucket() == Some("bucket") && req.prefix() == Some("prefix")
                    )
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
                                    .key("key")
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
