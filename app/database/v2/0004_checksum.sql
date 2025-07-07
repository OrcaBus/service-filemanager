-- The checksum table contains a checksum for an object. This table is like a specialized form
-- of the attributes table.
create table checksum (
    -- The table primary key.
    checksum_id uuid not null primary key,

    -- The name of the checksum, e.g. `md5`.
    checksum_name text not null,
    -- The value of the checksum.
    checksum_value text not null,

    -- The reference to the object table.
    object_id uuid references object,
    -- The reference to the historical object table.
    historical_object_id uuid references historical_object,
    -- A checksum can refer to either an object or historical object.
    check (num_nonnulls(object_id, historical_object_id) = 1)
);
