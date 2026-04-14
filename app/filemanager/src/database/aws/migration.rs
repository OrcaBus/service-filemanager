//! Database migration logic.
//!

use async_trait::async_trait;
use sqlx::migrate;
use sqlx::migrate::Migrator;
use tracing::trace;

use crate::database::{Client, CredentialGenerator, Migrate};
use crate::env::Config;
use crate::error::Error::MigrateError;
use crate::error::Result;

/// A struct to perform database migrations.
#[derive(Debug)]
pub struct Migration {
    client: Client,
}

impl Migration {
    /// Create a new migration.
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    /// Create a new migration with a default database client.
    pub async fn with_defaults(
        generator: Option<impl CredentialGenerator>,
        config: &Config,
    ) -> Result<Self> {
        Ok(Self::new(Client::from_generator(generator, config).await?))
    }

    /// Get the underlying sqlx migrator for the migrations.
    pub fn migrator() -> Migrator {
        migrate!("../database/migrations")
    }

    /// Get a reference to the database client.
    pub fn client(&self) -> &Client {
        &self.client
    }
}

#[async_trait]
impl Migrate for Migration {
    async fn migrate(&self) -> Result<()> {
        trace!("applying migrations");
        Self::migrator()
            .run(self.client().pool())
            .await
            .map_err(|err| MigrateError(err.to_string()))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use lazy_static::lazy_static;
    use sqlx::PgPool;
    use sqlx::Row;
    use sqlx::migrate::Migrate as SqlxMigrate;
    use sqlx::postgres::PgRow;
    use uuid::Uuid;

    use super::*;
    use crate::database::Migrate;
    use crate::uuid::UuidGenerator;

    lazy_static! {
        pub(crate) static ref MIGRATOR: Migrator = Migration::migrator();
    }

    #[sqlx::test(migrations = false)]
    async fn test_migrate(pool: PgPool) {
        let migrate = Migration::new(Client::from_pool(pool));

        let s3_object_exists = check_table_exists(&migrate, "s3_object").await;
        assert!(!s3_object_exists.get::<bool, _>("exists"));

        migrate.migrate().await.unwrap();

        let s3_object_exists = check_table_exists(&migrate, "s3_object").await;
        assert!(s3_object_exists.get::<bool, _>("exists"));

        // Migrating again shouldn't be an issue.
        migrate.migrate().await.unwrap();

        let s3_object_exists = check_table_exists(&migrate, "s3_object").await;
        assert!(s3_object_exists.get::<bool, _>("exists"));
    }

    #[sqlx::test(migrations = false)]
    async fn test_migration_0008_multiple_versions(pool: PgPool) {
        apply_migrations_to(&pool, 7).await;

        // Two Created versions for the same key, both incorrectly marked as current.
        let old = insert_s3_object(&pool, "key", "1", "1", "Created", false, true).await;
        let new = insert_s3_object(&pool, "key", "2", "2", "Created", false, true).await;

        apply_migration_0008(&pool).await;

        assert!(!get_current_state(&pool, old).await);
        assert!(get_current_state(&pool, new).await);
    }

    #[sqlx::test(migrations = false)]
    async fn test_migration_0008_delete_marker_is_not_current(pool: PgPool) {
        apply_migrations_to(&pool, 7).await;

        let created = insert_s3_object(&pool, "key", "1", "1", "Created", false, true).await;
        let marker = insert_s3_object(&pool, "key", "2", "2", "Deleted", true, true).await;

        apply_migration_0008(&pool).await;

        assert!(!get_current_state(&pool, created).await);
        assert!(!get_current_state(&pool, marker).await);
    }

    #[sqlx::test(migrations = false)]
    async fn test_migration_0008_all_deleted(pool: PgPool) {
        apply_migrations_to(&pool, 7).await;

        let created = insert_s3_object(&pool, "key", "1", "1", "Created", false, true).await;
        let deleted = insert_s3_object(&pool, "key", "1", "2", "Deleted", false, false).await;

        apply_migration_0008(&pool).await;

        assert!(!get_current_state(&pool, created).await);
        assert!(!get_current_state(&pool, deleted).await);
    }

    #[sqlx::test(migrations = false)]
    async fn test_migration_0008_multiple_keys(pool: PgPool) {
        apply_migrations_to(&pool, 7).await;

        let key1_old = insert_s3_object(&pool, "key1", "1", "1", "Created", false, true).await;
        let key1_new = insert_s3_object(&pool, "key1", "2", "2", "Created", false, true).await;
        let key2 = insert_s3_object(&pool, "key2", "1", "1", "Created", false, true).await;

        apply_migration_0008(&pool).await;

        assert!(!get_current_state(&pool, key1_old).await);
        assert!(get_current_state(&pool, key1_new).await);
        assert!(get_current_state(&pool, key2).await);
    }

    #[sqlx::test(migrations = false)]
    async fn test_migration_0008_deleted_version_fallback(pool: PgPool) {
        apply_migrations_to(&pool, 7).await;

        // 1 created, 2 created then deleted — 1 should become current.
        let v1 = insert_s3_object(&pool, "key", "1", "1", "Created", false, false).await;
        let v2_created = insert_s3_object(&pool, "key", "2", "2", "Created", false, true).await;
        let v2_deleted = insert_s3_object(&pool, "key", "2", "3", "Deleted", false, false).await;

        apply_migration_0008(&pool).await;

        assert!(get_current_state(&pool, v1).await);
        assert!(!get_current_state(&pool, v2_created).await);
        assert!(!get_current_state(&pool, v2_deleted).await);
    }

    async fn check_table_exists(migration: &Migration, table_name: &str) -> PgRow {
        sqlx::query(&format!(
            "select exists (select from information_schema.tables where table_name = '{table_name}')"
        ))
        .fetch_one(migration.client().pool())
        .await
        .unwrap()
    }

    /// Apply migrations up to and including the given version, skipping any beyond it.
    async fn apply_migrations_to(pool: &PgPool, up_to_version: i64) {
        let migrator = Migration::migrator();
        let mut conn = pool.acquire().await.unwrap();

        conn.ensure_migrations_table().await.unwrap();

        for migration in migrator.iter() {
            if migration.version > up_to_version {
                break;
            }
            if !migration.migration_type.is_down_migration() {
                SqlxMigrate::apply(&mut *conn, migration).await.unwrap();
            }
        }
    }

    /// Insert a test s3_object record with minimal required fields.
    async fn insert_s3_object(
        pool: &PgPool,
        key: &str,
        version_id: &str,
        sequencer: &str,
        event_type: &str,
        is_delete_marker: bool,
        is_current_state: bool,
    ) -> Uuid {
        let id = UuidGenerator::generate();
        sqlx::query(
            "insert into s3_object (s3_object_id, bucket, key, version_id, sequencer, event_type, is_delete_marker, is_current_state)
             values ($1, $2, $3, $4, $5, $6::event_type, $7, $8)"
        )
            .bind(id)
            .bind("bucket")
            .bind(key)
            .bind(version_id)
            .bind(sequencer)
            .bind(event_type)
            .bind(is_delete_marker)
            .bind(is_current_state)
            .execute(pool)
            .await
            .unwrap();
        id
    }

    /// Query `is_current_state` for a given s3_object_id.
    async fn get_current_state(pool: &PgPool, id: Uuid) -> bool {
        sqlx::query_scalar("select is_current_state from s3_object where s3_object_id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// Apply migration 0008 directly.
    async fn apply_migration_0008(pool: &PgPool) {
        let migrator = Migration::migrator();
        let mut conn = pool.acquire().await.unwrap();

        let migration = migrator.iter().find(|m| m.version == 8).unwrap();
        SqlxMigrate::apply(&mut *conn, migration).await.unwrap();
    }
}
