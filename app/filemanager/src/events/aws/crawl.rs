//! Crawl S3 using list operations and ingest into the database.
//!

use crate::clients::aws::s3::Client;
use crate::database::entities::sea_orm_active_enums::Reason;
use crate::error::Result;
use crate::events::aws::message::{default_version_id, quote_e_tag, EventType};

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
    use crate::events::aws::message::EventType::Created;
    use crate::events::aws::tests::assert_flat_without_time;
    use crate::events::aws::tests::EXPECTED_QUOTED_E_TAG;
    use aws_sdk_s3::operation::list_object_versions::ListObjectVersionsOutput;
    use aws_smithy_mocks::{mock, mock_client};
    use aws_smithy_mocks::{Rule, RuleMode};

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
