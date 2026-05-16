import { Link, Outlet } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthProvider.js';

export function RootLayout() {
  const { user, signOut } = useAuth();
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '16px' }}>
      <nav style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px' }}>
        <Link to="/" style={{ fontWeight: 700 }}>
          Agent Village
        </Link>
        <span style={{ flex: 1 }} />
        <span style={{ color: '#374151' }}>{user?.username}</span>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </nav>
      <Outlet />
    </main>
  );
}
