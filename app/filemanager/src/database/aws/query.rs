use sqlx::{Acquire, PgConnection, Postgres, Transaction, query, query_as};
use std::collections::HashSet;

use crate::database::Client;
use crate::error::Result;
use crate::events::aws::{FlatS3EventMessage, FlatS3EventMessages};

/// Query the filemanager via REST interface.
#[derive(Debug)]
pub struct Query {
    client: Client,
}

impl Query {
    /// Creates a new filemanager query client.
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    /// Selects existing objects by the bucket and key for update. This does not start a transaction.
    /// TODO, ideally this should use some better types. Potentially use sea-orm codegen to simplify queries.
    pub async fn select_current_by_bucket_key(
        &self,
        conn: &mut PgConnection,
        buckets: &[String],
        keys: &[String],
        version_ids: &[String],
    ) -> Result<FlatS3EventMessages> {
        Ok(FlatS3EventMessages(
            query_as::<_, FlatS3EventMessage>(include_str!(
                "../../../../database/queries/api/select_current_by_bucket_key.sql"
            ))
            .bind(buckets)
            .bind(keys)
            .bind(version_ids)
            .fetch_all(conn)
            .await?,
        ))
    }

    pub async fn select_all_by_bucket_key(
        &self,
        conn: &mut PgConnection,
        buckets: &[String],
        keys: &[String],
        version_ids: &[String],
    ) -> Result<FlatS3EventMessages> {
        Ok(FlatS3EventMessages(
            query_as::<_, FlatS3EventMessage>(include_str!(
                "../../../../database/queries/api/select_all_by_bucket_key.sql"
            ))
            .bind(buckets)
            .bind(keys)
            .bind(version_ids)
            .fetch_all(conn)
            .await?,
        ))
    }

    pub async fn reset_current_state(
        &self,
        conn: &mut PgConnection,
        buckets: Vec<String>,
        keys: Vec<String>,
    ) -> Result<()> {
        // Remove duplicate combinations of (bucket, key) as it's unnecessary to call multiple times.
        let keys: HashSet<_> = HashSet::from_iter(buckets.into_iter().zip(keys.into_iter()));
        let (buckets, keys): (Vec<_>, Vec<_>) = keys.into_iter().unzip();

        let conn = conn.acquire().await?;

        query(include_str!(
            "../../../../database/queries/api/reset_current_state.sql"
        ))
        .bind(buckets)
        .bind(keys)
        .execute(&mut *conn)
        .await?;

        Ok(())
    }

