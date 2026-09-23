'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from './api';

/**
 * Authentication Context Provider
 * Manages user session, token storage, and role-based access.
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ---- Initialize from localStorage ----
  useEffect(() => {
    const init = async () => {
      try {
        const token = localStorage.getItem('kmc_access_token');
        const cached = localStorage.getItem('kmc_user');

        if (token) {
          if (cached) {
            try {
              setUser(JSON.parse(cached));
            } catch (parseErr) {
              console.warn('Could not parse cached user:', parseErr);
            }
          }
          // Verify token is still valid with backend
          try {
            const res = await authAPI.me();
            setUser(res.data);
            localStorage.setItem('kmc_user', JSON.stringify(res.data));
          } catch (err) {
            if (err.response?.status === 401) {
              logout();
            }
          }
        }
      } catch (e) {
        console.error('Auth initialization error:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // ---- Login ----
  const login = useCallback(async (username, password) => {
    const res = await authAPI.login(username, password);
    const { access_token, refresh_token, user_id, role, username: uname } = res.data;

    localStorage.setItem('kmc_access_token', access_token);
    localStorage.setItem('kmc_refresh_token', refresh_token);

    const initialUser = { id: user_id, username: uname, role };
    setUser(initialUser);
    localStorage.setItem('kmc_user', JSON.stringify(initialUser));

    try {
      const meRes = await authAPI.me();
      const userData = meRes.data;
      localStorage.setItem('kmc_user', JSON.stringify(userData));
      setUser(userData);
      return userData;
    } catch (e) {
      console.warn('Could not fetch full user profile, using login response:', e);
      return initialUser;
    }
  }, []);

  // ---- Logout ----
  const logout = useCallback(() => {
    localStorage.removeItem('kmc_access_token');
    localStorage.removeItem('kmc_refresh_token');
    localStorage.removeItem('kmc_user');
    setUser(null);
  }, []);

  // ---- Role Checks ----
  const isAdmin = user?.role === 'GisAdmin';
  const isCollector = user?.role === 'DataCollector';
  const isValidator = user?.role === 'Validator';

  const value = {
    user,
    loading,
    login,
    logout,
    isAdmin,
    isCollector,
    isValidator,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export default AuthContext;
