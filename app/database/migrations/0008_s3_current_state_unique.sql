-- The default should be false since the value is determined when resetting the state. This is required to ensure
-- the index doesn't fail immediately. We run this first to acquire an access exclusive lock on the table to prevent
-- concurrent modifications for the rest of the transaction.
-- See https://www.postgresql.org/docs/current/sql-altertable.html
alter table s3_object alter column is_current_state set default false;

-- Set all `is_current_state` to false so that only the required values need updating.
update s3_object set is_current_state = false where is_current_state = true;

-- Like `reset_current_state`, this selects all valid current versions of an object. Instead of using cross join with
-- a where clause on bucket and key, this will partition directly over `bucket`, `key` and `version_id`. This should
-- give the same result set where the row number reflects the ordering from most current to least for a single object
-- version.
with current_versions as (
    select
        s3_object_id,
        bucket,
        key,
        is_delete_marker,
        sequencer,
        (
            row_number() over (partition by bucket, key, version_id order by sequencer desc nulls last) = 1 and
            (is_delete_marker or event_type = 'Created')
        ) as is_current_version
    from s3_object
),
-- Like the `reset_current_state`, this selects the single event that is the current state for the key. Instead of
-- computing the `is_current_state` bool in the inner query, it fetches only `true` values from the inner row_number
-- which represents the records that need updating. Since we set all values of `is_current_state` to false previously,
-- this should be more efficient in the update as it will only set `is_current_state` to true on the records that need
-- updating.
current_state as (
    select s3_object_id from (
        select
            s3_object_id,
            is_current_version,
            is_delete_marker,
            row_number() over (
                partition by
                    bucket,
                    key,
                    is_current_version
                order by sequencer desc nulls last
            ) as rn
        from current_versions
    ) sub
    where rn = 1 and is_current_version and not is_delete_marker
)
-- Ordering and locking is not required unlike `reset_current_state` as the table is locked exclusively.
update s3_object
set is_current_state = true
from current_state
where s3_object.s3_object_id = current_state.s3_object_id;

-- Ensures that at most one record per (bucket, key) has is_current_state = true.
create unique index s3_object_current_state_unique on s3_object (bucket, key) where is_current_state = true;
