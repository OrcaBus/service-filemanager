import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStackPipeline } from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';
import { getFileManagerStatefulProps } from '../stage/config';
import { FileManagerStatefulStack } from '../stage/filemanager-stateful-stack';
import { Pipeline } from 'aws-cdk-lib/aws-codepipeline';

export class StatefulStack extends cdk.Stack {
  readonly pipeline: Pipeline;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const deployment = new DeploymentStackPipeline(this, 'DeploymentPipeline', {
      githubBranch: 'main',
      githubRepo: 'service-filemanager',
      stack: FileManagerStatefulStack,
      stackName: 'FileManagerStatefulStack',
      stackConfig: {
        beta: getFileManagerStatefulProps('BETA'),
        gamma: getFileManagerStatefulProps('GAMMA'),
        prod: getFileManagerStatefulProps('PROD'),
      },
      pipelineName: 'OrcaBus-StatefulFileManager',
      cdkSynthCmd: ['pnpm cdk-stateful synth'],
      // No app tests for stateful stack.
      unitAppTestConfig: {
        command: [],
      },
      unitIacTestConfig: {
        command: [
          'pnpm test --testPathPatterns=test/stateful',
          'pnpm test --testPathPatterns=test/integration',
        ],
      },
      cacheOptions: {
        namespace: 'filemanager-stateful',
      },
    });

    this.pipeline = deployment.pipeline;
  }
}
