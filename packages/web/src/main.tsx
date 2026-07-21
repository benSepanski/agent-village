import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useAuth, AuthProvider } from './auth/AuthProvider.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { configureAmplify } from './auth/amplify-config.js';
import { router } from './router.js';

configureAmplify();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '16px' }}>
      <h1>Agent Village</h1>
      <section>
        <h2>Sign in</h2>
        <button type="button" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
      </section>
    </main>
  );
}

function App() {
  return (
    <ProtectedRoute fallback={<SignInScreen />}>
      <RouterProvider router={router} />
    </ProtectedRoute>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
