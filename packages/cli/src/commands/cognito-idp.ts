/**
 * Thin, dependency-free wrappers over the two cognito-idp `InitiateAuth`
 * operations `village login` needs (USER_PASSWORD_AUTH plus the
 * SOFTWARE_TOKEN_MFA challenge response). Direct TLS to
 * `cognito-idp.<region>.amazonaws.com` via fetch — no AWS SDK dependency.
 */

export interface CognitoAuthenticationResult {
  AccessToken: string;
  RefreshToken?: string;
}

export interface CognitoAuthResponse {
  AuthenticationResult?: CognitoAuthenticationResult;
  ChallengeName?: string;
  Session?: string;
}

interface CognitoRequestArgs {
  region: string;
  target: 'InitiateAuth' | 'RespondToAuthChallenge';
  body: unknown;
}

async function cognitoRequest(args: CognitoRequestArgs): Promise<CognitoAuthResponse> {
  const res = await fetch(`https://cognito-idp.${args.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${args.target}`,
    },
    body: JSON.stringify(args.body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito ${args.target} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CognitoAuthResponse;
}

export interface UserPasswordAuthArgs {
  region: string;
  clientId: string;
  email: string;
  password: string;
}

export async function initiateUserPasswordAuth(
  args: UserPasswordAuthArgs,
): Promise<CognitoAuthResponse> {
  return cognitoRequest({
    region: args.region,
    target: 'InitiateAuth',
    body: {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: args.clientId,
      AuthParameters: { USERNAME: args.email, PASSWORD: args.password },
    },
  });
}

export interface MfaChallengeArgs {
  region: string;
  clientId: string;
  email: string;
  code: string;
  session: string;
}

export async function respondToMfaChallenge(args: MfaChallengeArgs): Promise<CognitoAuthResponse> {
  return cognitoRequest({
    region: args.region,
    target: 'RespondToAuthChallenge',
    body: {
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      ClientId: args.clientId,
      ChallengeResponses: { USERNAME: args.email, SOFTWARE_TOKEN_MFA_CODE: args.code },
      Session: args.session,
    },
  });
}
