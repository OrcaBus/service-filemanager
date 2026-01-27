/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/dot-notation */

import { Match, Template } from 'aws-cdk-lib/assertions';
import { EventBridge } from '@aws-sdk/client-eventbridge';
import { getFileManagerStatefulProps } from '../../infrastructure/stage/config';
import { FileManagerStatefulStack } from '../../infrastructure/stage/filemanager-stateful-stack';
import { App } from 'aws-cdk-lib';
import { FILEMANAGER_INGEST_QUEUE } from '../../infrastructure/stage/constants';

let eventbridge: EventBridge;

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

/**
 * Test the event against the pattern.
 */
async function testEventPattern(event: any, pattern: any): Promise<boolean | undefined> {
  const request = await eventbridge.testEventPattern({
    Event: JSON.stringify(event),
    EventPattern: JSON.stringify(pattern),
  });
  return request.Result;
}

function testS3Event(bucket: string, key: string, size: number): any {
  return {
    version: '0',
    id: '17793124-05d4-b198-2fde-7ededc63b103',
    'detail-type': 'Object Created',
    source: 'aws.s3',
    account: '111122223333',
    time: '2021-11-12T00:00:00Z',
    region: 'ca-central-1',
    resources: [`arn:aws:s3:::${bucket}`],
    detail: {
      version: '0',
      bucket: {
        name: bucket,
      },
      object: {
        key: key,
        size: size,
        etag: 'b1946ac92492d2347c6235b4d2611184', // pragma: allowlist secret
        'version-id': 'IYV3p45BT0ac8hjHg1houSdS1a.Mro8e',
        sequencer: '617f08299329d189', // pragma: allowlist secret
      },
      'request-id': 'N4N7GDK58NMKJ12R',
      requester: '123456789012',
      'source-ip-address': '1.2.3.4',
      reason: 'PutObject',
    },
  };
}

beforeEach(() => {
  eventbridge = new EventBridge();
});

async function testDirectoryObjects(event: any, pattern: any) {
  event['detail']['object']['key'] = 'example-key/';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'example-key';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = '/';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'example-key/';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = 'example-key';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = '/';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);
}

async function testCacheObjects(event: any, pattern: any) {
  event['detail']['object']['key'] = 'byob-icav2/123/cache/123';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'byob-icav2/123/cache/123/';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'byob-icav2/123/cache/123';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'byob-icav2/123/cache/123/';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(false);
}

test.skip('Test event source event patterns', async () => {
  const app = new App({});
  const stack = new FileManagerStatefulStack(
    app,
    'TestEventSourceConstruct',
    getFileManagerStatefulProps('PROD')
  );

  const template = Template.fromStack(stack);

  for (const pattern of Object.entries(template.findResources('AWS::Events::Rule'))) {
    const eventPattern = pattern[1]['Properties']['EventPattern'];
    const bucket = eventPattern['detail']['bucket']['name'][0] as string;
    const event = testS3Event(bucket, 'example-key', 1);
    await testDirectoryObjects(event, eventPattern);

    if (JSON.stringify(eventPattern['detail']['object']).includes('cache')) {
      await testCacheObjects(event, eventPattern);
    }
  }
});

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
