import { FileManagerStatelessConfig } from './filemanager-stateless-stack';
import { getDefaultApiGatewayConfiguration } from '@orcabus/platform-cdk-constructs/api-gateway';
import { Function } from './functions/function';
import { FileManagerStatefulConfig, IngestRules } from './filemanager-stateful-stack';
import { StageName } from '@orcabus/platform-cdk-constructs/shared-config/accounts';
import { FILEMANAGER_INGEST_QUEUE } from './constants';
import {
  SHARED_SECURITY_GROUP_NAME,
  VPC_LOOKUP_PROPS,
} from '@orcabus/platform-cdk-constructs/shared-config/networking';
import {
  DATABASE_PORT,
  DB_CLUSTER_ENDPOINT_HOST_PARAMETER_NAME,
} from '@orcabus/platform-cdk-constructs/shared-config/database';
import {
  FILE_MANAGER_ACCESS_KEY_ARNS,
  FILE_MANAGER_BUCKETS,
  FILE_MANAGER_CACHE_BUCKETS,
  FILE_MANAGER_DOMAIN_PREFIX,
  FILE_MANAGER_INGEST_ROLE,
  FILE_MANAGER_PRESIGN_USER,
  FILE_MANAGER_PRESIGN_USER_SECRET,
} from '@orcabus/platform-cdk-constructs/shared-config/file-manager';

export const getFileManagerStatelessProps = (stage: StageName): FileManagerStatelessConfig => {
  const buckets = [...FILE_MANAGER_BUCKETS[stage], ...FILE_MANAGER_CACHE_BUCKETS[stage]];

  return {
    securityGroupName: SHARED_SECURITY_GROUP_NAME,
    vpcProps: VPC_LOOKUP_PROPS,
    eventSourceQueueName: FILEMANAGER_INGEST_QUEUE,
    databaseClusterEndpointHostParameter: DB_CLUSTER_ENDPOINT_HOST_PARAMETER_NAME,
    port: DATABASE_PORT,
    migrateDatabase: true,
    accessKeySecretArn: FILE_MANAGER_ACCESS_KEY_ARNS[stage],
    inventorySourceBuckets: buckets,
    eventSourceBuckets: buckets,
    fileManagerRoleName: FILE_MANAGER_INGEST_ROLE,
    apiGatewayCognitoProps: {
      ...getDefaultApiGatewayConfiguration(stage),
      apiName: 'FileManager',
      customDomainNamePrefix: FILE_MANAGER_DOMAIN_PREFIX,
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

export const getIngestRules = (stage: StageName): IngestRules[] => {
  const eventTypes = [
    'Object Created',
    'Object Deleted',
    'Object Restore Completed',
    'Object Restore Expired',
    'Object Storage Class Changed',
    'Object Access Tier Changed',
  ];

  const rules = [];

  for (const bucket of FILE_MANAGER_CACHE_BUCKETS[stage]) {
    rules.push({
      bucket,
      eventTypes,
      patterns: eventSourcePatternCache(),
    });
  }

  for (const bucket of FILE_MANAGER_BUCKETS[stage]) {
    rules.push({
      bucket,
      eventTypes,
      patterns: eventSourcePattern(),
    });
  }

  return rules;
};

export const getFileManagerStatefulProps = (stage: StageName): FileManagerStatefulConfig => {
  const buckets = [...FILE_MANAGER_BUCKETS[stage], ...FILE_MANAGER_CACHE_BUCKETS[stage]];
  return {
    accessKeyProps: {
      userName: FILE_MANAGER_PRESIGN_USER,
      secretName: FILE_MANAGER_PRESIGN_USER_SECRET,
      policies: Function.formatPoliciesForBucket(buckets, [...Function.getObjectActions()]),
    },
    rules: getIngestRules(stage),
  };
};
