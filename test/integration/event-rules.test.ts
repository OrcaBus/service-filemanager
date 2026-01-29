/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/dot-notation */

import { EventBridge } from '@aws-sdk/client-eventbridge';
import { App } from 'aws-cdk-lib';
import { FileManagerStatefulStack } from '../../infrastructure/stage/filemanager-stateful-stack';
import { getFileManagerStatefulProps } from '../../infrastructure/stage/config';
import { Template } from 'aws-cdk-lib/assertions';

let eventbridge: EventBridge;

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

async function testIapUploadTest(event: any, pattern: any) {
  event['detail']['object']['key'] = 'byob-icav2/.iap_upload_test.tmp';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'byob-icav2/.iap_upload_test.tmp';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(false);

  event['detail']['object']['key'] = 'byob-icav2/.iap_upload_test.tmp/example';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = 'byob-icav2/.iap_upload_test.tmp/';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = 'byob-icav2/.iap_upload_test.tmp/example';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = 'byob-icav2/.iap_upload_test.tmp/';
  event['detail']['object']['size'] = 0;
  expect(await testEventPattern(event, pattern)).toBe(false);
}

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

  event['detail']['object']['key'] = 'byob-icav2/123/123/cache';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);

  event['detail']['object']['key'] = 'byob-icav2/cache/123/123';
  event['detail']['object']['size'] = 1;
  expect(await testEventPattern(event, pattern)).toBe(true);
}

test('Test event source event patterns', async () => {
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
    await testIapUploadTest(event, eventPattern);
    await testDirectoryObjects(event, eventPattern);

    if (JSON.stringify(eventPattern['detail']['object']).includes('cache')) {
      await testCacheObjects(event, eventPattern);
    }
  }
}, 30000);
