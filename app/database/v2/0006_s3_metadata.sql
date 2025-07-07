-- The AWS S3 storage classes.
create type storage_class as enum (
    'DeepArchive',
    'Glacier',
    'GlacierIr',
    'IntelligentTiering',
    'OnezoneIa',
    'Outposts',
    'ReducedRedundancy',
    'Snow',
    'Standard',
    'StandardIa'
);

-- The intelligent tiering archive status.
create type archive_status as enum (
    'ArchiveAccess',
    'DeepArchiveAccess'
);

-- The S3 metadata table tracks S3-specific fields on objects, like the storage class or tags.
create table s3_metadata (
    -- The table primary key.
    s3_metadata_id uuid not null primary key,

    -- The storage class.
    storage_class storage_class,
    -- The last modified date.
    last_modified_date timestamptz,
    -- The etag.
    e_tag text,
    -- Whether this object is a delete marker.
    is_delete_marker bool,
    -- The expiration date of the object if it is set to expire.
    expiration timestamptz,
    -- If the object is in archive, whether it has been restored.
    restored bool,
    -- The archive status of the object.
    archive_status archive_status,
    -- Any S3 metadata set on the object.
    metadata jsonb,
    -- Any tags set on the object.
    tags jsonb,

    -- The reference to the object table.
    object_id uuid unique references object,
    -- The reference to the historical object table.
    historical_object_id uuid unique references historical_object,
    -- A s3 metadata table can refer to either an object or historical object.
    check (num_nonnulls(object_id, historical_object_id) = 1)
);
