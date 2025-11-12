import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/api';
import { resetSignalState } from '../crypto/signal';

export const AuthContext = createContext();

function normalizeUserId(value) {
  return typeof value === 'string' && value.length ? value : null;
}

export function AuthProvider({ children }) {
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const applySession = useCallback((nextUserId) => {
    const normalized = normalizeUserId(nextUserId);
    setUserId(normalized);
    return normalized;
  }, []);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const session = await api.session();
      applySession(session?.userId);
    } catch (err) {
      console.warn('Failed to restore auth session', err);
      applySession(null);
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (creds) => {
      setError('');
      try {
        const { userId: issuedUserId } = await api.login(creds);
        const applied = applySession(issuedUserId);
        if (!applied) {
          throw new Error('Invalid credentials');
        }
        return applied;
      } catch (err) {
        applySession(null);
        setError('Не удалось выполнить вход. Проверьте данные.');
        throw err;
      }
    },
    [applySession]
  );

  const register = useCallback(
    async (data) => {
      setError('');
      try {
        const { userId: issuedUserId } = await api.register(data);
        const applied = applySession(issuedUserId);
        if (!applied) {
          throw new Error('Registration failed');
        }
        return applied;
      } catch (err) {
        applySession(null);
        setError('Не удалось завершить регистрацию.');
        throw err;
      }
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    setError('');
    try {
      await api.logout();
    } catch (err) {
      console.warn('Logout request failed', err);
    }
    applySession(null);
    resetSignalState();
    navigate('/login');
  }, [applySession, navigate]);

  const value = useMemo(
    () => ({
      userId,
      isAuthenticated: Boolean(userId),
      error,
      login,
      register,
      logout,
      loading,
      refreshSession,
    }),
    [error, loading, login, logout, refreshSession, register, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
