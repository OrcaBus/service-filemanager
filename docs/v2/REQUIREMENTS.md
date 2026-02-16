### Filemanager features and requirements

### User Requirements

1. Provide a way for users to query an object on S3.

The filemanager must accurately reflect what is currently on S3. When a user asks for an object at a given bucket
and key, that object must also currently exist on S3. This must yield the same **object** as an
`aws s3api head-object --bucket bucket --key key`.

2. Provide a way for users to query for multiple objects on S3 based on metadata.

Similar to above, except returning multiple objects based on the key pattern, buckets, checksums, etags or storage
classes, dates or other S3 metadata.

> [!NOTE]
> Which attributes are actually required for querying storage, possibly the less common ones like date are unnecessary.

3. Provide a way for users to query the history of objects.

The filemanager must track how an object changes over time on the same key. This information should be made available
to the user and should show the complete history of the object including all versions created and deleted.

> [!NOTE]
> What information should be recorded as part of the history? Are creations and deletions enough, or should this also
> include all changes made to the metadata of objects, such as tags or storage classes.

4. Allow users to see how an object moves between locations.

In addition to what S3 provides natively, the filemanager must be able to show when an object moves from one key or
bucket location to another. It must recognise that a move between locations represents the same object entity.

> [!NOTE]
> Would tracking moves using a checksum be enough? Noting that this is not the same thing as knowing how a specific
> object moves because there may be duplicate objects with the same checksum that could be tracked individually.
> However, checksums for this purpose maybe be enough.

5. Annotate objects with the `portal_run_id`.

Objects that the filemanager tracks must be annotated with the portal run id where applicable. This role is currently
performed by the `fmannotator` in response to `WorkflowStateChange` events.

> [!NOTE]
> The `portal_run_id` is also present statically in the key path. Does this requirement need to be performed dynamically
> using events, or could it just be a static property of the key path? Dynamic `portal_run_id`s are more flexible as
> they allow specific files to be annotated based on events, rather than all files containing `*/<portal_run_id>/*`.

6. Allow users to respond to `portal_run_id` annotation.

When the filemanager annotates the `portal_run_id` it must provide a way for users/services to respond to this and
be notified when an object has obtained it's `portal_run_id` annotation.

> [!NOTE]
> Possibly not required.

7. Allow users to respond to object moves.

When an object moves that the filemanager is tracking, it must provide a way for users/services to respond to a moved
object and be notified of it.

> [!NOTE]
> Possibly not required.

8. Provide long-lived presigned URLs to objects.

The filemanager must provide presigned URLs to any objects that it has access to for a long duration (7 days).

9. Allow automatically transitioning object lifecycle.

The filemanager must be able to transition object storage classes automatically, based on pre-defined static rules or
in response to user or service requests.

> [!NOTE]
> Implementation wise this one is fairly open depending on what's required. Should this be done statically using S3
> tags? Should it be in response to certain events in the orcabus system? Should the filemanager even be worried about
> this?

10. Allow automatically moving objects between locations.

The filemanager must be able to move an object's location automatically, based on pre-defined static rules or
in response to user or service requests.

> [!NOTE]
> Similar to above. Is this even necessary? Should it be implemented in response to specific events?

11. Provide all of the above functionality for a different cloud storage backend.

As well as supporting S3, the filemanager must support other object-based storage backends like GCP, R2 or ICA.
Functionality between backends should be preserved. For example, if an object moves from S3 to GCP the filemanager
should be able to track it as the same object according to requirement 4.

### System Requirements

1. The filemanager must have a set of permissions that allows it to perform S3 operations.

The filemanager should have IAM roles and policies that allow it to interact with S3 and other AWS services, on behalf
of other orcabus services. One of the points of seperating out the filemanager as service is that it can act as a
security boundary for S3 so that other services do not have to do this themselves, supporting a separation of concerns.

This will include IAM roles that have access to S3 for obtaining metadata for user requirements like 1. and 2. or
presigning URLs for 8.

