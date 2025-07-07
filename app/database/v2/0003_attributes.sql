-- An attributes table represents an arbitrary group of objects that can be annotated with attributes.
create table attributes (
    -- The table primary key.
    attributes_id uuid not null primary key,

    -- The attributes of the group.
    attributes json not null
);

-- A table to represent the many-to-many relation between an object and attributes.
create table attributes_object (
    -- The key of the attributes table referenced in the relation.
    attributes_id uuid references attributes,
    -- The key of the object referenced in the relation.
    object_id uuid references object,

    -- The table primary key.
    constraint attributes_object_relation primary key (attributes_id, object_id)
);

-- A table to represent the many-to-many relation between a historical object and attributes.
create table attributes_historical_object (
    -- The key of the attributes table referenced in the relation.
    attributes_id uuid references attributes,
    -- The key of the object referenced in the relation.
    historical_object_id uuid references historical_object,

    -- The table primary key.
    constraint attributes_historical_object_relation primary key (attributes_id, historical_object_id)
);
