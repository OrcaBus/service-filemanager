-- This table maps closely to events received from S3. It tracks duplicates and ordering, and is the basis
-- for data inside `object` and `historical_object`.
create table s3_event (
    -- The table primary key.
    s3_event_id uuid not null primary key,

    -- The kind of event, either `Created` or `Deleted`.
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
