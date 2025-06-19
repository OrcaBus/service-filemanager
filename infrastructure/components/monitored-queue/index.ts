import { Construct } from 'constructs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Alarm, ComparisonOperator, MathExpression } from 'aws-cdk-lib/aws-cloudwatch';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';

/**
 * Properties for the monitored queue.
 */
export interface MonitoredQueueProps {
  /**
   * The props for the main SQS queue.
   */
  queueProps?: QueueProps;
  /**
   * The props for the dead-letter SQS queue when a message fails.
   */
  dlqProps?: QueueProps;
  /**
   * The maximum number of times a message can be unsuccessfully received before
   * pushing it to the DLQ. Defaults to 3.
   */
  maxReceiveCount?: number;
  /**
   * Send the alarm notification to the SNS topic.
   */
  sendToSnsTopic?: string;
}

/**
 * Properties for an SQS queue.
 */
export interface QueueProps {
  /**
   * The name of the queue to construct. Defaults to the automatically generated name.
   */
  queueName?: string;
  /**
   * How long messages stay in the queue.
   */
  retentionPeriod?: Duration;
  /**
   * The removal policy of the queue.
   */
  removalPolicy?: RemovalPolicy;
}

/**
 * A construct that defines an SQS S3 event source, along with a DLQ and CloudWatch alarms that notify
 * slack.
 */
export class MonitoredQueue extends Construct {
  readonly queue: Queue;
  readonly deadLetterQueue: Queue;
  readonly alarm: Alarm;

  constructor(scope: Construct, id: string, props: MonitoredQueueProps) {
    super(scope, id);

    this.deadLetterQueue = new Queue(scope, 'DeadLetterQueue', {
      enforceSSL: true,
      ...props.dlqProps,
    });

    this.queue = new Queue(this, 'Queue', {
      enforceSSL: true,
      deadLetterQueue: {
        maxReceiveCount: props.maxReceiveCount ?? 3,
        queue: this.deadLetterQueue,
      },
      ...props.queueProps,
    });

    const rateOfMessages = new MathExpression({
      expression: 'RATE(visible + notVisible)',
      usingMetrics: {
        visible: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
        notVisible: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      },
    });
    this.alarm = new Alarm(scope, 'Alarm', {
      metric: rateOfMessages,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: 0,
      evaluationPeriods: 1,
      alarmName: `${this.queue.queueName}-alarm`,
      alarmDescription: 'An event has been received in the dead letter queue.',
    });

    if (props.sendToSnsTopic !== undefined) {
      const topic = Topic.fromTopicArn(this, 'Topic', props.sendToSnsTopic);
      this.alarm.addAlarmAction(new SnsAction(topic));
    }
  }

  /**
   * Get the SQS queue ARN.
   */
  get queueArn(): string {
    return this.queue.queueArn;
  }
}
