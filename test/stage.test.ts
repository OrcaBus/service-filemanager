import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { SynthesisMessage } from 'aws-cdk-lib/cx-api';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { FileManagerStateless } from '../infrastructure/stage/filemanager-stateless-stack';
import {
  getFileManagerStatefulProps,
  getFileManagerStatelessProps,
} from '../infrastructure/stage/config';
import { FileManagerStateful } from '../infrastructure/stage/filemanager-stateful-stack';

/**
 * apply nag suppression
 * @param stack
 */
function applyNagSuppression(stack: Stack) {
  NagSuppressions.addStackSuppressions(
    stack,
    [{ id: 'AwsSolutions-S10', reason: 'not require requests to use SSL' }],
    true
  );
}

function synthesisMessageToString(sm: SynthesisMessage): string {
  return `${sm.entry.data} [${sm.id}]`;
}

function cdkNagStack(stack: Stack) {
  Aspects.of(stack).add(new AwsSolutionsChecks());
  applyNagSuppression(stack);

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

describe('cdk-nag-stateless-toolchain-stack', () => {
  const app = new App({});

  const filemanagerStatelessStack = new FileManagerStateless(app, 'FileManagerStatelessStack', {
    ...getFileManagerStatelessProps('PROD'),
  });

  cdkNagStack(filemanagerStatelessStack);
});

describe('cdk-nag-stateful-toolchain-stack', () => {
  const app = new App({});

  const fileManagerStatefulStack = new FileManagerStateful(app, 'FileManagerStatelessStack', {
    ...getFileManagerStatefulProps('PROD'),
  });

  cdkNagStack(fileManagerStatefulStack);
});
