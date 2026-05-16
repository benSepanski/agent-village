import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { configureAmplify } from './auth/amplify-config.js';

configureAmplify();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  return (
    <section>
      <h2>Sign in</h2>
      <button type="button" onClick={() => void signInWithGoogle()}>
        Sign in with Google
      </button>
    </section>
  );
}

function SignedInScreen() {
  const { user, signOut } = useAuth();
  return (
    <section>
      <h2>Welcome, {user?.username}</h2>
      <p>(Agents UI ships in Phase 1 step 11.)</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </section>
  );
}

function App() {
  return (
    <main>
      <h1>Agent Village</h1>
      <ProtectedRoute fallback={<SignInScreen />}>
        <SignedInScreen />
      </ProtectedRoute>
    </main>
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
