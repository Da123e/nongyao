import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ThemeProvider } from './components/ThemeProvider';
import { SensorProvider } from './context/SensorContext';
import { api, authApi } from './services/api';
import { resolveUserRole } from './utils/auth';

const PageFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
  </div>
);

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const SeedTrace = lazy(() => import('./pages/SeedTrace').then(m => ({ default: m.SeedTrace })));
const PlantingManage = lazy(() => import('./pages/PlantingManage').then(m => ({ default: m.PlantingManage })));
const PesticideManage = lazy(() => import('./pages/PesticideManage').then(m => ({ default: m.PesticideManage })));
const InspectionReport = lazy(() => import('./pages/InspectionReport').then(m => ({ default: m.InspectionReport })));
const ProcessingManage = lazy(() => import('./pages/ProcessingManage').then(m => ({ default: m.ProcessingManage })));
const InventoryManage = lazy(() => import('./pages/InventoryManage').then(m => ({ default: m.InventoryManage })));
const SalesManage = lazy(() => import('./pages/SalesManage').then(m => ({ default: m.SalesManage })));
const TraceQuery = lazy(() => import('./pages/TraceQuery').then(m => ({ default: m.TraceQuery })));
const SensorDataEntry = lazy(() => import('./pages/SensorDataEntry').then(m => ({ default: m.SensorDataEntry })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));

const routePermissions: Record<string, string[]> = {
  '/': ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'],
  '/seed': ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'],
  '/planting': ['admin', 'farmer'],
  '/pesticide': ['admin', 'farmer'],
  '/inspection': ['admin', 'farmer', 'inspector'],
  '/processing': ['admin', 'warehouse_manager'],
  '/inventory': ['admin', 'warehouse_manager'],
  '/sales': ['admin', 'warehouse_manager', 'salesperson'],
  '/trace': ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'],
  '/sensor': ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'],
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
    let role = '';
    if (userInfoStr) {
      try {
        const parsed = JSON.parse(userInfoStr);
        role = resolveUserRole(parsed);
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
    navigate('/');
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
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/login" element={isLoggedIn ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />

      {/* ===== 公开入口（不登录也能访问、不带管理员侧栏） ===== */}
      {/* 消费者扫码溯源端：/trace/public?batch=PB2026-001 */}
      <Route
        path="/trace/public"
        element={
          <ErrorBoundary>
            <TraceQuery publicMode />
          </ErrorBoundary>
        }
      />

      {/* 未登录态访问 /trace：走公开模式（允许用户直接链接分享） */}
      {!isLoggedIn && (
        <Route
          path="/trace"
          element={
            <ErrorBoundary>
              <TraceQuery publicMode />
            </ErrorBoundary>
          }
        />
      )}

      <Route path="/" element={isLoggedIn ? <Layout onLogout={handleLogout} /> : <Navigate to="/login" />}>
        <Route index element={
          <ProtectedRoute allowedRoles={routePermissions['/']} userRole={userRole}>
            {userRole === 'warehouse_manager' ? <Navigate to="/inventory" replace /> :
             userRole === 'salesperson' ? <Navigate to="/sales" replace /> :
             <ErrorBoundary><Dashboard /></ErrorBoundary>}
          </ProtectedRoute>
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

      <Route path="*" element={<Navigate to={isLoggedIn ? '/' : '/login'} replace />} />
    </Routes>
    </Suspense>
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
