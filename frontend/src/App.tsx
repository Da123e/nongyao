import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Dashboard } from './pages/Dashboard';
import { SeedTrace } from './pages/SeedTrace';
import { PlantingManage } from './pages/PlantingManage';
import { PesticideManage } from './pages/PesticideManage';
import { InspectionReport } from './pages/InspectionReport';
import { ProcessingManage } from './pages/ProcessingManage';
import { InventoryManage } from './pages/InventoryManage';
import { SalesManage } from './pages/SalesManage';
import { TraceQuery } from './pages/TraceQuery';
import { SensorDataEntry } from './pages/SensorDataEntry';

import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ThemeProvider } from './components/ThemeProvider';
import { SensorProvider } from './context/SensorContext';
import { api, authApi } from './services/api';
import { resolveUserRole } from './utils/auth';

const routePermissions: Record<string, string[]> = {
  '/': ['admin', 'farmer', 'inspector'],
  '/seed': ['admin', 'farmer'],
  '/planting': ['admin', 'farmer'],
  '/pesticide': ['admin', 'farmer'],
  '/inspection': ['admin', 'inspector'],
  '/processing': ['admin'],
  '/inventory': ['admin', 'warehouse_manager'],
  '/sales': ['admin', 'salesperson'],
  '/trace': ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'],
  '/sensor': ['admin', 'farmer', 'inspector'],
};

function AppContent() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // 初始值使用空字符串，避免默认落入 admin（安全+避免路由不一致）
  const [userRole, setUserRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const validateToken = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      try {
        const res = await authApi.getProfile();
        const role = resolveUserRole(res.data);
        if (!role) {
          localStorage.removeItem('token');
          localStorage.removeItem('user_info');
          delete api.defaults.headers.common['Authorization'];
          if (!cancelled) {
            setUserRole('');
            setIsLoggedIn(false);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          // 一次性更新，避免 isLoggedIn 与 role 不一致的中间渲染
          setUserRole(role);
          setIsLoggedIn(true);
          setLoading(false);
        }
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user_info');
        delete api.defaults.headers.common['Authorization'];
        if (!cancelled) {
          setUserRole('');
          setIsLoggedIn(false);
          setLoading(false);
        }
      }
    };
    validateToken();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = useCallback(() => {
    const token = localStorage.getItem('token');
    const userInfoStr = localStorage.getItem('user_info');
    if (!token) { return; }
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    let redirectPath = '/';
    let role = '';
    if (userInfoStr) {
      try {
        const parsed = JSON.parse(userInfoStr);
        role = resolveUserRole(parsed);
        if (role === 'warehouse_manager') redirectPath = '/inventory';
        if (role === 'salesperson') redirectPath = '/sales';
      } catch {
        role = '';
      }
    }
    if (!role) {
      localStorage.removeItem('token');
      localStorage.removeItem('user_info');
      delete api.defaults.headers.common['Authorization'];
      setUserRole('');
      setIsLoggedIn(false);
      return;
    }
    // 一次性同时设置，避免中间不一致状态导致路由跳转循环
    setUserRole(role);
    setIsLoggedIn(true);
    navigate(redirectPath);
  }, [navigate]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    delete api.defaults.headers.common['Authorization'];
    setIsLoggedIn(false);
    navigate('/login');
  }, [navigate]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <Routes>
      <Route path="/login" element={isLoggedIn ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
      
      <Route path="/" element={isLoggedIn ? <Layout onLogout={handleLogout} /> : <Navigate to="/login" />}>
        <Route index element={
          userRole === 'warehouse_manager' ? (
            <Navigate to="/inventory" replace />
          ) : userRole === 'salesperson' ? (
            <Navigate to="/sales" replace />
          ) : (
            <ProtectedRoute allowedRoles={routePermissions['/']} userRole={userRole}>
              <ErrorBoundary><Dashboard /></ErrorBoundary>
            </ProtectedRoute>
          )
        } />
        <Route path="seed" element={
          <ProtectedRoute allowedRoles={routePermissions['/seed']} userRole={userRole}>
            <ErrorBoundary><SeedTrace /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="planting" element={
          <ProtectedRoute allowedRoles={routePermissions['/planting']} userRole={userRole}>
            <ErrorBoundary><PlantingManage /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="pesticide" element={
          <ProtectedRoute allowedRoles={routePermissions['/pesticide']} userRole={userRole}>
            <ErrorBoundary><PesticideManage /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="inspection" element={
          <ProtectedRoute allowedRoles={routePermissions['/inspection']} userRole={userRole}>
            <ErrorBoundary><InspectionReport /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="processing" element={
          <ProtectedRoute allowedRoles={routePermissions['/processing']} userRole={userRole}>
            <ErrorBoundary><ProcessingManage /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="inventory" element={
          <ProtectedRoute allowedRoles={routePermissions['/inventory']} userRole={userRole}>
            <ErrorBoundary><InventoryManage /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="sales" element={
          <ProtectedRoute allowedRoles={routePermissions['/sales']} userRole={userRole}>
            <ErrorBoundary><SalesManage /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="trace" element={
          <ProtectedRoute allowedRoles={routePermissions['/trace']} userRole={userRole}>
            <ErrorBoundary><TraceQuery /></ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="sensor" element={
          <ProtectedRoute allowedRoles={routePermissions['/sensor']} userRole={userRole}>
            <ErrorBoundary><SensorDataEntry /></ErrorBoundary>
          </ProtectedRoute>
        } />
      </Route>

      {/* 未知路径：登录用户跳 /trace（全角色可访问），未登录跳 /login */}
      <Route path="*" element={<Navigate to={isLoggedIn ? "/trace" : "/login"} replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SensorProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </SensorProvider>
    </ThemeProvider>
  );
}

export default App;
