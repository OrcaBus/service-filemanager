import { SynthesisMessage } from 'aws-cdk-lib/cx-api';

export function synthesisMessageToString(sm: SynthesisMessage): string {
  return `${JSON.stringify(sm.entry.data)} [${sm.id}]`;
}
