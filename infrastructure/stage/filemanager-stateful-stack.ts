import { Construct } from 'constructs';
import { Arn, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AccessKeySecret, AccessKeySecretProps } from '../components/access-key-secret';
import { MonitoredQueue } from '../components/monitored-queue';
import { Rule } from 'aws-cdk-lib/aws-events';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { ALERTS_SNS_TOPIC, FILEMANAGER_INGEST_QUEUE } from './constants';

/**
 * Stateful config for filemanager.
 */
export interface FileManagerStatefulConfig {
  /**
   * Access key props.
   */
  accessKeyProps: AccessKeySecretProps;
  /**
   * A set of EventBridge rules that target S3 events.
   */
  rules: IngestRules[];
}

/**
 * Properties for defining rules for ingesting S3 events from buckets.
 */
export interface IngestRules {
  /**
   * Bucket to receive events from. If not specified, captures events from all buckets.
   */
  bucket?: string;

  /**
   * The types of events to capture for the bucket. If not specified, captures all events.
   * This should be from the list S3 EventBridge events:
   * https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html
   */
  eventTypes?: string[];

  /**
   * Rules matching specified fields inside "object" in the S3 event.
   */
  patterns?: Record<string, unknown>;
}

/**
 * Props for the filemanager stack.
 */
export type FileManagerStatefulProps = StackProps & FileManagerStatefulConfig;

/**
 * Construct used to configure stateful resources for the filemanager.
 */
export class FileManagerStatefulStack extends Stack {
  readonly accessKeySecret: AccessKeySecret;
  readonly monitoredQueue: MonitoredQueue;

  constructor(scope: Construct, id: string, props: StackProps & FileManagerStatefulProps) {
    super(scope, id, props);

    this.accessKeySecret = new AccessKeySecret(this, 'AccessKey', props.accessKeyProps);

    this.monitoredQueue = new MonitoredQueue(this, 'MonitoredQueue', {
      queueProps: {
        queueName: FILEMANAGER_INGEST_QUEUE,
        removalPolicy: RemovalPolicy.RETAIN,
      },
      dlqProps: {
        queueName: `${FILEMANAGER_INGEST_QUEUE}-dlq`,
        removalPolicy: RemovalPolicy.RETAIN,
        retentionPeriod: Duration.days(14),
      },
      sendToSnsTopic: Arn.format(
        {
          service: 'sns',
          resource: ALERTS_SNS_TOPIC,
        },
        this
      ),
    });
    this.createIngestRules(props.rules);
    this.monitoredQueue.queue.grantSendMessages(new ServicePrincipal('events.amazonaws.com'));
  }

  /**
   * Create the rules that forward S3 events to the filemanager queue.
   */
  createIngestRules(rules: IngestRules[]) {
    let cnt = 1;
    for (const prop of rules) {
      const eventPattern = {
        source: ['aws.s3'],
        detailType: prop.eventTypes,
        detail: {
          ...(prop.bucket && {
            bucket: {
              name: [prop.bucket],
            },
          }),
          ...(prop.patterns && {
            object: prop.patterns,
          }),
        },
      };

      const rule = new Rule(this, 'Rule' + cnt.toString(), {
        eventPattern,
      });

      rule.addTarget(new SqsQueue(this.monitoredQueue.queue));
      cnt += 1;
    }
  }
}
