import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: string[];
  userRole: string;
}

export function ProtectedRoute({ children, allowedRoles, userRole }: ProtectedRouteProps) {
  if (allowedRoles.includes(userRole)) {
    return <>{children}</>;
  }
  // 无权限：若用户已登录但角色不允许，跳转到 /trace（所有登录用户都能访问的安全页）；
  // 否则跳回登录页。避免 Navigate 到 "/" 触发 index 路由再转其他页面造成死循环。
  if (userRole) {
    return <Navigate to="/trace" replace />;
  }
  return <Navigate to="/login" replace />;
}
