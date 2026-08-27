import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from './ThemeProvider';
import {
  LayoutDashboard,
  Wheat,
  Leaf,
  FlaskConical,
  FileText,
  Factory,
  Package,
  ShoppingCart,
  Search,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Bell,
  User,
  Activity,
  AlertCircle,
  PackageOpen,
  CheckCircle2,
  Shield,
  Settings,
  Key,
  UserCircle,
  Palette,
  Save,
  Sun,
  Moon,
  Globe,
  Building2,
  Users,
  Plus,
  Edit3,
  Trash2,
  Eye,
  RotateCw,
  Download,
  Upload,
  Filter,
  Badge,
} from 'lucide-react';
import { authApi, notificationApi, organizationsApi } from '../services/api';
import { resolveUserRole } from '../utils/auth';
import { canManageSystem } from '../utils/roles';
import { formatDateTimeCn, formatDateCn } from '../utils/date';

interface LayoutProps {
  onLogout: () => void;
}

const menuItems = [
  // —— 工作台（首页仅对管理员/种植户/质检员开放；仓储管理员、售货员职责单一，登录后直接进主功能页） ——
  { path: '/', icon: LayoutDashboard, label: '首页', description: '数据概览', roles: ['admin', 'farmer', 'inspector'] },

  // —— 种植端（按任务顺序：种植→施药） ——
  { path: '/planting', icon: Leaf, label: '种植管理', description: '地块与记录', roles: ['admin', 'farmer'] },
  { path: '/pesticide', icon: FlaskConical, label: '农药管理', description: '采购与使用', roles: ['admin', 'farmer'] },

  // —— 检测端（质检员核心工作；种植户/管理员也可查看自己的报告） ——
  { path: '/inspection', icon: FileText, label: '检测报告', description: '质检与残留', roles: ['admin', 'farmer', 'inspector'] },

  // —— 仓储端（按流程：种子入库→加工→库存→发货） ——
  { path: '/seed', icon: Wheat, label: '种子溯源', description: '供应商与批次', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
  { path: '/processing', icon: Factory, label: '加工管理', description: '生产记录', roles: ['admin', 'warehouse_manager'] },
  { path: '/inventory', icon: Package, label: '库存管理', description: '仓库与库存', roles: ['admin', 'warehouse_manager'] },

  // —— 销售端（售货员：销售+溯源答客；仓储：发货签收；管理员：全局） ——
  { path: '/sales', icon: ShoppingCart, label: '销售管理', description: '订单与物流', roles: ['admin', 'warehouse_manager', 'salesperson'] },

  // —— 全员可见（传感器实时数据 + 溯源查询） ——
  { path: '/sensor', icon: Activity, label: '传感器', description: '数据查看', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
  { path: '/trace', icon: Search, label: '溯源查询', description: '全链查询', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
];

// 角色主题：每个角色一套完整色板（用户卡渐变 + 激活态背景/文字/图标/指示条/阴影/分组标题色）
// 注：Tailwind 不能动态拼接类名，所有类必须以完整字符串写出
const roleLabels: Record<string, {
  label: string;
  color: string;
  bg: string;
  gradient: string;
  activeBg: string;        // 激活菜单项背景
  activeText: string;      // 激活菜单项文字
  activeIconBg: string;    // 激活项图标圆角背景
  activeIcon: string;      // 激活项图标颜色
  indicator: string;       // 左侧指示条渐变
  shadow: string;          // 激活项阴影色
  groupLabel: string;      // 分组标题文字色
  ringShadow: string;      // 用户卡光晕阴影
}> = {
  admin: {
    label: '管理员', color: 'text-purple-600', bg: 'bg-purple-100', gradient: 'from-purple-500 to-violet-600',
    activeBg: 'bg-purple-50', activeText: 'text-purple-700', activeIconBg: 'bg-purple-100', activeIcon: 'text-purple-600',
    indicator: 'from-purple-400 to-violet-600', shadow: 'shadow-purple-100', groupLabel: 'text-purple-600/70',
    ringShadow: 'shadow-purple-300/40',
  },
  farmer: {
    label: '种植户', color: 'text-green-600', bg: 'bg-green-100', gradient: 'from-green-500 to-emerald-600',
    activeBg: 'bg-green-50', activeText: 'text-green-700', activeIconBg: 'bg-green-100', activeIcon: 'text-green-600',
    indicator: 'from-green-400 to-emerald-600', shadow: 'shadow-green-100', groupLabel: 'text-green-600/70',
    ringShadow: 'shadow-green-300/40',
  },
  inspector: {
    label: '质检员', color: 'text-blue-600', bg: 'bg-blue-100', gradient: 'from-blue-500 to-indigo-600',
    activeBg: 'bg-blue-50', activeText: 'text-blue-700', activeIconBg: 'bg-blue-100', activeIcon: 'text-blue-600',
    indicator: 'from-blue-400 to-indigo-600', shadow: 'shadow-blue-100', groupLabel: 'text-blue-600/70',
    ringShadow: 'shadow-blue-300/40',
  },
  warehouse_manager: {
    label: '仓储管理员', color: 'text-cyan-600', bg: 'bg-cyan-100', gradient: 'from-cyan-500 to-sky-600',
    activeBg: 'bg-cyan-50', activeText: 'text-cyan-700', activeIconBg: 'bg-cyan-100', activeIcon: 'text-cyan-600',
    indicator: 'from-cyan-400 to-sky-600', shadow: 'shadow-cyan-100', groupLabel: 'text-cyan-600/70',
    ringShadow: 'shadow-cyan-300/40',
  },
  salesperson: {
    label: '售货员', color: 'text-pink-600', bg: 'bg-pink-100', gradient: 'from-pink-500 to-rose-600',
    activeBg: 'bg-pink-50', activeText: 'text-pink-700', activeIconBg: 'bg-pink-100', activeIcon: 'text-pink-600',
    indicator: 'from-pink-400 to-rose-600', shadow: 'shadow-pink-100', groupLabel: 'text-pink-600/70',
    ringShadow: 'shadow-pink-300/40',
  },
};

// 角色自适应菜单分组：每个角色独立配置，避免单项目空组和语义混乱
// admin（全链路视图）：生产→质检→仓储→销售→数据
// farmer（生产执行者）：生产→质检→数据
// inspector（质量把关）：质检→数据
// warehouse_manager（仓储调度）：核心业务→数据
// salesperson（销售接单）：核心业务→数据
const ROLE_MENU_GROUPS: Record<string, { id: string; label: string; paths: string[] }[]> = {
  admin: [
    { id: 'workspace',  label: '工作台',     paths: ['/'] },
    { id: 'production', label: '生产管理',   paths: ['/seed', '/planting', '/pesticide'] },
    { id: 'quality',    label: '质量与检测', paths: ['/inspection'] },
    { id: 'warehouse',  label: '仓储与加工', paths: ['/processing', '/inventory'] },
    { id: 'sales',      label: '销售管理',   paths: ['/sales'] },
    { id: 'data',       label: '数据与溯源', paths: ['/sensor', '/trace'] },
  ],
  farmer: [
    { id: 'workspace',  label: '工作台',     paths: ['/'] },
    { id: 'production', label: '生产管理',   paths: ['/seed', '/planting', '/pesticide'] },
    { id: 'quality',    label: '质量与检测', paths: ['/inspection'] },
    { id: 'data',       label: '数据与溯源', paths: ['/sensor', '/trace'] },
  ],
  inspector: [
    { id: 'workspace',  label: '工作台',     paths: ['/'] },
    { id: 'quality',    label: '质检工作',   paths: ['/inspection', '/seed'] },
    { id: 'data',       label: '数据与溯源', paths: ['/sensor', '/trace'] },
  ],
  warehouse_manager: [
    { id: 'core',       label: '核心业务',   paths: ['/processing', '/inventory', '/sales'] },
    { id: 'data',       label: '数据与溯源', paths: ['/seed', '/sensor', '/trace'] },
  ],
  salesperson: [
    { id: 'core',       label: '核心业务',   paths: ['/sales'] },
    { id: 'data',       label: '数据与溯源', paths: ['/seed', '/sensor', '/trace'] },
  ],
};

type NotificationType = 'warning' | 'info' | 'success';

interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  read?: boolean;
}

const typeStyles: Record<NotificationType, { bg: string; text: string; border: string; badge: string; iconBg: string }> = {
  warning: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100', badge: 'bg-orange-100 text-orange-600', iconBg: 'bg-orange-100' },
  info: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', badge: 'bg-blue-100 text-blue-600', iconBg: 'bg-blue-100' },
  success: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-100', badge: 'bg-green-100 text-green-600', iconBg: 'bg-green-100' },
};

const typeIcons: Record<NotificationType, any> = {
  warning: AlertCircle,
  info: PackageOpen,
  success: CheckCircle2,
};

export function Layout({ onLogout }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [userInfo, setUserInfo] = useState<{ username: string; email?: string; phone?: string; wallet_address?: string; role?: string } | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingTab, setActiveSettingTab] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    phone: '',
  });
  const { theme: currentTheme, setTheme } = useTheme();
  const [passwordData, setPasswordData] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [saveMessage, setSaveMessage] = useState('');
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('notificationSettings');
    return saved ? JSON.parse(saved) : {
      inventory_alert: true,
      order_notification: true,
      system_message: true,
      inspection_report: true,
    };
  });
  const location = useLocation();

  useEffect(() => {
    authApi.getProfile().then(res => {
      // 统一使用共享的 resolveUserRole，避免与 App/Dashboard 不一致
      const role = resolveUserRole(res.data);
      setUserInfo({
        username: res.data.username || '用户',
        email: res.data.email,
        phone: res.data.phone,
        wallet_address: res.data.wallet_address,
        role,
      });
      setFormData({
        username: res.data.username || '',
        email: res.data.email || '',
        phone: res.data.phone || '',
      });
      // 主题：localStorage 优先，后端仅首次登录时作为补充
      const prefs = res.data.preferences || {};
      const localTheme = localStorage.getItem('theme');
      if (!localTheme && prefs.theme) {
        setTheme(prefs.theme as 'dark' | 'light' | 'system');
        localStorage.setItem('theme', prefs.theme);
      }
      // 通知偏好：localStorage 优先，后端仅首次登录时作为补充
      const localNotif = localStorage.getItem('notificationSettings');
      if (!localNotif && prefs.notificationSettings) {
        setNotificationSettings(prefs.notificationSettings);
        localStorage.setItem('notificationSettings', JSON.stringify(prefs.notificationSettings));
      }
    }).catch(err => {
      console.error('Failed to fetch user profile:', err);
    });
  }, []);

  useEffect(() => {
    const fetchNotifications = () => {
      notificationApi.getNotifications().then(res => {
        setNotifications(res.data.data || []);
        setUnreadCount(res.data.unread_count || 0);
      }).catch(err => {
        console.error('Failed to fetch notifications:', err);
      });
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleTheme = (theme: 'dark' | 'light' | 'system') => {
    setTheme(theme);
    localStorage.setItem('theme', theme);
    authApi.updatePreferences({ theme }).catch(() => {});
    setSaveMessage('主题已切换');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const filteredMenuItems = menuItems.filter(item => {
    if (!userInfo?.role) return false;
    return item.roles.includes(userInfo.role);
  });

  const currentPage = filteredMenuItems.find((item) => location.pathname === item.path);
  const roleInfo = userInfo?.role ? roleLabels[userInfo.role] : null;
  const isSystemAdmin = canManageSystem();
  const [activeOrgsTab, setActiveOrgsTab] = useState<'organizations' | 'users'>('organizations');

  // ========= 机构 & 用户管理 state =========
  interface Org { id: number; org_code: string; name: string; type: string; contact_name?: string; phone?: string; address?: string; is_active: boolean; created_at?: string }
  interface Usr { id: number; username: string; full_name?: string; email?: string; phone?: string; roles: string[]; organization_id?: number; organization_name?: string; is_active: boolean }
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<Usr[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [orgsSearch, setOrgsSearch] = useState('');
  const [usersSearch, setUsersSearch] = useState('');
  const [usersRoleFilter, setUsersRoleFilter] = useState<string>('all');
  const [orgsTypeFilter, setOrgsTypeFilter] = useState<string>('all');

  const [showOrgModal, setShowOrgModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Org | null>(null);
  const [orgForm, setOrgForm] = useState<Partial<Org>>({ org_code: '', name: '', type: '监管机构', contact_name: '', phone: '', address: '', is_active: true });

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<Usr | null>(null);
  const [userForm, setUserForm] = useState<any>({ username: '', full_name: '', email: '', phone: '', password: '', role: 'farmer', organization_id: undefined, is_active: true });

  const [detailOrg, setDetailOrg] = useState<Org | null>(null);

  const loadOrgs = () => {
    if (!isSystemAdmin) return;
    setOrgsLoading(true);
    organizationsApi.list().then(r => { setOrgs((r.data as { data?: Org[] })?.data || []); }).catch(() => setOrgs([])).finally(() => setOrgsLoading(false));
  };
  const loadUsers = () => {
    if (!isSystemAdmin) return;
    setUsersLoading(true);
    authApi.listUsers({}).then(r => { setUsers((r.data as { data?: Usr[] })?.data || []); }).catch(() => setUsers([])).finally(() => setUsersLoading(false));
  };
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const handleImportCsv = () => csvFileInputRef.current?.click();
  const onCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setSaveMessage('正在导入...');
      const res = await organizationsApi.importCsv(file);
      const d = res.data as any;
      setSaveMessage(d.message || `导入完成：成功 ${d.imported || 0} 条`);
      loadOrgs();
      loadUsers();
    } catch (err: any) {
      setSaveMessage('导入失败: ' + (err?.response?.data?.detail || err.message));
    } finally {
      e.target.value = '';
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };
  const handleExportCsv = async () => {
    try {
      setSaveMessage('正在导出...');
      const res = await organizationsApi.exportCsv();
      const blob = new Blob([res.data as any], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `organizations_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setSaveMessage('已导出机构数据');
    } catch (err: any) {
      setSaveMessage('导出失败: ' + (err?.response?.data?.detail || err.message));
    } finally {
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };
  const openNewOrg = () => { setEditingOrg(null); setOrgForm({ org_code: 'ORG-' + Date.now().toString().slice(-6), name: '', type: '合作社', contact_name: '', phone: '', address: '', is_active: true }); setShowOrgModal(true); };
  const openEditOrg = (o: Org) => { setEditingOrg(o); setOrgForm({ ...o }); setShowOrgModal(true); };
  const submitOrg = () => {
    if (!orgForm.org_code || !orgForm.name) { setSaveMessage('机构编码和名称必填'); setTimeout(() => setSaveMessage(''), 3000); return; }
    const p = editingOrg ? organizationsApi.update(editingOrg.id, orgForm) : organizationsApi.create({
      org_code: orgForm.org_code!,
      name: orgForm.name!,
      type: orgForm.type,
      contact_name: orgForm.contact_name,
      phone: orgForm.phone,
      address: orgForm.address,
    });
    p.then(() => { setShowOrgModal(false); setSaveMessage(editingOrg ? '机构更新成功' : '机构创建成功'); setTimeout(() => setSaveMessage(''), 3000); loadOrgs(); })
      .catch((e: any) => { setSaveMessage(e.response?.data?.detail || '机构操作失败'); setTimeout(() => setSaveMessage(''), 3000); });
  };
  const deleteOrg = (o: Org) => {
    if (!confirm(`确认删除机构「${o.name}」？如该机构下存在用户则删除将失败。`)) return;
    organizationsApi.delete(o.id).then(() => { setSaveMessage('机构已删除'); setTimeout(() => setSaveMessage(''), 3000); loadOrgs(); })
      .catch((e: any) => { setSaveMessage(e.response?.data?.detail || '删除失败（可能存在关联数据）'); setTimeout(() => setSaveMessage(''), 4000); });
  };
  const openNewUser = () => { setEditingUser(null); setUserForm({ username: '', full_name: '', email: '', phone: '', password: '', role: 'farmer', organization_id: users[0]?.organization_id, is_active: true }); setShowUserModal(true); };
  const openEditUser = (u: Usr) => { setEditingUser(u); setUserForm({ username: u.username, full_name: u.full_name || '', email: u.email || '', phone: u.phone || '', password: '', role: u.roles[0] || 'farmer', organization_id: u.organization_id, is_active: u.is_active }); setShowUserModal(true); };
  const submitUser = () => {
    if (!userForm.username) { setSaveMessage('用户名必填'); setTimeout(() => setSaveMessage(''), 3000); return; }
    if (!editingUser && !userForm.password) { setSaveMessage('新建用户必须设置初始密码'); setTimeout(() => setSaveMessage(''), 3000); return; }
    const payload: any = { role: userForm.role, is_active: !!userForm.is_active, organization_id: userForm.organization_id || null };
    if (userForm.full_name) payload.real_name = userForm.full_name;
    if (userForm.email) payload.email = userForm.email;
    if (userForm.phone) payload.phone = userForm.phone;
    if (userForm.password) payload.password = userForm.password;

    let p;
    if (editingUser) {
      p = authApi.updateUser(editingUser.id, payload);
    } else {
      payload.username = userForm.username;
      payload.password = userForm.password;
      p = authApi.createUser(payload);
    }
    p.then(() => { setShowUserModal(false); setSaveMessage(editingUser ? '用户更新成功' : '用户创建成功'); setTimeout(() => setSaveMessage(''), 3000); loadUsers(); })
      .catch((e: any) => { setSaveMessage(e.response?.data?.detail || '用户操作失败'); setTimeout(() => setSaveMessage(''), 3000); });
  };
  const deleteUserAccount = (u: Usr) => {
    if (!confirm(`确认禁用用户「${u.username}」？禁用后该用户将无法登录。`)) return;
    authApi.deleteUser(u.id).then(() => { setSaveMessage('用户已禁用'); setTimeout(() => setSaveMessage(''), 3000); loadUsers(); })
      .catch((e: any) => { setSaveMessage(e.response?.data?.detail || '禁用失败'); setTimeout(() => setSaveMessage(''), 3000); });
  };
  useEffect(() => {
    if (!showSettings || activeSettingTab !== 'orgs' || !isSystemAdmin) return;
    loadOrgs();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, activeSettingTab, isSystemAdmin]);

  const handleMarkAsRead = (notificationId: number) => {
    notificationApi.markAsRead(notificationId).then(() => {
      setNotifications(notifications.map(n =>
        n.id === notificationId ? { ...n, read: true } : n
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }).catch(err => {
      console.error('Failed to mark notification as read:', err);
    });
  };

  const handleMarkAllRead = () => {
    notificationApi.markAllRead().then(() => {
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    }).catch(err => {
      console.error('Failed to mark all notifications as read:', err);
    });
  };

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validatePhone = (phone: string) => {
    const re = /^1[3-9]\d{9}$/;
    return re.test(phone);
  };

  const handleSaveSettings = () => {
    if (formData.email && !validateEmail(formData.email)) {
      setSaveMessage('请输入正确的邮箱格式');
      setTimeout(() => setSaveMessage(''), 3000);
      return;
    }
    if (formData.phone && !validatePhone(formData.phone)) {
      setSaveMessage('请输入正确的手机号格式');
      setTimeout(() => setSaveMessage(''), 3000);
      return;
    }
    authApi.updateProfile(formData).then(res => {
      setSaveMessage('个人资料更新成功');
      if (res.data.data) {
        setUserInfo(prev => prev ? {
          ...prev,
          username: res.data.data.username,
          email: res.data.data.email,
          phone: res.data.data.phone,
        } : null);
      }
      setTimeout(() => setSaveMessage(''), 3000);
    }).catch(err => {
      setSaveMessage(err.response?.data?.detail || '更新失败，请重试');
      setTimeout(() => setSaveMessage(''), 3000);
    });
  };

  const handleChangePassword = () => {
    if (passwordData.new_password !== passwordData.confirm_password) {
      setSaveMessage('两次输入的密码不一致');
      setTimeout(() => setSaveMessage(''), 3000);
      return;
    }
    if (passwordData.new_password.length < 6) {
      setSaveMessage('新密码长度不能少于6位');
      setTimeout(() => setSaveMessage(''), 3000);
      return;
    }
    authApi.changePassword({
      old_password: passwordData.old_password,
      new_password: passwordData.new_password,
    }).then(() => {
      setSaveMessage('密码修改成功');
      setPasswordData({ old_password: '', new_password: '', confirm_password: '' });
      setTimeout(() => setSaveMessage(''), 3000);
    }).catch(err => {
      setSaveMessage(err.response?.data?.detail || '密码修改失败');
      setTimeout(() => setSaveMessage(''), 3000);
    });
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={{ x: -256 }}
        animate={{ x: mobileMenuOpen ? 0 : (sidebarOpen ? 0 : -256) }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`fixed lg:static z-50 w-64 flex flex-col bg-gradient-to-br from-white to-gray-50 border-r border-gray-100 h-full transition-all duration-300 ${mobileMenuOpen ? 'left-0' : ''}`}
      >
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-200 hover:shadow-xl transition-shadow">
              <Wheat className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-800 text-lg">金生链</h1>
              <p className="text-xs text-gray-500">花生全产业链溯源平台</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (window.innerWidth < 1024) {
                setMobileMenuOpen(false);
              } else {
                setSidebarOpen(false);
              }
            }}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-4">
          {userInfo && roleInfo && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }}
              className={`bg-gradient-to-br ${roleInfo.gradient} rounded-2xl p-5 text-white shadow-xl ${roleInfo.ringShadow} relative overflow-hidden`}
            >
              {/* 角色色光晕装饰 */}
              <div className="absolute -top-8 -right-8 w-24 h-24 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-4 relative">
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${roleInfo.gradient} flex items-center justify-center border-2 border-white/40 ring-4 ring-white/10`}>
                  <User className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/80">{roleInfo.label}</p>
                  <p className="text-lg font-bold truncate">{userInfo.username}</p>
                </div>
              </div>
              {userInfo.wallet_address && (
                <div className="mt-4 flex items-center gap-2 text-xs text-white/90 bg-white/10 rounded-lg px-3 py-2 relative">
                  <Shield className="w-3 h-3" />
                  <span className="truncate" title={userInfo.wallet_address}>
                    {userInfo.wallet_address.slice(0, 6)}...{userInfo.wallet_address.slice(-4)}
                  </span>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 relative">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowSettings(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  <span>设置</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onLogout}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white/10 hover:bg-red-500/30 rounded-xl text-sm font-medium transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>退出</span>
                </motion.button>
              </div>
            </motion.div>
          )}
        </div>

        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          {(ROLE_MENU_GROUPS[userInfo?.role || ''] || ROLE_MENU_GROUPS.admin).map((group) => {
            const groupItems = group.paths
              .map(p => filteredMenuItems.find(it => it.path === p))
              .filter((it): it is NonNullable<typeof it> => Boolean(it));
            if (groupItems.length === 0) return null;
            return (
              <div key={group.id} className="mb-2">
                <div className={`px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider ${roleInfo?.groupLabel || 'text-gray-500'}`}>
                  {group.label}
                </div>
                <div className="space-y-1">
                  {groupItems.map((item, idx) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <motion.div 
                        key={item.path} 
                        initial={{ opacity: 0, x: -20 }} 
                        animate={{ opacity: 1, x: 0 }} 
                        transition={{ delay: 0.1 + idx * 0.05 }}
                      >
                        <Link
                          to={item.path}
                          onClick={() => { if (window.innerWidth < 1024) setMobileMenuOpen(false); }}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative ${isActive
                            ? `${roleInfo?.activeBg} ${roleInfo?.activeText} font-semibold shadow-sm ${roleInfo?.shadow}`
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                          }`}
                          aria-label={item.label}
                        >
                          {isActive && (
                            <motion.div 
                              initial={{ scaleY: 0 }} 
                              animate={{ scaleY: 1 }} 
                              className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-gradient-to-b ${roleInfo?.indicator} rounded-r-full`} 
                            />
                          )}
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${isActive ? roleInfo?.activeIconBg : 'group-hover:bg-gray-200'}`}>
                            <Icon className={`w-5 h-5 ${isActive ? roleInfo?.activeIcon : ''}`} />
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">{item.label}</span>
                            <span className="text-xs text-gray-400 truncate">{item.description}</span>
                          </div>
                          {isActive && (
                            <motion.span 
                              initial={{ scale: 0 }} 
                              animate={{ scale: 1 }}
                              className={`w-2 h-2 rounded-full bg-gradient-to-br ${roleInfo?.indicator}`}
                            />
                          )}
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {window.innerWidth < 1024 && (
          <button 
            onClick={() => setMobileMenuOpen(false)} 
            className="p-4 border-t border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 lg:hidden" 
            aria-label="关闭菜单"
          >
            <X className="w-5 h-5 mx-auto" />
          </button>
        )}
      </motion.aside>

      {!sidebarOpen && window.innerWidth >= 1024 && (
        <motion.button 
          initial={{ opacity: 0, x: -10 }} 
          animate={{ opacity: 1, x: 0 }} 
          onClick={() => setSidebarOpen(true)} 
          className="fixed left-0 top-1/2 -translate-y-1/2 z-40 p-3 bg-white border border-gray-200 border-l-0 rounded-r-xl shadow-md hover:shadow-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all" 
          aria-label="展开侧边栏"
        >
          <ChevronRight className="w-5 h-5" />
        </motion.button>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-30 transition-all duration-300 ${isScrolled ? 'shadow-sm' : ''}`}
        >
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)} 
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors lg:hidden" 
              aria-label="切换菜单"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-gray-800">{currentPage?.label || '首页'}</h2>
              <p className="text-xs text-gray-500 hidden sm:block">{currentPage?.description || '欢迎使用金生链·花生全产业链溯源平台'}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-400 hidden sm:block">
              {formatDateCn(new Date())}
            </span>
            <motion.button 
              whileHover={{ scale: 1.05 }} 
              whileTap={{ scale: 0.95 }} 
              onClick={() => setShowNotifications(!showNotifications)} 
              className="relative p-3 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all" 
              aria-label="通知"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-2 right-2 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </motion.span>
              )}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowSettings(true)}
              className="relative p-3 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all lg:hidden"
              aria-label="设置"
              title="设置"
            >
              <Settings className="w-5 h-5" />
            </motion.button>
          </div>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="absolute right-4 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden flex flex-col w-[380px]"
                style={{ maxHeight: '500px' }}
              >
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-gradient-to-r from-gray-50 to-white">
                  <div>
                    <h3 className="font-semibold text-gray-800 text-base">通知中心</h3>
                    <p className="text-xs text-gray-500 mt-0.5">您有 {unreadCount} 条未读通知</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleMarkAllRead}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded hover:bg-primary-50 transition-colors"
                    >
                      全部已读
                    </button>
                    <button 
                      onClick={() => setShowNotifications(false)} 
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" 
                      aria-label="关闭"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {notifications.length > 0 ? (
                    notifications.map((notification, index) => {
                      const Icon = typeIcons[notification.type];
                      const styles = typeStyles[notification.type];
                      return (
                        <motion.div
                          key={notification.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={() => handleMarkAsRead(notification.id)}
                          className={`p-4 hover:bg-gray-50 border-b border-gray-50 cursor-pointer transition-all duration-200 last:border-0 ${notification.read ? 'opacity-70' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 ${styles.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-5 h-5 ${styles.text}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-gray-800">{notification.title}</p>
                                {!notification.read && (
                                  <span className="w-2 h-2 bg-primary-500 rounded-full" />
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded-full ${styles.badge} flex-shrink-0`}>
                                  {notification.type === 'warning' ? '预警' : notification.type === 'success' ? '成功' : '信息'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{notification.message}</p>
                              <p className="text-xs text-gray-400 mt-2">{notification.time}</p>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                        <Bell className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500 font-medium">暂无通知</p>
                      <p className="text-xs text-gray-400 mt-1">您将在此收到系统消息和提醒</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex-1 overflow-auto p-4 sm:p-6"
        >
          <Outlet />
        </motion.div>
      </main>

      {/* 设置模态框 */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                      <Settings className="w-5 h-5 text-primary-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800">系统设置</h2>
                  </div>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {activeSettingTab === null ? (
                  <div className={`grid gap-4 ${isSystemAdmin ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2'}`}>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setActiveSettingTab('profile')}
                      className="flex flex-col items-center gap-4 p-6 bg-blue-50 hover:bg-blue-100 rounded-2xl border-2 border-transparent hover:border-blue-200 transition-all"
                    >
                      <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                        <UserCircle className="w-7 h-7 text-white" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-lg font-bold text-gray-800">个人信息</h3>
                        <p className="text-sm text-gray-500 mt-1">修改姓名、邮箱、手机号</p>
                      </div>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setActiveSettingTab('password')}
                      className="flex flex-col items-center gap-4 p-6 bg-green-50 hover:bg-green-100 rounded-2xl border-2 border-transparent hover:border-green-200 transition-all"
                    >
                      <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-green-200">
                        <Key className="w-7 h-7 text-white" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-lg font-bold text-gray-800">修改密码</h3>
                        <p className="text-sm text-gray-500 mt-1">安全修改登录密码</p>
                      </div>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setActiveSettingTab('theme')}
                      className="flex flex-col items-center gap-4 p-6 bg-purple-50 hover:bg-purple-100 rounded-2xl border-2 border-transparent hover:border-purple-200 transition-all"
                    >
                      <div className="w-14 h-14 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
                        <Palette className="w-7 h-7 text-white" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-lg font-bold text-gray-800">主题设置</h3>
                        <p className="text-sm text-gray-500 mt-1">切换深色/浅色模式</p>
                      </div>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setActiveSettingTab('notification')}
                      className="flex flex-col items-center gap-4 p-6 bg-orange-50 hover:bg-orange-100 rounded-2xl border-2 border-transparent hover:border-orange-200 transition-all"
                    >
                      <div className="w-14 h-14 bg-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200">
                        <Bell className="w-7 h-7 text-white" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-lg font-bold text-gray-800">通知设置</h3>
                        <p className="text-sm text-gray-500 mt-1">管理各类通知提醒</p>
                      </div>
                    </motion.button>

                    {isSystemAdmin && (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { setActiveSettingTab('orgs'); setActiveOrgsTab('organizations'); }}
                        className={`flex flex-col items-center gap-4 p-6 bg-gradient-to-br from-violet-50 to-indigo-50 hover:from-violet-100 hover:to-indigo-100 rounded-2xl border-2 border-transparent hover:border-indigo-200 transition-all ${isSystemAdmin ? 'md:col-span-2 col-span-2' : ''}`}
                      >
                        <div className="w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                          <Building2 className="w-7 h-7 text-white" />
                        </div>
                        <div className="text-center">
                          <h3 className="text-lg font-bold text-gray-800">机构 &amp; 用户管理</h3>
                          <p className="text-sm text-gray-500 mt-1">管理合作机构、系统用户及角色分配（仅管理员）</p>
                        </div>
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <AnimatePresence>
                    <motion.div
                      key={activeSettingTab}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                    >
                      <button
                        onClick={() => setActiveSettingTab(null)}
                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        返回设置首页
                      </button>

                      {activeSettingTab === 'profile' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                            <input
                              type="text"
                              value={formData.username}
                              onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                            <input
                              type="email"
                              value={formData.email}
                              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
                            <input
                              type="tel"
                              value={formData.phone}
                              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                            <input
                              type="text"
                              value={roleInfo?.label || ''}
                              disabled
                              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-500 cursor-not-allowed"
                            />
                          </div>
                          {userInfo?.wallet_address && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">钱包地址</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={`${userInfo.wallet_address.slice(0, 6)}...${userInfo.wallet_address.slice(-4)}`}
                                  disabled
                                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-500 cursor-not-allowed text-sm"
                                />
                                <button
                                  onClick={() => navigator.clipboard.writeText(userInfo?.wallet_address || '')}
                                  className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium text-gray-600 transition-colors"
                                >
                                  复制
                                </button>
                              </div>
                            </div>
                          )}
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleSaveSettings}
                            className="w-full px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                          >
                            <Save className="w-4 h-4" />
                            保存个人信息
                          </motion.button>
                        </div>
                      )}

                      {activeSettingTab === 'password' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">当前密码</label>
                            <input
                              type="password"
                              value={passwordData.old_password}
                              onChange={(e) => setPasswordData(prev => ({ ...prev, old_password: e.target.value }))}
                              placeholder="请输入当前密码"
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                            <input
                              type="password"
                              value={passwordData.new_password}
                              onChange={(e) => setPasswordData(prev => ({ ...prev, new_password: e.target.value }))}
                              placeholder="请输入新密码（至少6位）"
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
                            <input
                              type="password"
                              value={passwordData.confirm_password}
                              onChange={(e) => setPasswordData(prev => ({ ...prev, confirm_password: e.target.value }))}
                              placeholder="请再次输入新密码"
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleChangePassword}
                            className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                          >
                            <Key className="w-4 h-4" />
                            修改密码
                          </motion.button>
                          <div className="p-4 bg-primary-50 rounded-xl flex items-start gap-3">
                            <Shield className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                            <div className="text-sm">
                              <p className="font-medium text-primary-800">安全提示</p>
                              <p className="text-primary-600 mt-1">定期修改密码可以提高账户安全性</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeSettingTab === 'theme' && (
                        <div className="space-y-4">
                          <p className="text-sm text-gray-500">选择您喜欢的界面主题</p>
                          <div className="grid grid-cols-3 gap-4">
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => toggleTheme('dark')}
                              className={`flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all ${currentTheme === 'dark' ? 'bg-gray-900 border-primary-500 shadow-lg' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}
                            >
                              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
                                <Moon className="w-6 h-6 text-white" />
                              </div>
                              <span className={`text-sm font-medium ${currentTheme === 'dark' ? 'text-white' : 'text-gray-700'}`}>深色模式</span>
                              {currentTheme === 'dark' && (
                                <div className="w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                </div>
                              )}
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => toggleTheme('light')}
                              className={`flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all ${currentTheme === 'light' ? 'bg-white border-primary-500 shadow-lg' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}
                            >
                              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                                <Sun className="w-6 h-6 text-gray-600" />
                              </div>
                              <span className={`text-sm font-medium ${currentTheme === 'light' ? 'text-gray-900' : 'text-gray-700'}`}>浅色模式</span>
                              {currentTheme === 'light' && (
                                <div className="w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                </div>
                              )}
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => toggleTheme('system')}
                              className={`flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all ${currentTheme === 'system' ? 'bg-blue-50 border-primary-500 shadow-lg' : 'bg-blue-50 border-gray-200 hover:border-blue-300'}`}
                            >
                              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                                <Globe className="w-6 h-6 text-white" />
                              </div>
                              <span className={`text-sm font-medium ${currentTheme === 'system' ? 'text-gray-900' : 'text-gray-700'}`}>跟随系统</span>
                              {currentTheme === 'system' && (
                                <div className="w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                </div>
                              )}
                            </motion.button>
                          </div>
                        </div>
                      )}

                      {activeSettingTab === 'notification' && (
                        <div className="space-y-3">
                          {[
                            { key: 'inventory_alert', label: '库存预警', desc: '接收库存低于预警值的通知' },
                            { key: 'order_notification', label: '订单通知', desc: '接收订单状态变更通知' },
                            { key: 'system_message', label: '系统消息', desc: '接收系统重要公告和通知' },
                            { key: 'inspection_report', label: '检测报告', desc: '接收检测报告完成通知' },
                          ].map((item) => (
                            <div key={item.key} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${notificationSettings[item.key] ? 'bg-green-100' : 'bg-gray-200'}`}>
                                  <Bell className={`w-5 h-5 ${notificationSettings[item.key] ? 'text-green-600' : 'text-gray-400'}`} />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-gray-700">{item.label}</p>
                                  <p className="text-xs text-gray-400">{item.desc}</p>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  const newValue = !notificationSettings[item.key];
                                  const newSettings = { ...notificationSettings, [item.key]: newValue };
                                  setNotificationSettings(newSettings);
                                  localStorage.setItem('notificationSettings', JSON.stringify(newSettings));
                                  // 持久化到后端
                                  authApi.updatePreferences({ notificationSettings: newSettings }).catch(() => {});
                                }}
                                className={`relative w-12 h-6 rounded-full transition-all duration-300 ${notificationSettings[item.key] ? 'bg-green-500' : 'bg-gray-300'}`}
                              >
                                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300 ${notificationSettings[item.key] ? 'right-1' : 'left-1'}`} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeSettingTab === 'orgs' && isSystemAdmin && (
                        <div className="space-y-4">
                          {/* Linear 下划线式 Tab */}
                          <div className="flex items-center gap-6 border-b border-gray-100">
                            {[
                              { k: 'organizations' as const, label: '机构列表', Icon: Building2, count: orgs.length },
                              { k: 'users' as const, label: '用户列表', Icon: Users, count: users.length },
                            ].map(({ k, label, Icon, count }) => {
                              const active = activeOrgsTab === k;
                              return (
                                <button
                                  key={k}
                                  onClick={() => setActiveOrgsTab(k)}
                                  className={`relative -mb-px flex items-center gap-1.5 px-1 pb-3 text-sm font-medium transition-colors ${active ? 'text-primary-700 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                  <Icon className="w-4 h-4" />
                                  {label}
                                  {count > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${active ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                                  )}
                                  {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-primary-500 to-secondary-500" />}
                                </button>
                              );
                            })}
                          </div>

                          {/* 操作条：4 按钮（新增/导入/导出/刷新）+ 搜索 */}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                              <div className="relative flex-1 min-w-[220px] max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                  type="text"
                                  placeholder={activeOrgsTab === 'organizations' ? '搜索机构编码 / 名称 / 联系人' : '搜索用户名 / 姓名 / 邮箱 / 手机号'}
                                  value={activeOrgsTab === 'organizations' ? orgsSearch : usersSearch}
                                  onChange={(e) => { activeOrgsTab === 'organizations' ? setOrgsSearch(e.target.value) : setUsersSearch(e.target.value); }}
                                  className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                                />
                              </div>
                              {activeOrgsTab === 'organizations' ? (
                                <select value={orgsTypeFilter} onChange={(e) => setOrgsTypeFilter(e.target.value)} className="text-xs px-3 py-2.5 border border-gray-200 rounded-xl text-gray-700 bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent">
                                  <option value="all">全部机构类型</option>
                                  <option value="监管机构">监管机构</option>
                                  <option value="合作社">合作社</option>
                                  <option value="检测机构">检测机构</option>
                                  <option value="加工企业">加工企业</option>
                                  <option value="种植基地">种植基地</option>
                                </select>
                              ) : (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <Filter className="w-3.5 h-3.5 text-gray-400" />
                                  {[
                                    { k: 'all', label: '全部' },
                                    ...Object.entries(roleLabels).map(([k, v]: any) => ({ k, label: v.label })),
                                  ].map(r => (
                                    <button key={r.k} onClick={() => setUsersRoleFilter(r.k)} className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${usersRoleFilter === r.k ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>{r.label}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button onClick={handleImportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all">
                                <Upload className="w-4 h-4" /> 导入
                              </button>
                              <input ref={csvFileInputRef} type="file" accept=".csv" className="hidden" onChange={onCsvFileChange} />

                              <button onClick={handleExportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all">
                                <Download className="w-4 h-4" /> 导出
                              </button>
                              <button onClick={() => { loadOrgs(); loadUsers(); setSaveMessage('数据已刷新'); setTimeout(() => setSaveMessage(''), 2500); }} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all">
                                <RotateCw className="w-4 h-4" /> 刷新
                              </button>
                              <button
                                onClick={activeOrgsTab === 'organizations' ? openNewOrg : openNewUser}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl shadow-sm shadow-primary-200 hover:from-primary-700 hover:to-secondary-700 transition-all"
                              >
                                <Plus className="w-4 h-4" /> 新建{activeOrgsTab === 'organizations' ? '机构' : '用户'}
                              </button>
                            </div>
                          </div>

                          {/* 表格：8 列 live 数据 */}
                          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                            <div className="overflow-x-auto">
                              {activeOrgsTab === 'organizations' ? (
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50 text-gray-500 text-left">
                                      <th className="px-4 py-3 font-medium">机构编码</th>
                                      <th className="px-4 py-3 font-medium">机构名称</th>
                                      <th className="px-4 py-3 font-medium">类型</th>
                                      <th className="px-4 py-3 font-medium">联系人</th>
                                      <th className="px-4 py-3 font-medium">电话</th>
                                      <th className="px-4 py-3 font-medium">地址</th>
                                      <th className="px-4 py-3 font-medium">状态</th>
                                      <th className="px-4 py-3 font-medium text-right pr-4">操作</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {(() => {
                                      const filtered = orgs.filter(o => {
                                        if (orgsTypeFilter !== 'all' && o.type !== orgsTypeFilter) return false;
                                        if (orgsSearch) { const t = orgsSearch.toLowerCase(); return `${o.org_code} ${o.name} ${o.contact_name || ''}`.toLowerCase().includes(t); }
                                        return true;
                                      });
                                      if (orgsLoading && !orgs.length) {
                                        return <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-gray-400">加载中…</td></tr>;
                                      }
                                      if (!filtered.length) {
                                        return <tr><td colSpan={8} className="px-4">
                                          <div className="py-14 flex flex-col items-center gap-3">
                                            <div className="w-20 h-20 rounded-full bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300"><Building2 className="w-10 h-10" /></div>
                                            <p className="text-sm font-semibold text-gray-600">暂无机构数据</p>
                                            <p className="text-xs text-gray-400">点击右上角「新建机构」创建第一条合作机构记录</p>
                                          </div>
                                        </td></tr>;
                                      }
                                      return filtered.map(o => (
                                        <tr key={o.id} className="hover:bg-gray-50/70 transition-colors" style={{ height: 44 }}>
                                          <td className="px-4 py-2 font-mono text-xs text-primary-700 font-semibold tracking-wide">{o.org_code}</td>
                                          <td className="px-4 py-2 text-gray-800 font-medium">{o.name}</td>
                                          <td className="px-4 py-2"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-[11px] font-medium"><Badge className="w-3 h-3" /> {o.type || '-'}</span></td>
                                          <td className="px-4 py-2 text-gray-600">{o.contact_name || '-'}</td>
                                          <td className="px-4 py-2 text-gray-600 tabular-nums">{o.phone || '-'}</td>
                                          <td className="px-4 py-2 text-gray-600 max-w-[260px] truncate" title={o.address}>{o.address || '-'}</td>
                                          <td className="px-4 py-2">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${o.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                              <span className={`w-1.5 h-1.5 rounded-full ${o.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                                              {o.is_active ? '启用' : '停用'}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2 text-right">
                                            <div className="inline-flex items-center gap-1">
                                              <button onClick={() => setDetailOrg(o)} title="机构详情" className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Eye className="w-4 h-4" /></button>
                                              <button onClick={() => openEditOrg(o)} title="编辑" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Edit3 className="w-4 h-4" /></button>
                                              <button onClick={() => deleteOrg(o)} title="删除" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                          </td>
                                        </tr>
                                      ));
                                    })()}
                                  </tbody>
                                </table>
                              ) : (
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50 text-gray-500 text-left">
                                      <th className="px-4 py-3 font-medium">用户名</th>
                                      <th className="px-4 py-3 font-medium">姓名</th>
                                      <th className="px-4 py-3 font-medium">角色</th>
                                      <th className="px-4 py-3 font-medium">所属机构</th>
                                      <th className="px-4 py-3 font-medium">邮箱</th>
                                      <th className="px-4 py-3 font-medium">手机号</th>
                                      <th className="px-4 py-3 font-medium">状态</th>
                                      <th className="px-4 py-3 font-medium text-right pr-4">操作</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {(() => {
                                      const filtered = users.filter(u => {
                                        if (usersRoleFilter !== 'all' && !u.roles.includes(usersRoleFilter)) return false;
                                        if (usersSearch) { const t = usersSearch.toLowerCase(); return `${u.username} ${u.full_name || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase().includes(t); }
                                        return true;
                                      });
                                      if (usersLoading && !users.length) return <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-gray-400">加载中…</td></tr>;
                                      if (!filtered.length) return <tr><td colSpan={8} className="px-4">
                                        <div className="py-14 flex flex-col items-center gap-3">
                                          <div className="w-20 h-20 rounded-full bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300"><Users className="w-10 h-10" /></div>
                                          <p className="text-sm font-semibold text-gray-600">暂无用户数据</p>
                                          <p className="text-xs text-gray-400">点击右上角「新建用户」创建系统登录账号并分配角色</p>
                                        </div>
                                      </td></tr>;
                                      return filtered.map(u => {
                                        const r = u.roles[0] || '';
                                        const rLabel = roleLabels[r];
                                        return (
                                          <tr key={u.id} className="hover:bg-gray-50/70 transition-colors" style={{ height: 44 }}>
                                            <td className="px-4 py-2 font-semibold text-gray-800 font-mono text-xs">{u.username}</td>
                                            <td className="px-4 py-2 text-gray-700">{u.full_name || '-'}</td>
                                            <td className="px-4 py-2">{rLabel
                                              ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${rLabel.bg} ${rLabel.color}`}>{rLabel.label}</span>
                                              : <span className="text-xs text-gray-500">{r || '-'}</span>}</td>
                                            <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate" title={u.organization_name}>{u.organization_name || '-'}</td>
                                            <td className="px-4 py-2 text-gray-600 text-xs">{u.email || '-'}</td>
                                            <td className="px-4 py-2 text-gray-600 text-xs tabular-nums">{u.phone || '-'}</td>
                                            <td className="px-4 py-2">
                                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                                                {u.is_active ? '启用' : '停用'}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                              <div className="inline-flex items-center gap-1">
                                                <button onClick={() => openEditUser(u)} title="编辑用户 / 重置密码" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Edit3 className="w-4 h-4" /></button>
                                                <button onClick={() => deleteUserAccount(u)} title="禁用用户" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      });
                                    })()}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>

                          {/* 模态层（机构详情/机构表单/用户表单） */}
                          {detailOrg && (
                            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
                              <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                                  <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center"><Building2 className="w-4.5 h-4.5" /></div><div><h3 className="text-sm font-semibold text-gray-800">机构详情</h3><p className="text-[11px] text-gray-500 font-mono">{detailOrg.org_code}</p></div></div>
                                  <button onClick={() => setDetailOrg(null)} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
                                </div>
                                <div className="p-5 space-y-3">
                                  {[
                                    ['机构名称', detailOrg.name], ['机构类型', detailOrg.type], ['联系人', detailOrg.contact_name],
                                    ['联系电话', detailOrg.phone], ['机构地址', detailOrg.address],
                                    ['创建时间', detailOrg.created_at ? formatDateTimeCn(detailOrg.created_at) : '-'],
                                  ].map(([k, v]) => (
                                    <div key={k} className="flex items-start gap-3">
                                      <div className="w-20 shrink-0 text-[11px] font-medium text-gray-500 pt-0.5">{k}</div>
                                      <div className="flex-1 text-sm text-gray-800">{v || '-'}</div>
                                    </div>
                                  ))}
                                  <div className="flex justify-end gap-2 pt-3 border-t border-gray-50">
                                    <button onClick={() => setDetailOrg(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">关闭</button>
                                    <button onClick={() => { setDetailOrg(null); openEditOrg(detailOrg); }} className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl">编辑</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {showOrgModal && (
                            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
                              <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
                                  <h3 className="text-sm font-semibold text-gray-800">{editingOrg ? '编辑机构' : '新建机构'}</h3>
                                  <button onClick={() => setShowOrgModal(false)} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
                                </div>
                                <div className="p-5 space-y-4">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">机构编码 *</label>
                                      <input value={orgForm.org_code || ''} onChange={(e) => setOrgForm({ ...orgForm, org_code: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="如 ORG-000001" required />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">机构类型</label>
                                      <select value={orgForm.type || '合作社'} onChange={(e) => setOrgForm({ ...orgForm, type: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                                        <option>监管机构</option><option>合作社</option><option>检测机构</option><option>加工企业</option><option>种植基地</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">机构名称 *</label>
                                    <input value={orgForm.name || ''} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="请输入机构全称" required />
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">联系人</label>
                                      <input value={orgForm.contact_name || ''} onChange={(e) => setOrgForm({ ...orgForm, contact_name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">联系电话</label>
                                      <input value={orgForm.phone || ''} onChange={(e) => setOrgForm({ ...orgForm, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">机构地址</label>
                                    <textarea value={orgForm.address || ''} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none" />
                                  </div>
                                  <label className="flex items-center gap-2 text-sm text-gray-600">
                                    <input type="checkbox" checked={!!orgForm.is_active} onChange={(e) => setOrgForm({ ...orgForm, is_active: e.target.checked })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                    <span>启用该机构</span>
                                  </label>
                                  <div className="flex justify-end gap-2 pt-2 border-t border-gray-50">
                                    <button onClick={() => setShowOrgModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">取消</button>
                                    <button onClick={submitOrg} className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl">{editingOrg ? '保存修改' : '创建机构'}</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {showUserModal && (
                            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
                              <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
                                  <h3 className="text-sm font-semibold text-gray-800">{editingUser ? '编辑用户 / 重置密码' : '新建用户'}</h3>
                                  <button onClick={() => setShowUserModal(false)} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
                                </div>
                                <div className="p-5 space-y-3.5">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">用户名 *</label>
                                      <input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="登录名" required />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">角色</label>
                                      <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                                        {Object.entries(roleLabels).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">姓名</label>
                                      <input value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">所属机构</label>
                                      <select value={userForm.organization_id || ''} onChange={(e) => setUserForm({ ...userForm, organization_id: e.target.value ? parseInt(e.target.value) : null })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                                        <option value="">— 不绑定机构 —</option>
                                        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">邮箱</label>
                                      <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="name@example.com" />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">手机号</label>
                                      <input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="11 位手机号" />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      密码 {editingUser && <span className="text-gray-400 font-normal">（留空则不修改）</span>}
                                    </label>
                                    <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder={editingUser ? '如需重置请输入新密码' : '请设置初始登录密码'} />
                                  </div>
                                  <label className="flex items-center gap-2 text-sm text-gray-600">
                                    <input type="checkbox" checked={!!userForm.is_active} onChange={(e) => setUserForm({ ...userForm, is_active: e.target.checked })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                    <span>启用该用户</span>
                                  </label>
                                  <div className="flex justify-end gap-2 pt-2 border-t border-gray-50">
                                    <button onClick={() => setShowUserModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">取消</button>
                                    <button onClick={submitUser} className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl">{editingUser ? '保存修改' : '创建用户'}</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>

              <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-center gap-3 flex-shrink-0">
                {saveMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${saveMessage.includes('成功') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                  >
                    {saveMessage}
                  </motion.div>
                )}
                {activeSettingTab !== null && (
                  <button
                    onClick={() => setActiveSettingTab(null)}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                  >
                    返回
                  </button>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  关闭
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}