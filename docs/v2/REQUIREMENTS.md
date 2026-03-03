# Filemanager V2 Requirements

The following document details filemanager user requirements for designing the V2 refactor. The aim of the requirements
and V2 design is to determine what is actually required of a filemanager in order to increase the filemanager's
maintainability, reliability and performance. Ideally the new filemanager should be more targeted and leaner, so that it
only deals with requirements that it needs to.

The following requirements represent a list of **possible** requirements that a filemanager could do. This doc is
work-in-progress including the design section. Anything could be included or removed, with a discussion on scope.
Some requirements might be missing. Possible discussion points are contained within notes.

## User Requirements

In the context of the filemanager, the user requirements can be taken two ways. Either someone manually
querying the filemanager, or another service or system in OrcaBus relying on the filemanager for outputs.

### 1. Provide a way for users to query an object on S3

The filemanager must accurately reflect what is currently on S3. When a user asks for an object at a given bucket
and key, that object must also currently exist on S3. This must yield the same **object** as an
`aws s3api head-object --bucket bucket --key key`.

### 2. Provide a way for users to query for multiple objects on S3 based on metadata

Similar to [1][req-1], except returning multiple objects based on the key pattern, buckets, checksums, etags or storage
classes, dates or other S3 metadata.

> [!NOTE]
> Which attributes are actually required for querying storage, possibly the less common ones like `date` are unnecessary.

### 3. Provide a way for users to query the history of objects

The filemanager must track how an object changes over time on the same key. This information should be made available
to the user and should show the complete history of the object including all versions created and deleted.

> [!NOTE]
> What information should be recorded as part of the history? Are creations and deletions enough, or should this also
> include all changes made to the metadata of objects, such as tags or storage classes?

### 4. Allow users to see how an object moves between locations

In addition to what S3 provides natively, the filemanager must be able to show when an object moves from one key or
bucket location to another. It must recognise that a move between locations represents the same object entity.

> [!NOTE]
> Would tracking moves using a checksum be enough? Noting, that this is not the same thing as knowing how a specific
> object moves because there may be duplicate objects with the same checksum that could be tracked individually.
> However, checksums for this purpose maybe be enough.

### 5. Provide long-lived presigned URLs to objects

The filemanager must provide presigned URLs to any objects that it has access to for a long duration, e.g. 7 days.

### 6. Annotations can be applied to single objects, or groups of objects

See [8][req-8] and [9][req-9] for a description of annotations.

For example, a `portal_run_id` applies to a group of objects that all have the same `portal_run_id`. There must be an
ability for users to annotate multiple objects in a group, and groups may overlap.

> [!NOTE]
> Are there any use-cases for this that aren't the `portal_run_id`?

### 7. There must be checksumming capabilities to find identical objects

There must be support for all built-in AWS S3 checksums, and comparison logic to determine if two objects are the
same. There could also be support for calculating checksums if they are missing on objects.

There could be logic that determines if objects are the same through proxy of other objects with different types of
checksums.

This requirement can be used to support [4][req-4], and also find duplicate objects.

### 8. Annotate objects with the `portal_run_id`

Objects that the filemanager tracks must be annotated with the `portal_run_id` where applicable. This role is currently
performed by the `fmannotator` in response to `WorkflowStateChange` events.

> [!NOTE]
> The `portal_run_id` is also present statically in the key path. Does this requirement need to be performed dynamically
> using events, or could it just be a static property of the key path? Dynamic `portal_run_id`s are more flexible as
> they allow specific files to be annotated based on events, rather than all files containing `*/<portal_run_id>/*`.

### 9. Allow other business-logic annotations

Similar to [8][req-8], allow other arbitrary annotations that represent some business logic in the OrcaBus system.

> [!NOTE]
> Is there anything other than the `portal_run_id`? What other tags could objects have?

### 10. Allow users to respond to any annotation

When the filemanager annotates the `portal_run_id` it must provide a way for users/services to respond to this and
be notified when an object has obtained its `portal_run_id` annotation. The same applies for any other annotation.

> [!NOTE]
> Implementation-wise I imagine that this would take the form of an event based system that publishes "annotation done"
> events for a set of objects.

### 11. Allow users to respond to object moves

