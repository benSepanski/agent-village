import { Amplify } from 'aws-amplify';

interface ViteEnv {
  VITE_COGNITO_USER_POOL_ID?: string;
  VITE_COGNITO_CLIENT_ID?: string;
  VITE_COGNITO_DOMAIN?: string;
  VITE_API_BASE_URL?: string;
}

const env = import.meta.env as ViteEnv;

export function configureAmplify(redirectOrigin: string = window.location.origin): void {
  if (!env.VITE_COGNITO_USER_POOL_ID || !env.VITE_COGNITO_CLIENT_ID || !env.VITE_COGNITO_DOMAIN) {
    console.warn(
      'Cognito env vars missing — sign-in will not work. Set VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID, VITE_COGNITO_DOMAIN.',
    );
    return;
  }
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: env.VITE_COGNITO_CLIENT_ID,
        loginWith: {
          oauth: {
            domain: env.VITE_COGNITO_DOMAIN,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [redirectOrigin],
            redirectSignOut: [redirectOrigin],
            responseType: 'code',
            providers: ['Google'],
          },
        },
      },
    },
  });
}

export const apiBaseUrl = (): string => env.VITE_API_BASE_URL ?? '';
