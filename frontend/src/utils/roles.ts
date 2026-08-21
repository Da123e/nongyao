import { resolveUserRole } from './auth';

export type RoleType = 'admin' | 'farmer' | 'inspector' | 'warehouse_manager' | 'salesperson';

export const getCurrentUserRole = (): RoleType | null => {
  const userInfoStr = localStorage.getItem('user_info');
  if (!userInfoStr) return null;
  try {
    const parsed = JSON.parse(userInfoStr);
    // 统一使用共享的 resolveUserRole，确保与 App/Layout/Dashboard 一致
    const resolved = resolveUserRole(parsed);
    if (!resolved) return null;
    return resolved as RoleType;
  } catch {
    return null;
  }
};

export const canManageSensors = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'farmer';
};

export const canSubmitSensorData = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'farmer';
};

export const canManagePlanting = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'farmer';
};

export const canManagePesticide = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'farmer';
};

export const canCreateInspection = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'inspector';
};

export const canManageInventory = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'warehouse_manager';
};

export const canManageSales = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'salesperson';
};

export const canExportTracePdf = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'inspector' || role === 'salesperson';
};