Similar to [10][req-10], except when an object moves that the filemanager is tracking, it must provide a way for users/services
to respond to a moved object and be notified of it.

### 12. Allow automatically transitioning object lifecycle

The filemanager must be able to transition object storage classes automatically, based on pre-defined static rules or
in response to user requests.

> [!NOTE]
> Implementation-wise this one is fairly open depending on what's required. Should this be done statically using S3
> tags? Should it be in response to certain events in the orcabus system? Should the filemanager even be worried about
> this?

### 13. Allow automatically moving objects between locations

Similar to [12][req-12], the filemanager must be able to move an object's location automatically, based on pre-defined static
rules or in response to user requests.

> [!NOTE]
> Is this even something that the filemanager should have to deal with? Should it be implemented in response to
> specific events?

### 14. Provide all of the above functionality for a different cloud storage backend

As well as supporting S3, the filemanager must support other object-based storage backends like GCP, R2 or ICA.
Functionality between backends should be preserved. For example, if an object moves from S3 to GCP the filemanager
should be able to track it as the same object according to [4][req-4].

## System Requirements

### 1. The filemanager must have a set of permissions that allows it to perform operations

The filemanager should have IAM roles and policies that allow it to interact with S3 and other AWS services on behalf
of other OrcaBus services. This requirement supports a separation of concerns with regard to security so that other
services do not have to worry about.

This will include IAM roles that have access to S3 for obtaining metadata for user requirements like [1][req-1] and [2][req-2] or
presigning URLs for [5][req-5].

### 2. APIs must be read-only and database modifying operations should involve the event system

Any filemanager API should only be allowed to perform read-only actions such as those described by user
requirements [1][req-1], [2][req-2], [3][req-3], [4][req-4], [5][req-5], [6][req-6] or [7][req-7]. Anything that must
modify the internal database of the filemanager should use the event bus, such as for requirements [8][req-8],
[9][req-9], [10][req-10] or [11][req-11].

> [!NOTE]
> Should the filemanager be part of the event system? There could be multiple services, with one service interacting
> with events, while the core service only deals with S3 state.

This requirement would be a departure from the current system which allows annotating objects using a POST/PATCH
command.

### 3. The filemanager as part of orchestration should only track orchestration-related buckets

Instead of tracking all buckets, the filemanager should have its scope narrowed to track only buckets required for
orchestration, such as the cache buckets or archive buckets.

> [!NOTE]
> Which buckets are relevant? I think this depends on which requirements are in scope.

### 4. The filemanager's internal state must be ingestable by downstream processes

Downstream processes like the OrcaHouse must be able to mirror database state of the filemanager.

> [!NOTE]
> This should be met by default if implementing the filemanager as a database-based service.

### 5. The filemanager must provide a mechanism to replay all events leading up to a given database state

The filemanager must be able to recreate its database state from a backup of all the events that it has ingested or
depended on.

> [!NOTE]
> This could be challenging to implement depending on how the filemanager sources information. It also might not be
> necessary or could be provided through other means like tracking changes on the database-level with a history table.

## Testing Requirements

### 1. There must be integration tests using real bucket configurations and policies

The filemanager will likely rely on bucket policies and roles to implement correct behaviour. This should be tested in
a staging environment to ensure that the filemanager obtains the correct database state from a given bucket, and
acts correctly on any API/event based operations.

## Performance Requirements

### 1. The filemanager should reflect the state of any S3 objects, movements or annotations within a few seconds/5 minutes/1 hour

Ideally the performance requirements of the filemanager include the ability reflect changes in S3 as fast as possible
(e.g. within a few seconds). However, this is highly dependent on how the filemanager sources information from AWS.

S3 event are the fastest source of information, and should arrive within a few seconds. Whereas S3 metadata tables
have a 5 minute delay for the journal table and a 1 hour delay for the inventory table.

> [!NOTE]
> In the AWS docs it states that the journal table is available "in near real time", however from testing, the table
> appears to refresh every 5 minutes.

Also, S3 events only contain the base object, without any additional metadata like storage classes or checksums.
To obtain this metadata, additional `HeadObject` calls would be required which introduces some more delay. This could
affect user requirements [1][req-1], [2][req-2], [3][req-3] or [7][req-7].

