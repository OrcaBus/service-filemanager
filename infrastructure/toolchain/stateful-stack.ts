import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStackPipeline } from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';
import { getFileManagerStatefulProps } from '../stage/config';
import { FileManagerStatefulStack } from '../stage/filemanager-stateful-stack';

export class StatefulStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new DeploymentStackPipeline(this, 'DeploymentPipeline', {
      githubBranch: 'initialize',
      githubRepo: 'service-filemanager',
      stack: FileManagerStatefulStack,
      stackName: 'FileManagerStatefulStack',
      stackConfig: {
        beta: getFileManagerStatefulProps('BETA'),
        gamma: getFileManagerStatefulProps('GAMMA'),
        prod: getFileManagerStatefulProps('PROD'),
      },
      pipelineName: 'OrcaBus-StatefulFileManager',
      cdkSynthCmd: ['pnpm install --frozen-lockfile --ignore-scripts', 'pnpm cdk-stateful synth'],
    });
  }
}
