-- The type of event for this s3_object record.
create type event_type as enum (
    -- The object was created.
    'Created',
    -- The object was deleted.
    'Deleted',
    -- The object was deleted using lifecycle expiration rules.
    'DeletedLifecycle',
    -- The object was restored from archive.
    'Restored',
    -- The object's restored copy was expired.
    'RestoreExpired',
    -- The object's storage class was changed, including changes intelligent tiering classes.
    'StorageClassChanged',
    -- This event was generated from a crawl operation like S3 inventory.
    'Crawl',
    -- This event was generated from a crawl operation and the object was in a `Restored` state from archive.
    'CrawlRestored',
    -- A tag was PUT on an object or an existing tag was updated.
    'TaggingCreated',
    -- A tag was deleted from the object.
    'TaggingDeleted'
);

-- This table maps closely to events received from S3. It tracks duplicates and ordering, and is the basis
-- for data inside `object` and `historical_object`.
create table s3_event (
    -- The table primary key.
    s3_event_id uuid not null primary key,

    -- The kind of event.
    event_type event_type not null,
    -- The time the event occurred.
    event_time timestamptz not null,
    -- The sequencer determines the ordering of events and is used to de-duplicate events.
    sequencer text not null,


    -- The bucket of the object.
    bucket text not null,
    -- The key of the object.
    key text not null,
    -- The version id of the object. It is allowed to be null for non-versioned objects.
    version_id text default null,
    -- The size of the object if it is present.
    size bigint default null,
    -- The object eTag if it is present.
    e_tag text default null
);
