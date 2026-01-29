-- Create an index targeting the version id which is primarily used to reset the current state.
create index version_id_index on s3_object (version_id, sequencer desc nulls last);
