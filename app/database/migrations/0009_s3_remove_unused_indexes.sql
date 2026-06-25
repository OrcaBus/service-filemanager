-- Remove indexes on s3_object that are unused or redundant.

-- Set the lock timeout just in case in order to not hold `access exclusive` for too long.
set local lock_timeout = '10s';

-- No scans in database as order by already sorts in memory.
drop index if exists sequencer_index;
-- Relatively unused, as reset_current_state only partitions rather than filtering.
drop index if exists version_id_index;
-- Relatively unused as a bool value isn't chosen often.
drop index if exists is_current_state_index;
-- Used, but not useful as the reset_current_state does a fallback to regular bucket, key, version_id constraints anyway.
drop index if exists reset_current_state_index;
