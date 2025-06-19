import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MonitoredQueue } from '../infrastructure/components/monitored-queue';

let stack: cdk.Stack;

function assert_common(template: Template) {
  template.resourceCountIs('AWS::SQS::Queue', 1);

  template.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: 'queue',
    RedrivePolicy: {
      deadLetterTargetArn: Match.anyValue(),
      maxReceiveCount: 100,
    },
  });
  template.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: 'queue-dlq',
  });

  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    ComparisonOperator: 'GreaterThanThreshold',
    EvaluationPeriods: 1,
    Threshold: 0,
  });
}

beforeEach(() => {
  stack = new cdk.Stack();
});

test('Test EventSourceConstruct created props', () => {
  new MonitoredQueue(stack, 'MonitoredQueue', {
    queueProps: {
      queueName: 'queue',
    },
    dlqProps: {
      queueName: 'queue-dlq',
    },
  });
  const template = Template.fromStack(stack);

  console.log(JSON.stringify(template, undefined, 2));

  assert_common(template);
});
