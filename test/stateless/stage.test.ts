import { App, Stack } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { FileManagerStack } from '../../infrastructure/stage/filemanager-stateless-stack';
import { getFileManagerStatelessProps } from '../../infrastructure/stage/config';
import { applyIAMWildcardSuppression, cdkNagStack } from '../util';

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
