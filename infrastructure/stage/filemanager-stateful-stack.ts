import { Construct } from 'constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { AccessKeySecret, AccessKeySecretProps } from '../components/access-key-secret';
import { EventSourceConstruct, EventSourceProps } from '../components/event-source';

/**
 * Stateful config for filemanager.
 */
export interface FileManagerStatefulConfig {
  /**
   * Access key props.
   */
  accessKeyProps: AccessKeySecretProps;
  /**
   * Any configuration related to event source
   */
  eventSourceProps: EventSourceProps;
}

/**
 * Props for the filemanager stack.
 */
export type FileManagerStatefulProps = StackProps & FileManagerStatefulConfig;

/**
 * Construct used to configure the filemanager.
 */
export class FileManagerStateful extends Stack {
  readonly accessKeySecret: AccessKeySecret;

  constructor(scope: Construct, id: string, props: StackProps & FileManagerStatefulProps) {
    super(scope, id, props);

    this.accessKeySecret = new AccessKeySecret(this, 'AccessKey', props.accessKeyProps);
    new EventSourceConstruct(this, 'EventSourceConstruct', props.eventSourceProps);
  }
}
