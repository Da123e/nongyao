import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Wheat, Leaf, FlaskConical, FileText, Factory, Package, ShoppingCart, CheckCircle, Download, ChevronRight, AlertCircle, Camera, X, Upload, QrCode, Sparkles } from 'lucide-react';
import { api, inspectionApi } from '../services/api';
import { getCurrentUserRole, canExportTracePdf } from '../utils/roles';
import jsqr from 'jsqr';

// 浏览器原生 BarcodeDetector 的 TS 声明（Chrome / Edge / Safari 17.4+ 原生支持）
declare global {
  interface Window {
    BarcodeDetector?: any;
  }
}

interface TraceData {
  seed_batch: {
    batch_code: string;
    variety_name: string;
    breeding_base: string;
    production_date: string;
    net_weight: number;
    germination_rate: number;
    purity: number;
    supplier: string;
    status: string;
  };
  planting: Array<{
    plot_code: string;
    plot_name: string;
    location: string;
    planting_date: string;
    expected_harvest_date: string;
    farmer: string;
    status: string;
    farming_activities?: Array<{
      activity_type: string;
      activity_date: string;
      description: string;
    }>;
    environmental_data?: Array<{
      record_time: string;
      temperature: number | null;
      humidity: number | null;
      soil_moisture: number | null;
      soil_temperature?: number | null;
      ph_value: number | null;
      conductivity?: number | null;
      nitrogen?: number | null;
      phosphorus?: number | null;
      potassium?: number | null;
      salinity?: number | null;
      illumination?: number | null;
      wind_speed?: number | null;
      data_source?: string | null;
    }>;
  }>;
  pesticide_applications: Array<{
    pesticide_name: string;
    brand: string;
    registration_no: string;
    application_date: string;
    dosage: number;
    unit: string;
    applicator: string;
    safety_interval_end: string;
    is_compliant: boolean;
  }>;
  inspections: Array<{
    report_code: string;
    report_type: string;
    report_date: string;
    inspector: string;
    inspection_agency: string;
    is_qualified: boolean;
    pesticide_residues?: Array<{
      test_item: string;
      limit_value: number;
      measured_value: number;
      unit: string;
      is_over_limit: boolean;
    }>;
  }>;
  processing: Array<{
    batch_code: string;
    product_name: string;
    product_grade: string;
    processing_date: string;
    status: string;
    process_records?: Array<{
      process_name: string;
      process_order: number;
      start_time: string;
      end_time: string;
      parameters: string;
      operator: string;
    }>;
  }>;
  inventory: Array<{
    item_code: string;
    item_name: string;
    quantity: number;
    unit: string;
    status: string;
  }>;
  sales: Array<{
    order_no: string;
    item_name: string;
    quantity: number;
    unit: string;
    unit_price: number;
    order_date: string;
    status: string;
  }>;
}

