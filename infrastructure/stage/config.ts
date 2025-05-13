import { FileManagerStatelessConfig } from './filemanager-stateless-stack';
import {
  accessKeySecretArn,
  computeSecurityGroupName,
  databasePort,
  dbClusterEndpointHostParameterName,
  eventSourceQueueName,
  fileManagerBuckets,
  fileManagerCacheBuckets,
  fileManagerIngestRoleName,
  fileManagerPresignUser,
  fileManagerPresignUserSecret,
  vpcProps,
} from './constants';
import { StageName } from '@orcabus/platform-cdk-constructs/utils';
import { getDefaultApiGatewayConfiguration } from '@orcabus/platform-cdk-constructs/api-gateway';
import { FileManagerStatefulConfig } from './filemanager-stateful-stack';
import { Function } from './functions/function';
import { EventSourceProps } from '../components/event-source';

export const getFileManagerStatelessProps = (stage: StageName): FileManagerStatelessConfig => {
  const buckets = [...fileManagerBuckets[stage], ...fileManagerCacheBuckets[stage]];

  return {
    securityGroupName: computeSecurityGroupName,
    vpcProps,
    eventSourceQueueName,
    databaseClusterEndpointHostParameter: dbClusterEndpointHostParameterName,
    port: databasePort,
    migrateDatabase: true,
    accessKeySecretArn: accessKeySecretArn[stage],
    inventorySourceBuckets: buckets,
    eventSourceBuckets: buckets,
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

  const props: EventSourceProps = {
    queueName: eventSourceQueueName,
    maxReceiveCount: 3,
    rules: [],
  };

  for (const bucket of fileManagerCacheBuckets[stage]) {
    props.rules.push({
      bucket,
      eventTypes,
      patterns: eventSourcePatternCache(),
    });
  }

  for (const bucket of fileManagerBuckets[stage]) {
    props.rules.push({
      bucket,
      eventTypes,
      patterns: eventSourcePattern(),
    });
  }

  return props;
};

export const getFileManagerStatefulProps = (stage: StageName): FileManagerStatefulConfig => {
  const buckets = [...fileManagerBuckets[stage], ...fileManagerCacheBuckets[stage]];
  return {
    accessKeyProps: {
      userName: fileManagerPresignUser,
      secretName: fileManagerPresignUserSecret,
      policies: Function.formatPoliciesForBucket(buckets, [...Function.getObjectActions()]),
    },
    eventSourceProps: getEventSourceConstructProps(stage),
  };
};
