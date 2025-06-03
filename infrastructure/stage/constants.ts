import { VpcLookupOptions } from 'aws-cdk-lib/aws-ec2';

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

export const rdsPolicyName = 'orcabus-rds-connect-filemanager';

export const FILEMANAGER_SERVICE_NAME = 'filemanager';
export const FILEMANAGER_INGEST_ID_TAG_NAME = 'umccr-org:OrcaBusFileManagerIngestId';
