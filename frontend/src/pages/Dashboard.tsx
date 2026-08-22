import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Wheat,
  Leaf,
  FlaskConical,
  FileText,
  Factory,
  Package,
  ShoppingCart,
  AlertTriangle,
  CheckCircle,
  Server,
  Database,
  Wifi,
  RefreshCw,
  Activity,
  Zap,
  Shield,
  Sun,
  Moon,
  CloudSun,
  ArrowUpRight,
  Calendar,
  Target,
  FileCheck,
  Truck,
  BarChart3,
  Thermometer,
  Droplets,
  Gauge,
  Wind,
  Sparkles,
  FlaskRound,
  CircleDot,
  Beaker,
  Ruler,
  Flame,
  Link2,
  Boxes,
  Search,
} from 'lucide-react';
import { inventoryApi, authApi, blockchainApi, statisticsApi, operationsApi, measurementApi } from '../services/api';
import { resolveUserRole } from '../utils/auth';
import type { LatestEnvironmentalRecord } from '../types';

interface Stats {
  seedBatches: number;
  plantingPlots: number;
  pesticides: number;
  reports: number;
  processingBatches: number;
  inventoryItems: number;
  orders: number;
  alerts: number;
  totalUsers: number;
  todayOrders: number;
  pendingReviews: number;
  pendingOrders: number;
  qualifiedReports: number;
  overLimitCount: number;
}

const roleStats: Record<string, { label: string; icon: any; color: string; key: keyof Stats; path: string }[]> = {
  admin: [
    { label: '种子批次', icon: Wheat, color: 'green', key: 'seedBatches', path: '/seed' },
    { label: '种植地块', icon: Leaf, color: 'emerald', key: 'plantingPlots', path: '/planting' },
    { label: '农药种类', icon: FlaskConical, color: 'blue', key: 'pesticides', path: '/pesticide' },
    { label: '检测报告', icon: FileText, color: 'purple', key: 'reports', path: '/inspection' },
    { label: '加工批次', icon: Factory, color: 'orange', key: 'processingBatches', path: '/processing' },
    { label: '库存商品', icon: Package, color: 'cyan', key: 'inventoryItems', path: '/inventory' },
    { label: '销售订单', icon: ShoppingCart, color: 'pink', key: 'orders', path: '/sales' },
    { label: '待处理告警', icon: AlertTriangle, color: 'red', key: 'alerts', path: '/inventory' },
  ],
  farmer: [
    { label: '种子批次', icon: Wheat, color: 'green', key: 'seedBatches', path: '/seed' },
    { label: '种植地块', icon: Leaf, color: 'emerald', key: 'plantingPlots', path: '/planting' },
    { label: '农药种类', icon: FlaskConical, color: 'blue', key: 'pesticides', path: '/pesticide' },
  ],
  inspector: [
    { label: '检测报告', icon: FileText, color: 'purple', key: 'reports', path: '/inspection' },
    { label: '合格报告', icon: CheckCircle, color: 'emerald', key: 'qualifiedReports', path: '/inspection' },
    { label: '待审核', icon: AlertTriangle, color: 'orange', key: 'pendingReviews', path: '/inspection' },
  ],
  warehouse_manager: [
    { label: '库存商品', icon: Package, color: 'cyan', key: 'inventoryItems', path: '/inventory' },
    { label: '待处理告警', icon: AlertTriangle, color: 'red', key: 'alerts', path: '/inventory' },
  ],
  salesperson: [
    { label: '销售订单', icon: ShoppingCart, color: 'pink', key: 'orders', path: '/sales' },
  ],
};

