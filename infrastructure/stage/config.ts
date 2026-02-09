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
  FILE_MANAGER_CROSS_ACCOUNT_BUCKETS,
  FILE_MANAGER_DOMAIN_PREFIX,
  FILE_MANAGER_INGEST_ROLE,
  FILE_MANAGER_PRESIGN_USER,
  FILE_MANAGER_PRESIGN_USER_SECRET,
} from '@orcabus/platform-cdk-constructs/shared-config/file-manager';

export const getFileManagerStatelessProps = (stage: StageName): FileManagerStatelessConfig => {
  const buckets = getAllowedBuckets(stage);
  return {
    securityGroupName: SHARED_SECURITY_GROUP_NAME,
    vpcProps: VPC_LOOKUP_PROPS,
    ingestQueueName: FILEMANAGER_INGEST_QUEUE,
    databaseClusterEndpointHostParameter: DB_CLUSTER_ENDPOINT_HOST_PARAMETER_NAME,
    port: DATABASE_PORT,
    migrateDatabase: true,
    accessKeySecretArn: FILE_MANAGER_ACCESS_KEY_ARNS[stage],
    inventoryBuckets: buckets,
    ingestBuckets: buckets,
    fileManagerRoleName: FILE_MANAGER_INGEST_ROLE,
    apiGatewayCognitoProps: {
      ...getDefaultApiGatewayConfiguration(stage),
      apiName: 'FileManager',
      customDomainNamePrefix: FILE_MANAGER_DOMAIN_PREFIX,
    },
  };
};

export const ingestPattern = () => {
  // NOT KEY is iap_upload_test.tmp AND (SIZE > 0 OR NOT KEY ends with "/") expands to
  // (NOT KEY is iap_upload_test.tmp AND SIZE > 0) OR (NOT KEY is iap_upload_test.tmp AND NOT KEY ends with "/")
  return {
    $or: [
      {
        key: [
          {
            'anything-but': {
              wildcard: ['byob-icav2/.iap_upload_test.tmp', 'testdata/.iap_upload_test.tmp'],
            },
          },
        ],
        size: [{ numeric: ['>', 0] }],
      },
      {
        key: [
          {
            'anything-but': {
              wildcard: ['byob-icav2/.iap_upload_test.tmp', 'testdata/.iap_upload_test.tmp', '*/'],
            },
          },
        ],
      },
    ],
  };
};

export const ingestCachePattern = () => {
  // NOT KEY is iap_upload_test.tmp AND NOT KEY in cache AND (SIZE > 0 OR NOT KEY ends with "/") expands to
  // (NOT KEY is iap_upload_test.tmp AND NOT KEY in cache AND SIZE > 0) OR (NOT KEY is iap_upload_test.tmp AND NOT KEY in cache AND NOT KEY ends with "/")
  return {
    $or: [
      {
        key: [
          {
            'anything-but': {
              wildcard: [
                'byob-icav2/*/cache/*',
                'byob-icav2/.iap_upload_test.tmp',
                'testdata/.iap_upload_test.tmp',
              ],
            },
          },
        ],
        size: [{ numeric: ['>', 0] }],
      },
      {
        key: [
          {
            'anything-but': {
              wildcard: [
                'byob-icav2/*/cache/*',
                '*/',
                'byob-icav2/.iap_upload_test.tmp',
                'testdata/.iap_upload_test.tmp',
              ],
            },
          },
        ],
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
      patterns: ingestCachePattern(),
    });
  }

  for (const bucket of FILE_MANAGER_BUCKETS[stage]) {
    rules.push({
      bucket,
      eventTypes,
      patterns: ingestPattern(),
    });
  }

  // Only the production filemanager deployment should ingest the cross account buckets for now,
  // as the tagging needs to avoid race conditions.
  if (stage == 'PROD') {
    for (const bucket of FILE_MANAGER_CROSS_ACCOUNT_BUCKETS) {
      rules.push({
        bucket,
        eventTypes,
        patterns: ingestPattern(),
      });
    }
  }

  return rules;
};

export const getAllowedBuckets = (stage: StageName): string[] => {
  // The filemanager should have access to all cross account buckets, even if the ingester isn't running
  // on them yet.
  return [
    ...FILE_MANAGER_BUCKETS[stage],
    ...FILE_MANAGER_CACHE_BUCKETS[stage],
    ...FILE_MANAGER_CROSS_ACCOUNT_BUCKETS,
  ];
};

export const getFileManagerStatefulProps = (stage: StageName): FileManagerStatefulConfig => {
  return {
    accessKeyProps: {
      userName: FILE_MANAGER_PRESIGN_USER,
      secretName: FILE_MANAGER_PRESIGN_USER_SECRET,
      policies: [
        Function.formatPoliciesForBucket(getAllowedBuckets(stage), [
          ...Function.getObjectActions(),
        ]),
      ],
    },
    rules: getIngestRules(stage),
  };
};
