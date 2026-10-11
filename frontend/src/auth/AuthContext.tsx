import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { configureClient } from '../api/client';
import { api } from '../api/endpoints';
import type { Parent } from '../api/types';

const STORAGE_KEY = 'feeflow.session';

interface Session {
  token: string;
  expiresAt: string;
  parent: Parent;
}

interface AuthContextValue {
  session: Session | null;
  /** Set when the API rejected the stored token (shown on the login page). */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) - session lives in memory only */
  }
}

// Module-level mirror so the API client can read the token synchronously.
let currentToken: string | null = loadSession()?.token ?? null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [sessionExpired, setSessionExpired] = useState(false);

  const clear = useCallback((expired: boolean) => {
    currentToken = null;
    saveSession(null);
    setSession(null);
    setSessionExpired(expired);
  }, []);

  configureClient(
    () => currentToken,
    () => clear(true),
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    const next: Session = { token: res.access_token, expiresAt: res.expires_at, parent: res.parent };
    currentToken = next.token;
    saveSession(next);
    setSession(next);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* token may already be invalid; log out locally regardless */
    }
    clear(false);
  }, [clear]);

  const value = useMemo(() => ({ session, sessionExpired, login, logout }), [session, sessionExpired, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
