import { FileManagerStatelessConfig } from './filemanager-stateless-stack';
import {
  accessKeySecretArn,
  computeSecurityGroupName,
  databasePort,
  dataSharingCacheBucket,
  dbClusterEndpointHostParameterName,
  eventSourceQueueName,
  externalProjectBuckets,
  fileManagerIngestRoleName,
  fileManagerInventoryBucket,
  fileManagerPresignUser,
  fileManagerPresignUserSecret,
  icav2ArchiveAnalysisBucket,
  icav2ArchiveFastqBucket,
  icav2PipelineCacheBucket,
  ntsmBucket,
  oncoanalyserBucket,
  vpcProps,
} from './constants';
import { StageName } from '@orcabus/platform-cdk-constructs/utils';
import { getDefaultApiGatewayConfiguration } from '@orcabus/platform-cdk-constructs/api-gateway';
import { FileManagerStatefulConfig } from './filemanager-stateful-stack';
import { Function } from './constructs/function';
import { EventSourceProps } from '../components/event-source';

export const fileManagerBuckets = (stage: StageName): string[] => {
  const eventSourceBuckets = [oncoanalyserBucket[stage], icav2PipelineCacheBucket[stage]];
  // Note, that we only archive production data, so we only need access to the archive buckets in prod.
  if (stage == 'PROD') {
    eventSourceBuckets.push(icav2ArchiveAnalysisBucket[stage]);
    eventSourceBuckets.push(icav2ArchiveFastqBucket[stage]);
  }
  eventSourceBuckets.push(ntsmBucket[stage]);
  eventSourceBuckets.push(dataSharingCacheBucket[stage]);

  /* Extend the event source buckets with the external project buckets */
  for (const bucket of externalProjectBuckets[stage]) {
    eventSourceBuckets.push(bucket);
  }

  return eventSourceBuckets;
};

export const fileManagerInventoryBuckets = (stage: StageName): string[] => {
  const inventorySourceBuckets = [];
  if (stage == 'BETA') {
    inventorySourceBuckets.push(fileManagerInventoryBucket[stage]);
  }
  return inventorySourceBuckets;
};

export const getFileManagerStatelessProps = (stage: StageName): FileManagerStatelessConfig => {
  const inventorySourceBuckets = fileManagerInventoryBuckets(stage);
  const eventSourceBuckets = fileManagerBuckets(stage);

  return {
    securityGroupName: computeSecurityGroupName,
    vpcProps,
    eventSourceQueueName: eventSourceQueueName,
    databaseClusterEndpointHostParameter: dbClusterEndpointHostParameterName,
    port: databasePort,
    migrateDatabase: true,
    accessKeySecretArn: accessKeySecretArn[stage],
    inventorySourceBuckets,
    eventSourceBuckets,
    fileManagerRoleName: fileManagerIngestRoleName,
    apiGatewayCognitoProps: {
      ...getDefaultApiGatewayConfiguration(stage),
      apiName: 'FileManager',
      customDomainNamePrefix: 'file',
    },
  };
};

export const eventSourcePattern = () => {
  return {
    $or: [
      {
        size: [{ numeric: ['>', 0] }],
      },
      {
        key: [{ 'anything-but': { wildcard: ['*/'] } }],
      },
    ],
  };
};

export const eventSourcePatternCache = () => {
  // NOT KEY in cache AND (SIZE > 0 OR NOT KEY ends with "/") expands to
  // (NOT KEY in cache and SIZE > 0) OR (NOT KEY in cache and NOT KEY ends with "/")\
  return {
    $or: [
      {
        key: [{ 'anything-but': { wildcard: ['byob-icav2/*/cache/*'] } }],
        size: [{ numeric: ['>', 0] }],
      },
      {
        key: [{ 'anything-but': { wildcard: ['byob-icav2/*/cache/*', '*/'] } }],
      },
    ],
  };
};

export const getEventSourceConstructProps = (stage: StageName): EventSourceProps => {
  const eventTypes = [
    'Object Created',
    'Object Deleted',
    'Object Restore Completed',
    'Object Restore Expired',
    'Object Storage Class Changed',
    'Object Access Tier Changed',
  ];

  const props = {
    queueName: eventSourceQueueName,
    maxReceiveCount: 3,
    rules: [
      {
        bucket: oncoanalyserBucket[stage],
        eventTypes,
        patterns: eventSourcePattern(),
      },
      {
        bucket: icav2PipelineCacheBucket[stage],
        eventTypes,
        patterns: eventSourcePatternCache(),
      },
    ],
  };

  if (stage === 'PROD') {
    props.rules.push({
      bucket: icav2ArchiveAnalysisBucket[stage],
      eventTypes,
      patterns: eventSourcePattern(),
    });
    props.rules.push({
      bucket: icav2ArchiveFastqBucket[stage],
      eventTypes,
      patterns: eventSourcePattern(),
    });
  }

  // Add the ntsm bucket rule
  props.rules.push({
    bucket: ntsmBucket[stage],
    eventTypes,
    patterns: eventSourcePattern(),
  });

  props.rules.push({
    bucket: dataSharingCacheBucket[stage],
    eventTypes,
    patterns: eventSourcePattern(),
  });

  for (const bucket of externalProjectBuckets[stage]) {
    props.rules.push({
      bucket: bucket,
      eventTypes,
      patterns: eventSourcePattern(),
    });
  }

  return props;
};

export const getFileManagerStatefulProps = (stage: StageName): FileManagerStatefulConfig => {
  const inventorySourceBuckets = fileManagerInventoryBuckets(stage);
  const eventSourceBuckets = fileManagerBuckets(stage);

  return {
    accessKeyProps: {
      userName: fileManagerPresignUser,
      secretName: fileManagerPresignUserSecret,
      policies: Function.formatPoliciesForBucket(
        // Only need read only access to the buckets. The filemanager will only use this access key for pre-signing URLs.
        // All regular actions will use the role.
        [...eventSourceBuckets, ...inventorySourceBuckets],
        [...Function.getObjectActions()]
      ),
    },
    eventSourceProps: getEventSourceConstructProps(stage),
  };
};
