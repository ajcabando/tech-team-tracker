import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getRefreshToken, onAuthChange, setTokens } from '../lib/api';

export type Branding = {
  applicationName: string;
  companyName: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  loginBackgroundUrl?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  timezone?: string;
  country?: string | null;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'DISPATCHER' | 'TECHNICIAN';
  organizationId?: string | null;
  organization?: { id: string; name: string; slug: string; status: string } | null;
};

export const DEFAULT_BRANDING: Branding = {
  applicationName: 'Multi-Technician Tracker',
  companyName: 'Company',
  primaryColor: '#0ea5e9',
  secondaryColor: '#0f172a',
};

type AuthValue = {
  user: SessionUser | null;
  branding: Branding;
  ready: boolean;
  setupRequired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  reloadBranding: () => Promise<void>;
  setBranding: (branding: Branding) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);

  const reloadBranding = useCallback(async () => {
    try {
      const publicBranding = await api<Branding>('/api/branding/public', { auth: false });
      setBranding({ ...DEFAULT_BRANDING, ...publicBranding });
    } catch {
      /* keep defaults when the API is unreachable */
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const profile = await api<SessionUser>('/api/auth/me');
    setUser(profile);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api<{ initialized: boolean }>('/api/setup/status', { auth: false });
        if (cancelled) return;
        setSetupRequired(!status.initialized);
      } catch {
        /* if the status check fails, assume setup is not required and let login surface errors */
      }
      await reloadBranding();
      if (getRefreshToken()) {
        try {
          await refreshProfile();
        } catch {
          setTokens(null, null);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadBranding, refreshProfile]);

  useEffect(
    () =>
      onAuthChange(() => {
        if (!getRefreshToken()) setUser(null);
      }),
    [],
  );

  useEffect(() => {
    document.title = branding.applicationName;
    if (branding.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = branding.faviconUrl;
    }
  }, [branding]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api<{ accessToken: string; refreshToken: string; user: SessionUser; branding: Branding | null }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);
      if (result.branding) setBranding((current) => ({ ...current, ...result.branding }));
      else await reloadBranding();
    },
    [reloadBranding],
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: { refreshToken: getRefreshToken() } });
    } catch {
      /* logging out locally is enough */
    }
    setTokens(null, null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, branding, ready, setupRequired, login, logout, refreshProfile, reloadBranding, setBranding }),
    [user, branding, ready, setupRequired, login, logout, refreshProfile, reloadBranding],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** Apply the configured brand colors as CSS custom properties on the document root. */
export function useBrandTheme(branding: Branding): void {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', branding.primaryColor);
    root.style.setProperty('--secondary', branding.secondaryColor);
  }, [branding.primaryColor, branding.secondaryColor]);
}
