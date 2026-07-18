import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  OAuthScope,
  UserPool,
  UserPoolClientIdentityProvider,
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
  public readonly cliClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removal = config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const pool = new UserPool(this, 'UserPool', {
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
      removalPolicy: removal,
    });

    // Google IdP wiring lands in Phase 1.2 (see docs/playbooks/add-frontend-route.md).
    this.userPool = pool;
    this.userPoolClient = pool.addClient('SpaClient', {
      userPoolClientName: `${config.prefix}-spa`,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
    });

    // CLI app client: USER_PASSWORD_AUTH direct to Cognito over TLS, no
    // hosted-UI/OAuth block (see the nag suppression rationale in bin/app.ts
    // for why this replaces SRP for the CLI).
    this.cliClient = pool.addClient('CliClient', {
      userPoolClientName: `${config.prefix}-cli`,
      authFlows: { userPassword: true },
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
    });
    new CfnOutput(this, 'CliClientId', { value: this.cliClient.userPoolClientId });
  }
}
