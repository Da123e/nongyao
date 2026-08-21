import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { authApi, notificationApi } from '../services/api';
import { resolveUserRole } from '../utils/auth';

interface LayoutProps {
  onLogout: () => void;
}

const menuItems = [
  { path: '/', icon: LayoutDashboard, label: '首页', description: '数据概览', roles: ['admin', 'farmer', 'inspector'] },
  { path: '/seed', icon: Wheat, label: '种子溯源', description: '供应商与批次', roles: ['admin', 'farmer'] },
  { path: '/planting', icon: Leaf, label: '种植管理', description: '地块与记录', roles: ['admin', 'farmer'] },
  { path: '/pesticide', icon: FlaskConical, label: '农药管理', description: '采购与使用', roles: ['admin', 'farmer'] },
  { path: '/inspection', icon: FileText, label: '检测报告', description: '质检与残留', roles: ['admin', 'inspector'] },
  { path: '/processing', icon: Factory, label: '加工管理', description: '生产记录', roles: ['admin'] },
  { path: '/inventory', icon: Package, label: '库存管理', description: '仓库与库存', roles: ['admin', 'warehouse_manager'] },
  { path: '/sales', icon: ShoppingCart, label: '销售管理', description: '订单与物流', roles: ['admin', 'salesperson'] },
  { path: '/trace', icon: Search, label: '溯源查询', description: '全链查询', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
  { path: '/sensor', icon: Activity, label: '传感器', description: '数据查看', roles: ['admin', 'farmer', 'inspector'] },
];

const roleLabels: Record<string, { label: string; color: string; bg: string; gradient: string }> = {
  admin: { label: '管理员', color: 'text-purple-600', bg: 'bg-purple-100', gradient: 'from-purple-500 to-violet-600' },
  farmer: { label: '种植户', color: 'text-green-600', bg: 'bg-green-100', gradient: 'from-green-500 to-emerald-600' },
  inspector: { label: '质检员', color: 'text-blue-600', bg: 'bg-blue-100', gradient: 'from-blue-500 to-indigo-600' },
  warehouse_manager: { label: '仓库管理员', color: 'text-cyan-600', bg: 'bg-cyan-100', gradient: 'from-cyan-500 to-sky-600' },
  salesperson: { label: '销售人员', color: 'text-pink-600', bg: 'bg-pink-100', gradient: 'from-pink-500 to-rose-600' },
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
    setSaveMessage('主题已切换');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const filteredMenuItems = menuItems.filter(item => {
    if (!userInfo?.role) return false;
    return item.roles.includes(userInfo.role);
  });

  const currentPage = filteredMenuItems.find((item) => location.pathname === item.path);
  const roleInfo = userInfo?.role ? roleLabels[userInfo.role] : null;

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
          {userInfo && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl p-5 text-white shadow-xl shadow-primary-200/50"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${roleInfo?.gradient || 'from-white/20 to-white/10'} flex items-center justify-center border-2 border-white/30`}>
                  <User className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary-100">{roleInfo?.label}</p>
                  <p className="text-lg font-bold truncate">{userInfo.username}</p>
                </div>
              </div>
              {userInfo.wallet_address && (
                <div className="mt-4 flex items-center gap-2 text-xs text-primary-200 bg-white/10 rounded-lg px-3 py-2">
                  <Shield className="w-3 h-3" />
                  <span className="truncate" title={userInfo.wallet_address}>
                    {userInfo.wallet_address.slice(0, 6)}...{userInfo.wallet_address.slice(-4)}
                  </span>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2">
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

        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {filteredMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <motion.div 
                key={item.path} 
                initial={{ opacity: 0, x: -20 }} 
                animate={{ opacity: 1, x: 0 }} 
                transition={{ delay: item.path === '/' ? 0.1 : 0.15 + filteredMenuItems.indexOf(item) * 0.05 }}
              >
                <Link
                  to={item.path}
                  onClick={() => { if (window.innerWidth < 1024) setMobileMenuOpen(false); }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative ${isActive ? 'bg-primary-50 text-primary-700 font-medium shadow-sm shadow-primary-100' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'}`}
                  aria-label={item.label}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 ${isActive ? 'bg-primary-100' : 'group-hover:bg-gray-200'}`}>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-primary-600' : ''}`} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs text-gray-400">{item.description}</span>
                  </div>
                  {isActive && (
                    <motion.div 
                      initial={{ scaleX: 0 }} 
                      animate={{ scaleX: 1 }} 
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-primary-400 to-primary-600 rounded-r-full" 
                    />
                  )}
                </Link>
              </motion.div>
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
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
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
                  <div className="grid grid-cols-2 gap-4">
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
                                }}
                                className={`relative w-12 h-6 rounded-full transition-all duration-300 ${notificationSettings[item.key] ? 'bg-green-500' : 'bg-gray-300'}`}
                              >
                                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300 ${notificationSettings[item.key] ? 'right-1' : 'left-1'}`} />
                              </button>
                            </div>
                          ))}
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