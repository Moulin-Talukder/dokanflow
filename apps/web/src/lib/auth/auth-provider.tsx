'use client';

import type { Permission, Session } from '@dokanflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { publicEnv } from '../env';
import { AuthClient } from './auth-client';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  client: AuthClient;
  /** UI convenience only; the API enforces permissions. */
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // undefined = not known yet (initial silent refresh in progress).
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [client] = useState(
    () => new AuthClient({ baseUrl: publicEnv.NEXT_PUBLIC_API_URL, onSessionChange: setSession }),
  );

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    client.refresh().catch(() => {
      setSession(null);
    });
  }, [client]);

  // Cached data belongs to one user in one shop; drop it when either changes.
  const scope = session ? `${session.user.id}:${session.tenant.id}` : null;
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current !== scope) {
      queryClient.clear();
      previousScope.current = scope;
    }
  }, [scope, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session === undefined ? 'loading' : session ? 'authenticated' : 'anonymous',
      session: session ?? null,
      client,
      can: (permission) => session?.permissions.includes(permission) ?? false,
    }),
    [session, client],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
