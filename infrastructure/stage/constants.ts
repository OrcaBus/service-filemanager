import { VpcLookupOptions } from 'aws-cdk-lib/aws-ec2';
import { StageName } from '@orcabus/platform-cdk-constructs/utils';
import {
  BETA_ENVIRONMENT,
  GAMMA_ENVIRONMENT,
  PROD_ENVIRONMENT,
} from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';

export const fileManagerBuckets: Record<StageName, string[]> = {
  ['BETA']: [
    'umccr-temp-dev',
    `ntsm-fingerprints-${BETA_ENVIRONMENT.account}-ap-southeast-2`,
    `data-sharing-artifacts-${BETA_ENVIRONMENT.account}-ap-southeast-2`,
    'filemanager-inventory-test',
  ],
  ['GAMMA']: [
    'umccr-temp-stg',
    `ntsm-fingerprints-${GAMMA_ENVIRONMENT.account}-ap-southeast-2`,
    `data-sharing-artifacts-${GAMMA_ENVIRONMENT.account}-ap-southeast-2`,
  ],
  ['PROD']: [
    'org.umccr.data.oncoanalyser',
    'archive-prod-analysis-503977275616-ap-southeast-2',
    'archive-prod-fastq-503977275616-ap-southeast-2',
    `ntsm-fingerprints-${PROD_ENVIRONMENT.account}-ap-southeast-2`,
    `data-sharing-artifacts-${PROD_ENVIRONMENT.account}-ap-southeast-2`,
    'pipeline-montauk-977251586657-ap-southeast-2',
  ],
};

export const fileManagerCacheBuckets: Record<StageName, string[]> = {
  ['BETA']: ['pipeline-dev-cache-503977275616-ap-southeast-2'],
  ['GAMMA']: ['pipeline-stg-cache-503977275616-ap-southeast-2'],
  ['PROD']: ['pipeline-prod-cache-503977275616-ap-southeast-2'],
};

// Db Construct
export const computeSecurityGroupName = 'OrcaBusSharedComputeSecurityGroup';
// upstream infra: vpc
const vpcName = 'main-vpc';
const vpcStackName = 'networking';
export const vpcProps: VpcLookupOptions = {
  vpcName: vpcName,
  tags: {
    Stack: vpcStackName,
  },
};
export const eventSourceQueueName = 'orcabus-event-source-queue';
export const dbClusterEndpointHostParameterName = '/orcabus/db-cluster-endpoint-host';
export const databasePort = 5432;

/**
 * Validate the secret name so that it doesn't end with 6 characters and a hyphen.
 */
export const validateSecretName = (secretName: string) => {
  // Note, this should not end with a hyphen and 6 characters, otherwise secrets manager won't be
  // able to find the secret using a partial ARN.
  if (/-(.){6}$/.test(secretName)) {
    throw new Error('the secret name should not end with a hyphen and 6 characters');
  }
};

export const fileManagerPresignUserSecret = 'orcabus/file-manager-presign-user'; // pragma: allowlist secret
export const accessKeySecretArn: Record<StageName, string> = {
  ['BETA']: `arn:aws:secretsmanager:${BETA_ENVIRONMENT.region}:${BETA_ENVIRONMENT.account}:secret:${fileManagerPresignUserSecret}`,
  ['GAMMA']: `arn:aws:secretsmanager:${GAMMA_ENVIRONMENT.region}:${GAMMA_ENVIRONMENT.account}:secret:${fileManagerPresignUserSecret}`,
  ['PROD']: `arn:aws:secretsmanager:${PROD_ENVIRONMENT.region}:${PROD_ENVIRONMENT.account}:secret:${fileManagerPresignUserSecret}`,
};

export const fileManagerIngestRoleName = 'orcabus-file-manager-ingest-role';
validateSecretName(fileManagerPresignUserSecret);

export const fileManagerPresignUser = 'orcabus-file-manager-presign-user'; // pragma: allowlist secret

export const rdsPolicyName = 'orcabus-rds-connect-filemanager';