2. APIs must be read-only and database modifying operations should involve the event system.

Given a filemanager API, this should only be able to perform read-only actions such as those described by user
requirements such as 1., 2., 3., 4., or 8. Anything that must modify the internal database of the filemanager should use
the event bus, such as 5. or 9.

> [!NOTE]
> I'm not sure exactly how this could work if the filemanager is intended to avoid being part of the event system. Maybe
> it should be part of the event system? Or there should be multiple satellite services that interact with events, with
> core filemanager logic being it's own separate service.

This requirement would be a departure from the current system which allows annotating objects using a POST/PATCH
command.

3. The filemanager as part of orchestration should only track orchestration-related buckets.

Instead of tracking all buckets, the filemanager should have it's scope narrowed to track only buckets required for
orchestration, such as the cache buckets or archive buckets.

> [!NOTE]
> I'm not sure exactly how this could work if the filemanager is intended to avoid being part of the event system. Maybe
> it should be part of the event system? Or there should be multiple satellite services that interact with events, with
> core filemanager logic being it's own separate service.

4. The filemanager's internal state must be ingestable by downstream processes.

Downstream processes like the orcahouse must be able to provide the database state of the filemanager.

> [!NOTE]
> This should be met by default if implementing the filemanager as a database-based service.

5. The filemanager must provide a mechanism to replay all events leading up to a given database state.

If the filemanager obtains its state from event sources like S3 events, and implements system requirement 2., then there
must be a mechanism to go back to a point-in-time of the database by replaying certain events.

> [!NOTE]
> This could be challenging to implement depending on how the filemanager sources information. It also might not be
> necessary or could be provided through other means like tracking changes on the database-level with a history table.

### Testing requirements

1. There must be integration tests using real bucket configurations and policies.

The filemanager will likely rely on bucket policies and roles to implement correct behaviour. This should be tested in
a staging environment to ensure that the filemanager obtains the correct database state from a given bucket, and
acts correctly on any API/event based operations.

### Performance requirements

1. The filemanager should reflect the state of any S3 objects, movements or annotations within
   a few seconds/5 minutes/1 hour.

Ideally the performance requirements of the filemanager include the ability reflect changes in S3 as fast as possible
(e.g. within a few seconds). However, this is highly dependent on how the filemanager sources information from AWS.

S3 event are the fastest source of information, and should arrive within a few seconds. Whereas S3 metadata tables
have a 5 minute delay for the journal table and a 1 hour delay for the inventory table.

> [!NOTE]
> In the AWS docs it states that the journal table is available "in near real time", however from testing, the table
> appears to refresh every 5 minutes.

Also, S3 events only contain the base object, without any additional metadata like storage classes or checksums.
To obtain this metadata, additional `HeadObject` calls would be required which introduces some more delay. This could
affect user requirements 1., 2., or 3.

So depending on the source of information, the following performance can be expected:

| Source                      | Delay         | Comment                                                                                                    |
| --------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| S3 Events                   | A few seconds | Only applicable to the base object state, and does not include metadata like storage classes or checksums. |
| S3 Metadata Journal Table   | 5 minutes     | Includes metadata and tags.                                                                                |
| S3 Metadata Inventory Table | 1 hour        | Includes metadata and tags.                                                                                |

### Proposed design

The strongest source of truth for information about S3 is the S3 metadata tables, however these come with a performance
disadvantage. Therefore, the proposed design for the V2 filemanager involves using both S3 events and the metadata
tables to achieve indexing speed and consistency over time.

The design involves taking the three sources of information, and feeding them into the current state and history tables
for the filemanager, which keep track of the state. The information flows from S3 events to updates on the journal table
to the inventory table to ensure that the state is consistent. The current state table represents all objects currently
available on S3, and the history table represents historical records.

> [!NOTE]
> We could choose to allow the history table to grow forever, or eventually transition it every x months/years to a more
> permanent storage, and away from an active table.
