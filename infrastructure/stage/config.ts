import { getDefaultApiGatewayConfiguration } from '@orcabus/platform-cdk-constructs/api-gateway';
import { StageName } from '@orcabus/platform-cdk-constructs/utils';

export const getStackProps = (stage: StageName) => {
  const serviceDomainNameDict: Record<StageName, string> = {
    BETA: 'service.dev.umccr.org',
    GAMMA: 'service.stg.umccr.org',
    PROD: 'service.prod.umccr.org',
  };

  return {
    apiGatewayConstructProps: {
      ...getDefaultApiGatewayConfiguration(stage),
      apiName: 'ServiceAPI',
      customDomainNamePrefix: 'service-orcabus',
    },
    serviceDomainName: serviceDomainNameDict[stage],
  };
};