So depending on the source of information, the following performance can be expected:

| Source                      | Delay     | Comment                                                                                                    |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| S3 Events                   | <1 minute | Only applicable to the base object state, and does not include metadata like storage classes or checksums. |
| S3 Metadata Journal Table   | 5 minutes | Includes metadata and tags.                                                                                |
| S3 Metadata Inventory Table | 1 hour    | Includes metadata and tags.                                                                                |

## Possible Designs & Discussion

Given the user requirements, there is a possibility to split the filemanager into 3 kinds of services or components.
Requirements [1][req-1] - [7][req-7] are the core ingester service that handles object state on S3. Requirements
[8][req-8] - [11][req-11] interact with the OrcaBus event system and annotate data based on orcabus business rules.
Requirements [12][req-12] and [13][req-13] are related to transitioning or moving data on S3.

### Ingester Service

Fulfils requirements [1][req-1] - [7][req-7].

The ingester service is like the current core filemanager service. It handles data from S3 and maintains a database
representing the current state on S3. The biggest change from the original filemanager would be new sources of data and
an overhaul of how the data is represented on the database.

The strongest source of truth for information about S3 is the S3 metadata tables, however these come with a performance
disadvantage. TFor the V2 filemanager, using S3 events, the metadata journal
table, and the metadata inventory table to achieve indexing speed and consistency over time seems like it could be a good
approach.

This involves taking the three sources of information, and feeding them into the current state and history tables
for the filemanager, which keep track of the state. The information flows from S3 events to updates on the journal table
to the inventory table to ensure that the state is consistent. The current state table represents all objects currently
available on S3, and the history table represents historical records.

When reconciling S3 events with S3 Metadata Tables, both the S3 events and journal table represent the same information.
The journal table would be preferenced over time as a more accurate source of information. The inventory table would be
considered the most accurate for the current state, however the events and journal table could be used to build an
anticipated state before the inventory table is updated.

> [!NOTE]
> We could choose to allow the history table to grow forever, or eventually transition it every x months/years to a more
> permanent storage, and away from an active table.

The underlying database representation of the S3 state could have the current and history tables separate, similar to how
S3 tables has a journal and inventory table. This is to ensure that queries on the current state are as fast as possible.

The ingester service will also maintain an API layer that responds to user requests on the S3 state, similar to the
current filemanager. However, there should be no data-modifying API requests available to users. Data modifying
requirements could be addressed by other components and services.

### Annotation Service

Fulfills requirements [8][req-8] - [11][req-11].

The annotation service could be responsible for responding to events from the OrcaBus. This is similar to the current
fmannotator service. The core difference is that this service may be used to annotate something other than the
`portal_run_id`, and also may publish "annotation done" events back to the event bus.

This service will depend on data sourced from the Ingester service in order to figure out which objects should be
annotated. Currently, the fmannotator uses a PATCH API request to perform annotations, however since the API should be
read-only, there needs to be another way to address this requirement.

For events published back to the event bus, this would be useful for services that depend on waiting for the `portal_run_id`
to be annotated. Instead, they could wait on an event stating the records have been annotated correctly. The events
themselves could be grouped to address a set of objects annotated, rather than single objects.

This service is separate from the core ingester service to provide a separation of concerns, which allows the main
ingester service to be leaner and have a clearer purpose. It also allows the main service to not be tied down with
the event system, or with business logic use cases.

### Data Service

Fulfills requirements [12][req-12] and [13][req-13].

This service could be responsible for transitioning object lifecycle or moving objects. Currently, this is handled by
various other services like the data mover. Similar to the annotation service, this service could
respond to events from the event bus to transition objects in an automated way.

One mechanism by which this service could operation, is to tag objects to determine how to transition them.
It could also respond to timers that should move objects between buckets.

> [!NOTE]
> I think this service would require discussion on how to implement or scope requirements. Should it just
> do lifecycle transitions? Is it even necessary because static rules could already solve this?
>
> Also, it's not clear how this service would depend on the main filemanager ingester service, if at all.

### Shared Database or Multiple Databases?

[System requirement 2][sys-req-2] states that APIs should be read-only. There is a question of how separate services or components
can update a database state to achieve something like annotation. E.g., the current fmannotator uses a PATCH request
to update the filemanager's database with a `portal_run_id`.

