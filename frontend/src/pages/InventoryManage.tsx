import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Package, AlertTriangle, X, ArrowDownCircle, ArrowUpCircle, Link2, ScanLine, Edit3, QrCode } from 'lucide-react';
import { inventoryApi, seedApi } from '../services/api';
import type { InventoryItem, SeedBatch } from '../types/index.ts';
import { BatchChainView } from '../components/BatchChainView';
import { canManageInventory } from '../utils/roles';
import jsqr from 'jsqr';

// 浏览器原生 BarcodeDetector 的 TS 声明（Chrome / Edge 原生支持，扫码入库用）
declare global {
  interface Window {
    BarcodeDetector?: any;
  }
}

const batchColors = [
  'bg-green-500',
  'bg-blue-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
];

const getBatchColor = (index: number) => batchColors[index % batchColors.length];
const getBatchBgColor = (index: number) => getBatchColor(index).replace('500', '50');
const getBatchTextColor = (index: number) => getBatchColor(index).replace('500', '700');

export function InventoryManage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [alerts, setAlerts] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'add' | 'transaction'>('add');
  const [formData, setFormData] = useState<any>({});
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [seedBatches, setSeedBatches] = useState<SeedBatch[]>([]);
  const [selectedSeedBatchCode, setSelectedSeedBatchCode] = useState('');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  // === 扫码入库状态 ===
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanHint, setScanHint] = useState('');
  const [scanResult, setScanResult] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanClosedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // === 扫码入库核心逻辑 ===
  const stopScan = useCallback(() => {
    scanClosedRef.current = true;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // 从二维码扫描结果中提取批次号（支持纯批次号或 URL 格式）
  const extractBatchFromScan = (raw: string): string => {
    if (!raw) return '';
    const t = raw.trim();
    // URL 格式: /trace/public?batch=PB2026-001
    const match = t.match(/[?&]batch=([^&#\s]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);
    // 纯批次号: PB2026-001
    const m2 = t.match(/([A-Z]{1,4}\d{4}[-_]?\d{2,5})/);
    if (m2 && m2[1]) return m2[1].replace(/_/g, '-');
    return t;
  };

  const onScanSuccess = async (raw: string) => {
    const batchCode = extractBatchFromScan(raw);
    stopScan();
    setScanOpen(false);
    if (!batchCode) {
      setScanError('未能从二维码中解析出有效批次号');
      return;
    }
    // 防重复入库：先查该批次是否已有库存条目
    try {
      const res = await inventoryApi.getInventory({ seed_batch_code: batchCode });
      const existing = (res.data || [])[0];
      if (existing) {
        // 已有库存条目 → 走入库流水累加（同一条目数量累加，不会重复建档）
        setSelectedItem(existing);
        setModalType('transaction');
        setFormData({ transaction_type: 'in' });
        setShowModal(true);
        setScanResult(`✅ 已识别批次：${batchCode}，该批次在「${existing.warehouse_name || '仓库'}」已有库存条目（当前 ${existing.quantity}${existing.unit}），本次扫码将作为入库流水累加，不会重复建档`);
        return;
      }
    } catch (err) {
      // 查询失败不阻塞，回退到新建表单流程
      console.error('查询批次库存失败，按新建处理:', err);
    }
    // 无库存条目 → 打开新建表单（首次入库建档）
    setModalType('add');
    setFormData({
      seed_batch_code: batchCode,
      item_name: `扫码入库 · ${batchCode}`,
      item_code: `SKU-${batchCode}`,
      quantity: 1,
      unit: '件',
      item_type: '成品',
      operator: '扫码入库',
    });
    setShowModal(true);
    setScanResult(`✅ 已识别批次：${batchCode}，该批次首次入库，请确认入库信息后提交`);
  };

  const startScan = async () => {
    setScanOpen(true);
    setScanError('');
    setScanHint('正在请求相机权限，请允许访问...');
    setScanResult('');
    scanClosedRef.current = false;

    try {
      // 前置校验：非 HTTPS / 微信内置浏览器等场景 mediaDevices 可能不存在
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error(
          '当前浏览器环境不支持直接调用相机，请改为手动输入批次号'
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
        ? '将二维码对准摄像头...（原生加速）'
        : '将二维码对准摄像头...');

      const detector = hasNativeDetector
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;
      detectorRef.current = detector;

      // jsqr 离屏 canvas
      const scanCanvas = document.createElement('canvas');
      const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

      const scanLoop = async () => {
        if (scanClosedRef.current) return;
        if (!videoRef.current) return;
        try {
          // 路径 1: 原生 BarcodeDetector
          if (detector) {
            const detections = await detector.detect(videoRef.current);
            if (detections && detections.length > 0) {
              const raw = detections[0].rawValue || detections[0].raw || '';
              if (raw) { onScanSuccess(raw); return; }
            }
          }
          // 路径 2: jsqr 纯 JS 解码
          if (scanCtx && videoRef.current.readyState >= 2) {
            const w = videoRef.current.videoWidth;
            const h = videoRef.current.videoHeight;
            if (w > 0 && h > 0) {
              const targetW = 480;
              const scale = w > targetW ? targetW / w : 1;
              scanCanvas.width = w * scale;
              scanCanvas.height = h * scale;
              scanCtx.drawImage(videoRef.current, 0, 0, scanCanvas.width, scanCanvas.height);
              const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
              const code = jsqr(imageData.data, imageData.width, imageData.height);
              if (code && code.data) { onScanSuccess(code.data); return; }
            }
          }
        } catch { /* ignore per-frame errors */ }
        rafRef.current = requestAnimationFrame(scanLoop);
      };
      rafRef.current = requestAnimationFrame(scanLoop);
    } catch (err: any) {
      setScanError('相机启动失败：' + (err?.message || '未知错误'));
      setScanHint('您也可以点击"手动输入"直接填写批次号');
    }
  };

  useEffect(() => {
    return () => stopScan();
  }, [stopScan]);

  useEffect(() => {
    fetchInventory();
    fetchAlerts();
    fetchSeedBatches();
    fetchWarehouses();
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [selectedSeedBatchCode]);

  // 从首页快捷卡跳转带 ?action=xxx 参数时自动打开对应弹窗
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'scan') {
      startScan();
    } else if (action === 'new') {
      handleAddItem();
    }
    if (action) {
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchInventory = async () => {
    try {
      const params: any = {};
      if (selectedSeedBatchCode) {
        params.seed_batch_code = selectedSeedBatchCode;
      }
      const res = await inventoryApi.getInventory(params);
      setItems(res.data || []);
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
    }
  };

  const fetchSeedBatches = async () => {
    try {
      const res = await seedApi.getBatches();
      setSeedBatches(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch seed batches:', err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await inventoryApi.getAlerts();
      setAlerts(res.data || []);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await inventoryApi.getWarehouses();
      setWarehouses(res.data || []);
    } catch (err) {
      console.error('Failed to fetch warehouses:', err);
    }
  };

  const handleAddItem = () => {
    setModalType('add');
    setFormData({});
    setShowModal(true);
  };

  const handleTransaction = (item: InventoryItem, type: 'in' | 'out') => {
    setSelectedItem(item);
    setModalType('transaction');
    setFormData({ transaction_type: type });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'add') {
        await inventoryApi.createInventoryItem(formData);
      } else if (selectedItem) {
        await inventoryApi.addTransaction(selectedItem.id, formData);
      }
      setShowModal(false);
      fetchInventory();
      fetchAlerts();
    } catch (err: any) {
      console.error('Failed to submit:', err);
      const errorMsg = err?.response?.data?.detail || '操作失败，请稍后重试';
      alert(errorMsg);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索商品名称..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <select
            value={selectedSeedBatchCode}
            onChange={(e) => setSelectedSeedBatchCode(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
          >
            <option value="">全部种子批次</option>
            {seedBatches.map((batch) => (
              <option key={batch.id} value={batch.batch_code}>{batch.batch_code} - {batch.variety_name}</option>
            ))}
          </select>
        </div>
        {canManageInventory() && (
          <div className="flex items-center gap-2">
            <button onClick={startScan} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors">
              <ScanLine className="w-4 h-4" />
              扫码入库
            </button>
            <button onClick={handleAddItem} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
              <Plus className="w-4 h-4" />
              添加商品
            </button>
          </div>
        )}
      </div>

      {warehouses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {warehouses.map((warehouse: any) => {
            const used = warehouse.used_capacity || 0;
            const capacity = warehouse.capacity || 0;
            const usagePercent = capacity > 0 ? Math.round((used / capacity) * 100) : 0;
            const barColor = usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-yellow-500' : 'bg-green-500';
            return (
              <div key={warehouse.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-800">{warehouse.name}</span>
                  <span className="text-xs text-gray-500">{warehouse.location}</span>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  容量使用: <span className="font-medium text-gray-800">{used.toFixed(0)} / {capacity}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(usagePercent, 100)}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-500">
                  <span>使用率 {usagePercent}%</span>
                  {usagePercent >= 90 && <span className="text-red-500">⚠ 接近容量上限</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="font-medium text-red-700">库存预警 ({alerts.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between p-3 bg-white rounded-lg">
                <span className="text-sm text-gray-700 font-medium">{alert.item_name}</span>
                <span className={`text-sm ${alert.alert_type === 'low_stock' ? 'text-red-600' : 'text-yellow-600'}`}>
                  {alert.current_stock}{alert.unit} / {alert.alert_type === 'low_stock' ? `最低${alert.min_stock}` : `最高${alert.max_stock}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品编码</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">仓库</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">批次编号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">当前库存</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">最低/最高</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items
                .filter((item) => {
                  if (!searchTerm) return true;
                  const term = searchTerm.toLowerCase();
                  return (
                    (item.item_code?.toLowerCase().includes(term) || false) ||
                    (item.item_name?.toLowerCase().includes(term) || false) ||
                    (item.item_type?.toLowerCase().includes(term) || false) ||
                    (item.batch_code?.toLowerCase().includes(term) || false) ||
                    (item.seed_batch_code?.toLowerCase().includes(term) || false)
                  );
                })
                .map((item, index) => {
                  const batchIndex = seedBatches.findIndex(b => b.batch_code === item.seed_batch_code);
                  const colorIndex = batchIndex >= 0 ? batchIndex : index;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-green-700">{item.item_code}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{item.item_name}</td>
                      <td className="px-6 py-4">
                        {item.warehouse_name ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-blue-700">{item.warehouse_name}</span>
                            {item.warehouse_location && (
                              <span className="text-xs text-gray-400">{item.warehouse_location}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {item.item_type}
                        {item.seed_batch_code && (
                          <div className="text-xs text-gray-400 mt-0.5">种子: {item.seed_batch_code}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {item.batch_code || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-800 font-medium">
                        <div>{item.quantity} {item.unit}
                        {item.min_stock && item.quantity < item.min_stock && (
                          <span className="ml-2 text-xs text-red-500">⚠</span>
                        )}</div>
                        <div className="text-xs text-gray-400 font-normal mt-0.5">
                          账面单价: <span className="text-green-600 font-medium">¥{item.unit_price || 0}</span>
                          {(item.total_value ?? 0) > 0 && (
                            <span className="ml-2 text-gray-400">总价值: ¥{(item.total_value || 0).toFixed(2)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {item.min_stock || 0} - {item.max_stock || '∞'} {item.unit}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          item.quantity === 0 ? 'bg-red-100 text-red-700' :
                          item.min_stock && item.quantity < item.min_stock ? 'bg-yellow-100 text-yellow-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {item.quantity === 0 ? '缺货' :
                           item.min_stock && item.quantity < item.min_stock ? '低库存' : '在库'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-right">
                        <div className="flex items-center justify-end gap-2">
                          {item.seed_batch_code && (
                            <button onClick={() => { setSelectedBatchCode(item.seed_batch_code!); setShowChainView(true); }} className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}>
                              <Link2 className="w-3 h-3" />
                              溯源
                            </button>
                          )}
                          {item.traceability_qr_code && (
                            <button
                              onClick={() => {
                                const w = window.open('', '_blank', 'width=420,height=520');
                                if (w) {
                                  w.document.write(`<html><head><title>溯源二维码 - ${item.item_code}</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;margin:0;"><h3>${item.item_name}</h3><img src="${item.traceability_qr_code}" style="width:280px;height:280px;"/><p style="margin-top:10px;color:#666;">手机扫码可直接打开溯源页</p><a href="${item.traceability_qr_code}" download="溯源二维码-${item.item_code}.png" style="margin-top:16px;padding:8px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;">下载二维码图片</a><p style="margin-top:8px;color:#999;font-size:12px;">也可在图片上右键 → 图片另存为</p></body></html>`);
                                }
                              }}
                              className="text-gray-400 hover:text-blue-500"
                              title="查看溯源二维码"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => handleTransaction(item, 'in')} className="text-gray-400 hover:text-green-500" title="入库">
                            <ArrowDownCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleTransaction(item, 'out')} className="text-gray-400 hover:text-blue-500" title="出库">
                            <ArrowUpCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">库存商品数</p>
              <p className="text-2xl font-bold text-gray-800">{items.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">原料库存</p>
              <p className="text-2xl font-bold text-gray-800">
                {items.filter(i => i.item_type === '原料').reduce((sum, i) => sum + i.quantity, 0).toLocaleString()} kg
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">成品库存</p>
              <p className="text-2xl font-bold text-gray-800">
                {items.filter(i => i.item_type === '成品').reduce((sum, i) => sum + i.quantity, 0).toLocaleString()} kg
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">预警商品</p>
              <p className="text-2xl font-bold text-gray-800">{alerts.length}</p>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {modalType === 'add' ? '添加库存商品' : `${formData.transaction_type === 'in' ? '入库' : '出库'}操作`}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {selectedItem && modalType === 'transaction' && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">当前商品: <span className="font-medium text-gray-800">{selectedItem.item_name}</span></p>
                <p className="text-sm text-gray-600">当前库存: <span className="font-medium text-gray-800">{selectedItem.quantity} {selectedItem.unit}</span></p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              {modalType === 'add' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">仓库</label>
                    <select
                      value={formData.warehouse_id || ''}
                      onChange={(e) => setFormData({ ...formData, warehouse_id: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择仓库</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">商品编码</label>
                    <input
                      type="text"
                      value={formData.item_code || ''}
                      onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入商品编码"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">商品名称</label>
                    <input
                      type="text"
                      value={formData.item_name || ''}
                      onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入商品名称"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                      <select
                        value={formData.item_type || ''}
                        onChange={(e) => setFormData({ ...formData, item_type: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">请选择</option>
                        <option value="原料">原料</option>
                        <option value="成品">成品</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">批次编号</label>
                      <input
                        type="text"
                        value={formData.batch_code || ''}
                        onChange={(e) => setFormData({ ...formData, batch_code: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">数量</label>
                      <input
                        type="number"
                        value={formData.quantity || ''}
                        onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
                      <input
                        type="text"
                        value={formData.unit || ''}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单价 (元/kg)</label>
                      <input
                        type="number"
                        value={formData.unit_price || ''}
                        onChange={(e) => setFormData({ ...formData, unit_price: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="如: 12.50"
                        step="0.01"
                      />
                    </div>
                    <div className="flex items-end">
                      {formData.quantity && formData.unit_price ? (
                        <div className="w-full px-4 py-2 bg-green-50 rounded-lg text-sm text-green-700 border border-green-100">
                          总价值: <span className="font-bold">¥{(formData.quantity * formData.unit_price).toFixed(2)}</span>
                        </div>
                      ) : (
                        <div className="w-full px-4 py-2 bg-gray-50 rounded-lg text-sm text-gray-400 border border-gray-100">
                          填写数量和单价后自动计算
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">最低库存</label>
                      <input
                        type="number"
                        value={formData.min_stock || ''}
                        onChange={(e) => setFormData({ ...formData, min_stock: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">最高库存</label>
                      <input
                        type="number"
                        value={formData.max_stock || ''}
                        onChange={(e) => setFormData({ ...formData, max_stock: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">商品: <span className="font-medium text-gray-800">{selectedItem?.item_name}</span></span>
                      <span className="text-gray-600">仓库: <span className="font-medium text-blue-700">{selectedItem?.warehouse_name || '-'}</span></span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-600">当前库存: <span className="font-bold text-green-700">{selectedItem?.quantity} {selectedItem?.unit}</span></span>
                      {formData.transaction_type === 'in' && selectedItem?.max_stock && (
                        <span className="text-gray-600">最高库存: <span className="font-medium text-orange-600">{selectedItem.max_stock} {selectedItem?.unit}</span></span>
                      )}
                      {formData.transaction_type === 'out' && (
                        <span className="text-gray-600">最低库存: <span className="font-medium text-orange-600">{selectedItem?.min_stock || 0} {selectedItem?.unit}</span></span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      数量 <span className="text-red-500">*</span>
                    </label>
                    {(() => {
                      const currentStock = selectedItem?.quantity || 0;
                      const maxStock = selectedItem?.max_stock || null;
                      const minStock = selectedItem?.min_stock || 0;
                      const type = formData.transaction_type;
                      const maxAllowed = type === 'out' ? currentStock : (maxStock ? maxStock - currentStock : null);
                      const quantity = parseFloat(formData.quantity || 0);
                      const wouldExceed = maxAllowed !== null && quantity > maxAllowed;
                      const wouldBelowMin = type === 'out' && (currentStock - quantity) < minStock;
                      return (
                        <>
                          <input
                            type="number"
                            value={formData.quantity || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (type === 'out' && val > currentStock) {
                                alert(`出库失败：数量 ${val} 超过当前库存 ${currentStock}${selectedItem?.unit}`);
                                return;
                              }
                              if (type === 'in' && maxStock !== null && (currentStock + val) > maxStock) {
                                alert(`入库警告：入库后库存将达到 ${(currentStock + val).toFixed(2)}，超过最高库存 ${maxStock}${selectedItem?.unit}`);
                              }
                              setFormData({ ...formData, quantity: val });
                            }}
                            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 ${wouldExceed ? 'border-red-400 focus:ring-red-500' : wouldBelowMin ? 'border-orange-400 focus:ring-orange-500' : 'border-gray-300 focus:ring-green-500'}`}
                            placeholder={`请输入${type === 'in' ? '入库' : '出库'}数量`}
                            required
                            min="0.01"
                            step="0.01"
                          />
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span className="text-gray-500">
                              单位: <span className="font-medium text-gray-700">{selectedItem?.unit}</span>
                            </span>
                            {maxAllowed !== null && maxAllowed > 0 && (
                              <span className="text-blue-600">
                                {type === 'in' ? '最大可入库' : '最大可出库'}: <span className="font-medium">{maxAllowed.toFixed(2)} {selectedItem?.unit}</span>
                              </span>
                            )}
                            {maxAllowed !== null && maxAllowed <= 0 && (
                              <span className="text-red-600">
                                {type === 'in' ? '已达最高库存，无法再入库' : '已无库存，无法出库'}
                              </span>
                            )}
                            {wouldExceed && (
                              <span className="text-red-600 font-medium">⚠ 数量超出限制</span>
                            )}
                            {wouldBelowMin && !wouldExceed && (
                              <span className="text-orange-600 font-medium">⚠ 出库后将低于最低库存线</span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单据编号</label>
                      <input
                        type="text"
                        value={formData.source_document || ''}
                        onChange={(e) => setFormData({ ...formData, source_document: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="如: PO-2026-001"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单价 (元)</label>
                      <input
                        type="number"
                        value={formData.unit_price || ''}
                        onChange={(e) => setFormData({ ...formData, unit_price: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="可选"
                        step="0.01"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                    <textarea
                      value={formData.remarks || ''}
                      onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="操作说明、备注信息等"
                      rows={2}
                    />
                  </div>

                  {formData.quantity && formData.unit_price && (
                    <div className="p-2 bg-gray-50 rounded text-sm">
                      <span className="text-gray-600">总金额: </span>
                      <span className="font-bold text-green-700">
                        ¥{(parseFloat(formData.quantity) * parseFloat(formData.unit_price || 0)).toFixed(2)}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">确认</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChainView && (
        <BatchChainView batchCode={selectedBatchCode} onClose={() => setShowChainView(false)} />
      )}

      {/* === 扫码入库弹窗 === */}
      {scanOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <ScanLine className="w-5 h-5 text-cyan-600" />
                <h3 className="text-lg font-semibold text-gray-800">扫码入库</h3>
              </div>
              <button onClick={() => { stopScan(); setScanOpen(false); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              {!scanResult && (
                <>
                  <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
                    <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-56 h-56 border-2 border-cyan-400 rounded-lg flex items-center justify-center">
                        <ScanLine className="w-16 h-16 text-cyan-400 opacity-50" />
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-2">
                      {scanHint || '准备中...'}
                    </div>
                  </div>
                  {scanError && (
                    <div className="mt-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{scanError}</div>
                  )}
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-gray-400" title="种子溯源管理 → 批次详情 → 打印二维码">扫描包装上的批次溯源码（种子/加工批次生成，见种子溯源管理-批次详情-打印贴纸）</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { stopScan(); setScanOpen(false); setModalType('add'); setFormData({}); setShowModal(true); }}
                        className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                      >
                        <Edit3 className="w-3 h-3" /> 手动输入
                      </button>
                    </div>
                  </div>
                </>
              )}
              {scanResult && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-green-600 font-medium mb-4">{scanResult}</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => { setScanResult(''); startScan(); }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                    >
                      再扫一次
                    </button>
                    <button
                      onClick={() => { setScanResult(''); setScanOpen(false); }}
                      className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600"
                    >
                      确认入库
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}