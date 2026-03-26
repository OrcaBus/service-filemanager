-- The default should be false since the value is determined when resetting the state.
alter table s3_object alter column is_current_state set default false;

-- Ensures that at most one record per (bucket, key) has is_current_state = true.
create unique index s3_object_current_state_unique on s3_object (bucket, key) where is_current_state = true;
