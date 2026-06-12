import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClientIdentityProvider,
  UserPoolIdentityProviderGoogle,
  type IUserPool,
  type UserPoolClient,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

export interface AuthStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class AuthStack extends Stack {
  public readonly userPool: IUserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    const pool = this.buildUserPool(config);
    this.userPool = pool;

    // Hosted UI domain: Google federation round-trips through it, and the
    // SPA's VITE_COGNITO_DOMAIN env var is this output.
    const domain = pool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: config.prefix },
    });

    const googleIdp = this.buildGoogleIdp(pool, config);
    this.userPoolClient = this.buildSpaClient(pool, config, googleIdp);

    new CfnOutput(this, 'UserPoolDomain', {
      value: `${domain.domainName}.auth.${this.region}.amazoncognito.com`,
    });
  }

  private buildUserPool(config: EnvConfig): UserPool {
    return new UserPool(this, 'UserPool', {
      userPoolName: config.prefix,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireUppercase: true,
        requireSymbols: true,
        requireLowercase: true,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
  }

  /**
   * The Google OAuth client is created out-of-band (Google Cloud console);
   * its secret lives in Secrets Manager, never in the repo. Skipped entirely
   * until config.googleClientId is set, so envs without a Google client
   * still synth and deploy.
   */
  private buildGoogleIdp(
    pool: UserPool,
    config: EnvConfig,
  ): UserPoolIdentityProviderGoogle | undefined {
    if (!config.googleClientId) return undefined;
    return new UserPoolIdentityProviderGoogle(this, 'GoogleIdp', {
      userPool: pool,
      clientId: config.googleClientId,
      clientSecretValue: SecretValue.secretsManager(
        `agent-village/${config.env}/auth/google-client-secret`,
      ),
      scopes: ['openid', 'email', 'profile'],
      attributeMapping: {
        email: ProviderAttribute.GOOGLE_EMAIL,
        fullname: ProviderAttribute.GOOGLE_NAME,
      },
    });
  }

  private buildSpaClient(
    pool: UserPool,
    config: EnvConfig,
    googleIdp: UserPoolIdentityProviderGoogle | undefined,
  ): UserPoolClient {
    const callbackUrls = config.oauthCallbackUrls ? [...config.oauthCallbackUrls] : undefined;
    const client = pool.addClient('SpaClient', {
      userPoolClientName: `${config.prefix}-spa`,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        ...(callbackUrls ? { callbackUrls, logoutUrls: callbackUrls } : {}),
      },
      supportedIdentityProviders: googleIdp
        ? [UserPoolClientIdentityProvider.COGNITO, UserPoolClientIdentityProvider.GOOGLE]
        : [UserPoolClientIdentityProvider.COGNITO],
    });
    // The client must not be created before the IdP it references exists.
    if (googleIdp) client.node.addDependency(googleIdp);
    return client;
  }
}