One approach is to have separate services act on the same shared database tables. This kind of design is more of a monolith that
has both the annotation service and ingestion service sharing tables.

**Advantages:**

- Simpler implementation.
- Faster and more performant as it lives closer to the database.

**Disadvantages:**

- Tighter coupling.
- Less clear separation of concerns.

Another approach is to have all filemanager services maintain their own database tables. This would be more in line with a
microservices approach, and would involve the ingester service focussing on ingesting objects. The annotation service
would maintain the database for annotations and would coordinate with the ingester service to find which files need to
be annotated.

When a user queries for data, one of the services must aggregate the request or there the user would be required to
perform two API calls and aggregate the requests themselves. E.g. to find objects with a given `portal_run_id`,
a single user request would go across both the ingester and annotation service.

> [!NOTE]
> The actual database design is not yet clear. The ingester service would hold object-level data like the current
> filemanager. Would the annotation service hold the `portal_run_id` annotation linked to primary keys from the ingester
> service? Or dynamically computed?

**Advantages:**

- Less coupling, clear separation of concerns.
- Unburdens filemanager from the event system and any business logic.

**Disadvantages:**

- Slower queries as there are multiple API requests that require data aggregation.
- Possibly not warranted for just a `portal_run_id`, especially if the `portal_run_id` can just be statically obtained
  from the key path.

> [!NOTE]
> I think it depends on the scope of requirements whether having this separation is justified. If the `portal_run_id`
> can just be obtained from the key path then there might not be a reason to split.

#### Diagrams

Diagrams for both a shared database and multiple databases are shown below.

**For a single database:**

![single_database.drawio.svg](single_database.drawio.svg)

**For multiple databases:**

![multiple_databases.drawio.svg](multiple_databases.drawio.svg)

> [!NOTE]
> It's not clear whether the data service would need to interact with the ingester service at all, if this service
> exists in the first place.

#### Should the filemanager just be part of OrcaHouse?

The OrcaHouse contains the data warehousing for OrcaBus in the OrcaVault. Instead of implementing a filemanager, the
Orcavault could be responsible for ingesting S3 metadata tables in its ETL process to support filemanager use-cases.

Whether this is feasible or not depends on which requirements are needed from the filemanager. The focus of the OrcaHouse
is as a downstream process that aggregates all OrcaBus data sources. It is not intended to be used as part of orchestration
itself. If the filemanager doesn't need to be involved in orchestration, or there are other solutions to filemanager
use-cases, then it could be implemented as part of the OrcaHouse.

One of the filemanager's use-cases is to support the OrcaUi to serve data to users. This use-case is intended to be
handled by the OrcaHouse. Here it makes sense that the filemanager is not required directly. Another use case is object
history tracking. Placing this requirement in the OrcaHouse potentially makes more sense if history tracking is never
used for automation.

However, there seem to be automation use-cases for the filemanager as well (see below). Most of these use-cases stem from
automation and querying around the `portal_run_id` and generating presigned URLs. These could potentially be replaced
by other solutions. For example, a dedicated presign URL role could be used across any service that needs presigned URLs,
and the `portal_run_id` could be obtained from the key path.

Another use-case is tracking object moves. This is perhaps one of the stronger use-cases, as it may
be harder for services to implement this logic on their own. There is also a convenience for services using the
filemanager so that they are not required to implement this on their own. Another point is that the filemanager
represents a clearer security boundary for services interacting with S3, as it has permissions to view or
presign files in a single place.

Summarising moving the filemanager to OrcaHouse:

**Advantages:**

- Simpler design.
- Lower implementation burden.
- Clear mapping from S3 metadata tables to data warehouse design.

**Disadvantages:**

- More fragmented service responsibilities, some services may implement their own filemanager logic.
- Possibly repeated code.
- Less options for expanded use-cases like data moving, different backends or more advanced automation.
- Less clear permission boundary for accessing files or creating presigned URLs.

> [!NOTE]
> One option would be to move some use-cases to the OrcaHouse, while keeping a dedicated filemanager service for
> others. For example, I think history tracking could easily be part of OrcaHouse, as I'm not sure
> that there are any automation use-cases for object history.

#### Filemanager Current Uses

