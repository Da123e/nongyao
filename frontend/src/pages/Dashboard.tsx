import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  FileCheck,
  Truck,
  Thermometer,
  Droplets,
  Gauge,
  Sparkles,
  FlaskRound,
  Beaker,
  Ruler,
  Link2,
  Boxes,
  Search,
  ScanLine,
  Cpu,
  Plus,
  LogIn,
  Users,
  ClipboardList,
  MapPin,
  Info,
  TrendingUp,
  CalendarDays,
  BadgeCheck,
} from 'lucide-react';
import { inventoryApi, authApi, blockchainApi, statisticsApi, operationsApi, measurementApi, plantingApi, inspectionApi, salesApi, seedApi } from '../services/api';
import { resolveUserRole } from '../utils/auth';
import { subscribeLiveData, getBufferedSeries } from '../utils/liveSensorData';
import { formatRelativeCn, formatDateWithWeekdayCn } from '../utils/date';

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
  sensors: number;
  // 上一轮 statistics 兼容性扩展字段
  onlineSensors?: number;
  totalSensors?: number;
  todayPendingOrderOverlap?: number;
  totalSalesAmount?: number;
  // 虚拟字段（前端合成，非 API 字段）
  inspectionPassRate?: number;
}

// ===== 角色专属数据定义 =====

// 角色辅助统计卡（首页下方网格；admin 由「最近动态」区块替代，故为空数组）
const roleStats: Record<string, { label: string; icon: any; color: string; key: keyof Stats; path: string }[]> = {
  farmer: [
    { label: '种植地块', icon: Leaf, color: 'emerald', key: 'plantingPlots', path: '/planting' },
    { label: '在线传感器', icon: Activity, color: 'teal', key: 'sensors', path: '/sensor' },
    { label: '超限数据', icon: Zap, color: 'red', key: 'overLimitCount', path: '/inspection' },
    { label: '检测报告', icon: FileText, color: 'purple', key: 'reports', path: '/inspection' },
  ],
  inspector: [
    { label: '检测报告', icon: FileText, color: 'purple', key: 'reports', path: '/inspection' },
    { label: '合格报告', icon: CheckCircle, color: 'emerald', key: 'qualifiedReports', path: '/inspection' },
    { label: '待审核', icon: FileCheck, color: 'indigo', key: 'pendingReviews', path: '/inspection' },
    { label: '超限数据', icon: AlertTriangle, color: 'red', key: 'overLimitCount', path: '/inspection' },
  ],
  warehouse_manager: [
    { label: '库存商品', icon: Package, color: 'cyan', key: 'inventoryItems', path: '/inventory' },
    { label: '库存预警', icon: AlertTriangle, color: 'red', key: 'alerts', path: '/inventory' },
    { label: '加工批次', icon: Factory, color: 'orange', key: 'processingBatches', path: '/processing' },
    { label: '待发货订单', icon: Truck, color: 'amber', key: 'pendingOrders', path: '/sales' },
  ],
  salesperson: [
    { label: '销售订单', icon: ShoppingCart, color: 'pink', key: 'orders', path: '/sales' },
    { label: '今日订单', icon: Calendar, color: 'blue', key: 'todayOrders', path: '/sales' },
    { label: '待发货', icon: Truck, color: 'amber', key: 'pendingOrders', path: '/sales' },
    { label: '总销售额', icon: BadgeCheck, color: 'emerald', key: 'totalSalesAmount', path: '/sales' },
  ],
  admin: [],
};

