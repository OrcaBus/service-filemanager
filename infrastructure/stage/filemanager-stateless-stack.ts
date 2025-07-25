import { Construct } from 'constructs';
import { IngestFunction } from './functions/ingest';
import { MigrateFunction } from './functions/migrate';
import { ApiFunction } from './functions/api';
import { DatabaseProps } from './functions/function';
import { Vpc, SecurityGroup, VpcLookupOptions, IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Arn, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';
import {
  HttpMethod,
  HttpNoneAuthorizer,
  HttpRoute,
  HttpRouteKey,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { InventoryFunction } from './functions/inventory';
import { Role } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import {
  OrcaBusApiGateway,
  OrcaBusApiGatewayProps,
} from '@orcabus/platform-cdk-constructs/api-gateway';
import { ProviderFunction } from '@orcabus/platform-cdk-constructs/provider-function';
import { NamedLambdaRole } from '@orcabus/platform-cdk-constructs/named-lambda-role';

/**
 * Stateful config for filemanager.
 */
export type FileManagerStatelessConfig = Omit<DatabaseProps, 'host' | 'securityGroup'> & {
  ingestQueueName: string;
  ingestBuckets: string[];
  inventoryBuckets: string[];
  databaseClusterEndpointHostParameter: string;
  vpcProps: VpcLookupOptions;
  migrateDatabase?: boolean;
  securityGroupName: string;
  fileManagerRoleName: string;
  accessKeySecretArn: string;
  apiGatewayCognitoProps: OrcaBusApiGatewayProps;
  buildEnvironment?: Record<string, string>;
};

/**
 * Props for the filemanager stack.
 */
export type FileManagerStatelessProps = StackProps & FileManagerStatelessConfig;

/**
 * Construct used to configure the filemanager.
 */
export class FileManagerStack extends Stack {
  private readonly vpc: IVpc;
  private readonly host: string;
  private readonly securityGroup: ISecurityGroup;
  private readonly queue: IQueue;
  readonly domainName: string;
  readonly ingestRole: Role;

  constructor(scope: Construct, id: string, props: FileManagerStatelessProps) {
    super(scope, id, props);

    this.vpc = Vpc.fromLookup(this, 'MainVpc', props.vpcProps);

    this.securityGroup = SecurityGroup.fromLookupByName(
      this,
      'OrcaBusLambdaSecurityGroup',
      props.securityGroupName,
      this.vpc
    );

    this.host = StringParameter.valueForStringParameter(
      this,
      props.databaseClusterEndpointHostParameter
    );

    this.ingestRole = this.createRole(props.fileManagerRoleName, 'IngestFunctionRole');

    if (props.migrateDatabase) {
      const migrateFunction = new MigrateFunction(this, 'MigrateFunction', {
        vpc: this.vpc,
        host: this.host,
        port: props.port,
        securityGroup: this.securityGroup,
        buildEnvironment: props.buildEnvironment,
      });

      new ProviderFunction(this, 'MigrateProviderFunction', {
        vpc: this.vpc,
        function: migrateFunction.function,
      });
    }

    this.queue = Queue.fromQueueArn(
      this,
      'FilemanagerQueue',
      Arn.format(
        {
          resource: props.ingestQueueName,
          service: 'sqs',
        },
        this
      )
    );

    this.createIngestFunction(props);
    this.createInventoryFunction(props);

    this.domainName = this.createApiFunction(props);

    // CDK Nag suppression (IAM5)
    NagSuppressions.addResourceSuppressions(
      this.ingestRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Role needs access to bucket so this will result in a wildcard policy.',
        },
      ],
      true
    );
  }

  private createRole(name: string, id: string) {
    return new NamedLambdaRole(this, id, {
      name,
      maxSessionDuration: Duration.hours(12),
    });
  }

  /**
   * Lambda function definitions and surrounding infrastructure.
   */
  private createIngestFunction(props: FileManagerStatelessProps) {
    return new IngestFunction(this, 'IngestFunction', {
      vpc: this.vpc,
      host: this.host,
      securityGroup: this.securityGroup,
      ingestQueues: [this.queue],
      buckets: props.ingestBuckets,
      role: this.ingestRole,
      ...props,
    });
  }

  /**
   * Create the inventory function.
   */
  private createInventoryFunction(props: FileManagerStatelessProps) {
    return new InventoryFunction(this, 'InventoryFunction', {
      vpc: this.vpc,
      host: this.host,
      securityGroup: this.securityGroup,
      port: props.port,
      buckets: props.inventoryBuckets,
      role: this.ingestRole,
      buildEnvironment: props.buildEnvironment,
    });
  }

  /**
   * Query function and API Gateway fronting the function. Returns the configured domain name.
   */
  private createApiFunction(props: FileManagerStatelessProps): string {
    const apiLambda = new ApiFunction(this, 'ApiFunction', {
      vpc: this.vpc,
      host: this.host,
      securityGroup: this.securityGroup,
      buckets: [...props.ingestBuckets, ...props.inventoryBuckets],
      role: this.ingestRole,
      ...props,
    });

    const apiGateway = new OrcaBusApiGateway(this, 'ApiGateway', props.apiGatewayCognitoProps);
    const httpApi = apiGateway.httpApi;

    const integration = new HttpLambdaIntegration('ApiIntegration', apiLambda.function);

    new HttpRoute(this, 'GetSchemaHttpRoute', {
      httpApi,
      integration,
      authorizer: new HttpNoneAuthorizer(),
      routeKey: HttpRouteKey.with(`/schema/{proxy+}`, HttpMethod.GET),
    });

    new HttpRoute(this, 'GetHttpRoute', {
      httpApi,
      integration,
      routeKey: HttpRouteKey.with('/{proxy+}', HttpMethod.GET),
    });

    new HttpRoute(this, 'PatchHttpRoute', {
      httpApi,
      integration,
      authorizer: apiGateway.authStackHttpLambdaAuthorizer,
      routeKey: HttpRouteKey.with('/{proxy+}', HttpMethod.PATCH),
    });

    new HttpRoute(this, 'PostHttpRoute', {
      httpApi,
      integration,
      authorizer: apiGateway.authStackHttpLambdaAuthorizer,
      routeKey: HttpRouteKey.with('/{proxy+}', HttpMethod.POST),
    });

    return apiGateway.domainName;
  }
}