The following is a list of current filemanager uses.

> [!NOTE]
> I think there should be a discussion on which of these use-cases will remain, which might not be necessary, or which
> ones are not yet implemented and would be good future use-cases.

**Found using GitHub search:**

- https://github.com/search?q=org%3AOrcaBus%20filemanager&type=code
- https://github.com/search?q=org%3AOrcaBus+file.&type=code

**Current use-cases:**

- https://github.com/OrcaBus/service-icav2-wes-manager
  - Sync `portal_run_id` to output URI location.
- https://github.com/OrcaBus/service-data-sharing-manager
  - Lists files using `portal_run_id`.
  - Generates long-lived presigned URLs.
- https://github.com/OrcaBus/service-bssh-to-aws-s3-copy-manager
  - Crawls filemanager and checks it has correct state.
- https://github.com/OrcaBus/service-dragen-tso500-ctdna-pipeline-manager
  - Crawls filemanager and checks that it has the correct state.
- https://github.com/OrcaBus/service-bclconvert-interop-qc-pipeline-manager
  - Lists objects and generates presigned URLs.
- https://github.com/OrcaBus/service-fastq-unarchiving-manager
  - Updates ingest id.
- https://github.com/OrcaBus/service-fastq-decompression-manager
  - Lists objects and generates presigned URLs.
- https://github.com/OrcaBus/service-oncoanalyser-wgts-dna-pipeline-manager
  - Lists objects based on `portal_run_id`.
- https://github.com/OrcaBus/service-fastq-glue
  - Lists objects based on `portal_run_id`.
- https://github.com/OrcaBus/service-sash-pipeline-manager
  - Lists objects based on `portal_run_id`.
- https://github.com/OrcaBus/service-dragen-wgts-dna-pipeline-manager
  - Lists objects and generates presigned URLs.
- https://github.com/OrcaBus/service-oncoanalyser-wgts-both-pipeline-manager
  - Lists objects based on `portal_run_id`.
- https://github.com/OrcaBus/orca-ui
  - Lists objects and creates presigned URLs.
- https://github.com/OrcaBus/service-sequence-run-manager/blob/32fc8ba38e0e408befcfe3664cfb829aa6764cba/app/sequence_run_manager/models/sample_sheet.py#L23
  - Possible use to add checksum?

## Links

- [IBM DOORS Requirements Documentation](https://www.ibm.com/docs/en/SSYQBZ_9.6.1/com.ibm.doors.requirements.doc/topics/get_it_right_the_first_time.pdf)

[req-1]: #1-provide-a-way-for-users-to-query-an-object-on-s3
[req-2]: #2-provide-a-way-for-users-to-query-for-multiple-objects-on-s3-based-on-metadata
[req-3]: #3-provide-a-way-for-users-to-query-the-history-of-objects
[req-4]: #4-allow-users-to-see-how-an-object-moves-between-locations
[req-5]: #5-provide-long-lived-presigned-urls-to-objects
[req-6]: #6-annotations-can-be-applied-to-single-objects-or-groups-of-objects
[req-7]: #7-there-must-be-checksumming-capabilities-to-find-identical-objects
[req-8]: #8-annotate-objects-with-the-portal_run_id
[req-9]: #9-allow-other-business-logic-annotations
[req-10]: #10-allow-users-to-respond-to-any-annotation
[req-11]: #11-allow-users-to-respond-to-object-moves
[req-12]: #12-allow-automatically-transitioning-object-lifecycle
[req-13]: #13-allow-automatically-moving-objects-between-locations
[req-14]: #14-provide-all-of-the-above-functionality-for-a-different-cloud-storage-backend
[sys-req-1]: #1-the-filemanager-must-have-a-set-of-permissions-that-allows-it-to-perform-operations
[sys-req-2]: #2-apis-must-be-read-only-and-database-modifying-operations-should-involve-the-event-system
[sys-req-3]: #3-the-filemanager-as-part-of-orchestration-should-only-track-orchestration-related-buckets
[sys-req-4]: #4-the-filemanagers-internal-state-must-be-ingestable-by-downstream-processes
[sys-req-5]: #5-the-filemanager-must-provide-a-mechanism-to-replay-all-events-leading-up-to-a-given-database-state
