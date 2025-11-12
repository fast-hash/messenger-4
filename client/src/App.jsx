// client/src/App.jsx
import { useContext } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';

import { AuthContext } from './contexts/AuthContext';
import ChatPage from './pages/ChatPage';
import LoginPage from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

function LoadingScreen() {
  return <div style={{ padding: 32 }}>Загрузка…</div>;
}

function Protected({ children }) {
  const { isAuthenticated, loading } = useContext(AuthContext);
  if (loading) {
    return <LoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const { isAuthenticated, loading } = useContext(AuthContext);

  const loginElement = loading ? <LoadingScreen /> : isAuthenticated ? <Navigate to="/chat" replace /> : <LoginPage />;
  const registerElement = loading
    ? <LoadingScreen />
    : isAuthenticated
      ? <Navigate to="/chat" replace />
      : <RegisterPage />;

  return (
    <Routes>
      <Route path="/login" element={loginElement} />
      <Route path="/register" element={registerElement} />
      <Route
        path="/chat"
        element={
          <Protected>
            <div style={{ padding: 24 }}>
              <p>Выберите собеседника или откройте прямую ссылку чата.</p>
              <Link to="/chat/demo">Открыть демо-чат</Link>
            </div>
          </Protected>
        }
      />
      <Route
        path="/chat/:chatId"
        element={
          <Protected>
            <ChatPage />
          </Protected>
        }
      />
      <Route
        path="*"
        element={
          loading ? <LoadingScreen /> : <Navigate to={isAuthenticated ? '/chat' : '/login'} replace />
        }
      />
    </Routes>
  );
}