    /// Start a new transaction.
    pub async fn transaction(&self) -> Result<Transaction<'_, Postgres>> {
        Ok(self.client.pool().begin().await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::database::Ingest;
    use crate::database::aws::ingester::Ingester;
    use crate::database::aws::ingester::tests::test_events;
    use crate::database::aws::migration::tests::MIGRATOR;
    use crate::events::EventSourceType;
    use crate::events::aws::TransposedS3EventMessages;
    use crate::events::aws::crawl::tests::{assert_eq_event, fetch_results};
    use crate::events::aws::message::EventType;
    use crate::events::aws::message::EventType::Created;
    use crate::events::aws::tests::{
        EXPECTED_NEW_SEQUENCER_ONE, EXPECTED_SEQUENCER_CREATED_ONE, EXPECTED_VERSION_ID,
    };
    use chrono::{DateTime, Duration, Utc};
    use sqlx::{Executor, PgPool};
    use std::ops::Add;

    async fn ingest_test_records(pool: PgPool) -> (String, Option<DateTime<Utc>>) {
        let events = test_events(Some(Created));

        let new_date = Some(DateTime::default().add(Duration::days(1)));
        let new_sequencer = Some(EXPECTED_NEW_SEQUENCER_ONE.to_string());
        let new_key = "key1";

        let mut increase_date = test_events(Some(Created));
        increase_date.event_times[0] = new_date;
        increase_date.sequencers[0].clone_from(&new_sequencer);

        let mut different_key = test_events(Some(Created));
        different_key.keys[0] = new_key.to_string();

        let mut different_key_and_date = test_events(Some(Created));
        different_key_and_date.event_times[0] = new_date;
        different_key_and_date.keys[0] = new_key.to_string();
        different_key_and_date.sequencers[0].clone_from(&new_sequencer);

        Ingester::ingest_query(&events, &mut pool.acquire().await.unwrap())
            .await
            .unwrap();
        Ingester::ingest_query(&increase_date, &mut pool.acquire().await.unwrap())
            .await
            .unwrap();
        Ingester::ingest_query(&different_key, &mut pool.acquire().await.unwrap())
            .await
            .unwrap();
        Ingester::ingest_query(&different_key_and_date, &mut pool.acquire().await.unwrap())
            .await
            .unwrap();

        (new_key.to_string(), new_date)
    }

    async fn query_current_state(
        new_key: &String,
        query: &Query,
        conn: &mut PgConnection,
    ) -> Vec<FlatS3EventMessage> {
        query
            .select_current_by_bucket_key(
                conn,
                vec!["bucket".to_string(), "bucket".to_string()].as_slice(),
                vec!["key".to_string(), new_key.to_string()].as_slice(),
                vec![
                    EXPECTED_VERSION_ID.to_string(),
                    EXPECTED_VERSION_ID.to_string(),
                ]
                .as_slice(),
            )
            .await
            .unwrap()
            .0
    }

    async fn query_all(
        new_key: &String,
        query: &Query,
        conn: &mut PgConnection,
    ) -> Vec<FlatS3EventMessage> {
        query
            .select_all_by_bucket_key(
                conn,
                vec!["bucket".to_string(), "bucket".to_string()].as_slice(),
                vec!["key".to_string(), new_key.to_string()].as_slice(),
                vec![
                    EXPECTED_VERSION_ID.to_string(),
                    EXPECTED_VERSION_ID.to_string(),
                ]
                .as_slice(),
            )
            .await
            .unwrap()
            .0
    }

    async fn query_reset_current_state(new_key: &String, query: &Query, conn: &mut PgConnection) {
        query
            .reset_current_state(
                conn,
                vec!["bucket".to_string(), "bucket".to_string()],
                vec!["key".to_string(), new_key.to_string()],
            )
            .await
            .unwrap();
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn test_select_current_by_bucket_key(pool: PgPool) {
        let (new_key, new_date) = ingest_test_records(pool.clone()).await;
        let client = Client::from_pool(pool);
        let query = Query::new(client);

        let mut tx = query.client.pool().begin().await.unwrap();
        let results = query_current_state(&new_key, &query, &mut tx).await;
        tx.commit().await.unwrap();

        assert_eq!(results.len(), 2);
        assert!(
            results
                .first()
                .iter()
                .all(|result| result.bucket == "bucket"
                    && result.key == "key"
                    && result.event_time == new_date)
        );
        assert!(results.get(1).iter().all(|result| result.bucket == "bucket"
            && result.key == new_key
            && result.event_time == new_date));
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn test_select_all_by_bucket_key(pool: PgPool) {
        let (new_key, _) = ingest_test_records(pool.clone()).await;
        let client = Client::from_pool(pool);
        let query = Query::new(client);

        let mut tx = query.client.pool().begin().await.unwrap();
        let results = query_all(&new_key, &query, &mut tx).await;
        tx.commit().await.unwrap();

        assert_eq!(results.len(), 4);

        let (key, new_key) = results.split_at(2);
        assert!(
            key.iter()
                .all(|result| result.bucket == "bucket" && result.key == "key")
        );
        assert!(
            new_key
                .iter()
                .all(|result| result.bucket == "bucket" && result.key == "key1")
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn test_reset_current_state(pool: PgPool) {
        let (new_key, _) = ingest_test_records(pool.clone()).await;
        let client = Client::from_pool(pool);
        let query = Query::new(client);

        let mut tx = query.client.pool().begin().await.unwrap();
        query_reset_current_state(&new_key, &query, &mut tx).await;

        let results = query_current_state(&new_key, &query, &mut tx).await;

        tx.commit().await.unwrap();

        for result in results {
            if result.sequencer == Some(EXPECTED_SEQUENCER_CREATED_ONE.to_string()) {
                assert!(!result.is_current_state);
            } else {
                assert!(result.is_current_state);
            }
        }
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn test_reset_current_state_version_id(pool: PgPool) {
        let client = Client::from_pool(pool);

        let event_one = FlatS3EventMessage::new_with_generated_id()
            .with_key("key".to_string())
            .with_bucket("bucket".to_string())
            .with_version_id("1".to_string())
            .with_sequencer(Some("1".to_string()))
            .with_event_type(EventType::Created);

        let mut events = vec![event_one.clone()];
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 1);
        assert_eq_event(
            result[0].clone(),
            event_one.clone().with_is_current_state(true),
        );

        let event_two = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("2".to_string())
            .with_sequencer(Some("2".to_string()));
        events.push(event_two.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 2);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(
            result[1].clone(),
            event_two.clone().with_is_current_state(true),
        );

        let event_three = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("3".to_string())
            .with_sequencer(Some("3".to_string()));
        events.push(event_three.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 3);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(
            result[2].clone(),
            event_three.clone().with_is_current_state(true),
        );

        // Permanently delete non-current version.
        let event_four = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("2".to_string())
            .with_sequencer(Some("4".to_string()))
            .with_event_type(EventType::Deleted);
        events.push(event_four.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 4);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(
            result[2].clone(),
            event_three.clone().with_is_current_state(true),
        );
        assert_eq_event(result[3].clone(), event_four.clone());

        // Create delete marker.
        let event_five = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("4".to_string())
            .with_sequencer(Some("5".to_string()))
            .with_event_type(EventType::Deleted)
            .with_is_delete_marker(true);
        events.push(event_five.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 5);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(result[2].clone(), event_three.clone());
        assert_eq_event(result[3].clone(), event_four.clone());
        assert_eq_event(result[4].clone(), event_five.clone());

        // Upload new object over delete marker.
        let event_six = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("5".to_string())
            .with_sequencer(Some("6".to_string()));
        events.push(event_six.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 6);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(result[2].clone(), event_three.clone());
        assert_eq_event(result[3].clone(), event_four.clone());
        assert_eq_event(result[4].clone(), event_five.clone());
        assert_eq_event(
            result[5].clone(),
            event_six.clone().with_is_current_state(true),
        );

        // Permanently delete object version, delete marker is now current.
        let event_seven = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("5".to_string())
            .with_sequencer(Some("7".to_string()))
            .with_event_type(EventType::Deleted);
        events.push(event_seven.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 7);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(result[2].clone(), event_three.clone());
        assert_eq_event(result[3].clone(), event_four.clone());
        assert_eq_event(result[4].clone(), event_five.clone());
        assert_eq_event(result[5].clone(), event_six.clone());
        assert_eq_event(result[6].clone(), event_seven.clone());

        // Permanently delete delete marker, old version is now current.
        let event_eight = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("4".to_string())
            .with_sequencer(Some("8".to_string()))
            .with_event_type(EventType::Deleted);
        events.push(event_eight.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 8);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(
            result[2].clone(),
            event_three.clone().with_is_current_state(true),
        );
        assert_eq_event(result[3].clone(), event_four.clone());
        assert_eq_event(result[4].clone(), event_five.clone());
        assert_eq_event(result[5].clone(), event_six.clone());
        assert_eq_event(result[6].clone(), event_seven.clone());
        assert_eq_event(result[7].clone(), event_eight.clone());

        // Permanently delete object, first object now current.
        let event_nine = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("3".to_string())
            .with_sequencer(Some("9".to_string()))
            .with_event_type(EventType::Deleted);
        events.push(event_nine.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 9);
        assert_eq_event(
            result[0].clone(),
            event_one.clone().with_is_current_state(true),
        );
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(result[2].clone(), event_three.clone());
        assert_eq_event(result[3].clone(), event_four.clone());
        assert_eq_event(result[4].clone(), event_five.clone());
        assert_eq_event(result[5].clone(), event_six.clone());
        assert_eq_event(result[6].clone(), event_seven.clone());
        assert_eq_event(result[7].clone(), event_eight.clone());
        assert_eq_event(result[8].clone(), event_nine.clone());

        // Permanently delete last object.
        let event_ten = event_one
            .clone()
            .regenerate_ids()
            .with_version_id("1".to_string())
            .with_sequencer(Some("99".to_string()))
            .with_event_type(EventType::Deleted);
        events.push(event_ten.clone());
        let result = ingest_events(&client, events.clone()).await;
        assert_eq!(result.len(), 10);
        assert_eq_event(result[0].clone(), event_one.clone());
        assert_eq_event(result[1].clone(), event_two.clone());
        assert_eq_event(result[2].clone(), event_three.clone());
        assert_eq_event(result[3].clone(), event_four.clone());
        assert_eq_event(result[4].clone(), event_five.clone());
        assert_eq_event(result[5].clone(), event_six.clone());
        assert_eq_event(result[6].clone(), event_seven.clone());
        assert_eq_event(result[7].clone(), event_eight.clone());
        assert_eq_event(result[8].clone(), event_nine.clone());
        assert_eq_event(result[9].clone(), event_ten.clone());
    }

    async fn ingest_events(
        client: &Client,
        events: Vec<FlatS3EventMessage>,
    ) -> Vec<FlatS3EventMessage> {
        client
            .ingest(EventSourceType::S3(TransposedS3EventMessages::from(
                FlatS3EventMessages(events),
            )))
            .await
            .unwrap();
        let results = fetch_results(client).await;
        client.pool().execute("truncate s3_object").await.unwrap();

        results
    }
}
