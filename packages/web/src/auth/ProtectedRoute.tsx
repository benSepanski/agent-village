import { type ReactNode } from 'react';
import { useAuth } from './AuthProvider.js';

export interface ProtectedRouteProps {
  children: ReactNode;
  fallback: ReactNode;
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading…</p>;
  if (!user) return <>{fallback}</>;
  return <>{children}</>;
}
