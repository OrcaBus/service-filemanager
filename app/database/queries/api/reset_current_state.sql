-- Resets the `is_current_state` to false for a set of objects based on the `bucket` and `key`. The current state of
-- an object is the one that represents what S3 sees when fetching a key. I.e. it's the most current version of an
-- object that hasn't been permanently deleted, and is not a delete marker.

-- Unnest input.
with input as (
    select
        *
    from unnest(
        $1::text[],
        $2::text[]
    ) as input (
        bucket,
        key
    )
),
-- This selects all valid current versions of an object, i.e. those that have not been permanently deleted from S3. To
-- do this, the query will partition over version_ids and mark the object version as current if a `Created` event is
-- the latest. Delete markers are treated specially in that they represent a current object version although one that
-- has been deleted.
current_versions as (
    select * from input cross join lateral (
        select
            s3_object_id,
            is_delete_marker,
            sequencer,
            (
                row_number() over (partition by s3_object.version_id order by s3_object.sequencer desc nulls last) = 1 and
                (s3_object.is_delete_marker or s3_object.event_type = 'Created')
            ) as is_current_version
        from s3_object
        where
            input.bucket = s3_object.bucket and
            input.key = s3_object.key
    ) s3_object
),
-- This selects the single event that is the current state for the key, i.e. the record that represents the current
-- version of all versioned objects. To do this, the query partitions over current versions of objects from the previous
-- query and selects the latest. Delete markers are treated specially because they should always be non-current state.
current_state as (
    select
        s3_object_id,
        (
            row_number() over (
                partition by
                    current_versions.bucket,
                    current_versions.key,
                    current_versions.is_current_version
                order by current_versions.sequencer desc nulls last
            ) = 1 and
            current_versions.is_current_version and
            not current_versions.is_delete_marker
        ) as is_current_state
    from current_versions
)
update s3_object
set is_current_state = current_state.is_current_state
from current_state
where s3_object.s3_object_id = current_state.s3_object_id
returning s3_object.s3_object_id, s3_object.is_current_state;
