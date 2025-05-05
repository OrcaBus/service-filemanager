import { App, Aspects } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { StatelessStack } from '../infrastructure/toolchain/stateless-stack';
import { synthesisMessageToString } from './utils';
import { StatefulStack } from '../infrastructure/toolchain/stateful-stack';

describe('cdk-nag-stateless-toolchain-stack', () => {
  const app = new App({});

  const statelessStack = new StatelessStack(app, 'StatelessStack', {
    env: {
      account: '123456789',
      region: 'ap-southeast-2',
    },
  });

  Aspects.of(statelessStack).add(new AwsSolutionsChecks());

  NagSuppressions.addStackSuppressions(statelessStack, [
    { id: 'AwsSolutions-IAM4', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-IAM5', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-S1', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-KMS5', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-CB3', reason: 'Allow CDK Pipeline' },
  ]);

  test(`cdk-nag AwsSolutions Pack errors`, () => {
    const errors = Annotations.fromStack(statelessStack)
      .findError('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(errors).toHaveLength(0);
  });

  test(`cdk-nag AwsSolutions Pack warnings`, () => {
    const warnings = Annotations.fromStack(statelessStack)
      .findWarning('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(warnings).toHaveLength(0);
  });
});

describe('cdk-nag-stateful-toolchain-stack', () => {
  const app = new App({});

  const statefulStack = new StatefulStack(app, 'StatefulStack', {
    env: {
      account: '123456789',
      region: 'ap-southeast-2',
    },
  });

  Aspects.of(statefulStack).add(new AwsSolutionsChecks());

  NagSuppressions.addStackSuppressions(statefulStack, [
    { id: 'AwsSolutions-IAM4', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-IAM5', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-S1', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-KMS5', reason: 'Allow CDK Pipeline' },
    { id: 'AwsSolutions-CB3', reason: 'Allow CDK Pipeline' },
  ]);

  test(`cdk-nag AwsSolutions Pack errors`, () => {
    const errors = Annotations.fromStack(statefulStack)
      .findError('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(errors).toHaveLength(0);
  });

  test(`cdk-nag AwsSolutions Pack warnings`, () => {
    const warnings = Annotations.fromStack(statefulStack)
      .findWarning('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(warnings).toHaveLength(0);
  });
});
