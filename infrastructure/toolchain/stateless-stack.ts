import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStackPipeline } from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';
import { FileManagerStateless } from '../stage/filemanager-stateless-stack';
import { getFileManagerStatelessProps } from '../stage/config';

export class StatelessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new DeploymentStackPipeline(this, 'DeploymentPipeline', {
      githubBranch: 'main',
      githubRepo: 'template-service-base',
      stack: FileManagerStateless,
      stackName: 'DeployStack',
      stackConfig: {
        beta: getFileManagerStatelessProps('BETA'),
        gamma: getFileManagerStatelessProps('GAMMA'),
        prod: getFileManagerStatelessProps('PROD'),
      },
      pipelineName: 'OrcaBus-StatelessMicroservice',
      cdkSynthCmd: ['pnpm install --frozen-lockfile --ignore-scripts', 'pnpm cdk synth'],
    });
  }
}
