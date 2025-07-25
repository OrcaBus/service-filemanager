import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { ISecurityGroup, IVpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Architecture, Version } from 'aws-cdk-lib/aws-lambda';
import { ManagedPolicy, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { RustFunction } from 'cargo-lambda-cdk';
import path from 'path';
import { FILEMANAGER_SERVICE_NAME, RDS_POLICY_NAME } from '../constants';
import { spawnSync } from 'node:child_process';
import { NamedLambdaRole } from '@orcabus/platform-cdk-constructs/named-lambda-role';

/**
 * Properties for the database.
 */
export interface DatabaseProps {
  /**
   * The host of the database.
   */
  readonly host: string;
  /**
   * The port to connect with.
   */
  readonly port: number;
  /**
   * The database security group.
   */
  readonly securityGroup: ISecurityGroup;
}

/**
 * Props for a Rust function which can be configured from the top-level orcabus context.
 */
export interface FunctionPropsConfigurable {
  /**
   * Additional build environment variables when building the Lambda function.
   */
  readonly buildEnvironment?: Record<string, string>;
  /**
   * Additional environment variables to set inside the Lambda function
   */
  readonly environment?: Record<string, string>;
  /**
   * RUST_LOG string, defaults to trace on local crates and info everywhere else.
   */
  readonly rustLog?: string;
  /**
   * The role which the Function assumes.
   */
  readonly role?: Role;
  /**
   * Vpc for the function.
   */
  readonly vpc: IVpc;
}

/**
 * Props for the Rust function which can be configured from the top-level orcabus context.
 */
export type FunctionProps = FunctionPropsConfigurable &
  DatabaseProps & {
    /**
     * The package to build for this function.
     */
    readonly package: string;
    /**
     * Name of the Lambda function resource.
     */
    readonly functionName?: string;
    /**
     * The timeout for the Lambda function, defaults to 28 seconds.
     */
    readonly timeout?: Duration;
  };

/**
 * A construct for a Rust Lambda function.
 */
export class Function extends Construct {
  private readonly _function: RustFunction;
  private readonly _role: Role;

  constructor(scope: Construct, id: string, props: FunctionProps) {
    super(scope, id);

    // Lambda role needs SQS execution role.
    this._role = props.role ?? new NamedLambdaRole(this, 'Role');
    // Lambda needs VPC access if it is created in a VPC.
    this.addAwsManagedPolicy('service-role/AWSLambdaVPCAccessExecutionRole');
    // Using RDS IAM credentials, so we add the managed policy created by the postgres manager.
    this.addCustomerManagedPolicy(RDS_POLICY_NAME);

    // Lambda needs to be able to reach out to access S3, security manager, etc.
    // Could this use an endpoint instead?
    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: 'Security group that allows a filemanager Lambda function to egress out.',
    });

    const manifestPath = path.join(__dirname, '..', '..', '..', 'app');
    const defaultTarget = spawnSync('rustc', ['--version', '--verbose'])
      .stdout.toString()
      .split(/\r?\n/)
      .find((line) => line.startsWith('host:'))
      ?.replace('host:', '')
      .trim();
    this._function = new RustFunction(this, 'RustFunction', {
      manifestPath: manifestPath,
      binaryName: props.package,
      bundling: {
        environment: {
          ...props.buildEnvironment,
        },
        ...(defaultTarget === 'aarch64-unknown-linux-gnu' && {
          cargoLambdaFlags: ['--compiler', 'cargo'],
        }),
      },
      memorySize: 1024,
      timeout: props.timeout ?? Duration.seconds(28),
      environment: {
        // No password here, using RDS IAM to generate credentials.
        PGHOST: props.host,
        PGPORT: props.port.toString(),
        PGDATABASE: FILEMANAGER_SERVICE_NAME,
        PGUSER: FILEMANAGER_SERVICE_NAME,
        RUST_LOG:
          props.rustLog ?? `info,${props.package.replace('-', '_')}=trace,filemanager=trace`,
        ...props.environment,
      },
      architecture: Architecture.ARM_64,
      role: this._role,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [
        securityGroup,
        // Allow access to database.
        props.securityGroup,
      ],
      functionName: props.functionName,
    });

    // TODO: this should probably connect to an RDS proxy rather than directly to the database.
  }

  /**
   * Add an AWS managed policy to the function's role.
   */
  addAwsManagedPolicy(policyName: string) {
    this._role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName(policyName));
  }

  /**
   * Add a customer managed policy to the function's role.
   */
  addCustomerManagedPolicy(policyName: string) {
    this._role.addManagedPolicy(ManagedPolicy.fromManagedPolicyName(this, 'Policy', policyName));
  }

  /**
   * Add a policy statement to this function's role.
   */
  addToPolicy(policyStatement: PolicyStatement) {
    this._role.addToPolicy(policyStatement);
  }

  /**
   * Add policies for 's3:List*' and 's3:Get*' on the buckets to this function's role.
   */
  addPoliciesForBuckets(buckets: string[], actions: string[]) {
    Function.formatPoliciesForBucket(buckets, actions).forEach((policy) => {
      this.addToPolicy(policy);
    });
  }

  /**
   * Get policy actions for fetching objects.
   */
  static getObjectVersionActions(): string[] {
    return ['s3:GetObjectVersion'];
  }

  /**
   * Get policy actions for versioned objects.
   */
  static getObjectActions(): string[] {
    return ['s3:ListBucket', 's3:ListBucketVersions', 's3:GetObject'];
  }

  /**
   * Format a set of buckets and actions into policy statements.
   */
  static formatPoliciesForBucket(buckets: string[], actions: string[]): PolicyStatement[] {
    return buckets.map((bucket) => {
      return new PolicyStatement({
        actions,
        resources: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      });
    });
  }

  /**
   * Get policy actions for using object tags.
   */
  static objectTaggingActions(): string[] {
    return [
      's3:GetObjectTagging',
      's3:GetObjectVersionTagging',
      's3:PutObjectTagging',
      's3:PutObjectVersionTagging',
    ];
  }

  /**
   * Get the function name.
   */
  get functionName(): string {
    return this.function.functionName;
  }

  /**
   * Get the function version.
   */
  get currentVersion(): Version {
    return this.function.currentVersion;
  }

  /**
   * Get the function IAM role.
   */
  get role(): Role {
    return this._role;
  }

  /**
   * Get the Lambda function.
   */
  get function(): RustFunction {
    return this._function;
  }
}
