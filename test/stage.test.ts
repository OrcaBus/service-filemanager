import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { FileManagerStack } from '../infrastructure/stage/filemanager-stateless-stack';
import {
  getFileManagerStatefulProps,
  getFileManagerStatelessProps,
} from '../infrastructure/stage/config';
import { FileManagerStatefulStack } from '../infrastructure/stage/filemanager-stateful-stack';
import { synthesisMessageToString } from '@orcabus/platform-cdk-constructs/utils';

function applyIAMWildcardSuppression(stack: Stack) {
  NagSuppressions.addResourceSuppressions(
    stack,
    [
      {
        id: 'AwsSolutions-IAM5',
        reason: "'*' is required to access objects in the indexed bucket by filemanager",
        appliesTo: [
          'Resource::arn:aws:s3:::org.umccr.data.oncoanalyser/*',
          'Resource::arn:aws:s3:::archive-prod-analysis-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::archive-prod-fastq-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::ntsm-fingerprints-472057503814-ap-southeast-2/*',
          'Resource::arn:aws:s3:::fastq-manager-sequali-outputs-472057503814-ap-southeast-2/*',
          'Resource::arn:aws:s3:::data-sharing-artifacts-472057503814-ap-southeast-2/*',
          'Resource::arn:aws:s3:::pipeline-montauk-977251586657-ap-southeast-2/*',
          'Resource::arn:aws:s3:::pipeline-prod-cache-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::research-data-550435500918-ap-southeast-2/*',
          'Resource::arn:aws:s3:::test-data-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-889522050439-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-491085415398-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-071784445872-ap-southeast-2/*',
        ],
      },
    ],
    true
  );
}

/**
 * Apply nag suppression for the stateless stack
 * @param stack
 */
function applyStatelessNagSuppressions(stack: Stack) {
  applyIAMWildcardSuppression(stack);

  NagSuppressions.addStackSuppressions(
    stack,
    [{ id: 'AwsSolutions-IAM4', reason: 'allow AWS managed policy' }],
    true
  );
  NagSuppressions.addResourceSuppressionsByPath(
    stack,
    '/FileManagerStatelessStack/GetSchemaHttpRoute/Resource',
    [
      {
        id: 'AwsSolutions-APIG4',
        reason: 'we have the default Cognito UserPool authorizer',
      },
    ],
    true
  );
  NagSuppressions.addResourceSuppressionsByPath(
    stack,
    `/FileManagerStatelessStack/MigrateProviderFunction/Provider/framework-onEvent/ServiceRole/DefaultPolicy/Resource`,
    [
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'the provider function needs to be able to invoke the configured function. It uses' +
          "`lambda.Function.grantInvoke` to achieve this which contains a '*'",
      },
    ],
    false
  );
  NagSuppressions.addResourceSuppressionsByPath(
    stack,
    '/FileManagerStatelessStack/MigrateProviderFunction/Provider/framework-onEvent/Resource',
    [
      {
        id: 'AwsSolutions-L1',
        reason: 'the provider function is controlled by CDK and has an outdated runtime',
      },
    ],
    false
  );
  NagSuppressions.addResourceSuppressionsByPath(
    stack,
    `/FileManagerStatelessStack/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/DefaultPolicy/Resource`,
    [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'the alarm needs permission to cloudwatch',
      },
    ],
    false
  );
}

/**
 * Apply nag suppression for the stateless stack
 * @param stack
 */
function applyStatefulNagSuppressions(stack: Stack) {
  applyIAMWildcardSuppression(stack);

  NagSuppressions.addResourceSuppressionsByPath(
    stack,
    '/FileManagerStatefulStack/AccessKey/Secret/Resource',
    [
      {
        id: 'AwsSolutions-SMG4',
        reason: 'secret rotation is an upcoming feature',
      },
    ],
    false
  );
}

/**
 * Run the CDK nag checks.
 */
function cdkNagStack(stack: Stack, applySuppressions: (stack: Stack) => void) {
  Aspects.of(stack).add(new AwsSolutionsChecks());
  applySuppressions(stack);

  test(`cdk-nag AwsSolutions Pack errors`, () => {
    const errors = Annotations.fromStack(stack)
      .findError('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(errors).toHaveLength(0);
  });

  test(`cdk-nag AwsSolutions Pack warnings`, () => {
    const warnings = Annotations.fromStack(stack)
      .findWarning('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(warnings).toHaveLength(0);
  });
}

describe('cdk-nag-stateless-stack', () => {
  const app = new App();

  const filemanagerStatelessStack = new FileManagerStack(app, 'FileManagerStatelessStack', {
    ...getFileManagerStatelessProps('PROD'),
    env: {
      account: '123456789',
      region: 'ap-southeast-2',
    },
    buildEnvironment: {
      // Need to have a separate build directory to the toolchain test to avoid concurrent build errors.
      CARGO_TARGET_DIR: 'target-stage-test',
    },
  });

  cdkNagStack(filemanagerStatelessStack, applyStatelessNagSuppressions);
});

describe('cdk-nag-stateful-stack', () => {
  const app = new App({});

  const fileManagerStatefulStack = new FileManagerStatefulStack(app, 'FileManagerStatefulStack', {
    ...getFileManagerStatefulProps('PROD'),
    env: {
      account: '123456789',
      region: 'ap-southeast-2',
    },
  });

  cdkNagStack(fileManagerStatefulStack, applyStatefulNagSuppressions);
});
