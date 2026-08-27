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
  // 对应 DB sensors:manage（admin + farmer）：硬件接入/新增传感器/编辑传感器
  return role === 'admin' || role === 'farmer';
};

export const canSubmitSensorData = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB sensors:submit（admin/farmer/inspector）——inspector 可以手动提交传感器数据补充检测证据
  return role === 'admin' || role === 'farmer' || role === 'inspector';
};

export const canManagePlanting = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB planting:manage（admin + farmer）
  return role === 'admin' || role === 'farmer';
};

export const canManagePesticide = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB pesticide:manage（admin + farmer）：农药目录新建/编辑；采购/使用记录用 pesticide:record
  return role === 'admin' || role === 'farmer';
};

export const canManagePesticideCatalog = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB pesticide:manage（admin + farmer），后端 routers/pesticide.py:29 创建农药就要求此权限
  return role === 'admin' || role === 'farmer';
};

export const canCreateInspection = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB inspection:quality（admin + farmer + inspector）——farmer 需要创建田间自检报告 + 触发农药残留自动报告
  return role === 'admin' || role === 'farmer' || role === 'inspector';
};

export const canManageInventory = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB inventory:manage（admin + warehouse_manager）
  return role === 'admin' || role === 'warehouse_manager';
};

export const canManageProcessing = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB processing:manage（admin + warehouse_manager）
  return role === 'admin' || role === 'warehouse_manager';
};

export const canManageSales = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'salesperson';
};

export const canManageLogistics = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'warehouse_manager';
};

export const canViewLogistics = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'warehouse_manager' || role === 'salesperson';
};

export const canCreateOrders = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'salesperson';
};

export const canManageCustomers = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'salesperson';
};

export const canViewOrders = (): boolean => {
  const role = getCurrentUserRole();
  return role === 'admin' || role === 'salesperson' || role === 'warehouse_manager';
};

export const canExportTracePdf = (): boolean => {
  const role = getCurrentUserRole();
  // 溯源 PDF 导出：admin/inspector/salesperson 商务场景使用，farmer/仓储不导出
  return role === 'admin' || role === 'inspector' || role === 'salesperson';
};

// ===== 种子溯源：查看 vs 管理 =====
export const canManageSeed = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB seed:manage（admin + farmer + warehouse_manager）——仓储需要种子入库
  return role === 'admin' || role === 'farmer' || role === 'warehouse_manager';
};

// ===== 检测报告：查看 vs 创建 =====
export const canViewInspection = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB inspection:query（admin + farmer + inspector）
  return role === 'admin' || role === 'farmer' || role === 'inspector';
};

// ===== 传感器：完整查看（含实时数据+硬件连接/模拟）vs 只读（仅历史） =====
export const canViewSensorRealtime = (): boolean => {
  const role = getCurrentUserRole();
  // 能看实时模拟/硬件：admin/farmer/inspector（即 sensors:submit 的角色）；仓库和售货员只能看历史记录
  return role === 'admin' || role === 'farmer' || role === 'inspector';
};

// ===== 系统管理：机构&用户（仅 admin）=====
export const canManageSystem = (): boolean => {
  const role = getCurrentUserRole();
  // 对应 DB system:manage（仅 admin）——organizations 5 端点 + auth.py GET/POST /users
  return role === 'admin';
};