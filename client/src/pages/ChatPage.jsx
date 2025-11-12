import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';

import { getBundle, sendMessage as sendCiphertext, history as fetchHistory } from '../api/api.js';
import { ChatWindow } from '../components/ChatWindow';
import MessageInput from '../components/MessageInput';
import { AuthContext } from '../contexts/AuthContext';
import { initSession, decryptMessage } from '../crypto/signal.js';

export default function ChatPage() {
  const { userId, isAuthenticated, logout } = useContext(AuthContext);
  const { chatId: routeChatId } = useParams();

  const chatId = useMemo(() => routeChatId, [routeChatId]);
  const [messages, setMessages] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joinedRoom, setJoinedRoom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSessionReady(false);

    setMessages([]);
    setHistoryCursor(null);
    setHasMoreHistory(false);
    setLoadingHistory(false);

    (async () => {
      try {
        const bundle = await getBundle(chatId);
        if (cancelled) return;
        await initSession(chatId, bundle);
        if (!cancelled) {
          setSessionReady(true);
        }
      } catch (err) {
        console.error('Failed to initialise Signal session:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  useEffect(() => {
    if (!sessionReady) return undefined;
    let cancelled = false;

    setLoadingHistory(true);
    (async () => {
      try {
        const {
          messages: historyMessages,
          nextCursor,
          hasMore,
        } = await fetchHistory(chatId, {
          limit: 50,
        });
        if (cancelled) return;
        setMessages(historyMessages);
        setHistoryCursor(nextCursor);
        setHasMoreHistory(hasMore);
      } catch (err) {
        console.error('Failed to load chat history:', err);
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, sessionReady]);

  useEffect(() => {
    setJoinError('');
    setJoinedRoom(false);
    if (!isAuthenticated || !sessionReady) return undefined;

    const configuredUrl = (import.meta.env.VITE_API_URL || '').trim();
    const fallbackOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:3000';
    let resolvedUrl = configuredUrl || fallbackOrigin;

    try {
      resolvedUrl = new URL(resolvedUrl, fallbackOrigin).toString();
    } catch (err) {
      setJoinError('Некорректный адрес сервера WebSocket.');
      console.error('Invalid socket URL:', err);
      return undefined;
    }

    if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
      try {
        const parsed = new URL(resolvedUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'ws:') {
          setJoinError('Для защищённого соединения укажите HTTPS/WSS адрес в VITE_API_URL.');
          return undefined;
        }
      } catch (err) {
        setJoinError('Не удалось разобрать адрес сервера WebSocket.');
        console.error('Failed to parse socket URL:', err);
        return undefined;
      }
    }

    const describeJoinError = (reason) => {
      switch (reason) {
        case 'forbidden':
          return 'Вы не можете подключиться к этому чату.';
        case 'bad chatId':
        case 'invalid_chat':
          return 'Некорректный идентификатор чата.';
        case 'rate_limited':
          return 'Слишком много попыток переподключения. Попробуйте позже.';
        case 'unauthorized':
          return 'Сессия недействительна. Выполните вход ещё раз.';
        default:
          if (!reason || reason === 'connection_error') {
            return 'Не удалось подключиться к чату.';
          }
          return reason;
      }
    };

    const socket = io(resolvedUrl, {
      withCredentials: true,
    });

    let cancelled = false;

    socket.emit('join', { chatId }, (ack) => {
      if (cancelled) return;
      if (!ack?.ok) {
        const message = describeJoinError(ack?.error);
        setJoinError(message);
        if (ack?.error === 'unauthorized') {
          logout();
        }
        return;
      }
      setJoinError('');
      setJoinedRoom(true);
    });

    const handler = async (message) => {
      try {
        const text = await decryptMessage(message.encryptedPayload);
        setMessages((prev) => {
          const key = message.id || message._id || message.createdAt;
          if (
            prev.some((existing) => (existing.id || existing._id || existing.createdAt) === key)
          ) {
            return prev;
          }
          return [...prev, { ...message, text }];
        });
      } catch (err) {
        console.error('Failed to decrypt incoming message:', err);
      }
    };

    socket.on('message', handler);

    const connectErrorHandler = (err) => {
      if (cancelled) return;
      const code = err?.message || err?.data?.message || 'connection_error';
      const friendly = describeJoinError(code);
      setJoinError(friendly);
      if (code === 'unauthorized') {
        logout();
      }
      setJoinedRoom(false);
    };

    const disconnectHandler = () => {
      if (cancelled) return;
      setJoinedRoom(false);
    };

    socket.on('connect_error', connectErrorHandler);
    socket.on('disconnect', disconnectHandler);

    return () => {
      cancelled = true;
      socket.off('message', handler);
      socket.off('connect_error', connectErrorHandler);
      socket.off('disconnect', disconnectHandler);
      socket.disconnect();
    };
  }, [chatId, isAuthenticated, logout, sessionReady]);

  const handleSend = async (plainText) => {
    if (!sessionReady || !plainText || !joinedRoom) return;
    try {
      const { encryptedPayload } = await sendCiphertext(chatId, plainText);
      setMessages((prev) => {
        const createdAt = new Date().toISOString();
        return [
          ...prev,
          {
            chatId,
            senderId: userId,
            encryptedPayload,
            text: plainText,
            createdAt,
          },
        ];
      });
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleLoadMore = async () => {
    if (!hasMoreHistory || loadingHistory || !historyCursor) {
      return;
    }
    setLoadingHistory(true);
    try {
      const {
        messages: olderMessages,
        nextCursor,
        hasMore,
      } = await fetchHistory(chatId, {
        limit: 50,
        cursor: historyCursor,
      });
      setMessages((prev) => {
        const existingKeys = new Set(prev.map((msg) => msg.id || msg._id || msg.createdAt));
        const deduped = [];
        for (const message of olderMessages) {
          const key = message.id || message._id || message.createdAt;
          if (existingKeys.has(key)) {
            continue;
          }
          existingKeys.add(key);
          deduped.push(message);
        }
        return deduped.length ? [...deduped, ...prev] : prev;
      });
      setHistoryCursor(nextCursor);
      setHasMoreHistory(hasMore);
    } catch (err) {
      console.error('Failed to load earlier messages:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <button onClick={logout}>Выйти</button>
      <h3>
        Чат <em>{chatId}</em>
      </h3>
      {joinError ? (
        <div role="alert" style={{ color: 'red', marginBottom: 12 }}>
          {joinError}
        </div>
      ) : null}
      <ChatWindow
        messages={messages}
        currentUserId={userId}
        onLoadMore={handleLoadMore}
        hasMore={hasMoreHistory}
        loadingMore={loadingHistory}
      />
      <MessageInput onSend={handleSend} />
    </div>
  );
}
