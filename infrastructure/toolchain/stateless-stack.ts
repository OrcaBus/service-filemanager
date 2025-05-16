import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStackPipeline } from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';
import { FileManagerStatelessStack } from '../stage/filemanager-stateless-stack';
import { getFileManagerStatelessProps } from '../stage/config';
import { Pipeline } from 'aws-cdk-lib/aws-codepipeline';

/**
 * Options for configuring the stateless stack.
 */
interface StatelessStackConfig {
  /**
   * Additional build environment variables when building the Lambda function.
   */
  readonly buildEnvironment?: Record<string, string>;
}

export class StatelessStack extends cdk.Stack {
  readonly pipeline: Pipeline;

  constructor(scope: Construct, id: string, props?: cdk.StackProps & StatelessStackConfig) {
    super(scope, id, props);

    const deployment = new DeploymentStackPipeline(this, 'DeploymentPipeline', {
      githubBranch: 'initialize',
      githubRepo: 'service-filemanager',
      stack: FileManagerStatelessStack,
      stackName: 'FileManagerStatelessStack',
      stackConfig: {
        beta: {
          ...getFileManagerStatelessProps('BETA'),
          buildEnvironment: props?.buildEnvironment,
        },
        gamma: {
          ...getFileManagerStatelessProps('GAMMA'),
          buildEnvironment: props?.buildEnvironment,
        },
        prod: {
          ...getFileManagerStatelessProps('PROD'),
          buildEnvironment: props?.buildEnvironment,
        },
      },
      pipelineName: 'OrcaBus-StatelessFileManager',
      cdkSynthCmd: ['pnpm install --frozen-lockfile --ignore-scripts', 'pnpm cdk synth'],
    });

    this.pipeline = deployment.pipeline;
  }
}
