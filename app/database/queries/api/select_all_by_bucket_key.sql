-- Select the most recent s3_objects based on the input bucket, key and version_id values
-- into FlatS3EventMessage structs. This query fetches all database objects in S3 for a
-- set of buckets, keys and version_ids.

-- Unnest input.
with input as (
    select
        *
    from unnest(
        $1::text[],
        $2::text[],
        $3::text[]
    ) as input (
        bucket,
        key,
        version_id
    )
)
-- Select objects into a FlatS3EventMessage struct.
select
    s3_object_id,
    s3_object.bucket,
    s3_object.key,
    event_time,
    last_modified_date,
    e_tag,
    sha256,
    storage_class,
    s3_object.version_id,
    sequencer,
    number_duplicate_events,
    size,
    is_delete_marker,
    reason,
    archive_status,
    event_type,
    ingest_id,
    attributes,
    is_current_state,
    0::bigint as "number_reordered"
from input
-- Grab all objects in each input group.
cross join lateral (
    -- Cross join the input with all s3_objects.
    select
        *
    from s3_object
    where
        input.bucket = s3_object.bucket and
        input.key = s3_object.key and
        input.version_id = s3_object.version_id
    order by s3_object.sequencer desc nulls last
)
as s3_object;
