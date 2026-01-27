import { Aspects, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { synthesisMessageToString } from '@orcabus/platform-cdk-constructs/utils';

/**
 * Run the CDK nag checks.
 */
export function cdkNagStack(stack: Stack, applySuppressions: (stack: Stack) => void) {
  Aspects.of(stack).add(new AwsSolutionsChecks());
  applySuppressions(stack);

  test(`cdk-nag AwsSolutions Pack errors`, () => {
    const errors = Annotations.fromStack(stack)
      .findError('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(errors).toHaveLength(0);
  });

  test(`cdk-nag AwsSolutions Pack warnings`, () => {
    const warnings = Annotations.fromStack(stack)
      .findWarning('*', Match.stringLikeRegexp('AwsSolutions-.*'))
      .map(synthesisMessageToString);
    expect(warnings).toHaveLength(0);
  });
}

/**
 * Apply nag suppressions for filemanager ingest buckets.
 * @param stack
 */
export function applyIAMWildcardSuppression(stack: Stack) {
  NagSuppressions.addResourceSuppressions(
    stack,
    [
      {
        id: 'AwsSolutions-IAM5',
        reason: "'*' is required to access objects in the indexed bucket by filemanager",
        appliesTo: [
          'Resource::arn:aws:s3:::org.umccr.data.oncoanalyser/*',
          'Resource::arn:aws:s3:::archive-prod-analysis-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::archive-prod-fastq-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::ntsm-fingerprints-472057503814-ap-southeast-2/*',
          'Resource::arn:aws:s3:::fastq-manager-sequali-outputs-472057503814-ap-southeast-2/*',
          'Resource::arn:aws:s3:::data-sharing-artifacts-472057503814-ap-southeast-2/*',
          'Resource::arn:aws:s3:::pipeline-montauk-977251586657-ap-southeast-2/*',
          'Resource::arn:aws:s3:::pipeline-prod-cache-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::research-data-550435500918-ap-southeast-2/*',
          'Resource::arn:aws:s3:::test-data-503977275616-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-889522050439-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-491085415398-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-071784445872-ap-southeast-2/*',
          'Resource::arn:aws:s3:::project-data-980504796380-ap-southeast-2/*',
        ],
      },
    ],
    true
  );
}
