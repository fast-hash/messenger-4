// src/components/MessageInput.jsx
import React, { useState } from 'react';

export default function MessageInput({ onSend }) {
  const [text, setText] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!text) return;
    onSend(text);
    setText('');
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', marginTop: '1em' }}>
      <input
        style={{ flex: 1, padding: '0.5em' }}
        data-testid="composer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your message…"
      />
      <button type="submit" style={{ marginLeft: '0.5em' }}>
        Send
      </button>
    </form>
  );
}