export function TraceQuery({ publicMode = false }: { publicMode?: boolean }) {
  const [batchCode, setBatchCode] = useState('');
  const [traceData, setTraceData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  // 公开扫码页：不看 role，直接走公开接口，展示默认全 7 个阶段
  const userRole = publicMode ? '' : getCurrentUserRole();

  // ===== 扫码相关：相机扫码 + 相册二维码 =====
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanHint, setScanHint] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);
  const scanClosedRef = useRef(false);

  const stopScan = () => {
    scanClosedRef.current = true;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      // eslint-disable-next-line no-param-reassign
      videoRef.current.srcObject = null;
    }
  };

  const parseQrFromImage = async (file: File): Promise<string | null> => {
    // 优先尝试浏览器原生 BarcodeDetector
    if (typeof window.BarcodeDetector !== 'undefined') {
      try {
        const detector = detectorRef.current || new window.BarcodeDetector({ formats: ['qr_code'] });
        detectorRef.current = detector;
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        (bitmap as any)?.close?.();
        if (codes && codes.length > 0 && codes[0]?.rawValue) return codes[0].rawValue;
      } catch {
        // 忽略，降级到 jsqr
      }
    }
    // jsqr 降级：纯 JS 解码，任何浏览器都可用
    try {
      const img = await loadImage(file);
      const canvas = document.createElement('canvas');
      const maxW = 800;
      const scale = img.width > maxW ? maxW / img.width : 1;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsqr(imageData.data, imageData.width, imageData.height);
      if (code && code.data) return code.data;
    } catch {
      // 忽略
    }
    return null;
  };

  // 把 File 加载为 HTMLImageElement
  const loadImage = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };
      img.src = url;
    });
  };

  // 从二维码 rawValue 中提取批次号：支持纯批次号、或 URL 带 ?batch=PB2026-001
  const extractBatchCode = (raw: string): string => {
    if (!raw) return '';
    const t = raw.trim();
    // 形如 /trace/public?batch=PB2026-001 或 https://xx/trace?batch=PB2026-001
    const match = t.match(/[?&]batch=([^&#\s]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);
    // 最后尝试：取 6 位以上字母数字的批次编号（如 PB2026-001）
    const m2 = t.match(/([A-Z]{1,4}\d{4}[-_]?\d{2,5})/);
    if (m2 && m2[1]) return m2[1].replace(/_/g, '-');
    return t;
  };

  const onScanSuccess = (raw: string) => {
    const code = extractBatchCode(raw);
    stopScan();
    setScanOpen(false);
    if (code) {
      setBatchCode(code);
      setSearchParams(prev => {
        prev.set('batch', code);
        return prev;
      });
      handleSearch(code);
    } else {
      setError('扫码未识别到有效的批次编号');
    }
  };

  const startScan = async () => {
    setScanOpen(true);
    setScanError('');
    setScanHint('正在请求相机权限，请允许访问后置摄像头…');
    scanClosedRef.current = false;
    // 下一帧等 DOM video 挂好再启动
    setTimeout(async () => {
      if (scanClosedRef.current) return;
      try {
        // 前置校验：非 HTTPS / 微信内置浏览器 / 无权限等场景 mediaDevices 可能不存在
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          throw new Error(
            '当前浏览器环境不支持直接调用相机，请改为「从相册上传二维码」或手动输入批次号'
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const hasNativeDetector = typeof window.BarcodeDetector !== 'undefined';
        setScanHint(hasNativeDetector
          ? '请将二维码对准取景框，系统会自动识别（原生加速）'
          : '请将二维码对准取景框，系统会自动识别');

        const detector = hasNativeDetector
          ? new window.BarcodeDetector({ formats: ['qr_code'] })
          : null;
        detectorRef.current = detector;

        // 用于 jsqr 的离屏 canvas
        const scanCanvas = document.createElement('canvas');
        const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

        const tick = async () => {
          if (scanClosedRef.current) return;
          try {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              // 路径 1: 原生 BarcodeDetector
              if (detector) {
                const codes = await detector.detect(videoRef.current);
                if (codes && codes.length > 0 && codes[0]?.rawValue) {
                  onScanSuccess(codes[0].rawValue);
                  return;
                }
              }
              // 路径 2: jsqr 纯 JS 解码（Edge / 所有浏览器通用）
              if (scanCtx) {
                const w = videoRef.current.videoWidth;
                const h = videoRef.current.videoHeight;
                if (w > 0 && h > 0) {
                  // 缩小到合理尺寸加速解码
                  const targetW = 480;
                  const scale = w > targetW ? targetW / w : 1;
                  scanCanvas.width = w * scale;
                  scanCanvas.height = h * scale;
                  scanCtx.drawImage(videoRef.current, 0, 0, scanCanvas.width, scanCanvas.height);
                  const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
                  const code = jsqr(imageData.data, imageData.width, imageData.height);
                  if (code && code.data) {
                    onScanSuccess(code.data);
                    return;
                  }
                }
              }
            }
          } catch {
            // 忽略单帧识别错误
          }
          if (!scanClosedRef.current) {
            rafRef.current = requestAnimationFrame(tick);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setScanError(e?.name === 'NotAllowedError' ? '您拒绝了相机权限，请改为「从相册上传二维码」或手动输入批次号'
          : e?.name === 'NotFoundError' ? '当前设备没有可用摄像头，请从相册上传二维码或手动输入'
          : '相机启动失败：' + (e?.message || '未知错误'));
        setScanHint('');
      }
    }, 80);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setScanError('');
    setScanHint('正在解析二维码图片…');
    const raw = await parseQrFromImage(f);
    if (raw) {
      onScanSuccess(raw);
    } else {
      setScanError('未能识别二维码，请确保图片清晰或手动输入批次号');
      setScanHint('');
    }
    // 重置 input 允许再次选同一张
    e.target.value = '';
  };


  const roleStages: Record<string, string[]> = {
    admin: ['seed', 'planting', 'pesticide', 'inspection', 'processing', 'inventory', 'sales'],
    farmer: ['seed', 'planting', 'pesticide', 'inspection', 'processing', 'inventory', 'sales'],
    inspector: ['seed', 'planting', 'pesticide', 'inspection', 'processing', 'inventory', 'sales'],
    warehouse_manager: ['seed', 'planting', 'pesticide', 'inspection', 'processing', 'inventory', 'sales'],
    salesperson: ['seed', 'planting', 'pesticide', 'inspection', 'processing', 'inventory', 'sales'],
  };

  const visibleStages = publicMode
    ? roleStages.admin
    : roleStages[userRole || 'admin'] || roleStages.admin;

  const stageConfig: Record<string, { label: string; icon: any; color: string; bg: string }> = {
    seed: { label: '种子溯源', icon: Wheat, color: 'text-green-600', bg: 'bg-green-500' },
    planting: { label: '种植管理', icon: Leaf, color: 'text-emerald-600', bg: 'bg-emerald-500' },
    pesticide: { label: '农药使用', icon: FlaskConical, color: 'text-blue-600', bg: 'bg-blue-500' },
    inspection: { label: '检测报告', icon: FileText, color: 'text-purple-600', bg: 'bg-purple-500' },
    processing: { label: '加工生产', icon: Factory, color: 'text-orange-600', bg: 'bg-orange-500' },
    inventory: { label: '仓储物流', icon: Package, color: 'text-cyan-600', bg: 'bg-cyan-500' },
    sales: { label: '终端销售', icon: ShoppingCart, color: 'text-pink-600', bg: 'bg-pink-500' },
  };

  const hasStageData = (key: string): boolean => {
    if (!traceData) return false;
    switch (key) {
      case 'seed': return !!traceData.seed_batch;
      case 'planting': return traceData.planting?.length > 0;
      case 'pesticide': return traceData.pesticide_applications?.length > 0;
      case 'inspection': return traceData.inspections?.length > 0;
      case 'processing': return traceData.processing?.length > 0;
      case 'inventory': return traceData.inventory?.length > 0;
      case 'sales': return traceData.sales?.length > 0;
      default: return false;
    }
  };

  const handleSearch = async (codeOverride?: string) => {
    const searchCode = codeOverride || batchCode;
    if (!searchCode.trim()) {
      setError('请输入批次编号');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const endpoint = userRole ? `/sales/trace/${searchCode.trim()}` : `/sales/public/trace/${searchCode.trim()}`;
      const res = await api.get(endpoint);
      setTraceData(res.data);
    } catch (err: any) {
      console.error('Failed to fetch trace data:', err);
      setError('查询失败，请检查批次编号或稍后重试');
      setTraceData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const urlBatch = searchParams.get('batch');
    if (urlBatch) {
      setBatchCode(urlBatch);
      handleSearch(urlBatch);
    }
    return () => stopScan();  // 离开页面时保证摄像头关闭
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const downloadTracePdf = async () => {
    if (!batchCode.trim() || !traceData) return;
    
    setPdfLoading(true);
    try {
      const response = await inspectionApi.exportTracePdf(batchCode.trim());
      
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${batchCode}_质量追溯报告.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download PDF:', err);
      alert('PDF下载失败，请重试');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case '合格':
      case '合规':
        return 'bg-green-100 text-green-800';
      case 'pending':
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
      case '不合格':
      case '不合规':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div
      className={`min-h-screen ${
        publicMode
          ? 'bg-gradient-to-br from-green-50 via-white to-emerald-50'
          : 'bg-gradient-to-br from-primary-50/30 via-white to-blue-50/30'
      }`}
    >
      {/* 顶部：消费者扫码公开页（publicMode）→ 固定独立品牌头，不进任何管理员导航 */}
      {publicMode && (
        <header className="bg-white/85 backdrop-blur-md border-b border-green-100 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-md">
                <Wheat className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-800 text-lg">金生链 · 消费者溯源<span className="ml-2 align-middle inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 text-white text-[10px] font-semibold shadow-sm"><QrCode className="w-3 h-3" />扫码端</span></h1>
                <p className="text-xs text-gray-500">相机扫码 · 相册识别 · 手动输入 — 三种方式查询从种子到餐桌全链信息</p>
              </div>
            </div>
            <Link
              to="/login"
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              平台登录
            </Link>
          </div>
        </header>
      )}
      {/* 管理员端（在 Layout 侧栏内部打开 /trace 时不显示品牌头，避免与管理员 Logo 重复） */}
      {!publicMode && !userRole && (
        <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <Link to="/trace" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-md">
                <Wheat className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-800 text-lg">金生链</h1>
                <p className="text-xs text-gray-500">花生全产业链溯源平台</p>
              </div>
            </Link>
            <Link
              to="/login"
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              管理员登录
            </Link>
          </div>
        </header>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* ===== 扫码查询 Modal ===== */}
      {scanOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between bg-gradient-to-r from-green-500 to-emerald-600 text-white">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                <h3 className="text-base font-bold">扫码识别批次</h3>
              </div>
              <button
                type="button"
                onClick={() => { stopScan(); setScanOpen(false); }}
                className="p-1.5 rounded-lg hover:bg-white/15 transition-colors"
                aria-label="关闭扫码"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="relative aspect-square w-full max-w-sm mx-auto bg-gray-900 rounded-xl overflow-hidden">
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover"
                  playsInline
                  muted
                />
                {/* 取景框辅助线 */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3/5 h-3/5 border-2 border-white/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                    <div className="absolute -top-[3px] -left-[3px] w-6 h-6 border-t-4 border-l-4 border-green-400 rounded-tl-xl" />
                    <div className="absolute -top-[3px] -right-[3px] w-6 h-6 border-t-4 border-r-4 border-green-400 rounded-tr-xl" />
                    <div className="absolute -bottom-[3px] -left-[3px] w-6 h-6 border-b-4 border-l-4 border-green-400 rounded-bl-xl" />
                    <div className="absolute -bottom-[3px] -right-[3px] w-6 h-6 border-b-4 border-r-4 border-green-400 rounded-br-xl" />
                  </div>
                </div>
              </div>
              {scanHint && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 text-green-700 text-sm">
                  <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{scanHint}</span>
                </div>
              )}
              {scanError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{scanError}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer text-sm font-semibold transition-colors">
                  <Upload className="w-4 h-4" />
                  从相册上传二维码
                  <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                </label>
                <button
                  type="button"
                  onClick={() => { stopScan(); setScanOpen(false); }}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold transition-colors"
                >
                  改为手动输入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-700 rounded-full flex items-center justify-center mx-auto mb-6">
          <Search className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">金生链 · 花生全产业链溯源查询</h2>
        <p className="text-gray-500 mb-6">
          {publicMode
            ? <>相机扫码 / 相册上传 / 手动输入批次号，三选一即可查询区块链全链路信息</>
            : <>输入种子批次编号，查询从种子到销售的完整区块链溯源信息</>}
        </p>
        
        {publicMode && (
          <div className="max-w-lg mx-auto mb-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={startScan}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:brightness-110 shadow-lg shadow-indigo-500/25 font-semibold transition-all"
            >
              <Camera className="w-5 h-5" />
              相机扫码查询
            </button>
            <label className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-600 text-white hover:brightness-110 shadow-lg shadow-sky-500/20 font-semibold cursor-pointer transition-all">
              <Upload className="w-5 h-5" />
              相册扫码上传
              <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            </label>
          </div>
        )}

        <div className="flex gap-3 max-w-2xl mx-auto flex-wrap justify-center">
          <input
            type="text"
            value={batchCode}
            onChange={(e) => setBatchCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入批次编号，如 PB2026-001"
            className="flex-1 min-w-[200px] px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
          >
            {loading ? '查询中...' : '查询'}
          </button>
        </div>

        {error && (
          <p className="mt-4 text-red-500">{error}</p>
        )}
      </div>

      {!traceData && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
          <h3 className="text-lg font-semibold text-gray-800 text-center mb-2">溯源全链路</h3>
          <p className="text-sm text-gray-500 text-center mb-8">从种子到终端销售，7个环节全程可追溯</p>
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            {[
              { icon: Wheat, label: '种子', desc: '品种/基地', color: 'bg-green-100 text-green-600' },
              { icon: Leaf, label: '种植', desc: '地块/管理', color: 'bg-emerald-100 text-emerald-600' },
              { icon: FlaskConical, label: '农药', desc: '使用/残留', color: 'bg-blue-100 text-blue-600' },
              { icon: FileText, label: '检测', desc: '质检报告', color: 'bg-purple-100 text-purple-600' },
              { icon: Factory, label: '加工', desc: '生产记录', color: 'bg-orange-100 text-orange-600' },
              { icon: Package, label: '仓储', desc: '库存/物流', color: 'bg-cyan-100 text-cyan-600' },
              { icon: ShoppingCart, label: '销售', desc: '订单/终端', color: 'bg-pink-100 text-pink-600' },
            ].map((stage, idx, arr) => {
              const Icon = stage.icon;
              const isLast = idx === arr.length - 1;
              return (
                <div key={stage.label} className="flex items-center flex-1 last:flex-none" style={{ minWidth: 0 }}>
                  <div className="flex flex-col items-center gap-2" style={{ minWidth: 64 }}>
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${stage.color}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-medium text-gray-700">{stage.label}</span>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{stage.desc}</span>
                  </div>
                  {!isLast && (
                    <div className="flex-1 h-0.5 bg-gradient-to-r from-gray-200 to-gray-100 mx-1"
                      style={{ minWidth: 8 }} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-8 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl">
            <div className="flex items-start gap-3">
              <Search className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-700 mb-1">如何使用？</p>
                <ul className="space-y-1 text-gray-500">
                  {publicMode ? (
                    <>
                      <li>1. <span className="font-medium text-emerald-700">相机扫码</span>：点「相机扫码查询」授权后置摄像头，对准包装上的二维码自动识别</li>
                      <li>2. <span className="font-medium text-sky-700">相册扫码</span>：点「相册扫码上传」从相册选择已拍摄的二维码图片</li>
                      <li>3. <span className="font-medium text-gray-700">手动输入</span>：在下方输入批次编号（如 PB2026-001），按回车或点「查询」</li>
                      <li>4. 系统将展示该批次从种子到销售的全链路区块链溯源信息</li>
                    </>
                  ) : (
                    <>
                      <li>1. 在上方输入框中输入种子批次编号（如 PB2026-001）</li>
                      <li>2. 点击「查询」按钮或按回车键</li>
                      <li>3. 系统将展示该批次从种子到销售的全链路溯源信息</li>
                      <li>4. 可在「种子溯源」模块中查看所有批次编号</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {traceData && (
        <div className="space-y-6">
          {!publicMode && canExportTracePdf() && (
            <div className="flex items-center justify-end">
              <button
                onClick={downloadTracePdf}
                disabled={pdfLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {pdfLoading ? '导出中...' : '导出PDF报告'}
              </button>
            </div>
          )}

          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6">
            <div className="flex items-center justify-between">
              {visibleStages.map((stageKey, idx) => {
                const config = stageConfig[stageKey];
                if (!config) return null;
                const Icon = config.icon;
                const hasData = hasStageData(stageKey);
                const isLast = idx === visibleStages.length - 1;
                return (
                  <div key={stageKey} className="flex items-center flex-1 last:flex-none" style={{ minWidth: 0 }}>
                    <div className="flex flex-col items-center gap-2" style={{ minWidth: 70 }}>
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 transition-all duration-300
                        ${hasData
                          ? `${config.bg} border-white shadow-lg shadow-green-200/50`
                          : 'bg-gray-200 border-white shadow-sm'}`}>
                        {hasData ? (
                          <Icon className="w-5 h-5 text-white" />
                        ) : (
                          <Icon className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      <span className={`text-xs font-medium whitespace-nowrap ${hasData ? 'text-gray-700' : 'text-gray-400'}`}>
                        {config.label}
                      </span>
                    </div>
                    {!isLast && (
                      <div className={`flex-1 h-1 mx-2 rounded-full transition-colors duration-300
                        ${hasData ? 'bg-green-400' : 'bg-gray-200'}`}
                        style={{ minWidth: 16 }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {visibleStages.includes('seed') && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Wheat className="w-5 h-5 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段一：种子溯源信息</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">批次编号</p>
                  <p className="font-medium text-green-700">{traceData.seed_batch.batch_code}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">品种名称</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.variety_name}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">繁育基地</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.breeding_base}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">供应商</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.supplier}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">发芽率</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.germination_rate}%</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">纯度</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.purity}%</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">净含量</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.net_weight} kg</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">生产日期</p>
                  <p className="font-medium text-gray-800">{traceData.seed_batch.production_date}</p>
                </div>
              </div>
            </div>
          )}

          {visibleStages.includes('planting') && traceData.planting.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Leaf className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段二：种植管理信息</h3>
              </div>
              <div className="space-y-4">
                {traceData.planting.map((p, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                          地块 {p.plot_code}
                        </span>
                        <span className="font-medium text-gray-800">{p.plot_name}</span>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(p.status)}`}>
                        {p.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-gray-500">位置</p>
                        <p className="font-medium text-gray-800">{p.location}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">种植日期</p>
                        <p className="font-medium text-gray-800">{p.planting_date}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">预计采收日期</p>
                        <p className="font-medium text-gray-800">{p.expected_harvest_date}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">种植户</p>
                        <p className="font-medium text-gray-800">{p.farmer}</p>
                      </div>
                    </div>

                    {p.farming_activities && p.farming_activities.length > 0 && (
                      <div className="mb-4">
                        <p className="text-sm font-medium text-gray-600 mb-2">农事活动记录</p>
                        <div className="space-y-2">
                          {p.farming_activities.map((act, actIdx) => (
                            <div key={actIdx} className="flex items-start gap-2 text-sm">
                              <span className="text-gray-400">•</span>
                              <span className="text-gray-700">
                                {act.activity_date} - {act.activity_type}：{act.description}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {p.environmental_data && p.environmental_data.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">环境监测数据</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm min-w-[1280px]">
                            <thead className="bg-emerald-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">时间</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">空气温度(°C)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">空气湿度(%)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">土壤温度(°C)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">土壤湿度(%)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">pH值</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">电导率(μS/cm)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">氮(mg/kg)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">磷(mg/kg)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">钾(mg/kg)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">盐分(mg/kg)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">光照(lux)</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">风速(m/s)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {p.environmental_data.slice(0, 5).map((env, envIdx) => (
                                <tr key={envIdx}>
                                  <td className="px-3 py-2 text-gray-700">{env.record_time}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.temperature ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.humidity ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.soil_temperature ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.soil_moisture ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.ph_value ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.conductivity ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.nitrogen ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.phosphorus ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.potassium ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.salinity ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.illumination ?? '-'}</td>
                                  <td className="px-3 py-2 text-gray-700">{env.wind_speed ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleStages.includes('pesticide') && traceData.pesticide_applications.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FlaskConical className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段三：农药使用记录</h3>
              </div>
              <div className="space-y-4">
                {traceData.pesticide_applications.map((app, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border ${app.is_compliant ? 'bg-gray-50 border-gray-100' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-gray-800">{app.pesticide_name}</span>
                      {!app.is_compliant && (
                        <span className="flex items-center gap-1 text-red-600 text-sm">
                          <AlertCircle className="w-4 h-4" />
                          不合规
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-gray-500">品牌</p>
                        <p className="text-gray-700">{app.brand}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">登记证号</p>
                        <p className="text-gray-700 text-xs">{app.registration_no}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">施用量</p>
                        <p className="text-gray-700">{app.dosage} {app.unit}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">施药人</p>
                        <p className="text-gray-700">{app.applicator}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">施药日期</p>
                        <p className="text-gray-700">{app.application_date}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">安全间隔期</p>
                        <p className="text-gray-700">{app.safety_interval_end}</p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-gray-500">合规性</p>
                        <span className={`flex items-center gap-1 ${app.is_compliant ? 'text-green-600' : 'text-red-600'}`}>
                          <CheckCircle className="w-4 h-4" />
                          <span>{app.is_compliant ? '合规' : '不合规'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleStages.includes('inspection') && traceData.inspections.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段四：检测报告</h3>
              </div>
              <div className="space-y-4">
                {traceData.inspections.map((ins, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border ${ins.is_qualified ? 'bg-gray-50 border-gray-100' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-purple-700">{ins.report_code}</span>
                      <span className={`px-2 py-1 text-xs rounded-full ${ins.is_qualified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {ins.is_qualified ? '合格' : '不合格'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                      <div>
                        <p className="text-gray-500">检测类型</p>
                        <p className="text-gray-700">{ins.report_type}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">检测机构</p>
                        <p className="text-gray-700">{ins.inspection_agency}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">检测日期</p>
                        <p className="text-gray-700">{ins.report_date}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">检测员</p>
                        <p className="text-gray-700">{ins.inspector}</p>
                      </div>
                    </div>

                    {ins.pesticide_residues && ins.pesticide_residues.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">农药残留检测结果</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-purple-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">检测项目</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">限量值</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">实测值</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">单位</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">判定</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {ins.pesticide_residues.map((res, resIdx) => (
                                <tr key={resIdx}>
                                  <td className="px-3 py-2 text-gray-700">{res.test_item}</td>
                                  <td className="px-3 py-2 text-gray-700">{res.limit_value}</td>
                                  <td className={`px-3 py-2 ${res.is_over_limit ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                                    {res.measured_value}
                                  </td>
                                  <td className="px-3 py-2 text-gray-700">{res.unit}</td>
                                  <td className="px-3 py-2">
                                    <span className={`flex items-center gap-1 ${res.is_over_limit ? 'text-red-600' : 'text-green-600'}`}>
                                      <CheckCircle className="w-4 h-4" />
                                      <span>{res.is_over_limit ? '超标' : '合格'}</span>
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleStages.includes('processing') && traceData.processing.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <Factory className="w-5 h-5 text-orange-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段五：加工生产信息</h3>
              </div>
              <div className="space-y-4">
                {traceData.processing.map((p, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-orange-700">{p.batch_code}</span>
                      <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(p.status)}`}>
                        {p.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                      <div>
                        <p className="text-gray-500">产品名称</p>
                        <p className="text-gray-700">{p.product_name}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">产品等级</p>
                        <p className="text-gray-700">{p.product_grade}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">加工日期</p>
                        <p className="text-gray-700">{p.processing_date}</p>
                      </div>
                    </div>

                    {p.process_records && p.process_records.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">加工工序</p>
                        <div className="flex flex-wrap gap-2">
                          {p.process_records.sort((a, b) => a.process_order - b.process_order).map((pr, prIdx) => (
                            <div key={prIdx} className="flex items-center gap-2">
                              <span className="w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">
                                {pr.process_order}
                              </span>
                              <span className="text-sm text-gray-700">{pr.process_name}</span>
                              {prIdx < (p.process_records?.length || 0) - 1 && (
                                <ChevronRight className="w-4 h-4 text-gray-400" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleStages.includes('inventory') && traceData.inventory.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Package className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段六：仓储物流信息</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-indigo-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">商品编码</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">商品名称</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">数量</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">单位</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {traceData.inventory.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-700">{item.item_code}</td>
                        <td className="px-4 py-3 text-sm text-gray-800">{item.item_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.quantity}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.unit}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {visibleStages.includes('sales') && traceData.sales.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-pink-100 rounded-lg flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-pink-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">阶段七：终端销售信息</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-pink-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">订单编号</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">商品名称</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">数量</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">单位</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">单价</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">订单日期</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {traceData.sales.map((s, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-pink-700">{s.order_no}</td>
                        <td className="px-4 py-3 text-sm text-gray-800">{s.item_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{s.quantity}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{s.unit}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">¥{s.unit_price}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{s.order_date}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(s.status)}`}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}