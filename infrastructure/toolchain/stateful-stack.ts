import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStackPipeline } from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';
import { getFileManagerStatefulProps } from '../stage/config';
import { FileManagerStateful } from '../stage/filemanager-stateful-stack';

export class StatefulStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new DeploymentStackPipeline(this, 'DeploymentPipeline', {
      githubBranch: 'main',
      githubRepo: 'template-service-base',
      stack: FileManagerStateful,
      stackName: 'DeployStack',
      stackConfig: {
        beta: getFileManagerStatefulProps('BETA'),
        gamma: getFileManagerStatefulProps('GAMMA'),
        prod: getFileManagerStatefulProps('PROD'),
      },
      pipelineName: 'OrcaBus-StatefulMicroservice',
      cdkSynthCmd: ['pnpm install --frozen-lockfile --ignore-scripts', 'pnpm cdk-stateful synth'],
    });
  }
}
