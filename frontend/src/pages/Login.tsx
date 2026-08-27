import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Wheat, Lock, User, Eye, EyeOff, Shield, Search, Sparkles } from 'lucide-react';
import { authApi } from '../services/api';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
          animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-20 right-10 w-96 h-96 bg-secondary-300/30 rounded-full blur-3xl"
          animate={{ x: [0, -40, 0], y: [0, -40, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 w-64 h-64 bg-accent-200/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
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

              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full rounded-xl">
                  {loading ? '登录中...' : '登录'}
                </Button>
              </motion.div>
            </motion.form>

            <div className="mt-5">
              <p className="text-xs text-gray-500 mb-2 font-medium tracking-wide">📋 演示账号（点击即可自动填入）：</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {[
                  { role: '管理员', roleKey: 'admin', user: 'admin', pwd: 'admin123', accent: 'from-purple-50 to-violet-50 border-purple-200 text-purple-700' },
                  { role: '种植户', roleKey: 'farmer', user: 'farmer', pwd: 'farmer123', accent: 'from-green-50 to-emerald-50 border-green-200 text-green-700' },
                  { role: '质检员', roleKey: 'inspector', user: 'inspector', pwd: 'inspector123', accent: 'from-blue-50 to-indigo-50 border-blue-200 text-blue-700' },
                  { role: '仓储常务管理员', roleKey: 'warehouse_manager', user: 'warehouse', pwd: 'warehouse123', accent: 'from-cyan-50 to-sky-50 border-cyan-200 text-cyan-700' },
                  { role: '售货员', roleKey: 'salesperson', user: 'sales', pwd: 'sales123', accent: 'from-pink-50 to-rose-50 border-pink-200 text-pink-700' },
                ].map((d) => (
                  <button
                    key={d.roleKey}
                    type="button"
                    onClick={() => {
                      setUsername(d.user);
                      setPassword(d.pwd);
                    }}
                    className={`group text-left px-3 py-2.5 rounded-xl border bg-gradient-to-br ${d.accent} hover:shadow-sm hover:-translate-y-0.5 transition-all duration-200`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{d.role}</span>
                      <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </div>
                    <div className="mt-0.5 text-[11px] opacity-80 font-mono">{d.user} / {d.pwd}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-100">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="flex flex-col items-center gap-1.5 p-3 bg-green-50 rounded-xl">
                  <Shield className="w-5 h-5 text-green-600" />
                  <span className="text-xs text-gray-600">区块链存证</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 p-3 bg-blue-50 rounded-xl">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  <span className="text-xs text-gray-600">IoT 实时监测</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 p-3 bg-purple-50 rounded-xl">
                  <Wheat className="w-5 h-5 text-purple-600" />
                  <span className="text-xs text-gray-600">全产业链</span>
                </div>
              </div>

              <Link
                to="/trace"
                className="mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-50 to-secondary-50 border border-primary-200 rounded-xl text-sm font-medium text-primary-700 hover:from-primary-100 hover:to-secondary-100 transition-all"
              >
                <Search className="w-4 h-4" />
                消费者溯源查询入口
              </Link>
            </div>
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
