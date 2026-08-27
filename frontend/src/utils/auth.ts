export type UserRole = 'admin' | 'farmer' | 'inspector' | 'warehouse_manager' | 'salesperson' | 'consumer';

export const KNOWN_ROLE_VALUES: Array<'admin' | 'farmer' | 'inspector' | 'warehouse_manager' | 'salesperson'> = [
  'admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson',
];

export interface UserInfo {
  id: number;
  username: string;
  real_name: string;
  email: string;
  phone: string;
  is_superuser: boolean;
  organization_type: string;
  roles: string[];
  wallet_address: string;
}

/**
 * 统一的角色解析函数
 * 规则：超级用户 → 其他角色按顺序匹配 → 无匹配返回 ''（注意不是 'consumer'，调用方自行处理空值）
 * 此函数被 App.tsx / Layout.tsx / Dashboard.tsx 共享，避免多处角色逻辑不一致
 */
export function resolveUserRole(data: any): string {
  if (!data) return '';
  const roles: string[] = data.roles || [];
  const isSuper = !!data.is_superuser;
  if (isSuper || roles.includes('admin')) return 'admin';
  for (const r of KNOWN_ROLE_VALUES) {
    if (r !== 'admin' && roles.includes(r)) return r;
  }
  return '';
}

const getUserInfo = (): UserInfo | null => {
  try {
    const userInfoStr = localStorage.getItem('user_info');
    if (!userInfoStr) return null;
    return JSON.parse(userInfoStr) as UserInfo;
  } catch {
    return null;
  }
};

export const getCurrentRole = (): UserRole => {
  const userInfo = getUserInfo();
  if (!userInfo) return 'consumer';

  const roles = userInfo.roles || [];

  if (userInfo.is_superuser || roles.includes('admin')) {
    return 'admin';
  }
  if (roles.includes('farmer')) {
    return 'farmer';
  }
  if (roles.includes('inspector')) {
    return 'inspector';
  }
  if (roles.includes('warehouse_manager')) {
    return 'warehouse_manager';
  }
  if (roles.includes('salesperson')) {
    return 'salesperson';
  }

  return 'consumer';
};

export const canViewSection = (section: string, _role: UserRole): boolean => {
  const allSections = ['seed', 'planting', 'pesticide', 'processing', 'inspection', 'inventory', 'sales'];
  return allSections.includes(section);
};