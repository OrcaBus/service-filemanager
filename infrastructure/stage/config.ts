import { FileManagerStatelessConfig } from './filemanager-stateless-stack';
import { getDefaultApiGatewayConfiguration } from '@orcabus/platform-cdk-constructs/api-gateway';
import { Function } from './functions/function';
import { EventSourceProps } from '../components/event-source';
import { FileManagerStatefulConfig } from './filemanager-stateful-stack';
import {
  accessKeySecretArn,
  fileManagerBuckets,
  fileManagerCacheBuckets,
  fileManagerIngestRoleName,
  fileManagerPresignUser,
  fileManagerPresignUserSecret,
} from '@orcabus/platform-cdk-constructs/shared-config/file-manager';
import { StageName } from '@orcabus/platform-cdk-constructs/shared-config/accounts';
import { EVENT_SOURCE_QUEUE_NAME } from './constants';
import {
  SHARED_SECURITY_GROUP_NAME,
  VPC_LOOKUP_PROPS,
} from '@orcabus/platform-cdk-constructs/shared-config/networking';
import {
  DATABASE_PORT,
  DB_CLUSTER_ENDPOINT_HOST_PARAMETER_NAME,
} from '@orcabus/platform-cdk-constructs/shared-config/database';

export const getFileManagerStatelessProps = (stage: StageName): FileManagerStatelessConfig => {
  const buckets = [...fileManagerBuckets[stage], ...fileManagerCacheBuckets[stage]];

  return {
    securityGroupName: SHARED_SECURITY_GROUP_NAME,
    vpcProps: VPC_LOOKUP_PROPS,
    eventSourceQueueName: EVENT_SOURCE_QUEUE_NAME,
    databaseClusterEndpointHostParameter: DB_CLUSTER_ENDPOINT_HOST_PARAMETER_NAME,
    port: DATABASE_PORT,
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
    queueName: EVENT_SOURCE_QUEUE_NAME,
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
