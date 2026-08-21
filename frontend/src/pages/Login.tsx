import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wheat, Lock, User, Eye, EyeOff, Users } from 'lucide-react';
import { authApi } from '../services/api';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

interface LoginProps {
  onLogin: () => void;
}

type RoleType = 'admin' | 'farmer' | 'inspector' | 'warehouse_manager' | 'salesperson';

const roleOptions: { value: RoleType; label: string; description: string; icon: string }[] = [
  { value: 'admin', label: '系统管理员', description: '管理系统所有功能', icon: '👨‍💼' },
  { value: 'farmer', label: '种植户', description: '管理种植和农药', icon: '👨‍🌾' },
  { value: 'inspector', label: '质检员', description: '管理质量检测', icon: '🔬' },
  { value: 'warehouse_manager', label: '仓库管理员', description: '管理库存', icon: '🏭' },
  { value: 'salesperson', label: '销售人员', description: '管理销售', icon: '💼' },
];

// 快速体验填充：仅用于本地演示/功能测试，正式部署版本应移除该功能
const roleDefaultUsers: Record<RoleType, { username: string; password: string }> = {
  admin: { username: 'admin', password: '•（部署时另行设置）' },
  farmer: { username: 'farmer', password: '•（部署时另行设置）' },
  inspector: { username: 'inspector', password: '•（部署时另行设置）' },
  warehouse_manager: { username: 'warehouse', password: '•（部署时另行设置）' },
  salesperson: { username: 'sales', password: '•（部署时另行设置）' },
};

export function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<RoleType>('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleRoleChange = (role: RoleType) => {
    setSelectedRole(role);
    const defaultUser = roleDefaultUsers[role];
    setUsername(defaultUser.username);
    setPassword(defaultUser.password);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await authApi.login(username, password);

      if (response.data.access_token) {
        localStorage.setItem('token', response.data.access_token);
        if (response.data.user_info) {
          localStorage.setItem('user_info', JSON.stringify(response.data.user_info));
        }
        onLogin();
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-primary-100/50 to-secondary-100 flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-20 left-10 w-72 h-72 bg-primary-300/30 rounded-full blur-3xl"
          animate={{
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute bottom-20 right-10 w-96 h-96 bg-secondary-300/30 rounded-full blur-3xl"
          animate={{
            x: [0, -40, 0],
            y: [0, -40, 0],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 w-64 h-64 bg-accent-200/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_rgba(0,0,0,0.05)_1px,transparent_0)] bg-[size:24px_24px]" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="bg-white/80 backdrop-blur-xl border border-white/50 rounded-3xl shadow-2xl shadow-primary-900/5 overflow-hidden">
          <div className="bg-gradient-to-r from-primary-500 to-primary-600 px-8 py-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1)_0%,transparent_50%)]" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="relative"
            >
              <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/30">
                <Wheat className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">金生链</h1>
              <p className="text-primary-100">基于区块链物联网的花生全产业链溯源平台</p>
            </motion.div>
          </div>

          <div className="px-8 py-8">
            <motion.form
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-danger-50 border border-danger-200 text-danger-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  {error}
                </motion.div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  选择角色
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {roleOptions.map((role) => (
                    <motion.button
                      key={role.value}
                      type="button"
                      onClick={() => handleRoleChange(role.value)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 ${
                        selectedRole === role.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-md shadow-primary-100'
                          : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      <span className="text-xl mb-1">{role.icon}</span>
                      <span className="text-xs font-medium">{role.label}</span>
                    </motion.button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 text-center">
                  {roleOptions.find(r => r.value === selectedRole)?.description}
                </p>
              </div>

              <Input
                label="用户名"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                icon={<User className="w-5 h-5" />}
                disabled={loading}
              />

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">密码</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className="w-full px-10 py-3 border border-gray-200 rounded-xl bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 disabled:opacity-50"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  className="w-full rounded-xl"
                >
                  {loading ? '登录中...' : '登录'}
                </Button>
              </motion.div>

              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">测试账号</h4>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  {roleOptions.map((role) => (
                    <div key={role.value} className="flex justify-between items-center text-gray-600">
                      <span>{role.icon} {role.label}</span>
                      <span className="text-gray-500">
                        {roleDefaultUsers[role.value].username} / {roleDefaultUsers[role.value].password}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.form>
          </div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-center text-gray-400 text-xs mt-6"
        >
          © 2026 金生链 · 花生全产业链溯源平台 · 数据安全保障
        </motion.p>
      </motion.div>
    </div>
  );
}