// 角色快捷操作（常用操作区；external 项以新窗口打开，其余走站内路由）
const roleShortcuts: Record<string, { label: string; sub: string; icon: any; path: string; color: string; external?: boolean }[]> = {
  farmer: [
    { label: '新增种植记录', sub: '选择地块与种子批次', icon: Plus, path: '/planting', color: 'from-emerald-500 to-teal-600' },
    { label: '种子溯源', sub: '供应商与批次台账', icon: Wheat, path: '/seed', color: 'from-green-500 to-emerald-600' },
    { label: '施药登记', sub: '农药采购与使用', icon: FlaskConical, path: '/pesticide', color: 'from-blue-500 to-indigo-600' },
    { label: '农事活动', sub: '记录田间作业', icon: Leaf, path: '/planting', color: 'from-lime-500 to-green-600' },
    { label: '传感器', sub: '实时环境数据', icon: Activity, path: '/sensor', color: 'from-teal-500 to-cyan-600' },
    { label: '检测报告', sub: '查看质检与残留', icon: FileText, path: '/inspection', color: 'from-purple-500 to-violet-600' },
    { label: '溯源查询', sub: '全链追溯验证', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
  inspector: [
    { label: '待审报告', sub: '优先处理积压审核', icon: FileCheck, path: '/inspection', color: 'from-indigo-500 to-violet-600' },
    { label: '上传报告', sub: '录入检测结果', icon: Plus, path: '/inspection', color: 'from-blue-500 to-indigo-600' },
    { label: '传感器', sub: '查看环境证据', icon: Activity, path: '/sensor', color: 'from-teal-500 to-cyan-600' },
    { label: '种子溯源', sub: '核对批次信息', icon: Wheat, path: '/seed', color: 'from-green-500 to-emerald-600' },
    { label: '溯源查询', sub: '抽查链路真伪', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
  warehouse_manager: [
    { label: '扫码入库', sub: '扫码登记入仓', icon: ScanLine, path: '/inventory', color: 'from-cyan-500 to-sky-600' },
    { label: '库存管理', sub: '仓库与库存台账', icon: Package, path: '/inventory', color: 'from-teal-500 to-cyan-600' },
    { label: '加工管理', sub: '生产批次流转', icon: Factory, path: '/processing', color: 'from-orange-500 to-amber-600' },
    { label: '订单发货', sub: '出库与物流', icon: Truck, path: '/sales', color: 'from-pink-500 to-rose-600' },
    { label: '溯源查询', sub: '全链追溯验证', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
  salesperson: [
    { label: '新建订单', sub: '录入销售订单', icon: Plus, path: '/sales', color: 'from-rose-500 to-pink-600' },
    { label: '销售管理', sub: '订单与物流跟踪', icon: ShoppingCart, path: '/sales', color: 'from-pink-500 to-rose-600' },
    { label: '订单发货', sub: '出库发货签收', icon: Truck, path: '/sales', color: 'from-amber-500 to-orange-600' },
    { label: '溯源查询', sub: '应答客户溯源问询', icon: Shield, path: '/trace', color: 'from-indigo-500 to-purple-600' },
  ],
  admin: [
    { label: '种子管理', sub: '供应商与批次', icon: Wheat, path: '/seed', color: 'from-green-500 to-emerald-600' },
    { label: '种植记录', sub: '地块与农事', icon: Leaf, path: '/planting', color: 'from-emerald-500 to-teal-600' },
    { label: '农药管理', sub: '采购与使用', icon: FlaskConical, path: '/pesticide', color: 'from-blue-500 to-indigo-600' },
    { label: '检测报告', sub: '质检与残留', icon: FileText, path: '/inspection', color: 'from-purple-500 to-violet-600' },
    { label: '加工管理', sub: '生产记录', icon: Factory, path: '/processing', color: 'from-orange-500 to-amber-600' },
    { label: '库存管理', sub: '仓库与库存', icon: Package, path: '/inventory', color: 'from-cyan-500 to-sky-600' },
    { label: '销售管理', sub: '订单与物流', icon: ShoppingCart, path: '/sales', color: 'from-pink-500 to-rose-600' },
    { label: '消费者体验', sub: 'C 端扫码入口', icon: LogIn, path: '/trace/public', color: 'from-violet-500 to-purple-600', external: true },
  ],
};

// 统计卡颜色映射
const colorMap: Record<string, { bg: string; text: string; gradient: string; iconBg: string }> = {
  green: { bg: 'bg-gradient-to-br from-green-50 to-emerald-50', text: 'text-green-600', gradient: 'from-green-400 to-green-600', iconBg: 'bg-green-100' },
  emerald: { bg: 'bg-gradient-to-br from-emerald-50 to-teal-50', text: 'text-emerald-600', gradient: 'from-emerald-400 to-emerald-600', iconBg: 'bg-emerald-100' },
  blue: { bg: 'bg-gradient-to-br from-blue-50 to-indigo-50', text: 'text-blue-600', gradient: 'from-blue-400 to-blue-600', iconBg: 'bg-blue-100' },
  indigo: { bg: 'bg-gradient-to-br from-indigo-50 to-violet-50', text: 'text-indigo-600', gradient: 'from-indigo-400 to-indigo-600', iconBg: 'bg-indigo-100' },
  purple: { bg: 'bg-gradient-to-br from-purple-50 to-violet-50', text: 'text-purple-600', gradient: 'from-purple-400 to-purple-600', iconBg: 'bg-purple-100' },
  orange: { bg: 'bg-gradient-to-br from-orange-50 to-amber-50', text: 'text-orange-600', gradient: 'from-orange-400 to-orange-600', iconBg: 'bg-orange-100' },
  amber: { bg: 'bg-gradient-to-br from-amber-50 to-orange-50', text: 'text-amber-600', gradient: 'from-amber-400 to-amber-600', iconBg: 'bg-amber-100' },
  cyan: { bg: 'bg-gradient-to-br from-cyan-50 to-sky-50', text: 'text-cyan-600', gradient: 'from-cyan-400 to-cyan-600', iconBg: 'bg-cyan-100' },
  teal: { bg: 'bg-gradient-to-br from-teal-50 to-cyan-50', text: 'text-teal-600', gradient: 'from-teal-400 to-teal-600', iconBg: 'bg-teal-100' },
  pink: { bg: 'bg-gradient-to-br from-pink-50 to-rose-50', text: 'text-pink-600', gradient: 'from-pink-400 to-pink-600', iconBg: 'bg-pink-100' },
  red: { bg: 'bg-gradient-to-br from-red-50 to-rose-50', text: 'text-red-600', gradient: 'from-red-400 to-red-600', iconBg: 'bg-red-100' },
};

// 环境监测 6 项指标的图标 / 渐变背景 / 迷你趋势线颜色
const ENV_ITEM_ICON: Record<string, any> = {
  soil_temperature: Thermometer,
  soil_moisture: Droplets,
  ph_value: Gauge,
  nitrogen: FlaskRound,
  phosphorus: Beaker,
  potassium: Ruler,
};
const ENV_ITEM_BG: Record<string, string> = {
  soil_temperature: 'from-red-50 to-orange-50 text-red-600',
  soil_moisture: 'from-blue-50 to-cyan-50 text-blue-600',
  ph_value: 'from-purple-50 to-violet-50 text-purple-600',
  nitrogen: 'from-green-50 to-emerald-50 text-green-600',
  phosphorus: 'from-amber-50 to-orange-50 text-amber-600',
  potassium: 'from-pink-50 to-rose-50 text-pink-600',
};
const ENV_ITEM_SPARK: Record<string, string> = {
  soil_temperature: '#f97316',
  soil_moisture: '#0ea5e9',
  ph_value: '#8b5cf6',
  nitrogen: '#22c55e',
  phosphorus: '#f59e0b',
  potassium: '#ec4899',
};

// 迷你趋势图（环境卡内嵌，各指标独立缩放；颜色直接为 hex 色值）
let sparkSeq = 0;
function MiniSparkline6({ data, color }: { data: number[]; color: string }) {
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
  const stroke = color.startsWith('#') ? color : '#14b8a6';
  const gradId = `spark6-${sparkSeq++}`;
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

// ===== 欢迎区角色化配置 =====

type HeroKpiDef = { label: string; key: keyof Stats | 'todoSum'; color: string; icon: any; suffix: string; path: string };
const heroKpisByRole: Record<string, HeroKpiDef[]> = {
  farmer: [
    { label: '种植地块', key: 'plantingPlots', color: 'from-emerald-400 to-green-500', icon: Leaf, suffix: '块', path: '/planting' },
    { label: '在线传感器', key: 'sensors', color: 'from-teal-400 to-cyan-500', icon: Cpu, suffix: '台', path: '/sensor' },
    { label: '超限数据', key: 'overLimitCount', color: 'from-rose-400 to-red-500', icon: Zap, suffix: '项', path: '/inspection' },
    { label: '今日待办', key: 'todoSum', color: 'from-blue-400 to-indigo-500', icon: ClipboardList, suffix: '项', path: '/inspection' },
  ],
  inspector: [
    { label: '待审核报告', key: 'pendingReviews', color: 'from-indigo-400 to-violet-500', icon: FileCheck, suffix: '份', path: '/inspection' },
    { label: '合格率', key: 'qualifiedReports', color: 'from-emerald-400 to-green-500', icon: CheckCircle, suffix: '%', path: '/inspection' },
    { label: '超限数据', key: 'overLimitCount', color: 'from-rose-400 to-red-500', icon: Zap, suffix: '项', path: '/inspection' },
    { label: '检测总数', key: 'reports', color: 'from-blue-400 to-cyan-500', icon: FileText, suffix: '份', path: '/inspection' },
  ],
  warehouse_manager: [
    { label: '库存品类', key: 'inventoryItems', color: 'from-teal-400 to-cyan-500', icon: Package, suffix: '类', path: '/inventory' },
    { label: '库存预警', key: 'alerts', color: 'from-orange-400 to-red-500', icon: AlertTriangle, suffix: '项', path: '/inventory' },
    { label: '加工批次', key: 'processingBatches', color: 'from-amber-400 to-orange-500', icon: Factory, suffix: '批', path: '/processing' },
    { label: '待发货订单', key: 'pendingOrders', color: 'from-blue-400 to-indigo-500', icon: Truck, suffix: '单', path: '/sales' },
  ],
  salesperson: [
    { label: '今日订单', key: 'todayOrders', color: 'from-rose-400 to-pink-500', icon: ShoppingCart, suffix: '单', path: '/sales' },
    { label: '待发货', key: 'pendingOrders', color: 'from-amber-400 to-orange-500', icon: Truck, suffix: '单', path: '/sales' },
    { label: '总订单数', key: 'orders', color: 'from-blue-400 to-indigo-500', icon: ClipboardList, suffix: '单', path: '/sales' },
    { label: '总销售额', key: 'totalSalesAmount', color: 'from-emerald-400 to-green-600', icon: BadgeCheck, suffix: '元', path: '/sales' },
  ],
  admin: [
    { label: '种植地块', key: 'plantingPlots', color: 'from-emerald-400 to-green-500', icon: Leaf, suffix: '块', path: '/planting' },
    { label: '在线传感器', key: 'sensors', color: 'from-teal-400 to-cyan-500', icon: Cpu, suffix: '台', path: '/sensor' },
    { label: '今日待办', key: 'todoSum', color: 'from-blue-400 to-indigo-500', icon: ClipboardList, suffix: '项', path: '/inspection' },
    { label: '库存品类', key: 'inventoryItems', color: 'from-amber-400 to-orange-500', icon: Package, suffix: '类', path: '/inventory' },
    { label: '今日新订单', key: 'todayOrders', color: 'from-rose-400 to-pink-500', icon: ShoppingCart, suffix: '单', path: '/sales' },
    { label: '系统用户', key: 'totalUsers', color: 'from-purple-400 to-violet-600', icon: Users, suffix: '人', path: '/' },
  ],
};

// Banner 主渐变按角色切换（Tailwind 需完整字符串，不能动态拼接）
const bannerGradientByRole: Record<string, string> = {
  farmer: 'from-emerald-500 via-green-600 to-lime-700',
  inspector: 'from-indigo-500 via-blue-600 to-sky-700',
  warehouse_manager: 'from-teal-500 via-cyan-600 to-sky-700',
  salesperson: 'from-rose-500 via-pink-600 to-orange-500',
  admin: 'from-violet-600 via-purple-700 to-indigo-800',
};

// 今日建议：按角色职责生成一行智能文案
const suggestionByRole: Record<string, (s: Stats) => string> = {
  farmer: (s) =>
    s.overLimitCount > 0
      ? `发现 ${s.overLimitCount} 项超限数据，建议查看检测报告`
      : s.sensors === 0
        ? '当前传感器离线，请检查 RS485 连接'
        : '环境数据一切正常，祝您丰收',
  inspector: (s) => (s.pendingReviews > 0 ? `待审报告 ${s.pendingReviews} 份，建议优先处理` : '今日无待审报告，保持记录复核习惯'),
  warehouse_manager: (s) => (s.alerts > 0 ? `有 ${s.alerts} 类商品库存偏低，建议立即补货` : `${s.pendingOrders} 单待发货，请及时出库`),
  salesperson: (s) => `今日新增 ${s.todayOrders} 单，累计订单 ${s.orders} 单`,
  admin: (s) => {
    const todo = (s.todayOrders || 0) + (s.pendingReviews || 0) + (s.pendingOrders || 0) + (s.alerts || 0) + (s.overLimitCount || 0) - (s.todayPendingOrderOverlap || 0);
    return `今日总待办 ${todo} 项，系统运行正常`;
  },
};

// 角色中文名（欢迎区标签）
const roleLabelMap: Record<string, string> = {
  farmer: '种植户',
  inspector: '质检员',
  warehouse_manager: '仓库管理员',
  salesperson: '售货员',
  admin: '系统管理员',
};

function PlotHistoryMiniChart({ plotCode, compact = false }: { plotCode: string; compact?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentPlotRef = useRef(plotCode);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dataRef = useRef<any>(null);
  // 默认只显示温度和湿度两条线，其余通过点击图例切换显示
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set(['soil_temperature', 'soil_moisture']));
  // 实时数据时，标记为"live"模式（顶部显示呼吸灯）
  const [liveMark, setLiveMark] = useState(false);
  // Hover：当前高亮的时间索引（-1 表示无悬停）
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  // Tooltip 相对容器的像素位置
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  /** 把 live 缓冲里比本地 data 时间更新的点 merge 进来 */
  const mergeBuffered = useCallback(() => {
    const cur = dataRef.current;
    if (!cur) return;
    const buf = getBufferedSeries(plotCode);
    if (!buf) return;

    // 取本地已有的最新时间，避免重复点
    const latestTs: Record<string, string> = {};
    for (const key of Object.keys(cur.series || {})) {
      const pts = cur.series[key].points || [];
      if (pts.length > 0) latestTs[key] = pts[pts.length - 1].t;
    }

    let changed = false;
    const next = { ...cur, series: { ...(cur.series || {}) } };
    for (const key of Object.keys(buf.series)) {
      const existing = next.series[key]?.points || [];
      const cutoff = latestTs[key] || "";
      const freshPts = buf.series[key].points.filter((p) => p.t > cutoff);
      if (freshPts.length === 0) continue;
      const merged = [...existing, ...freshPts];
      // 限制总点数不超过 2880 上限，避免累积过多
      const capped = merged.length > 2880 ? merged.slice(merged.length - 2880) : merged;
      next.series[key] = {
        label: next.series[key]?.label || buf.series[key].label,
        unit: next.series[key]?.unit || buf.series[key].unit,
        points: capped,
      };
      changed = true;
    }

    // 合并 timestamps
    const tsSet = new Set<string>(cur.timestamps || []);
    for (const t of buf.timestamps) tsSet.add(t);
    next.timestamps = Array.from(tsSet).sort();
    next.count = (cur.count || 0) + Object.values(buf.series).reduce((s, a) => s + a.points.length, 0);

    if (changed) {
      dataRef.current = next;
      setData(next);
      setLiveMark(true);
      setTimeout(() => setLiveMark(false), 1200);
    }
  }, [plotCode]);

  useEffect(() => {
    currentPlotRef.current = plotCode;
    dataRef.current = null;
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await measurementApi.getPlotHistory(plotCode, 24);
        if (!cancelled && currentPlotRef.current === plotCode) {
          const initial = res.data ?? res;
          dataRef.current = initial;
          setData(initial);
          // 拉完立刻补一次 live 缓冲里比它新的点
          mergeBuffered();
        }
      } catch (e: any) {
        if (!cancelled && currentPlotRef.current === plotCode) {
          setError(e?.response?.data?.detail || e?.message || '加载历史数据失败');
        }
      } finally {
        if (!cancelled && currentPlotRef.current === plotCode) setLoading(false);
      }
    };
    fetchData();

    // 订阅 WS 实时数据
    const unsub = subscribeLiveData((payload) => {
      if (payload.plot_code !== plotCode) return;
      mergeBuffered();
    });

    return () => { cancelled = true; unsub(); };
  }, [plotCode, mergeBuffered]);

  // 地块切换时重置默认可见项
  useEffect(() => {
    setVisibleKeys(new Set(['soil_temperature', 'soil_moisture']));
  }, [plotCode]);

  const toggleSeries = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showAll = () => {
    const allKeys = Object.keys(data?.series || {});
    setVisibleKeys(new Set(allKeys));
  };

  const showDefault = () => {
    setVisibleKeys(new Set(['soil_temperature', 'soil_moisture']));
  };

  // ---- Hover 交互：crosshair + tooltip ----
  const W = compact ? 400 : 600;
  const H = compact ? 120 : 160;
  const PAD_L = 40;
  const PAD_R = 10;
  const PAD_T = 8;
  const PAD_B = 24;

  const timestamps: string[] = data?.timestamps || [];
  const series = data?.series || {};
  const colors: Record<string, string> = {
    soil_temperature: '#dc2626',
    soil_moisture: '#059669',
    ph_value: '#7c3aed',
    nitrogen: '#16a34a',
    phosphorus: '#d97706',
    potassium: '#c026d3',
  };

  const nTs = timestamps.length;
  const innerW = W - PAD_L - PAD_R;

  /** 根据鼠标在 SVG 上的 clientX，算出最近时间点的索引，并计算 SVG viewbox 坐标下的 px */
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || nTs === 0) return;
    const rect = svg.getBoundingClientRect();
    // 鼠标在容器内的相对像素（0 ~ rect.width）
    const relPx = e.clientX - rect.left;
    // 换算成 SVG viewBox 坐标系下的 x
    const vbX = (relPx / rect.width) * W;
    // 限定到绘图区域
    const clampedX = Math.max(PAD_L, Math.min(W - PAD_R, vbX));
    // 反推索引
    const frac = nTs <= 1 ? 0 : (clampedX - PAD_L) / innerW;
    const idx = Math.max(0, Math.min(nTs - 1, Math.round(frac * (nTs - 1))));
    setHoverIdx(idx);
    // tooltip 位置（相对外层 div，用容器内像素坐标）
    setTooltipPos({ x: relPx, y: e.clientY - rect.top });
  };
  const handleMouseLeave = () => {
    setHoverIdx(-1);
    setTooltipPos(null);
  };

  /** 根据参数键和时间索引，取出其值；找不到返回 null */
  const valueAt = (key: string, idx: number): number | null => {
    const pts = series[key]?.points || [];
    if (pts.length === 0) return null;
    const targetT = timestamps[idx];
    if (!targetT) return null;
    // 优先精确匹配
    const exact = pts.find((p: any) => p.t === targetT);
    if (exact) return exact.v;
    // 否则按时间差取最近的一个（避免参数间采样时间不同步）
    let best: any = null;
    let bestDt = Infinity;
    for (const p of pts) {
      const dt = Math.abs(new Date(p.t).getTime() - new Date(targetT).getTime());
      if (dt < bestDt) { bestDt = dt; best = p; }
    }
    if (best && bestDt < 5 * 60 * 1000) return best.v;  // 容忍 5 分钟内的偏差
    return null;
  };

  /** 根据参数键 + 时间索引，计算 SVG 坐标（用于画高亮圆点和 crosshair） */
  const pointSvgCoord = (key: string, idx: number): { x: number; y: number } | null => {
    const pts = series[key]?.points || [];
    if (pts.length === 0) return null;
    const values = pts.map((p: any) => p.v);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const rangeV = maxV - minV || 1;
    const v = valueAt(key, idx);
    if (v === null) return null;
    const x = PAD_L + (nTs <= 1 ? 0 : innerW * (idx / (nTs - 1)));
    const y = PAD_T + (H - PAD_T - PAD_B) * (1 - (v - minV) / rangeV);
    return { x, y };
  };

  // crosshair 在 SVG 坐标下的 x
  const crosshairX = hoverIdx >= 0 && nTs > 0
    ? PAD_L + (nTs <= 1 ? 0 : innerW * (hoverIdx / (nTs - 1)))
    : -1;

  if (loading) {
    return (
      <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-[12px] text-gray-400">
        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
        正在加载 {plotCode} 地块的历史趋势...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 p-4 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-[12px] text-red-500">
        {error}
      </div>
    );
  }

  const seriesKeys = Object.keys(series);
  if (seriesKeys.length === 0) {
    return (
      <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-[12px] text-gray-400">
        该地块近 24 小时暂无历史数据
      </div>
    );
  }

  // 计算每个 series 的路径（仅可见的参与渲染）
  const paths = seriesKeys
    .filter((key) => visibleKeys.has(key))
    .map((key) => {
      const s = series[key];
      const pts = s.points || [];
      if (pts.length < 1) return null;
      const values = pts.map((p: any) => p.v);
      const minV = Math.min(...values);
      const maxV = Math.max(...values);
      const rangeV = maxV - minV || 1;
      const n = pts.length;

      const xStep = n === 1 ? 0 : (W - PAD_L - PAD_R) / (n - 1);
      const pathD = pts.map((p: any, i: number) => {
        const x = PAD_L + i * xStep;
        const y = PAD_T + (H - PAD_T - PAD_B) * (1 - (p.v - minV) / rangeV);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');

      return { key, label: s.label, unit: s.unit, pathD, color: colors[key] || '#666', minV, maxV, n };
    })
    .filter(Boolean);

  // 时间标签（跨天时补充日期）
  const timeLabels: string[] = [];
  const today = new Date();
  if (timestamps.length > 0) {
    const step = Math.max(1, Math.floor(timestamps.length / 3));
    for (let i = 0; i < timestamps.length; i += step) {
      const ts = new Date(timestamps[i]);
      const isSameDay = ts.toDateString() === today.toDateString();
      const hhmm = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}`;
      if (isSameDay) {
        timeLabels.push(hhmm);
      } else {
        const mmdd = `${(ts.getMonth() + 1).toString().padStart(2, '0')}-${ts.getDate().toString().padStart(2, '0')}`;
        timeLabels.push(`${mmdd} ${hhmm}`);
      }
    }
  }

  const allSeriesVisible = seriesKeys.every((k) => visibleKeys.has(k));

  return (
    <div className={`mt-3 p-4 rounded-xl bg-gradient-to-br from-emerald-50/60 to-white border transition-all duration-300 ${
      liveMark ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-emerald-100/60'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-medium text-gray-700 flex items-center gap-2">
          近 24 小时历史趋势 · <span className="text-emerald-700">{data?.plot_name || plotCode}</span>
          <span className="text-gray-400 ml-2">共 {data?.count || 0} 条记录</span>
          {liveMark && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              LIVE · 新数据到达
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">
            点击图例可切换显示（各参数独立 Y 轴缩放 · 顶部=该参数最高值，底部=该参数最低值）
          </span>
          {allSeriesVisible ? (
            <button onClick={showDefault} className="text-[11px] text-emerald-600 hover:text-emerald-700 underline">
              仅显示核心 2 项
            </button>
          ) : (
            <button onClick={showAll} className="text-[11px] text-emerald-600 hover:text-emerald-700 underline">
              显示全部 {seriesKeys.length} 项
            </button>
          )}
        </div>
      </div>

      {paths.length === 0 ? (
        <div className="text-center py-8 text-[12px] text-gray-400">
          已隐藏全部参数，请点击下方图例恢复显示
        </div>
      ) : (
        <div className="relative">
          {/* Y 轴左侧说明 */}
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 origin-center text-[9px] text-gray-400 whitespace-nowrap pointer-events-none">
            参数值 · 各自独立缩放（顶部=峰值 底部=谷值）
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className={`w-full ${compact ? 'h-[120px]' : 'h-[160px]'} ${compact ? 'pl-6' : 'pl-8'} cursor-crosshair`}
            preserveAspectRatio="xMidYMid meet"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Y 轴刻度线 */}
            {[0.25, 0.5, 0.75].map((r) => (
              <line
                key={r}
                x1={PAD_L}
                x2={W - PAD_R}
                y1={PAD_T + (H - PAD_T - PAD_B) * r}
                y2={PAD_T + (H - PAD_T - PAD_B) * r}
                stroke="#e5e7eb"
                strokeWidth="0.5"
                strokeDasharray="2,2"
              />
            ))}

            {/* X 轴时间标签 */}
            {timeLabels.map((label, i) => {
              const step = Math.max(1, Math.floor(timestamps.length / 3));
              const idx = i * step;
              const xStep = timestamps.length <= 1 ? 0 : (W - PAD_L - PAD_R) / (timestamps.length - 1);
              const x = PAD_L + idx * xStep;
              return (
                <text key={i} x={x} y={H - 6} fontSize="8" fill="#9ca3af" textAnchor="middle">
                  {label}
                </text>
              );
            })}

            {/* X 轴标题 */}
            <text x={W / 2} y={H - 1} fontSize="8" fill="#9ca3af" textAnchor="middle">
              时间 ←（24 小时前）— （现在）→
            </text>

            {/* 各参数趋势线（仅可见的） */}
            {paths.map((p: any) => (
              <g key={p.key}>
                <path
                  d={p.pathD}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.9"
                />
                {p.n > 0 && (() => {
                  const lastPt = series[p.key].points[p.n - 1];
                  const xStep = p.n === 1 ? 0 : (W - PAD_L - PAD_R) / (p.n - 1);
                  const x = PAD_L + (p.n - 1) * xStep;
                  const rangeV = p.maxV - p.minV || 1;
                  const y = PAD_T + (H - PAD_T - PAD_B) * (1 - (lastPt.v - p.minV) / rangeV);
                  return <circle cx={x} cy={y} r="3" fill={p.color} stroke="white" strokeWidth="1" />;
                })()}
              </g>
            ))}

            {/* Hover: crosshair 垂直线 */}
            {crosshairX > 0 && (
              <line
                x1={crosshairX}
                x2={crosshairX}
                y1={PAD_T}
                y2={H - PAD_B + 2}
                stroke="#6b7280"
                strokeWidth="0.8"
                strokeDasharray="3,2"
                opacity="0.7"
              />
            )}

            {/* Hover: 各可见线的高亮圆点 */}
            {hoverIdx >= 0 && seriesKeys.filter((k) => visibleKeys.has(k)).map((key) => {
              const coord = pointSvgCoord(key, hoverIdx);
              if (!coord) return null;
              const c = colors[key] || '#666';
              return (
                <circle
                  key={`dot-${key}-${hoverIdx}`}
                  cx={coord.x}
                  cy={coord.y}
                  r="4.5"
                  fill={c}
                  stroke="white"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>

          {/* 浮层 Tooltip：精确时间 + 各参数数值 */}
          {hoverIdx >= 0 && tooltipPos && timestamps[hoverIdx] && (
            <div
              className="absolute z-20 pointer-events-none rounded-lg bg-gray-900/95 text-white text-[11px] shadow-xl px-3 py-2 min-w-[170px] border border-gray-700/60"
              style={{
                left: Math.min(
                  Math.max(tooltipPos.x + 14, 4),
                  (svgRef.current?.getBoundingClientRect().width ?? 600) - 180
                ),
                top: Math.max(tooltipPos.y - 20, 4),
              }}
            >
              <div className="font-semibold text-emerald-300 text-[11.5px] pb-1 mb-1 border-b border-gray-700/60">
                {(() => {
                  const t = new Date(timestamps[hoverIdx]);
                  const mm = (t.getMonth() + 1).toString().padStart(2, '0');
                  const dd = t.getDate().toString().padStart(2, '0');
                  const hh = t.getHours().toString().padStart(2, '0');
                  const mi = t.getMinutes().toString().padStart(2, '0');
                  const ss = t.getSeconds().toString().padStart(2, '0');
                  return `${mm}月${dd}日 ${hh}:${mi}:${ss}`;
                })()}
              </div>
              <div className="space-y-0.5">
                {seriesKeys.filter((k) => visibleKeys.has(k)).map((key) => {
                  const v = valueAt(key, hoverIdx);
                  const s = series[key];
                  const c = colors[key] || '#999';
                  return (
                    <div key={`tt-${key}-${hoverIdx}`} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c }} />
                        <span className="text-gray-300">{s?.label || key}</span>
                      </span>
                      <span className="font-mono font-semibold tabular-nums">
                        {v === null ? <span className="text-gray-500">—</span> : `${typeof v === 'number' ? v.toFixed(1) : v}${s?.unit || ''}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 图例（可点击切换） */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2">
        {seriesKeys.map((key) => {
          const s = series[key];
          const isVisible = visibleKeys.has(key);
          const color = colors[key] || '#666';
          const pts = s.points || [];
          const values = pts.map((p: any) => p.v);
          const minV = values.length > 0 ? Math.min(...values) : 0;
          const maxV = values.length > 0 ? Math.max(...values) : 0;
          return (
            <button
              key={key}
              onClick={() => toggleSeries(key)}
              className={`flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full transition-all ${
                isVisible
                  ? 'text-gray-700 bg-white border border-gray-200 hover:border-gray-300 shadow-sm'
                  : 'text-gray-400 bg-gray-50 border border-gray-100 line-through'
              }`}
              title={isVisible ? '点击隐藏此参数' : '点击显示此参数'}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: isVisible ? color : '#d1d5db' }}
              />
              {s.label}
              {isVisible && (
                <span className="text-gray-400 font-mono">
                  {minV.toFixed(1)}~{maxV.toFixed(1)}{s.unit}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type RealTimeEnvCardProps<TPlot = any> = {
  wsConnected: boolean;
  envVersion: number;
  activePlotCode: string;
  onPlotsLoaded: (plots: TPlot[]) => void;
  onChangePlot: (code: string) => void;
  fetcherRef: React.MutableRefObject<(() => Promise<void>) | null>;
  envHolder: {
    value: { schema: any[]; plots: TPlot[] } | null;
    set: React.Dispatch<React.SetStateAction<{ schema: any[]; plots: TPlot[] } | null>>;
  };
};

function RealTimeEnvCard(props: RealTimeEnvCardProps) {
  const { wsConnected, envVersion, activePlotCode, onPlotsLoaded, onChangePlot, fetcherRef, envHolder } = props;
  const [loading, setLoading] = useState(!envHolder.value);
  const [error, setError] = useState('');
  // 默认展开趋势图，连接硬件后即可直接查看
  const [showTrend, setShowTrend] = useState(true);
  const navigate = useNavigate();

  // 切换地块时保持趋势图显示（用户手动收起后不再自动展开）
  useEffect(() => {}, [activePlotCode]);

  const load = async () => {
    try {
      setError('');
      const res = await measurementApi.getDashboardEnvironment();
      const payload = res.data ?? res;
      const plots: any[] = payload?.plots ?? [];
      const schema: any[] = payload?.schema ?? [];
      envHolder.set({ schema, plots });
      onPlotsLoaded(plots);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || '加载失败');
      setLoading(false);
    }
  };

  // 把刷新函数暴露给外层：WS 消息到 / 12s 兜底都能直接调
  fetcherRef.current = load;

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envVersion]);

  const { schema, plots } = envHolder.value ?? { schema: [], plots: [] };
  const active = plots.find(p => p.plot_code === activePlotCode) ?? plots[0] ?? null;
  const hasAnyData = !!active?.items?.length;

  // 秒级年龄 → 人类可读时间
  const humanizeAge = (sec: number): string => {
    if (sec < 60) return `${Math.max(1, Math.round(sec))} 秒`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} 分钟`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} 小时`;
    const day = Math.round(hr / 24);
    return day >= 7 ? `${Math.round(day / 7)} 周` : `${day} 天`;
  };

  // 呼吸灯状态：online 绿（<6s 且 WS 连接）/ stale 黄（6s~5min）/ offline 灰（>5min 或断开）
  const { lampClass, lampLabel, overallDim } = useMemo(() => {
    const ageS = active?.age_s ?? null;
    // 无任何历史数据（硬件未连接或地块为空）
    if (!hasAnyData) {
      return { lampClass: 'bg-gray-400', lampLabel: '等待硬件数据', overallDim: false };
    }
    // WS 断开或超 5 分钟无新数据视为离线（显示最近采集时间）
    if (!wsConnected || (ageS != null && ageS > 300)) {
      const label =
        ageS != null ? `最近一次采集 · ${humanizeAge(ageS)} 前` : '离线';
      return { lampClass: 'bg-gray-400', lampLabel: label, overallDim: true };
    }
    // WS 已连但超 6 秒无新数据视为同步延迟
    if (ageS != null && ageS > 6) {
      return {
        lampClass: 'bg-amber-400 animate-pulse',
        lampLabel: `${humanizeAge(ageS)} 前 · 等待下一次同步`,
        overallDim: true,
      };
    }
    // 正常实时
    return {
      lampClass: 'bg-emerald-500 animate-pulse shadow-[0_0_0_4px_rgba(16,185,129,0.18)]',
      lampLabel:
        ageS != null ? `实时同步 · ${humanizeAge(ageS)} 前更新` : '实时同步 · 刚刚更新',
      overallDim: false,
    };
  }, [active, wsConnected, hasAnyData]);

  // 将 schema 与实时数据合并渲染，固定显示 6 项监测指标
  const displaySix = useMemo(() => {
    const baseSchema = schema.length > 0 ? schema : [
      { key: 'soil_temperature', label: '土壤温度', unit: '°C' },
      { key: 'soil_moisture', label: '土壤湿度', unit: '%' },
      { key: 'ph_value', label: 'pH 值', unit: '' },
      { key: 'nitrogen', label: '氮 (N)', unit: 'mg/kg' },
      { key: 'phosphorus', label: '磷 (P)', unit: 'mg/kg' },
      { key: 'potassium', label: '钾 (K)', unit: 'mg/kg' },
    ];
    const byKey = new Map((active?.items ?? []).map((it: any) => [it.key, it]));
    return baseSchema.map((s: any) => ({ ...s, item: byKey.get(s.key) ?? null }));
  }, [schema, active]);

  const fmtVal = (s: any) => {
    if (s.item == null || s.item.value == null) return '--';
    const n = Number(s.item.value);
    if (!isFinite(n)) return '--';
    // pH 显示 1 位小数；mg/kg 整数；%/℃ 1 位小数
    if (s.key === 'ph_value') return n.toFixed(1);
    if (s.unit === 'mg/kg') return Math.round(n).toString();
    return n.toFixed(1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-2xl shadow-sm overflow-hidden border border-green-100/60 ${overallDim ? '' : ''}`}
    >
      {/* 渐变头部 */}
      <div className="bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 px-5 pt-4 pb-3 border-b border-green-100/60">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-md">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-bold text-gray-800 leading-tight">实时环境监测</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                  土壤 RS485 · 6 项
                </span>
              </div>
              <p className="text-[12px] text-gray-500 mt-0.5">
                全参数土壤传感器直接采集 · 每 12 秒兜底刷新，WebSocket 入站即时显示
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${lampClass}`} />
              <span className="text-[12px] text-gray-600 font-medium">{lampLabel}</span>
            </div>
            {/* 多地块 Tab：动态渲染不限数量，超过容器宽度自动换行 */}
            {plots.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 bg-white/70 rounded-xl p-1 border border-green-100 max-w-full">
                {plots.map(p => (
                  <button
                    key={p.plot_code}
                    onClick={() => onChangePlot(p.plot_code)}
                    className={`px-2.5 py-1 text-[12px] rounded-lg font-medium transition-colors ${
                      activePlotCode === p.plot_code
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-green-100/60'
                    }`}
                  >
                    {p.plot_name || p.plot_code}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6 格 */}
      <div className={`p-5 transition-opacity ${overallDim ? 'opacity-80' : ''}`}>
        {loading && !active ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[118px] rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-10 text-sm text-red-500">{error}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {displaySix.map(s => {
              const Icon = ENV_ITEM_ICON[s.key] || Gauge;
              const bg = ENV_ITEM_BG[s.key] || 'from-gray-50 to-gray-100 text-gray-600';
              const spark = ENV_ITEM_SPARK[s.key] || '#64748b';
              const status = s.item?.status === 'warn' ? 'warn' : 'ok';
              const valueMissing = s.item == null || s.item.value == null;
              return (
                <motion.div
                  key={s.key}
                  whileHover={{ y: -2 }}
                  className={`relative rounded-2xl p-4 bg-gradient-to-br ${bg} border border-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.04)]`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center shadow-sm`}>
                        <Icon className="w-[18px] h-[18px]" />
                      </div>
                      <span className="text-[13px] font-medium text-gray-700">{s.label}</span>
                    </div>
                    {!valueMissing && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        status === 'warn'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {status === 'warn' ? '偏离' : '正常'}
                      </span>
                    )}
                    {valueMissing && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                        等待采集
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className={`text-[28px] font-bold tracking-tight ${valueMissing ? 'text-gray-400' : 'text-gray-800'}`}>
                      {fmtVal(s)}
                    </span>
                    <span className="text-[13px] text-gray-500 font-medium">{s.unit}</span>
                  </div>

                  <div className="mt-2">
                    <MiniSparkline6 data={Array.from(s.item?.history ?? [])} color={valueMissing ? '#cbd5e1' : spark} />
                  </div>

                  {typeof s.min_ok === 'number' && typeof s.max_ok === 'number' && (
                    <div className="mt-1 text-[10.5px] text-gray-500/90 font-medium">
                      推荐区间 {s.min_ok} ~ {s.max_ok} {s.unit}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* 底部：绑定地块 + 批次 + 查看历史 */}
        <div className="mt-4 flex items-center justify-between flex-wrap gap-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-gray-600">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-600" />
              绑定地块：<span className="font-semibold text-gray-800">{active?.plot_name ?? active?.plot_code ?? '—'}</span>
            </div>
            {active?.seed_batch_code ? (
              <div className="flex items-center gap-1.5">
                <Wheat className="w-4 h-4 text-primary-600" />
                当前批次：<span className="font-semibold text-gray-800">{active.seed_batch_code}</span>
                <span
                  className="inline-flex items-center gap-0.5 text-[10.5px] text-gray-400 cursor-help"
                  title="同一时刻该地块只种唯一一批种子（当前茬唯一绑定，保证数据溯源精准）；采收/换季之后，同一地块可以在不同种植季节轮作其它批次种子（历史批次存在多条种植记录）。"
                >
                  <Info className="w-3 h-3" />
                  每茬唯一·跨季可轮作
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-gray-400">
                <Wheat className="w-4 h-4" />
                <span>当前暂无正在种植的批次</span>
                <span
                  className="inline-flex items-center gap-0.5 text-[10.5px] cursor-help"
                  title="当前地块没有「生长中」状态的种植记录。可在种植管理页新建种植记录（选择地块 + 种子批次）后，此处会自动显示唯一绑定的在种批次。"
                >
                  <Info className="w-3 h-3" />
                </span>
              </div>
            )}
            {active?.location && (
              <div className="hidden md:flex items-center gap-1.5 text-gray-500">
                <span>位置：</span>{active.location}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/sensor?plot_code=${activePlotCode}`)}
              className="text-[13px] font-semibold inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow hover:from-emerald-600 hover:to-teal-700 transition-colors"
              title="跳转到传感器管理页查看完整分析 + 更大曲线图"
            >
              <Activity className="w-4 h-4" />
              查看更大曲线图
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTrend((v) => !v)}
              className={`text-[12.5px] font-medium inline-flex items-center gap-1 px-3 py-2 rounded-xl border transition-colors ${
                showTrend
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-gray-200 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50'
              }`}
            >
              {showTrend ? '收起下方曲线' : '展开实时曲线图'}
            </button>
          </div>
        </div>

        {/* 实时趋势曲线图（默认展开，WS 新数据即时追加） */}
        {showTrend && activePlotCode && (
          <div className="mt-5 rounded-2xl bg-gradient-to-br from-emerald-50/70 via-teal-50/40 to-green-50/60 border border-emerald-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow">
                  <TrendingUp className="w-[18px] h-[18px]" />
                </div>
                <div>
                  <h4 className="text-[15px] font-bold text-gray-800 leading-tight flex items-center gap-2">
                    实时趋势曲线图
                    <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-medium animate-pulse">
                      WS 实时更新
                    </span>
                  </h4>
                  <p className="text-[11.5px] text-gray-500 mt-0.5">
                    连接硬件后曲线自动向右延伸 · 鼠标悬停可查看精确到秒的时间点 + 每一项数值
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  硬件数据到达即更新
                </span>
                <span className="text-gray-300">·</span>
                <span>24 小时滑窗</span>
              </div>
            </div>
            <PlotHistoryMiniChart plotCode={activePlotCode} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function WelcomeBanner({ greeting, userName, userRole, stats }: { greeting: string; userName: string; userRole: string; stats: Stats }) {
  const navigate = useNavigate();
  const hour = new Date().getHours();
  let WeatherIcon = Sun;
  if (hour >= 18 || hour < 6) WeatherIcon = Moon;
  else if (hour >= 12 && hour < 18) WeatherIcon = CloudSun;

  const kpis = heroKpisByRole[userRole] || heroKpisByRole.admin;
  const gradient = bannerGradientByRole[userRole] || bannerGradientByRole.admin;
  const todoSum = (stats.todayOrders || 0) + (stats.pendingReviews || 0) + (stats.pendingOrders || 0) + (stats.alerts || 0) + (stats.overLimitCount || 0) - (stats.todayPendingOrderOverlap || 0);

  const kpiValue = (def: HeroKpiDef): string => {
    if (def.key === 'todoSum') return todoSum.toLocaleString('zh-CN');
    if (def.key === 'qualifiedReports' && userRole === 'inspector') {
      const rate = stats.reports > 0 ? Math.round(((stats.qualifiedReports || 0) * 100) / stats.reports) : 0;
      return `${rate}%`;
    }
    if (def.key === 'totalSalesAmount') {
      return `¥${(stats.totalSalesAmount || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
    }
    const v = stats[def.key as keyof Stats];
    return `${(v ?? 0).toLocaleString('zh-CN')}${def.suffix}`;
  };

  const roleMessages: Record<string, string> = {
    farmer: '今天也要好好照顾您的作物',
    inspector: '确保每一份检测报告都准确无误',
    warehouse_manager: '库存管理，安全第一',
    salesperson: '祝您今天订单满满',
    admin: '管理全局，掌控一切',
  };
  const suggestion = (suggestionByRole[userRole] || suggestionByRole.admin)(stats);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-br ${gradient} text-white shadow-2xl`}
    >
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-white/5 blur-2xl" />
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg">
              <WeatherIcon className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-white/80 text-sm font-medium">{greeting}</p>
              <h2 className="text-xl font-bold">{userName}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs font-medium">
              {roleLabelMap[userRole] || '成员'}
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" />
              {formatDateWithWeekdayCn(new Date())}
            </span>
          </div>
        </div>

        <h1 className="mt-5 text-2xl sm:text-3xl font-black tracking-tight">欢迎回到金生链</h1>
        <p className="mt-1.5 text-white/85 text-sm">{roleMessages[userRole] || '花生全产业链溯源平台，开始您的工作吧！'}</p>

        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[12px] text-white/90">
          <Sparkles className="w-3.5 h-3.5" />
          {suggestion}
        </div>

        <div className={`mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3 ${kpis.length >= 6 ? 'xl:grid-cols-6' : 'md:grid-cols-4'}`}>
          {kpis.map((def, i) => {
            const Icon = def.icon;
            return (
              <motion.button
                key={`${userRole}-${def.label}`}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                whileHover={{ y: -2, scale: 1.02 }}
                onClick={() => navigate(def.path)}
                className="group flex items-center gap-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-[18px] h-[18px] text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-white/70 truncate">{def.label}</p>
                  <p className="text-lg font-black tracking-tight tabular-nums leading-tight truncate">{kpiValue(def)}</p>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white/80 transition-colors flex-shrink-0" />
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function BlockchainHighlight({ connected, ipfsConnected, wsConnected, dbOnline, userRole, batchCode }: {
  connected: boolean;
  ipfsConnected: boolean;
  wsConnected: boolean;
  dbOnline: boolean;
  userRole: string;
  batchCode: string;
}) {
  const navigate = useNavigate();
  const chainPoints: Array<{ label: string; icon: any; color: string; path: string; roles: string[] }> = [
    { label: '种子采购', icon: Wheat, color: 'bg-green-100 text-green-600', path: '/seed', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
    { label: '种植记录', icon: Leaf, color: 'bg-emerald-100 text-emerald-600', path: '/planting', roles: ['admin', 'farmer'] },
    { label: '农药使用', icon: FlaskConical, color: 'bg-blue-100 text-blue-600', path: '/pesticide', roles: ['admin', 'farmer'] },
    { label: '检测报告', icon: FileText, color: 'bg-purple-100 text-purple-600', path: '/inspection', roles: ['admin', 'farmer', 'inspector'] },
    { label: '加工生产', icon: Factory, color: 'bg-orange-100 text-orange-600', path: '/processing', roles: ['admin', 'warehouse_manager'] },
    { label: '成品入库', icon: Package, color: 'bg-cyan-100 text-cyan-600', path: '/inventory', roles: ['admin', 'warehouse_manager'] },
    { label: '物流发货', icon: Truck, color: 'bg-indigo-100 text-indigo-600', path: '/sales', roles: ['admin', 'warehouse_manager', 'salesperson'] },
    { label: '终端销售', icon: ShoppingCart, color: 'bg-pink-100 text-pink-600', path: '/sales', roles: ['admin', 'warehouse_manager', 'salesperson'] },
    { label: '环境数据', icon: Activity, color: 'bg-teal-100 text-teal-600', path: '/sensor', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
    { label: '溯源验证', icon: Shield, color: 'bg-red-100 text-red-600', path: '/trace', roles: ['admin', 'farmer', 'inspector', 'warehouse_manager', 'salesperson'] },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-700 p-6 sm:p-8 text-white shadow-2xl"
    >
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-white/5 blur-2xl" />
      <div className="relative z-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-6 h-6 text-blue-200" />
              <h3 className="text-xl sm:text-2xl font-bold">区块链全链路存证</h3>
              <span className="px-2.5 py-1 bg-white/15 backdrop-blur-sm rounded-full text-xs font-semibold">10 个上链点</span>
            </div>
            <p className="text-blue-100 text-sm">从种子到货架，全流程数据上链，不可篡改、可追溯</p>
            {batchCode && (
              <p className="mt-1 text-blue-200/90 text-[12px]">
                最近上链批次：<span className="font-mono font-semibold text-white/90">{batchCode}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-sm ${connected ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-xs font-semibold">{connected ? '链节点在线' : '链节点离线'}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-sm ${ipfsConnected ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <Boxes className="w-3.5 h-3.5 text-blue-200" />
              <span className="text-xs font-semibold">{ipfsConnected ? 'IPFS在线' : 'IPFS离线'}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-sm ${wsConnected ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <Wifi className="w-3.5 h-3.5 text-blue-200" />
              <span className="text-xs font-semibold">{wsConnected ? '实时同步' : '离线'}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-sm ${dbOnline ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <Database className="w-3.5 h-3.5 text-blue-200" />
              <span className="text-xs font-semibold">{dbOnline ? '数据库在线' : '数据库异常'}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
          {chainPoints.map((point, index) => {
            const Icon = point.icon;
            const allowed = point.roles.includes(userRole);
            return (
              <motion.button
                key={point.label}
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={allowed ? { y: -2, scale: 1.05 } : {}}
                onClick={() => allowed && navigate(point.path)}
                disabled={!allowed}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                  allowed
                    ? 'bg-white/10 backdrop-blur-sm border-white/10 hover:bg-white/15 cursor-pointer'
                    : 'bg-white/5 border-white/5 opacity-40 cursor-not-allowed'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg ${point.color} flex items-center justify-center`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[11px] text-center text-blue-50 font-medium">{point.label}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/trace')}
            className="flex items-center gap-2 px-5 py-2.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl text-sm font-medium transition-all"
          >
            <Search className="w-4 h-4" />
            查看溯源链路
          </motion.button>
          {!dbOnline && (
            <span className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-400/30 text-xs font-medium">
              <Server className="w-4 h-4" />
              数据库连接异常，部分数据可能延迟
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function QuickAction({ label, sub, icon, path, color, external }: { label: string; sub?: string; icon: any; path: string; color: string; external?: boolean }) {
  const navigate = useNavigate();
  const IconComp = icon;
  const handleClick = () => {
    if (external) window.open(path, '_blank', 'noopener,noreferrer');
    else navigate(path);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="group flex items-center gap-3 w-full p-4 rounded-2xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all duration-200 text-left"
    >
      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center flex-shrink-0 shadow-md group-hover:scale-105 transition-transform`}>
        <IconComp className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-gray-700 group-hover:text-gray-900 truncate">{label}</p>
        {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
      </div>
      {external && <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />}
    </button>
  );
}

function StatCard({ icon, label, value, color, path }: { icon: React.ReactNode; label: string; value: number; color: string; path?: string }) {
  const colors = colorMap[color] || colorMap.blue;
  const navigate = useNavigate();
  const isClickable = !!path;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -4, scale: 1.02 } : {}}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      onClick={() => isClickable && navigate(path!)}
      className={`${colors.bg} rounded-2xl p-5 border border-gray-100 shadow-sm transition-all duration-300 ${isClickable ? 'cursor-pointer hover:shadow-xl' : ''}`}
    >
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center mb-4 shadow-md shadow-gray-200`}>
        <div className="text-white">{icon}</div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-gray-500 text-sm font-medium mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-800">{value}</p>
        </div>
        {isClickable && <ArrowUpRight className="w-5 h-5 text-gray-400" />}
      </div>
    </motion.div>
  );
}

function RecentOperations({ todayTodo, todayOrders, todayInbound, todayAlerts }: { todayTodo: number; todayOrders: number; todayInbound: number; todayAlerts: number }) {
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOperations = async () => {
      try {
        setLoading(true);
        const res = await operationsApi.getRecentOperations({ page_size: 6 });
        const list = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        setOperations(list);
      } catch {
        setOperations([]);
      } finally {
        setLoading(false);
      }
    };
    fetchOperations();
    const interval = setInterval(fetchOperations, 30000);
    return () => clearInterval(interval);
  }, []);

  const iconMap: Record<string, any> = { Package, ShoppingCart, FileText, Wheat, Leaf, FlaskConical, Factory, Truck };
  const summary = [
    { label: '今日待办', value: todayTodo, icon: ClipboardList, color: 'from-blue-400 to-indigo-500' },
    { label: '今日订单', value: todayOrders, icon: ShoppingCart, color: 'from-rose-400 to-pink-500' },
    { label: '入库品类', value: todayInbound, icon: Package, color: 'from-cyan-400 to-sky-500' },
    { label: '库存预警', value: todayAlerts, icon: AlertTriangle, color: 'from-orange-400 to-red-500' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary-600" />
          最近动态
        </h3>
        <span className="text-xs text-gray-400">实时更新</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {summary.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-2.5 p-3 rounded-xl bg-gray-50/80 border border-gray-100">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-gray-500 truncate">{s.label}</p>
                <p className="text-lg font-bold text-gray-800 leading-tight tabular-nums">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-4">
        {loading ? (
          [...Array(4)].map((_, index) => (
            <div key={index} className="flex items-center gap-4 p-3 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-1/2 animate-pulse" />
                <div className="h-3 bg-gray-100 rounded w-1/3 animate-pulse" />
              </div>
            </div>
          ))
        ) : operations.length > 0 ? (
          operations.map((op, index) => {
            const Icon = iconMap[op.icon] || FileText;
            const colors = colorMap[op.color] || colorMap.blue;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ x: 4 }}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-all duration-200"
              >
                <div className={`w-10 h-10 rounded-lg ${colors.iconBg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${colors.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{op.action}</p>
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

function RoleWorkflowCard({ userRole }: { userRole: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const config: Record<string, { title: string; sub: string; icon: any; color: string; path: string; emptyText: string }> = {
    farmer: { title: '农事动态', sub: '最近农事活动记录', icon: Leaf, color: 'from-emerald-500 to-teal-600', path: '/planting', emptyText: '暂无农事记录' },
    inspector: { title: '待审报告', sub: '需要您审核的检测报告', icon: FileCheck, color: 'from-indigo-500 to-violet-600', path: '/inspection', emptyText: '暂无待审报告' },
    warehouse_manager: { title: '出入库待办', sub: '最新库存流转记录', icon: Package, color: 'from-cyan-500 to-sky-600', path: '/inventory', emptyText: '暂无出入库记录' },
    salesperson: { title: '今日订单', sub: '最近创建的销售订单', icon: ShoppingCart, color: 'from-rose-500 to-pink-600', path: '/sales', emptyText: '今日暂无订单' },
    admin: { title: '全链路卡点', sub: '各环节最新业务动态', icon: Activity, color: 'from-violet-500 to-purple-600', path: '/', emptyText: '暂无动态' },
  };
  const cfg = config[userRole] || config.admin;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let list: any[] = [];
        if (userRole === 'farmer') {
          const res = await plantingApi.getFarmingActivities({ page_size: 5 });
          list = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        } else if (userRole === 'inspector') {
          const res = await inspectionApi.getReports({ page_size: 5 });
          list = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        } else if (userRole === 'warehouse_manager') {
          const res = await inventoryApi.getTransactions({ page_size: 5 });
          list = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        } else if (userRole === 'salesperson') {
          const res = await salesApi.getOrders({ page_size: 5 });
          list = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        } else {
          const res = await operationsApi.getRecentOperations({ page_size: 5 });
          list = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        }
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [userRole]);

  const fieldName = (item: any) => {
    if (userRole === 'farmer') return item.activity_type || item.plot_name || item.description || '农事活动';
    if (userRole === 'inspector') return item.report_code || item.batch_code || item.sample_name || '检测报告';
    if (userRole === 'warehouse_manager') return item.item_name || item.transaction_type || '库存记录';
    if (userRole === 'salesperson') return item.order_code || item.customer_name || '销售订单';
    return item.action || item.description || '业务动态';
  };
  const fieldTime = (item: any) => item.time_str || item.created_at || item.record_time || item.updated_at || '';
  const IconComp = cfg.icon;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.color} flex items-center justify-center shadow-md`}>
            <IconComp className="w-[18px] h-[18px] text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-gray-800 leading-tight">{cfg.title}</h3>
            <p className="text-[11.5px] text-gray-400">{cfg.sub}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(cfg.path)}
          className="text-[12px] font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
        >
          查看全部
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl">
              <div className="w-9 h-9 rounded-lg bg-gray-100 animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-gray-100 rounded w-1/2 animate-pulse" />
                <div className="h-3 bg-gray-100 rounded w-1/3 animate-pulse" />
              </div>
            </div>
          ))
        ) : items.length > 0 ? (
          items.map((item, i) => (
            <motion.button
              key={i}
              type="button"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ x: 3 }}
              onClick={() => navigate(cfg.path)}
              className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${cfg.color} flex items-center justify-center flex-shrink-0`}>
                <IconComp className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-700 truncate">{fieldName(item)}</p>
                {fieldTime(item) && <p className="text-[11px] text-gray-400">{formatRelativeCn(fieldTime(item))}</p>}
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            </motion.button>
          ))
        ) : (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p className="text-gray-500 font-medium text-sm">{cfg.emptyText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TodoAlertCard({ stats, userRole, inventoryAlerts }: { stats: Stats; userRole: string; inventoryAlerts: any[] }) {
  const navigate = useNavigate();
  const defs: Array<{ label: string; value: number; icon: any; color: string; path: string; roles: string[] }> = [
    { label: '今日订单', value: stats.todayOrders || 0, icon: ShoppingCart, color: 'from-rose-400 to-pink-500', path: '/sales', roles: ['admin', 'warehouse_manager', 'salesperson'] },
    { label: '待审核', value: stats.pendingReviews || 0, icon: FileCheck, color: 'from-indigo-400 to-violet-500', path: '/inspection', roles: ['admin', 'farmer', 'inspector'] },
    { label: '待发货', value: stats.pendingOrders || 0, icon: Truck, color: 'from-amber-400 to-orange-500', path: '/sales', roles: ['admin', 'warehouse_manager', 'salesperson'] },
    { label: '超限数据', value: stats.overLimitCount || 0, icon: AlertTriangle, color: 'from-red-400 to-rose-500', path: '/inspection', roles: ['admin', 'farmer', 'inspector'] },
  ];
  const visibleDefs = defs.filter((d) => d.roles.includes(userRole));
  const firstAction = visibleDefs.find((d) => d.value > 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          待办 & 预警
        </h3>
        {firstAction ? (
          <button
            type="button"
            onClick={() => navigate(firstAction.path)}
            className="text-[11.5px] font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
          >
            点击跳转处理
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-[11.5px] text-gray-400">暂无待办</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {visibleDefs.map((d) => {
          const Icon = d.icon;
          return (
            <motion.button
              key={d.label}
              type="button"
              whileHover={{ y: -2 }}
              onClick={() => d.value > 0 && navigate(d.path)}
              className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all ${
                d.value > 0
                  ? 'bg-gray-50/80 border-gray-100 hover:border-gray-200 hover:shadow-md'
                  : 'bg-gray-50/40 border-gray-50 opacity-60'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${d.color} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[11px] text-gray-500 truncate">{d.label}</p>
                <p className="text-lg font-bold text-gray-800 leading-tight tabular-nums">{d.value}</p>
              </div>
            </motion.button>
          );
        })}
      </div>

      {['admin', 'warehouse_manager'].includes(userRole) && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5">
              <Package className="w-4 h-4 text-orange-500" />
              库存预警
            </h4>
            <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-[11px] font-semibold rounded-full">
              {inventoryAlerts.length} 条
            </span>
          </div>
          <div className="space-y-2">
            {inventoryAlerts.length > 0 ? (
              inventoryAlerts.map((alert, index) => {
                const threshold = alert.threshold ?? alert.min_stock ?? alert.max_stock ?? 0;
                const unit = alert.unit || 'kg';
                return (
                  <motion.button
                    key={index}
                    type="button"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ x: 3 }}
                    onClick={() => navigate('/inventory')}
                    className="flex items-center gap-3 w-full p-3 rounded-xl bg-orange-50/70 border border-orange-100 hover:border-orange-200 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold text-gray-800 truncate">{alert.item_name}</p>
                      <p className="text-[11px] text-gray-500">
                        当前 <span className="text-orange-600 font-medium">{alert.current_stock} {unit}</span> · 阈值 {threshold} {unit}
                      </p>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-orange-300 flex-shrink-0" />
                  </motion.button>
                );
              })
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
                <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <p className="text-[12px] text-gray-600">库存状态良好，无需补货</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
    sensors: 0,
  });
  const [inventoryAlerts, setInventoryAlerts] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [userName, setUserName] = useState<string>('用户');
  const [blockchainConnected, setBlockchainConnected] = useState(false);
  const [ipfsConnected, setIpfsConnected] = useState(false);
  const [dbOnline, setDbOnline] = useState(false);
  const [traceBatchCode, setTraceBatchCode] = useState('');
  const [activePlotCode, setActivePlotCode] = useState('');
  const [envVersion, setEnvVersion] = useState(0);
  const [dashboardEnv, setDashboardEnv] = useState<{ schema: any[]; plots: any[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const envFetcherRef = useRef<(() => Promise<void>) | null>(null);
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
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      // 新测量/检测数据推送：同步溯源批次与实时环境卡刷新
      wsRef.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.seed_batch_code) {
            setTraceBatchCode(msg.seed_batch_code);
          }
          if (msg?.plot_code) {
            setActivePlotCode(msg.plot_code);
          }
          setEnvVersion((v) => v + 1);
        } catch {
          // 非 JSON 消息（心跳/占位），忽略
        }
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
        // 统一走共享角色解析，与 App/Layout 权限判断保持一致
        const role = resolveUserRole(profileRes.data);
        setUserRole(role);
        setUserName(profileRes.data.username || '用户');

        const fetchAlertsIfAllowed = async (allowedRoles: string[]) => {
          if (!role || !allowedRoles.includes(role)) return { data: [] };
          try {
            return await inventoryApi.getAlerts();
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
          sensors: statsData.onlineSensors || statsData.sensors || 0,
          onlineSensors: statsData.onlineSensors || statsData.sensors || 0,
          totalSensors: statsData.totalSensors || 0,
          todayPendingOrderOverlap: statsData.todayPendingOrderOverlap || 0,
          totalSalesAmount: statsData.totalSalesAmount || 0,
          inspectionPassRate: statsData.inspectionPassRate || 0,
        });

        setInventoryAlerts(alerts.slice(0, 5));

        // 统计接口成功即代表数据库可读，作为 DB 在线依据
        setDbOnline(true);

        try {
          const bcRes = await blockchainApi.getConnectionStatus();
          setBlockchainConnected(bcRes.data.blockchain?.connected || false);
          setIpfsConnected(bcRes.data.ipfs?.connected || false);
        } catch {
          setBlockchainConnected(false);
          setIpfsConnected(false);
        }

        // 默认溯源批次取最近一条种子批次
        try {
          const batchRes = await seedApi.getBatches({ page: 1, page_size: 1 });
          const batchList = batchRes.data?.data || batchRes.data || [];
          if (batchList.length) {
            setTraceBatchCode(batchList[0].batch_code || '');
          }
        } catch {
          // 无权限或接口异常时保持空批次，不阻断首页
        }
      } catch (err) {
        console.error('Dashboard data fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    connectWebSocket();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
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

  return <div className="space-y-5">
    {/* Welcome Banner：问候 + 业务概览 KPI */}
    <WelcomeBanner
      greeting={greeting}
      userName={userName}
      userRole={userRole}
      stats={stats}
    />

    {/* 区块链存证（链/IPFS/WS/DB 状态 + 上链入口） */}
    <BlockchainHighlight
      connected={blockchainConnected}
      ipfsConnected={ipfsConnected}
      wsConnected={wsConnected}
      dbOnline={dbOnline}
      userRole={userRole}
      batchCode={traceBatchCode}
    />

    {/* 实时 6 项环境监测（WS 实时刷新 + 12 秒兜底，下方默认展开趋势曲线图） */}
    <div>
      <RealTimeEnvCard
        wsConnected={wsConnected}
        envVersion={envVersion}
        activePlotCode={activePlotCode}
        onPlotsLoaded={(plots) => {
          if (!activePlotCode && plots.length) {
            setActivePlotCode(plots[0].plot_code);
          }
        }}
        onChangePlot={setActivePlotCode}
        fetcherRef={envFetcherRef}
        envHolder={{ value: dashboardEnv, set: setDashboardEnv }}
      />
    </div>

    {/* 常用操作入口（8 项，2 行 × 4 列） */}
    <div className="relative overflow-hidden rounded-3xl border border-gray-100/80 bg-white/90 backdrop-blur-sm p-5 sm:p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)]">
      {/* 右上角装饰光晕 */}
      <div className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary-200/25 blur-3xl" />
      <div className="relative flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-gray-800 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-md shadow-primary-200/60 ring-1 ring-white/40">
            <Zap className="w-[16px] h-[16px] text-white" />
          </span>
          常用操作
          <span className="text-[11px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full ring-1 ring-primary-100">{currentShortcuts.length}</span>
        </h3>
        <span className="text-[11px] text-gray-400 hidden sm:block">
          不与左侧导航重复，侧重 <span className="text-green-600 font-semibold">新建 / 录入 / 扫码</span> 类高频动作
        </span>
      </div>
      {/* 4 列网格：8 项正好 2 行 × 4 列 */}
      <div className="relative grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {currentShortcuts.map((shortcut, index) => (
          <motion.div
            key={`${shortcut.label}-${shortcut.path}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.04 }}
          >
            <QuickAction
              label={shortcut.label}
              sub={shortcut.sub}
              icon={shortcut.icon}
              path={shortcut.path}
              color={shortcut.color}
              external={shortcut.external}
            />
          </motion.div>
        ))}
      </div>
    </div>

    {/* 角色专属工作流区块
       · farmer：农事动态  · inspector：待审报告
       · warehouse_manager：出入库待办  · salesperson：今日订单
       · admin：全链路卡点 */}
    <RoleWorkflowCard userRole={userRole} />

    {/* 布局：统计卡/最近动态（左 2/3）+ 待办 & 预警（右 1/3） */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* ---- 左列 ---- */}
      {currentStats.length > 0 ? (
        /* 非 admin：左 2/3 角色统计卡 */
        <div className="lg:col-span-2 min-w-0">
          <div
            className={`grid grid-cols-1 gap-5 ${
              currentStats.length === 1
                ? 'sm:grid-cols-1'
                : currentStats.length === 2
                  ? 'sm:grid-cols-2'
                  : 'sm:grid-cols-2 xl:grid-cols-3'
            }`}
          >
            {currentStats.map((item, index) => {
              const Icon = item.icon;
              const statValue = stats[item.key];
              return (
                <motion.div
                  key={`${item.key}-${item.label}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="min-w-0"
                >
                  <StatCard
                    icon={<Icon className="w-6 h-6" />}
                    label={item.label}
                    value={statValue ?? 0}
                    color={item.color}
                    path={item.path}
                  />
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        /* admin：左 2/3 最近动态 + 今日统计 */
        <div className="lg:col-span-2 min-w-0">
          <RecentOperations
            todayTodo={
              (stats.todayOrders || 0) +
              (stats.pendingReviews || 0) +
              (stats.pendingOrders || 0) +
              (stats.overLimitCount || 0)
            }
            todayOrders={stats.todayOrders || 0}
            todayInbound={stats.inventoryItems || 0}
            todayAlerts={stats.alerts || 0}
          />
        </div>
      )}

      {/* 右列（1/3）：待办 & 预警 */}
      <div className="lg:col-span-1 min-w-0">
        <TodoAlertCard stats={stats} userRole={userRole} inventoryAlerts={inventoryAlerts} />
      </div>
    </div>
  </div>;
}
