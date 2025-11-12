import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api/api';
import { AuthContext } from '../contexts/AuthContext';
import { saveIdentityEncrypted, savePreKeys } from '../crypto/keystore';
import { generateIdentityAndPreKeys, signalStore } from '../crypto/signal';

const initialForm = {
  username: '',
  email: '',
  password: '',
  passphrase: '',
};

export function RegisterPage() {
  const { register } = useContext(AuthContext);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const update = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.passphrase || form.passphrase.length < 8) {
      setError('Задайте пароль-фразу длиной не менее 8 символов');
      return;
    }

    setLoading(true);
    try {
      const identityMaterial = await generateIdentityAndPreKeys();

      const uploadPayload = {
        identityKey: identityMaterial.bundle.identityKey,
        signedPreKey: identityMaterial.bundle.signedPreKey,
        oneTimePreKeys: identityMaterial.bundle.oneTimePreKeys,
      };

      await register({
        username: form.username,
        email: form.email,
        password: form.password,
        publicKey: identityMaterial.bundle.identityKey,
      });

      await saveIdentityEncrypted(form.passphrase, {
        registrationId: identityMaterial.registrationId,
        identityKeyPair: identityMaterial.identityKeyPair,
      });

      await savePreKeys(form.passphrase, {
        signedPreKey: identityMaterial.signedPreKey,
        oneTimePreKeys: identityMaterial.oneTimePreKeys,
      });

      await api.uploadBundle(uploadPayload);

      // загрузим материал обратно в рантайм, чтобы не требовать повторного ввода
      signalStore.setIdentityKeyPair(identityMaterial.identityKeyPair);
      signalStore.setLocalRegistrationId(identityMaterial.registrationId);
      signalStore.storeSignedPreKey(
        identityMaterial.signedPreKey.keyId,
        identityMaterial.signedPreKey.keyPair
      );
      identityMaterial.oneTimePreKeys.forEach((preKey) => {
        signalStore.storePreKey(preKey.keyId, preKey.keyPair);
      });

      navigate('/chat');
    } catch (err) {
      console.error('Registration failed', err);
      setError('Не удалось завершить регистрацию. Проверьте данные и попробуйте снова.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24, border: '1px solid #ccc' }}>
      <h2>Регистрация</h2>
      {error && <div style={{ color: 'red', marginBottom: 12 }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Имя пользователя
          <input
            name="username"
            value={form.username}
            onChange={update}
            required
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Email
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={update}
            required
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Пароль
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={update}
            required
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          Пароль-фраза для ключей (локально)
          <input
            type="password"
            name="passphrase"
            value={form.passphrase}
            onChange={update}
            required
            placeholder="Не передаётся на сервер"
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Создаём учётную запись…' : 'Зарегистрироваться'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Уже есть аккаунт? <Link to="/login">Войти</Link>
      </p>
    </div>
  );
}
