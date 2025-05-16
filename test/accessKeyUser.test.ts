import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { getFileManagerStatefulProps } from '../infrastructure/stage/config';
import {
  fileManagerPresignUser,
  fileManagerPresignUserSecret,
} from '../infrastructure/stage/constants';
import { FileManagerStatefulStack } from '../infrastructure/stage/filemanager-stateful-stack';

const app = new cdk.App();

const stack = new FileManagerStatefulStack(app, 'TestAccessKeySecret', {
  env: {
    account: '123456789',
    region: 'ap-southeast-2',
  },
  ...getFileManagerStatefulProps('PROD'),
});

describe('AccessKeySecret', () => {
  test('Test Construction', () => {
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: fileManagerPresignUserSecret,
    });
    template.hasResourceProperties('AWS::IAM::User', {
      UserName: fileManagerPresignUser,
    });
  });
});
