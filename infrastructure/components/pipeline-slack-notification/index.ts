import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { SlackChannelConfiguration } from 'aws-cdk-lib/aws-chatbot';
import { IPipeline, PipelineNotificationEvents } from 'aws-cdk-lib/aws-codepipeline';
import { DetailType } from 'aws-cdk-lib/aws-codestarnotifications';

/**
 * Props for slack notifier.
 */
export interface PipelineSlackNotifierProps {
  /**
   * The pipeline to notify on.
   */
  pipeline: IPipeline;
  /**
   * Name of the notification.
   */
  notificationName: string;
}

/**
 * A construct that notifies slack on failure and success.
 */
export class PipelineSlackNotifier extends Construct {
  constructor(scope: Construct, id: string, props: PipelineSlackNotifierProps) {
    super(scope, id);

    const alertsBuildSlackConfigArn = StringParameter.valueForStringParameter(
      this,
      '/chatbot_arn/slack/alerts-build'
    );
    const target = SlackChannelConfiguration.fromSlackChannelConfigurationArn(
      this,
      'SlackChannelConfiguration',
      alertsBuildSlackConfigArn
    );

    props.pipeline.notifyOn('PipelineSlackNotification', target, {
      events: [
        PipelineNotificationEvents.PIPELINE_EXECUTION_FAILED,
        PipelineNotificationEvents.PIPELINE_EXECUTION_SUCCEEDED,
      ],
      detailType: DetailType.FULL,
      notificationRuleName: props.notificationName,
    });
  }
}
