import { Match, Template } from 'aws-cdk-lib/assertions';
import { FileManagerStatefulStack } from '../../infrastructure/stage/filemanager-stateful-stack';
import { App } from 'aws-cdk-lib';
import { FILEMANAGER_INGEST_QUEUE } from '../../infrastructure/stage/constants';

function assertCommon(template: Template) {
  template.resourceCountIs('AWS::SQS::Queue', 2);

  template.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: FILEMANAGER_INGEST_QUEUE,
    RedrivePolicy: {
      deadLetterTargetArn: Match.anyValue(),
    },
  });

  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    ComparisonOperator: 'GreaterThanThreshold',
    EvaluationPeriods: 1,
    Threshold: 0,
  });

  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: {
      source: ['aws.s3'],
      detail: {
        bucket: {
          name: ['bucket'],
        },
      },
    },
  });
}

test('Test stateful created props', () => {
  const app = new App({});
  const stack = new FileManagerStatefulStack(app, 'TestFilemanagerStatefulStack', {
    env: {
      account: '123456789',
      region: 'ap-southeast-2',
    },
    accessKeyProps: {
      secretName: 'secret', // pragma: allowlist secret
      userName: 'username',
      policies: [],
    },
    rules: [
      {
        bucket: 'bucket',
      },
    ],
  });
  const template = Template.fromStack(stack);

  assertCommon(template);
});

test('Test stateful created props with event types', () => {
  const app = new App({});
  const stack = new FileManagerStatefulStack(app, 'TestFilemanagerStatefulStack', {
    accessKeyProps: {
      secretName: 'secret', // pragma: allowlist secret
      userName: 'username',
      policies: [],
    },
    rules: [
      {
        bucket: 'bucket',
        eventTypes: ['Object Created'],
      },
    ],
  });
  const template = Template.fromStack(stack);

  assertCommon(template);
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: {
      'detail-type': ['Object Created'],
    },
  });
});

test('Test stateful created props with key rule', () => {
  const app = new App({});
  const stack = new FileManagerStatefulStack(app, 'TestFilemanagerStatefulStack', {
    accessKeyProps: {
      secretName: 'secret', // pragma: allowlist secret
      userName: 'username',
      policies: [],
    },
    rules: [
      {
        bucket: 'bucket',
        patterns: { key: [{ 'anything-but': { wildcard: 'wildcard/*' } }, { prefix: 'prefix' }] },
      },
    ],
  });
  const template = Template.fromStack(stack);

  assertCommon(template);
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: {
      detail: {
        object: {
          key: [
            {
              'anything-but': { wildcard: 'wildcard/*' },
            },
            {
              prefix: 'prefix',
            },
          ],
        },
      },
    },
  });
});

test('Test stateful created props with rules matching any bucket', () => {
  const app = new App({});
  const stack = new FileManagerStatefulStack(app, 'TestFilemanagerStatefulStack', {
    accessKeyProps: {
      secretName: 'secret', // pragma: allowlist secret
      userName: 'username',
      policies: [],
    },
    rules: [{}],
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: {
      source: ['aws.s3'],
      detail: {},
    },
  });
});
