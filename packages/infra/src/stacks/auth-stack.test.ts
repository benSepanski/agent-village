import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { devConfig } from '../../config/dev.js';
import type { EnvConfig } from '../../config/index.js';
import { AuthStack } from './auth-stack.js';

function synth(config: EnvConfig = devConfig): Template {
  const app = new App();
  const stack = new AuthStack(app, 'test-auth', {
    env: { account: '000000000000', region: 'us-east-1' },
    config,
  });
  return Template.fromStack(stack);
}

describe('AuthStack', () => {
  it('creates a hosted UI domain from the env prefix', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'agent-village-dev',
    });
  });

  it('supports only the COGNITO provider when no Google client is configured', () => {
    const template = synth();
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'agent-village-dev-spa',
      SupportedIdentityProviders: ['COGNITO'],
      CallbackURLs: ['http://localhost:5173'],
    });
  });

  it('wires Google federation into the client when googleClientId is set', () => {
    const template = synth({
      ...devConfig,
      googleClientId: 'client-id.apps.googleusercontent.com',
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderName: 'Google',
      ProviderType: 'Google',
      ProviderDetails: Match.objectLike({
        client_id: 'client-id.apps.googleusercontent.com',
        authorize_scopes: 'openid email profile',
      }),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'agent-village-dev-spa',
      SupportedIdentityProviders: ['COGNITO', 'Google'],
    });
  });

  it('keeps the CLI app client (village CLI login depends on it) regardless of Google config', () => {
    for (const config of [devConfig, { ...devConfig, googleClientId: 'client-id' }]) {
      const template = synth(config);
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ClientName: 'agent-village-dev-cli',
        ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
        SupportedIdentityProviders: ['COGNITO'],
      });
      template.hasOutput('CliClientId', {});
    }
  });
});