const roleShortcuts: Record<string, { label: string; icon: any; path: string; color: string }[]> = {
  admin: [
    { label: '种子管理', icon: Wheat, path: '/seed', color: 'from-green-500 to-emerald-600' },
    { label: '种植记录', icon: Leaf, path: '/planting', color: 'from-emerald-500 to-teal-600' },
    { label: '农药管理', icon: FlaskConical, path: '/pesticide', color: 'from-blue-500 to-indigo-600' },
    { label: '检测报告', icon: FileText, path: '/inspection', color: 'from-purple-500 to-violet-600' },
    { label: '加工管理', icon: Factory, path: '/processing', color: 'from-orange-500 to-amber-600' },
    { label: '库存管理', icon: Package, path: '/inventory', color: 'from-cyan-500 to-sky-600' },
    { label: '销售管理', icon: ShoppingCart, path: '/sales', color: 'from-pink-500 to-rose-600' },
    { label: '传感器', icon: Activity, path: '/sensor', color: 'from-teal-500 to-cyan-600' },
  ],
  farmer: [
    { label: '种子溯源', icon: Wheat, path: '/seed', color: 'from-green-500 to-emerald-600' },
    { label: '种植管理', icon: Leaf, path: '/planting', color: 'from-emerald-500 to-teal-600' },
    { label: '农药管理', icon: FlaskConical, path: '/pesticide', color: 'from-blue-500 to-indigo-600' },
    { label: '传感器', icon: Activity, path: '/sensor', color: 'from-teal-500 to-cyan-600' },
    { label: '溯源查询', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
  inspector: [
    { label: '检测报告', icon: FileText, path: '/inspection', color: 'from-purple-500 to-violet-600' },
    { label: '溯源查询', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
    { label: '传感器', icon: Activity, path: '/sensor', color: 'from-teal-500 to-cyan-600' },
  ],
  warehouse_manager: [
    { label: '库存管理', icon: Package, path: '/inventory', color: 'from-cyan-500 to-sky-600' },
    { label: '溯源查询', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
  salesperson: [
    { label: '销售管理', icon: ShoppingCart, path: '/sales', color: 'from-pink-500 to-rose-600' },
    { label: '溯源查询', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
};

const colorMap: Record<string, { bg: string; text: string; gradient: string; iconBg: string }> = {
  green: { bg: 'bg-gradient-to-br from-green-50 to-emerald-50', text: 'text-green-600', gradient: 'from-green-400 to-green-600', iconBg: 'bg-green-100' },
  emerald: { bg: 'bg-gradient-to-br from-emerald-50 to-teal-50', text: 'text-emerald-600', gradient: 'from-emerald-400 to-emerald-600', iconBg: 'bg-emerald-100' },
  blue: { bg: 'bg-gradient-to-br from-blue-50 to-indigo-50', text: 'text-blue-600', gradient: 'from-blue-400 to-blue-600', iconBg: 'bg-blue-100' },
  purple: { bg: 'bg-gradient-to-br from-purple-50 to-violet-50', text: 'text-purple-600', gradient: 'from-purple-400 to-purple-600', iconBg: 'bg-purple-100' },
  orange: { bg: 'bg-gradient-to-br from-orange-50 to-amber-50', text: 'text-orange-600', gradient: 'from-orange-400 to-orange-600', iconBg: 'bg-orange-100' },
  cyan: { bg: 'bg-gradient-to-br from-cyan-50 to-sky-50', text: 'text-cyan-600', gradient: 'from-cyan-400 to-cyan-600', iconBg: 'bg-cyan-100' },
  pink: { bg: 'bg-gradient-to-br from-pink-50 to-rose-50', text: 'text-pink-600', gradient: 'from-pink-400 to-pink-600', iconBg: 'bg-pink-100' },
  red: { bg: 'bg-gradient-to-br from-red-50 to-rose-50', text: 'text-red-600', gradient: 'from-red-400 to-red-600', iconBg: 'bg-red-100' },
};

function StatCard({ icon, label, value, color, trend, path, onClick }: { icon: React.ReactNode; label: string; value: number; color: string; trend?: { value: number; up: boolean }; path?: string; onClick?: () => void }) {
  const colors = colorMap[color] || colorMap.blue;
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (path) {
      navigate(path);
    }
  };

  const isClickable = !!path || !!onClick;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -4, scale: 1.02 } : {}}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      onClick={handleClick}
      className={`${colors.bg} rounded-2xl p-5 border border-gray-100 shadow-sm transition-all duration-300 ${
        isClickable ? 'cursor-pointer hover:shadow-xl' : ''
      }`}
    >
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center mb-4 shadow-md shadow-gray-200`}>
        <div className="text-white">{icon}</div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-gray-500 text-sm font-medium mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-800">{value}</p>
        </div>
        <div className="flex items-center gap-2">
          {trend && (
            <div className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-full ${trend.up ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {trend.up ? <ArrowUpRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4 rotate-180" />}
              <span>{Math.abs(trend.value)}%</span>
            </div>
          )}
          {isClickable && !trend && (
            <ArrowUpRight className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function QuickAction({ label, icon, path, color }: { label: string; icon: any; path: string; color: string }) {
  const IconComp = icon;
  return (
    <motion.a
      href={path}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05, y: -2 }}
      whileTap={{ scale: 0.95 }}
      className="group flex flex-col items-center justify-center p-5 rounded-2xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-xl transition-all duration-300"
    >
      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center mb-3 shadow-lg shadow-gray-200 group-hover:shadow-xl transition-shadow`}>
        <IconComp className="w-7 h-7 text-white" />
      </div>
      <span className="text-sm font-semibold text-gray-700 group-hover:text-gray-900">{label}</span>
    </motion.a>
  );
}

function StatusCard({ icon, label, status, isOnline }: { icon: React.ReactNode; label: string; status: string; isOnline: boolean }) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl ${isOnline ? 'bg-green-50/80 border border-green-100' : 'bg-red-50/80 border border-red-100'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isOnline ? 'bg-green-100' : 'bg-red-100'}`}>
          <div className={`${isOnline ? 'text-green-600' : 'text-red-600'}`}>{icon}</div>
        </div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className={`text-sm font-semibold ${isOnline ? 'text-green-600' : 'text-red-600'}`}>{status}</span>
      </div>
    </div>
  );
}

function AlertItem({ item }: { item: any }) {
  const threshold = item.threshold || item.min_stock || item.max_stock || 0;
  const unit = item.unit || 'kg';
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 p-4 bg-white rounded-xl border border-orange-100 hover:border-orange-200 hover:shadow-md transition-all duration-200"
    >
      <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
        <AlertTriangle className="w-5 h-5 text-orange-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{item.item_name}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-gray-500">当前库存: <span className="text-orange-600 font-medium">{item.current_stock} {unit}</span></span>
          <span className="text-xs text-gray-400">|</span>
          <span className="text-xs text-gray-500">预警阈值: {threshold} {unit}</span>
        </div>
      </div>
      <span className="px-3 py-1 bg-orange-100 text-orange-600 text-xs font-semibold rounded-full">紧急</span>
    </motion.div>
  );
}

function WelcomeBanner({ greeting, userName, userRole, wsConnected, syncStatus }: { greeting: string; userName: string; userRole: string; wsConnected: boolean; syncStatus: 'idle' | 'syncing' | 'synced' }) {
  const hour = new Date().getHours();
  let WeatherIcon = Sun;
  if (hour >= 18 || hour < 6) WeatherIcon = Moon;
  else if (hour >= 12 && hour < 18) WeatherIcon = CloudSun;

  const roleMessages: Record<string, string> = {
    farmer: '今天也要好好照顾您的作物哦！',
    inspector: '确保每一份检测报告都准确无误',
    warehouse_manager: '库存管理，安全第一',
    salesperson: '祝您今天订单满满！',
    admin: '管理全局，掌控一切',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl p-8 bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 text-white shadow-2xl"
    >
      <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
      <div className="relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <WeatherIcon className="w-6 h-6 text-white/80" />
              </div>
              <div>
                <p className="text-primary-200 text-sm font-medium">{greeting}</p>
                <p className="text-lg font-semibold">{userName}</p>
              </div>
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold mb-3">欢迎回到金生链</h1>
            <p className="text-primary-100 text-lg">{roleMessages[userRole] || '花生全产业链溯源平台，开始您的工作吧！'}</p>
          </div>
          <div className="flex flex-col gap-3">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`flex items-center gap-3 px-5 py-3 rounded-full backdrop-blur-sm ${wsConnected ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}
            >
              <Wifi className={`w-5 h-5 ${wsConnected ? 'text-green-400' : 'text-red-400'}`} />
              <span className={`text-sm font-semibold ${wsConnected ? 'text-green-300' : 'text-red-300'}`}>{wsConnected ? '实时连接' : '离线'}</span>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`flex items-center gap-3 px-5 py-3 rounded-full backdrop-blur-sm ${syncStatus === 'synced' ? 'bg-blue-500/20 border border-blue-500/30' : syncStatus === 'syncing' ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-gray-500/20 border border-gray-500/30'}`}
            >
              <RefreshCw className={`w-5 h-5 ${syncStatus === 'synced' ? 'text-blue-400' : syncStatus === 'syncing' ? 'text-yellow-400 animate-spin' : 'text-gray-400'}`} />
              <span className={`text-sm font-semibold ${syncStatus === 'synced' ? 'text-blue-300' : syncStatus === 'syncing' ? 'text-yellow-300' : 'text-gray-300'}`}>
                {syncStatus === 'synced' ? '数据已同步' : syncStatus === 'syncing' ? '同步中' : '未同步'}
              </span>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) {
    return (
      <div className="h-8 flex items-center justify-center text-[10px] text-gray-300">
        趋势积累中...
      </div>
    );
  }
  const w = 120;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  const gradId = `spark-grad-${color.replace(/[^a-z0-9]/g, '')}`;
  const colorMap: Record<string, string> = {
    teal: '#14b8a6',
    red: '#ef4444',
    orange: '#f97316',
    blue: '#3b82f6',
    green: '#22c55e',
  };
  const stroke = colorMap[color] || '#14b8a6';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EnvMetric({ icon, label, value, unit, color }: { icon: any; label: string; value: number | null; unit: string; color: string }) {
  const Icon = icon;
  const colors: Record<string, string> = {
    red: 'text-red-500',
    orange: 'text-orange-500',
    blue: 'text-blue-500',
    green: 'text-green-500',
    purple: 'text-purple-500',
    amber: 'text-amber-500',
    cyan: 'text-cyan-500',
  };
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${colors[color] || 'text-gray-400'}`} />
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-semibold text-gray-700">
        {value !== null ? `${value}${unit}` : '--'}
      </span>
    </div>
  );
}

const COLLAPSED_THRESHOLD = 3; // 折叠时默认显示的地块数

function EnvironmentCard() {
  const navigate = useNavigate();
  const [envData, setEnvData] = useState<LatestEnvironmentalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [expanded, setExpanded] = useState(false); // 是否展开全部地块

  const visibleData = expanded ? envData : envData.slice(0, COLLAPSED_THRESHOLD);
  const hasMore = envData.length > COLLAPSED_THRESHOLD;
  const hiddenCount = envData.length - COLLAPSED_THRESHOLD;

  useEffect(() => {
    const fetchEnvData = async () => {
      try {
        const res = await measurementApi.getLatestEnvironmental();
        const data = res.data?.data || [];
        setEnvData(data);
        setHistory(prev => {
          const next = { ...prev };
          data.forEach(item => {
            if (item.temperature !== null && item.temperature !== undefined) {
              const arr = next[item.plot_code] ? [...next[item.plot_code]] : [];
              arr.push(item.temperature);
              if (arr.length > 20) arr.shift();
              next[item.plot_code] = arr;
            }
          });
          return next;
        });
      } catch {
        setEnvData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchEnvData();
    const interval = setInterval(fetchEnvData, 5000);
    return () => clearInterval(interval);
  }, []);

  // 对每个地块，筛选有值的指标（该传感器测不了的空气湿度/光照/风速 NULL 的不显示）
  const buildMetrics = (item: LatestEnvironmentalRecord) => {
    const all = [
      { icon: Thermometer, label: '空气温度', value: item.temperature, unit: '°C', color: 'red' },
      { icon: Flame, label: '土壤温度', value: item.soil_temperature, unit: '°C', color: 'orange' },
      { icon: Droplets, label: '空气湿度', value: item.humidity, unit: '%', color: 'blue' },
      { icon: Leaf, label: '土壤湿度', value: item.soil_moisture, unit: '%', color: 'green' },
      { icon: Gauge, label: 'pH', value: item.ph_value, unit: '', color: 'purple' },
      { icon: Ruler, label: '电导率', value: item.conductivity, unit: 'μS/cm', color: 'blue' },
      { icon: FlaskRound, label: '氮', value: item.nitrogen, unit: 'mg/kg', color: 'green' },
      { icon: Beaker, label: '磷', value: item.phosphorus, unit: 'mg/kg', color: 'red' },
      { icon: CircleDot, label: '钾', value: item.potassium, unit: 'mg/kg', color: 'purple' },
      { icon: Sparkles, label: '盐分', value: item.salinity, unit: 'mg/kg', color: 'amber' },
      { icon: Sun, label: '光照', value: item.illumination, unit: 'lux', color: 'amber' },
      { icon: Wind, label: '风速', value: item.wind_speed, unit: 'm/s', color: 'cyan' },
    ];
    return all.filter((m) => m.value !== null && m.value !== undefined);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Thermometer className="w-5 h-5 text-teal-500" />
          <h3 className="text-lg font-bold text-gray-800">环境监测概览</h3>
        </div>
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-teal-500" />
          <h3 className="text-lg font-bold text-gray-800">环境监测概览</h3>
          {envData.length > 0 && (
            <span className="ml-1 px-2 py-0.5 bg-teal-50 text-teal-600 text-xs font-medium rounded-full">
              共 {envData.length} 个地块
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/sensor')}
          className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium transition-colors"
        >
          查看详情
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
      {envData.length > 0 ? (
        <div className="space-y-3">
          {visibleData.map((item) => (
            <motion.div
              key={item.plot_code}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -2 }}
              onClick={() => navigate('/sensor')}
              className={`cursor-pointer rounded-xl border p-4 transition-all duration-200 hover:shadow-md ${
                item.is_stale
                  ? 'border-orange-100 bg-gradient-to-br from-orange-50/40 to-amber-50/20 hover:border-orange-200'
                  : 'border-teal-50 bg-gradient-to-br from-teal-50/50 to-cyan-50/30 hover:border-teal-200'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${item.is_stale ? 'bg-orange-400' : 'bg-teal-500 animate-pulse'}`} />
                  <span className="text-sm font-bold text-gray-800">{item.plot_name}</span>
                  <span className="text-xs text-gray-400">({item.plot_code})</span>
                  {item.is_stale && (
                    <span
                      title="该地块传感器数据已超过1小时未更新，请检查传感器状态"
                      className="px-1.5 py-0.5 bg-orange-100 text-orange-600 text-[10px] font-medium rounded cursor-help"
                    >
                      过期
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {item.record_time
                    ? new Date(item.record_time).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '--'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-x-3 gap-y-2">
                {buildMetrics(item).map((m, idx) => (
                  <EnvMetric key={`${item.plot_code}-${idx}-${m.label}`} {...m} />
                ))}
              </div>
              {history[item.plot_code] && history[item.plot_code].length >= 2 && (
                <div className="mt-3 pt-2 border-t border-gray-100/60">
                  <div className="flex items-center gap-2 mb-1">
                    <Thermometer className="w-3 h-3 text-teal-500" />
                    <span className="text-[10px] text-gray-400 font-medium">温度趋势</span>
                    <span className="text-[10px] text-gray-300">({history[item.plot_code].length}次采样)</span>
                  </div>
                  <MiniSparkline data={history[item.plot_code]} color="teal" />
                </div>
              )}
            </motion.div>
          ))}

          {hasMore && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 mt-1 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 hover:bg-gray-100 hover:border-gray-300 text-sm text-gray-600 transition-all duration-200"
            >
              {expanded ? (
                <>
                  <span>收起</span>
                  <ArrowUpRight className="w-3.5 h-3.5 rotate-180" />
                </>
              ) : (
                <>
                  <span>展开全部</span>
                  <span className="text-xs text-gray-400">({hiddenCount} 个地块)</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <Thermometer className="w-14 h-14 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-medium">暂无环境监测数据</p>
          <p className="text-xs text-gray-400 mt-1">请在传感器页面上传数据后查看</p>
        </div>
      )}
    </div>
  );
}

function AdminOverview({ stats }: { stats: Stats }) {
  const navigate = useNavigate();

  const overviewItems = [
    { label: '今日订单', value: stats.todayOrders, icon: ShoppingCart, color: 'green', path: '/sales', disabled: stats.todayOrders === 0 },
    { label: '待审核', value: stats.pendingReviews, icon: FileCheck, color: 'purple', path: '/inspection', disabled: stats.pendingReviews === 0 },
    { label: '待处理订单', value: stats.pendingOrders, icon: AlertTriangle, color: 'orange', path: '/sales', disabled: stats.pendingOrders === 0 },
    { label: '库存预警', value: stats.alerts, icon: AlertTriangle, color: 'red', path: '/inventory', disabled: stats.alerts === 0 },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary-600" />
          全局概览
        </h3>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {overviewItems.map((item, index) => {
          const Icon = item.icon;
          const colors = colorMap[item.color] || colorMap.blue;
          return (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={!item.disabled ? { scale: 1.02, y: -2 } : {}}
              onClick={() => !item.disabled && navigate(item.path)}
              className={`flex items-center gap-3 p-4 ${colors.bg} rounded-xl cursor-pointer transition-all duration-200 ${
                item.disabled 
                  ? 'opacity-60 cursor-not-allowed' 
                  : 'hover:shadow-md hover:border-gray-200'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg ${colors.iconBg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${colors.text}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="text-xl font-bold text-gray-800">{item.value}</p>
              </div>
              {!item.disabled && (
                <ArrowUpRight className="w-4 h-4 text-gray-400" />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function RecentOperations() {
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOperations = async () => {
      try {
        setLoading(true);
        const res = await operationsApi.getRecentOperations(6);
        setOperations(res.data || []);
      } catch (error) {
        console.error('Failed to fetch recent operations:', error);
        setOperations([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOperations();
    const interval = setInterval(fetchOperations, 30000);
    return () => clearInterval(interval);
  }, []);

  const iconMap: Record<string, any> = {
    Package,
    ShoppingCart,
    FileText,
    Wheat,
    Leaf,
    FlaskConical,
    Factory,
    Truck,
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-600" />
            最近动态
          </h3>
          <span className="text-xs text-gray-400">实时更新</span>
        </div>
        <div className="space-y-4">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="flex items-center gap-4 p-3 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-1/2 animate-pulse" />
                <div className="h-3 bg-gray-100 rounded w-1/3 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary-600" />
          最近动态
        </h3>
        <span className="text-xs text-gray-400">实时更新</span>
      </div>
      <div className="space-y-4">
        {operations.length > 0 ? (
          operations.map((op, index) => {
            const Icon = iconMap[op.icon] || FileText;
            const colors = colorMap[op.color] || colorMap.blue;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ x: 4 }}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-all duration-200"
              >
                <div className={`w-10 h-10 rounded-lg ${colors.iconBg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${colors.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700">{op.action}</p>
                  <p className="text-xs text-gray-400">{op.user} · {op.time_str}</p>
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="text-center py-8">
            <Activity className="w-14 h-14 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">暂无操作记录</p>
            <p className="text-xs text-gray-400 mt-1">系统将记录您的操作并在此显示</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BlockchainHighlight({ connected, ipfsConnected }: { connected: boolean; ipfsConnected: boolean }) {
  const navigate = useNavigate();
  const chainPoints = [
    { label: '种子采购', icon: Wheat, color: 'bg-green-100 text-green-600' },
    { label: '种植记录', icon: Leaf, color: 'bg-emerald-100 text-emerald-600' },
    { label: '农药使用', icon: FlaskConical, color: 'bg-blue-100 text-blue-600' },
    { label: '检测报告', icon: FileText, color: 'bg-purple-100 text-purple-600' },
    { label: '加工生产', icon: Factory, color: 'bg-orange-100 text-orange-600' },
    { label: '成品入库', icon: Package, color: 'bg-cyan-100 text-cyan-600' },
    { label: '物流发货', icon: Truck, color: 'bg-indigo-100 text-indigo-600' },
    { label: '终端销售', icon: ShoppingCart, color: 'bg-pink-100 text-pink-600' },
    { label: '环境数据', icon: Activity, color: 'bg-teal-100 text-teal-600' },
    { label: '溯源验证', icon: Shield, color: 'bg-red-100 text-red-600' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-700 p-6 sm:p-8 text-white shadow-2xl"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-6 h-6 text-blue-200" />
              <h3 className="text-xl sm:text-2xl font-bold">区块链全链路存证</h3>
              <span className="px-2.5 py-1 bg-white/15 backdrop-blur-sm rounded-full text-xs font-semibold">
                10 个上链点
              </span>
            </div>
            <p className="text-blue-100 text-sm">从种子到货架，全流程数据上链，不可篡改、可追溯</p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-sm ${connected ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-xs font-semibold">{connected ? '链节点在线' : '链节点离线'}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-sm ${ipfsConnected ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <Boxes className="w-3.5 h-3.5 text-blue-200" />
              <span className="text-xs font-semibold">{ipfsConnected ? 'IPFS在线' : 'IPFS离线'}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
          {chainPoints.map((point, index) => {
            const Icon = point.icon;
            return (
              <motion.div
                key={point.label}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ y: -2, scale: 1.05 }}
                className="flex flex-col items-center gap-2 p-3 bg-white/10 backdrop-blur-sm rounded-xl border border-white/10 hover:bg-white/15 transition-all cursor-pointer"
                onClick={() => navigate('/trace')}
              >
                <div className={`w-9 h-9 rounded-lg ${point.color} flex items-center justify-center`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[11px] text-center text-blue-50 font-medium">{point.label}</span>
              </motion.div>
            );
          })}
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/trace')}
          className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl text-sm font-medium transition-all"
        >
          <Search className="w-4 h-4" />
          查看溯源链路
        </motion.button>
      </div>
    </motion.div>
  );
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    seedBatches: 0,
    plantingPlots: 0,
    pesticides: 0,
    reports: 0,
    processingBatches: 0,
    inventoryItems: 0,
    orders: 0,
    alerts: 0,
    totalUsers: 0,
    todayOrders: 0,
    pendingReviews: 0,
    pendingOrders: 0,
    qualifiedReports: 0,
    overLimitCount: 0,
  });

  const [inventoryAlerts, setInventoryAlerts] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const [userRole, setUserRole] = useState<string>('');
  const [blockchainConnected, setBlockchainConnected] = useState(false);
  const [ipfsConnected, setIpfsConnected] = useState(false);
  const [userName, setUserName] = useState<string>('用户');
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const token = localStorage.getItem('token');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws${token ? `?token=${token}` : ''}`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setWsConnected(true);
        setSyncStatus('synced');
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      wsRef.current.onmessage = () => {
        setSyncStatus('syncing');
        setTimeout(() => setSyncStatus('synced'), 1000);
      };

      wsRef.current.onerror = () => {
        setWsConnected(false);
      };

      wsRef.current.onclose = () => {
        setWsConnected(false);
        reconnectTimerRef.current = setTimeout(connectWebSocket, 5000);
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      reconnectTimerRef.current = setTimeout(connectWebSocket, 5000);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);

        const profileRes = await authApi.getProfile();
        // 统一使用共享的 resolveUserRole，避免与 App/Layout 不一致
        const role = resolveUserRole(profileRes.data);
        setUserRole(role);
        setUserName(profileRes.data.username || '用户');

        const fetchAlertsIfAllowed = async (allowedRoles: string[]) => {
          if (!role || !allowedRoles.includes(role)) return { data: [] };
          try {
            const res = await inventoryApi.getAlerts();
            return res;
          } catch {
            return { data: [] };
          }
        };

        const [alertsRes, statsRes] = await Promise.all([
          fetchAlertsIfAllowed(['admin', 'warehouse_manager']),
          statisticsApi.getDashboard().catch(() => ({ data: { data: {} } })),
        ]);

        const alerts = alertsRes.data || [];
        const statsData = statsRes.data?.data || {};

        setStats({
          seedBatches: statsData.seedBatches || 0,
          plantingPlots: statsData.plantingPlots || 0,
          pesticides: statsData.pesticides || 0,
          reports: statsData.reports || 0,
          processingBatches: statsData.processingBatches || 0,
          inventoryItems: statsData.inventoryItems || 0,
          orders: statsData.orders || 0,
          alerts: alerts.length || 0,
          totalUsers: statsData.totalUsers || 0,
          todayOrders: statsData.todayOrders || 0,
          pendingReviews: statsData.pendingReviews || 0,
          pendingOrders: statsData.pendingOrders || 0,
          qualifiedReports: statsData.qualifiedReports || 0,
          overLimitCount: statsData.overLimitCount || 0,
        });

        setInventoryAlerts(alerts.slice(0, 5));

        try {
          const bcRes = await blockchainApi.getConnectionStatus();
          setBlockchainConnected(bcRes.data.blockchain?.connected || false);
          setIpfsConnected(bcRes.data.ipfs?.connected || false);
        } catch {
          setBlockchainConnected(false);
          setIpfsConnected(false);
        }
      } catch (err) {
        console.error('Dashboard data fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    connectWebSocket();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setSyncStatus('idle');
      } else {
        setSyncStatus('syncing');
        setTimeout(() => setSyncStatus('synced'), 1000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const currentStats = roleStats[userRole] || roleStats.admin;
  const currentShortcuts = roleShortcuts[userRole] || roleShortcuts.admin;
  const now = new Date();
  const greeting = now.getHours() < 12 ? '上午好' : now.getHours() < 18 ? '下午好' : '晚上好';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"
          />
          <p className="text-gray-500 font-medium">加载中...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WelcomeBanner
        greeting={greeting}
        userName={userName}
        userRole={userRole}
        wsConnected={wsConnected}
        syncStatus={syncStatus}
      />

      <BlockchainHighlight connected={blockchainConnected} ipfsConnected={ipfsConnected} />

      {userRole === 'admin' && <AdminOverview stats={stats} />}

      {(userRole === 'admin' || userRole === 'farmer') && <EnvironmentCard />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {currentStats.map((item, index) => {
          const Icon = item.icon;
          const statKey = item.key as keyof Stats;
          const statValue = stats[statKey];
          return (
            <motion.div
              key={statKey}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <StatCard
                icon={<Icon className="w-6 h-6" />}
                label={item.label}
                value={statValue}
                color={item.color}
                path={item.path}
              />
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary-600" />
                快捷操作
              </h3>
              <span className="text-xs text-gray-400">点击快速进入</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {currentShortcuts.map((shortcut, index) => (
                <motion.div
                  key={shortcut.path}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <QuickAction
                    label={shortcut.label}
                    icon={shortcut.icon}
                    path={shortcut.path}
                    color={shortcut.color}
                  />
                </motion.div>
              ))}
            </div>
          </div>

          {userRole === 'admin' && <RecentOperations />}
        </div>

        <div className="space-y-6">
          {(userRole === 'admin' || userRole === 'warehouse_manager') && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                  库存预警
                </h3>
                <span className="px-2 py-1 bg-orange-100 text-orange-600 text-xs font-semibold rounded-full">
                  {inventoryAlerts.length} 条
                </span>
              </div>
              <div className="space-y-3">
                {inventoryAlerts.length > 0 ? (
                  inventoryAlerts.map((alert, index) => (
                    <AlertItem key={index} item={alert} />
                  ))
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle className="w-14 h-14 mx-auto mb-3 text-green-400" />
                    <p className="text-gray-500 font-medium">暂无库存预警</p>
                    <p className="text-xs text-gray-400 mt-1">库存状态良好，无需补货</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Server className="w-5 h-5 text-gray-500" />
                系统状态
              </h3>
              <span className="text-xs text-gray-400">实时监控</span>
            </div>
            <div className="space-y-3">
              <StatusCard icon={<Database className="w-5 h-5" />} label="数据库" status="正常" isOnline={true} />
              <StatusCard icon={<Server className="w-5 h-5" />} label="区块链节点" status={blockchainConnected ? '已连接' : '未连接'} isOnline={blockchainConnected} />
              <StatusCard icon={<Target className="w-5 h-5" />} label="IPFS节点" status={ipfsConnected ? '已连接' : '未连接'} isOnline={ipfsConnected} />
              <StatusCard icon={<Wifi className="w-5 h-5" />} label="实时同步" status={syncStatus === 'synced' ? '已同步' : syncStatus === 'syncing' ? '同步中' : '离线'} isOnline={wsConnected} />
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-bold text-gray-800">安全提示</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">数据加密存储</p>
                  <p className="text-xs text-gray-500">所有数据通过区块链加密存储，确保不可篡改</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">操作可追溯</p>
                  <p className="text-xs text-gray-500">每一笔操作都记录在区块链上，全程可追溯</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">权限分级管理</p>
                  <p className="text-xs text-gray-500">基于角色的权限控制，数据安全可控</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}