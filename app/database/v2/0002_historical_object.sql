-- A historical object represents a record in cloud storage for an object that is no longer current. I.e. it does not
-- exist any more and has been deleted.
create table historical_object (
    -- The table primary key.
    historical_object_id uuid not null primary key,

    -- The bucket of the object.
    bucket text not null,
    -- The key of the object.
    key text not null,
    -- The version id of the object. It is allowed to be null for non-versioned objects.
    version_id text default null,
    -- When this object was created. This column should not be relied upon for ordering.
    created timestamptz not null,
    -- When this object was deleted. This column should not be relied upon for ordering.
    deleted timestamptz not null default now(),
    -- The ordering string determines the order in which `object`s and `historical_object`s are created when compared
    -- to each other on the same `bucket`, `key` and `version_id`.
    ordering text not null,

    -- The filemanager id tracks how objects move between locations, and remains the same when an object changes
    -- locations is deleted, or copied.
    filemanager_id uuid not null
);
