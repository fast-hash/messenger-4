import React from 'react';

export function ChatWindow({ messages, currentUserId, onLoadMore, hasMore, loadingMore }) {
  const items = Array.isArray(messages) ? messages : [];

  return (
    <div className="messages" data-testid="messages" style={{ maxHeight: 400, overflowY: 'auto' }}>
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          data-testid="load-more"
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        >
          {loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
        </button>
      ) : null}
      {items.length === 0 ? (
        <div style={{ padding: '0.5rem 0' }}>Сообщений пока нет</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((message) => (
            <li
              key={message._id || message.id || message.createdAt}
              style={{ marginBottom: '0.5rem' }}
            >
              <b>{message.senderId === currentUserId ? 'Вы' : 'Собеседник'}:</b>{' '}
              <span>{message.text ?? '…'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
