import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { getFileManagerStatefulProps } from '../infrastructure/stage/config';
import { FileManagerStatefulStack } from '../infrastructure/stage/filemanager-stateful-stack';
import {
  FILE_MANAGER_PRESIGN_USER,
  FILE_MANAGER_PRESIGN_USER_SECRET,
} from '@orcabus/platform-cdk-constructs/shared-config/file-manager';

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
      Name: FILE_MANAGER_PRESIGN_USER_SECRET,
    });
    template.hasResourceProperties('AWS::IAM::User', {
      UserName: FILE_MANAGER_PRESIGN_USER,
    });
  });
});
