import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStackPipeline } from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline';
import { DeployStack } from '../stage/deployment-stack';
import { getStackProps } from '../stage/config';

export class StatefulStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new DeploymentStackPipeline(this, 'DeploymentPipeline', {
      githubBranch: 'main',
      githubRepo: 'template-service-base',
      stack: DeployStack,
      stackName: 'DeployStack',
      stackConfig: {
        beta: getStackProps('BETA'),
        gamma: getStackProps('GAMMA'),
        prod: getStackProps('PROD'),
      },
      pipelineName: 'OrcaBus-StatefulMicroservice',
      cdkSynthCmd: ['pnpm install --frozen-lockfile --ignore-scripts', 'pnpm cdk-stateful synth'],
    });
  }
}
