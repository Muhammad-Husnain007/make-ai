import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getMe, loginAccount, logoutAccount, registerAccount, resetPassword as resetPasswordAccount } from '../lib/api.js';
import { clearToken, getToken, setToken } from '../lib/session.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    getMe()
      .then((data) => setUser(data.user || null))
      .catch(() => {
        clearToken();
        setUser(null);
      });
  }, []);

  const value = useMemo(() => ({
    user,
    ready: user !== undefined,
    async refresh() {
      if (!getToken()) {
        setUser(null);
        return null;
      }
      const data = await getMe();
      setUser(data.user || null);
      return data.user;
    },
    async register(form) {
      const data = await registerAccount(form);
      if (!data.token) {
        clearToken();
        setUser(null);
        return data;
      }
      setToken(data.token);
      setUser(data.user);
      return data;
    },
    async login(form) {
      const data = await loginAccount(form);
      setToken(data.token);
      setUser(data.user);
      return data;
    },
    async resetPassword(form) {
      const data = await resetPasswordAccount(form);
      if (!data.token) {
        clearToken();
        setUser(null);
        return data;
      }
      setToken(data.token);
      setUser(data.user);
      return data;
    },
    async logout() {
      try { await logoutAccount(); } catch {}
      clearToken();
      setUser(null);
    },
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
