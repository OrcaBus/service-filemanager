import { App, Stack } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { getFileManagerStatefulProps } from '../../infrastructure/stage/config';
import { FileManagerStatefulStack } from '../../infrastructure/stage/filemanager-stateful-stack';
import { applyIAMWildcardSuppression, cdkNagStack } from '../util';

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
