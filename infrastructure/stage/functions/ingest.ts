import { Construct } from 'constructs';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { DatabaseProps, Function, FunctionPropsConfigurable } from './function';
import { FILEMANAGER_INGEST_ID_TAG_NAME } from '../constants';

/**
 * Props for controlling access to buckets.
 */
export interface BucketProps {
  /**
   * The buckets that the filemanager is expected to process. This will add policies to access the buckets via
   * 's3:List*' and 's3:Get*'.
   */
  readonly buckets: string[];
}

/**
 * Props related to the filemanager event source.
 */
export type EventSourceProps = {
  /**
   * The SQS queue URL to receive events from.
   */
  readonly eventSources: IQueue[];
} & BucketProps;

/**
 * Props for the ingest function.
 */
export type IngestFunctionProps = FunctionPropsConfigurable & DatabaseProps & EventSourceProps;

/**
 * A construct for the Lambda ingest function.
 */
export class IngestFunction extends Function {
  constructor(scope: Construct, id: string, props: IngestFunctionProps) {
    super(scope, id, {
      package: 'filemanager-ingest-lambda',
      environment: {
        FILEMANAGER_INGESTER_TAG_NAME: FILEMANAGER_INGEST_ID_TAG_NAME,
        ...props.environment,
      },
      ...props,
    });

    this.addAwsManagedPolicy('service-role/AWSLambdaSQSQueueExecutionRole');

    props.eventSources.forEach((source) => {
      const eventSource = new SqsEventSource(source);
      this.function.addEventSource(eventSource);
    });
    this.addPoliciesForBuckets(props.buckets, [
      ...Function.getObjectActions(),
      ...Function.getObjectVersionActions(),
      ...Function.objectTaggingActions(),
    ]);
  }
}
