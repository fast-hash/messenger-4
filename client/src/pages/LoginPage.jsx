import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AuthContext } from '../contexts/AuthContext';
import { loadIdentity, loadPreKeys } from '../crypto/keystore';
import { signalStore, resetSignalState } from '../crypto/signal';

export default function LoginPage() {
  const { login, error } = useContext(AuthContext);
  const [form, setForm] = useState({ email: '', password: '', passphrase: '' });
  const [unlockError, setUnlockError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setUnlockError('');
    setLoading(true);
    try {
      await login({ email: form.email, password: form.password });

      resetSignalState();

      const identity = await loadIdentity(form.passphrase);
      if (!identity) {
        throw new Error('Ключи не найдены в локальном хранилище');
      }
      signalStore.setIdentityKeyPair({
        pubKey: identity.identityKeyPair.pubKey,
        privKey: identity.identityKeyPair.privKey,
      });
      signalStore.setLocalRegistrationId(identity.registrationId);

      const preKeys = await loadPreKeys(form.passphrase);
      if (preKeys) {
        signalStore.storeSignedPreKey(preKeys.signedPreKey.keyId, preKeys.signedPreKey.keyPair);
        preKeys.oneTimePreKeys.forEach((item) => {
          signalStore.storePreKey(item.keyId, item.keyPair);
        });
      }

      navigate('/chat');
    } catch (err) {
      console.error('Login failed', err);
      setUnlockError(err.message || 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: '100px auto', padding: 20, border: '1px solid #ccc' }}>
      <h2>Вход</h2>
      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
      {unlockError && <div style={{ color: 'red', marginBottom: 8 }}>{unlockError}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 10 }}>
          <label>Email</label>
          <br />
          <input type="email" name="email" value={form.email} onChange={handleChange} required />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label>Пароль</label>
          <br />
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            required
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label>Пароль-фраза для ключей</label>
          <br />
          <input
            type="password"
            name="passphrase"
            value={form.passphrase}
            onChange={handleChange}
            required
            placeholder="Хранится только локально"
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Проверяем…' : 'Войти'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
      </p>
    </div>
  );
}
