-- The is_accessible column should consider objects with a null storage class as accessible. A null storage class
-- means that the storage class could not be determined, not that the object is definitively non-accessible,
-- so by default, it should be assumed that it is accessible.
alter table s3_object drop column is_accessible;
alter table s3_object add column is_accessible bool not null generated always as (
    is_current_state and
    (storage_class is null or (
        storage_class != 'Glacier' and
        (storage_class != 'DeepArchive' or reason = 'Restored' or reason = 'CrawlRestored') and
        (storage_class != 'IntelligentTiering' or archive_status is null)
    ))
) stored;
