import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Eye,
  Edit,
  Trash2,
  User,
  Package,
  FileCheck,
  X,
  Leaf,
  MapPin,
  Building2,
  RefreshCw,
  CheckCircle2,
  Circle,
  Factory,
  Warehouse,
  ShoppingCart,
  AlertTriangle,
  Droplets,
  Thermometer,
  Wind,
  Sprout,
  Play,
  Pause,
  Gauge,
  FlaskRound,
  Beaker,
  CircleDot,
  Sparkles,
  Ruler,
  Sun,
  Flame,
  Download,
  Printer,
  Link as LinkIcon,
} from 'lucide-react';
import { api, seedApi, blockchainApi } from '../services/api';
import type { SeedSupplier, SeedBatch, SeedQualityTest, BatchFullChainData } from '../types/index.ts';
import { canManageSeed } from '../utils/roles';
import { formatDateCn } from '../utils/date';

interface BatchChainStatus {
  has_planting: boolean;
  has_pesticide: boolean;
  has_inspection: boolean;
  has_processing: boolean;
  has_inventory: boolean;
  has_sales: boolean;
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

const formatBatchName = (_batch: SeedBatch, index: number) => {
  return `批次${String(index + 1).padStart(2, '0')}`;
};

export function SeedTrace() {
  const [activeTab, setActiveTab] = useState<'suppliers' | 'batches'>('batches');
  const [suppliers, setSuppliers] = useState<SeedSupplier[]>([]);
  const [batches, setBatches] = useState<SeedBatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'supplier' | 'batch'>('batch');
  const [selectedBatchCode, setSelectedBatchCode] = useState<string>('');
  const [selectedBatch, setSelectedBatch] = useState<SeedBatch | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<SeedSupplier | null>(null);
  const [qualityTests, setQualityTests] = useState<SeedQualityTest[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [formData, setFormData] = useState<Record<string, string | number | boolean | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [batchChainStatus, setBatchChainStatus] = useState<Record<string, BatchChainStatus>>({});
  const [fullChainData, setFullChainData] = useState<BatchFullChainData | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [qrcodeData, setQrcodeData] = useState<string>('');
  const [qrcodeUrl, setQrcodeUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchChainStatus = useCallback(async (batchList: SeedBatch[]) => {
    const statusMap: Record<string, BatchChainStatus> = {};
    const promises = batchList.map(async (batch) => {
      try {
        const chainRes = await seedApi.getBatchFullChain(batch.batch_code);
        const data = chainRes.data.data || {};
        statusMap[batch.batch_code] = {
          has_planting: (data.planting?.records?.length || 0) > 0,
          has_pesticide: (data.planting?.pesticide_applications?.length || 0) > 0,
          has_inspection: (data.inspection?.reports?.length || 0) > 0,
          has_processing: (data.processing?.batches?.length || 0) > 0,
          has_inventory: (data.inventory?.length || 0) > 0,
          has_sales: (data.sales?.order_items?.length || 0) > 0,
        };
      } catch {
        statusMap[batch.batch_code] = {
          has_planting: false,
          has_pesticide: false,
          has_inspection: false,
          has_processing: false,
          has_inventory: false,
          has_sales: false,
        };
      }
    });
    await Promise.all(promises);
    setBatchChainStatus(statusMap);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'suppliers') {
        const res = await seedApi.getSuppliers();
        setSuppliers(res.data.data || []);
      } else {
        const res = await seedApi.getBatches();
        setBatches(res.data.data || []);
        await fetchChainStatus(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, fetchChainStatus]);

  const fetchFullChain = useCallback(async (batchCode: string) => {
    if (!batchCode) return;
    setChainLoading(true);
    try {
      const res = await seedApi.getBatchFullChain(batchCode);
      setFullChainData(res.data.data || null);
    } catch (err) {
      console.error('Failed to fetch full chain:', err);
      setFullChainData(null);
    } finally {
      setChainLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (suppliers.length === 0) {
      seedApi.getSuppliers().then(res => {
        setSuppliers(res.data.data || []);
      }).catch(err => {
        console.error('Failed to fetch suppliers:', err);
      });
    }
  }, [fetchData, suppliers.length]);

  useEffect(() => {
    if (batches.length > 0 && !selectedBatchCode) {
      setSelectedBatchCode(batches[0].batch_code);
    }
    const batch = batches.find(b => b.batch_code === selectedBatchCode);
    if (batch) {
      setSelectedBatch(batch);
      fetchFullChain(batch.batch_code);
    }
  }, [selectedBatchCode, batches, fetchFullChain]);

  const handleCreate = () => {
    setModalType(activeTab === 'suppliers' ? 'supplier' : 'batch');
    setFormData({});
    setShowModal(true);
  };

  // 从首页快捷卡跳转带 ?action=xxx 参数时自动打开对应弹窗
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'new') {
      setActiveTab('batches');
      setModalType('batch');
      setFormData({});
      setShowModal(true);
    }
    if (action) {
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'supplier') {
        if (formData.id) {
          const supplierCode = formData.supplier_code;
          delete formData.id;
          delete formData.created_at;
          delete formData.updated_at;
          delete formData.batches;
          await api.put(`/seed/suppliers/${supplierCode}`, formData);
        } else {
          await seedApi.createSupplier(formData);
        }
      } else {
        await seedApi.createBatch(formData);
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      console.error('Failed to save:', err);
    }
  };

  const handleViewDetail = async (batch: SeedBatch) => {
    setSelectedBatch(batch);
    setShowDetailModal(true);
    setQrcodeData('');
    try {
      const res = await seedApi.getQualityTests(batch.batch_code);
      setQualityTests(res.data.data || []);
      
      const qrRes = await blockchainApi.generateQrcode({
        batch_id: batch.id,
        seed_batch_id: batch.batch_code,
        url_prefix: window.location.origin,
      });
      if (qrRes.data && qrRes.data.qrcode) {
        setQrcodeData(qrRes.data.qrcode);
        setQrcodeUrl(qrRes.data.trace_url || '');
      } else {
        setQrcodeUrl('');
      }
    } catch (err) {
      console.error('Failed to fetch quality tests:', err);
      setQualityTests([]);
    }
  };

  const handleDownloadQrcode = () => {
    if (!qrcodeData) return;
    const link = document.createElement('a');
    link.href = qrcodeData;
    link.download = `溯源二维码_${selectedBatch?.batch_code || ''}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintQrcode = () => {
    if (!qrcodeData) return;
    const w = window.open('', '_blank', 'width=400,height=520');
    if (!w) return;
    w.document.write(`
      <html><head><title>溯源贴纸 - ${selectedBatch?.batch_code || ''}</title>
      <style>
        body { font-family: -apple-system, "Microsoft YaHei", sans-serif; text-align: center; padding: 24px; }
        .brand { font-size: 16px; font-weight: bold; color: #047857; }
        img { width: 200px; height: 200px; margin: 12px 0; }
        .batch { font-size: 13px; color: #374151; margin-top: 6px; }
        .hint { font-size: 11px; color: #9ca3af; margin-top: 8px; }
      </style></head>
      <body>
        <div class="brand">金生链 · 花生全产业链溯源</div>
        <img src="${qrcodeData}" alt="溯源二维码" />
        <div class="batch">批次编号: ${selectedBatch?.batch_code || ''}</div>
        ${selectedBatch?.variety_name ? `<div class="batch">${selectedBatch.variety_name}</div>` : ''}
        <div class="hint">手机扫码可查看该批次全链条溯源信息</div>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  const handleCopyQrcodeLink = async () => {
    if (!qrcodeUrl) return;
    try {
      await navigator.clipboard.writeText(qrcodeUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = qrcodeUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleViewSupplier = (supplier: SeedSupplier) => {
    setSelectedSupplier(supplier);
  };

  const handleEditSupplier = (supplier: SeedSupplier) => {
    setFormData({ ...supplier });
    setModalType('supplier');
    setShowModal(true);
  };

  const handleDeleteSupplier = async (supplier: SeedSupplier) => {
    if (window.confirm(`确定要删除供应商 "${supplier.name}" 吗？\n\n注意：如果该供应商下存在种子批次，则无法删除。`)) {
      try {
        await api.delete(`/seed/suppliers/${supplier.supplier_code}`);
        fetchData();
      } catch (err: any) {
        console.error('Failed to delete supplier:', err);
      }
    }
  };

  const handleToggleSupplierStatus = async (supplier: SeedSupplier) => {
    const newStatus = !supplier.is_active;
    const action = newStatus ? '启用' : '停用';
    if (window.confirm(`确定要${action}供应商 "${supplier.name}" 吗？`)) {
      try {
        await api.put(`/seed/suppliers/${supplier.supplier_code}`, { is_active: newStatus });
        fetchData();
      } catch (err: any) {
        console.error('Failed to update supplier:', err);
      }
    }
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.supplier_code || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredBatches = batches.filter(
    (b) =>
      (b.batch_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.variety_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.breeding_base || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusIcon = (status: boolean) => (
    status ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />
  );

  const getStageCard = (
    title: string,
    icon: React.ReactNode,
    status: boolean,
    color: string,
    _data: unknown,
    children: React.ReactNode
  ) => (
    <div className={`border rounded-xl p-4 transition-all ${status ? `${color}/50 border-${color}/20` : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${status ? `${color}/20` : 'bg-gray-200'}`}>
          {icon}
        </div>
        <div className="flex-1">
          <h4 className={`font-semibold text-sm ${status ? `${color}-700` : 'text-gray-500'}`}>{title}</h4>
          <span className={`text-xs ${status ? `${color}-600` : 'text-gray-400'}`}>
            {status ? '已完成' : '未开始'}
          </span>
        </div>
        <div className={`${status ? `${color}-600` : 'text-gray-400'}`}>
          {getStatusIcon(status)}
        </div>
      </div>
      {status && children}
      {!status && (
        <div className="text-xs text-gray-400 text-center py-4">该环节暂无数据</div>
      )}
    </div>
  );

  if (activeTab === 'suppliers') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('suppliers')}
                className="px-4 py-2 rounded-md text-sm font-medium bg-white shadow-sm text-green-700"
              >
                <span className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  供应商管理
                </span>
              </button>
              <button
                onClick={() => setActiveTab('batches')}
                className="px-4 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                <span className="flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  种子批次
                </span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索供应商名称..."
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            {canManageSeed() && (
              <button
                onClick={handleCreate}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-500"></div>
            </div>
          ) : filteredSuppliers.length > 0 ? (
            filteredSuppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{supplier.name}</h3>
                    <p className="text-sm text-gray-500">{supplier.supplier_code}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      supplier.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {supplier.is_active ? '活跃' : '停用'}
                  </span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <User className="w-4 h-4 text-gray-400" />
                    {supplier.contact_name}
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {supplier.phone}
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    {supplier.address}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
                  <button onClick={() => handleViewSupplier(supplier)} className="text-gray-400 hover:text-blue-500 p-2" title="查看详情">
                    <Eye className="w-4 h-4" />
                  </button>
                  {canManageSeed() && (
                    <>
                      <button onClick={() => handleEditSupplier(supplier)} className="text-gray-400 hover:text-blue-500 p-2" title="编辑">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleSupplierStatus(supplier)}
                        className={`p-2 ${supplier.is_active ? 'text-gray-400 hover:text-orange-500' : 'text-gray-400 hover:text-green-500'}`}
                        title={supplier.is_active ? '停用' : '启用'}
                      >
                        {supplier.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={() => handleDeleteSupplier(supplier)} className="text-gray-400 hover:text-red-500 p-2" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-12">
              <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">暂无供应商数据</p>
            </div>
          )}
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">添加供应商</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供应商编码</label>
                  <input
                    type="text"
                    value={String(formData.supplier_code || '')}
                    onChange={(e) => setFormData({ ...formData, supplier_code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入供应商编码"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供应商名称</label>
                  <input
                    type="text"
                    value={String(formData.name || '')}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入供应商名称"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">联系人</label>
                  <input
                    type="text"
                    value={String(formData.contact_name || '')}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入联系人"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
                  <input
                    type="text"
                    value={String(formData.phone || '')}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入电话"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
                  <input
                    type="text"
                    value={String(formData.address || '')}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入地址"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                    取消
                  </button>
                  <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
                    保存
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {selectedSupplier && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">供应商详情</h3>
                <button onClick={() => setSelectedSupplier(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">供应商编码</p>
                    <p className="font-medium text-gray-800">{selectedSupplier.supplier_code}</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">供应商名称</p>
                    <p className="font-medium text-gray-800">{selectedSupplier.name}</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">联系人</p>
                    <p className="font-medium text-gray-800">{selectedSupplier.contact_name}</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">电话</p>
                    <p className="font-medium text-gray-800">{selectedSupplier.phone}</p>
                  </div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">地址</p>
                  <p className="font-medium text-gray-800">{selectedSupplier.address}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    selectedSupplier.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {selectedSupplier.is_active ? '活跃' : '停用'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const currentBatch = batches.find(b => b.batch_code === selectedBatchCode) || null;
  const currentStatus = currentBatch ? batchChainStatus[currentBatch.batch_code] : null;
  const _selectedIndex = filteredBatches.findIndex(b => b.batch_code === selectedBatchCode);
  const displayIndex = _selectedIndex >= 0 ? _selectedIndex : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('suppliers')}
              className="px-4 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800"
            >
              <span className="flex items-center gap-2">
                <User className="w-4 h-4" />
                供应商管理
              </span>
            </button>
            <button
              onClick={() => setActiveTab('batches')}
              className="px-4 py-2 rounded-md text-sm font-medium bg-white shadow-sm text-green-700"
            >
              <span className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                种子批次
              </span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索批次编号、品种名称..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>
      </div>

      <div className="flex gap-6 h-[calc(100vh-200px)]">
        <div className="w-80 flex-shrink-0 overflow-hidden flex flex-col">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 flex-1 overflow-y-auto">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Package className="w-4 h-4" />
              种子批次列表
            </h3>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-green-500"></div>
              </div>
            ) : filteredBatches.length > 0 ? (
              <div className="space-y-2">
                {filteredBatches.map((batch, index) => {
                  const isSelected = selectedBatchCode === batch.batch_code;
                  const status = batchChainStatus[batch.batch_code];
                  const completedStages = [status?.has_planting, status?.has_inspection, status?.has_processing, status?.has_inventory, status?.has_sales].filter(Boolean).length;
                  const progress = Math.round((completedStages / 5) * 100);
                  return (
                    <div
                      key={batch.id}
                      onClick={() => setSelectedBatchCode(batch.batch_code)}
                      className={`cursor-pointer rounded-lg border transition-all p-3 ${
                        isSelected
                          ? `${getBatchBgColor(index)} border-${getBatchColor(index).replace('500', '300')} shadow-md`
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${getBatchColor(index)}`}></div>
                        <span className={`font-semibold text-sm ${isSelected ? `${getBatchTextColor(index)}` : 'text-gray-700'}`}>
                          {formatBatchName(batch, index)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          batch.status === 'stocked' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {batch.status === 'stocked' ? '已入库' : batch.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{batch.variety_name}</p>
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                        <span>{batch.net_weight} kg</span>
                        <span>{batch.germination_rate}% 发芽率</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${getBatchColor(index)}`} style={{ width: `${progress}%` }}></div>
                      </div>
                      <p className="text-xs text-gray-400 mt-1 text-right">{completedStages}/5 环节完成</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">暂无批次数据</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {chainLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500 mx-auto mb-4"></div>
                <p className="text-gray-500">正在加载批次全链条数据...</p>
              </div>
            </div>
          ) : currentBatch && fullChainData ? (
            <div className="flex-1 overflow-y-auto space-y-6">
              <div className={`rounded-xl p-6 ${getBatchBgColor(displayIndex)} border border-${getBatchColor(displayIndex).replace('500', '200')}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-2xl ${getBatchColor(displayIndex)} flex items-center justify-center text-white`}>
                    <Package className="w-8 h-8" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-gray-800">{formatBatchName(currentBatch, displayIndex)}</h2>
                      <span className={`text-xs px-3 py-1 rounded-full font-medium ${getBatchColor(displayIndex)} text-white`}>
                        {currentBatch.variety_name}
                      </span>
                    </div>
                    <p className="text-gray-600 text-sm mt-1">{currentBatch.batch_code}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                      <span className="flex items-center gap-1"><Building2 className="w-4 h-4" />{currentBatch.breeding_base}</span>
                      <span>{currentBatch.net_weight} kg</span>
                      <span>发芽率 {currentBatch.germination_rate}%</span>
                      <span>纯度 {currentBatch.purity}%</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleViewDetail(currentBatch)}
                    className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm hover:shadow transition-colors"
                  >
                    <Eye className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">查看详情</span>
                  </button>
                </div>
              </div>

              <div className="relative pl-8">
                <div className={`absolute left-[1.25rem] top-0 bottom-0 w-1 ${getBatchColor(displayIndex)} rounded-full`}></div>

                <div className="space-y-6">
                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${getBatchColor(displayIndex)} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <Sprout className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '种子采购与质检',
                      <Package className="w-4 h-4 text-green-600" />,
                      true,
                      'bg-green',
                      fullChainData.seed,
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs text-gray-500">供应商</p>
                            <p className="text-sm font-medium text-gray-800">{fullChainData.seed.supplier?.name || '-'}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs text-gray-500">繁育基地</p>
                            <p className="text-sm font-medium text-gray-800">{currentBatch.breeding_base}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs text-gray-500">存放位置</p>
                            <p className="text-sm font-medium text-gray-800">{currentBatch.storage_location}</p>
                          </div>
                        </div>
                        {fullChainData.seed.quality_tests && fullChainData.seed.quality_tests.length > 0 && (
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-500 mb-2">质检记录</p>
                            <div className="space-y-1">
                              {fullChainData.seed.quality_tests.slice(0, 3).map((test) => (
                                <div key={test.id} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-600">{test.test_item}</span>
                                  <span className={`${test.is_qualified ? 'text-green-600' : 'text-red-600'}`}>
                                    {test.is_qualified ? '合格' : '不合格'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${currentStatus?.has_planting ? getBatchColor(displayIndex) : 'bg-gray-300'} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <Leaf className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '田间种植',
                      <Leaf className="w-4 h-4 text-emerald-600" />,
                      currentStatus?.has_planting || false,
                      'bg-emerald',
                      fullChainData.planting,
                      <div className="space-y-3">
                        {fullChainData.planting.records && fullChainData.planting.records.length > 0 && (
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-500 mb-2">种植记录</p>
                            <div className="space-y-2">
                              {fullChainData.planting.records.slice(0, 2).map((record) => (
                                <div key={record.id} className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-gray-800">
                                      {fullChainData.planting.plots?.[String(record.plot_id)]?.name || fullChainData.planting.plots?.[record.plot_id]?.name || '未知地块'}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      种植日期: {formatDateCn(record.planting_date)} | 种植量: {record.quantity_planted} kg
                                    </p>
                                  </div>
                                  <span className={`text-xs px-2 py-1 rounded ${
                                    record.status === 'growing' ? 'bg-yellow-100 text-yellow-700' :
                                    record.status === 'harvested' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {record.status === 'growing' ? '生长中' : record.status === 'harvested' ? '已采收' : record.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {fullChainData.planting.environmental_data && fullChainData.planting.environmental_data.length > 0 && (
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-500 mb-2">环境监测（最新）</p>
                            {(() => {
                              const env = fullChainData.planting.environmental_data[0];
                              const metrics = [
                                { icon: Thermometer, cls: 'text-red-500', label: '空气温度', value: env.temperature, unit: '°C' },
                                { icon: Flame, cls: 'text-orange-600', label: '土壤温度', value: (env as any).soil_temperature, unit: '°C' },
                                { icon: Leaf, cls: 'text-green-600', label: '土壤湿度', value: env.soil_moisture, unit: '%' },
                                { icon: Droplets, cls: 'text-blue-500', label: '空气湿度', value: env.humidity, unit: '%' },
                                { icon: Gauge, cls: 'text-purple-500', label: 'pH', value: env.ph_value, unit: '' },
                                { icon: Ruler, cls: 'text-blue-600', label: '电导率', value: env.conductivity, unit: 'μS/cm' },
                                { icon: FlaskRound, cls: 'text-green-700', label: '氮', value: env.nitrogen, unit: 'mg/kg' },
                                { icon: Beaker, cls: 'text-red-500', label: '磷', value: env.phosphorus, unit: 'mg/kg' },
                                { icon: CircleDot, cls: 'text-purple-600', label: '钾', value: env.potassium, unit: 'mg/kg' },
                                { icon: Sparkles, cls: 'text-amber-600', label: '盐分', value: env.salinity, unit: 'mg/kg' },
                                { icon: Sun, cls: 'text-amber-500', label: '光照', value: env.illumination, unit: 'lux' },
                                { icon: Wind, cls: 'text-cyan-600', label: '风速', value: env.wind_speed, unit: 'm/s' },
                              ].filter((m) => m.value !== null && m.value !== undefined && m.value !== '');
                              return (
                                <div className="grid grid-cols-4 gap-2">
                                  {metrics.map((m, i) => {
                                    const Icon = m.icon;
                                    return (
                                      <div key={i} className="flex items-center gap-2 text-xs">
                                        <Icon className={`w-3 h-3 ${m.cls}`} />
                                        <span className="text-gray-600">
                                          {m.label} {m.value}
                                          {m.unit}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${currentStatus?.has_pesticide ? getBatchColor(displayIndex) : 'bg-gray-300'} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <AlertTriangle className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '农药施用',
                      <AlertTriangle className="w-4 h-4 text-amber-600" />,
                      currentStatus?.has_pesticide || false,
                      'bg-amber',
                      fullChainData.planting?.pesticide_applications,
                      <div className="space-y-2">
                        {fullChainData.planting.pesticide_applications && fullChainData.planting.pesticide_applications.length > 0 && (
                          fullChainData.planting.pesticide_applications.slice(0, 3).map((app) => {
                            const pesticide = fullChainData.planting.pesticides?.[String(app.pesticide_id)] || fullChainData.planting.pesticides?.[app.pesticide_id];
                            return (
                              <div key={app.id} className="bg-white rounded-lg p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium text-gray-800">{pesticide?.name || '未知农药'}</span>
                                  <span className="text-xs text-gray-500">{formatDateCn(app.application_date)}</span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-gray-500">
                                  <span>用量: {app.dosage} {app.unit}</span>
                                  <span>施药人: {app.applicator}</span>
                                  <span className={`${app.is_compliant ? 'text-green-600' : 'text-red-600'}`}>
                                    {app.is_compliant ? '合规' : '不合规'}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${currentStatus?.has_inspection ? getBatchColor(displayIndex) : 'bg-gray-300'} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <FileCheck className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '质量检测',
                      <FileCheck className="w-4 h-4 text-purple-600" />,
                      currentStatus?.has_inspection || false,
                      'bg-purple',
                      fullChainData.inspection,
                      <div className="space-y-2">
                        {fullChainData.inspection.reports && fullChainData.inspection.reports.length > 0 && (
                          fullChainData.inspection.reports.slice(0, 3).map((report) => (
                            <div key={report.id} className="bg-white rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-800">{report.report_code}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  report.is_qualified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {report.is_qualified ? '合格' : '不合格'}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span>{report.report_type}</span>
                                <span>{report.inspection_agency}</span>
                                <span>{formatDateCn(report.report_date)}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${currentStatus?.has_processing ? getBatchColor(displayIndex) : 'bg-gray-300'} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <Factory className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '加工处理',
                      <Factory className="w-4 h-4 text-orange-600" />,
                      currentStatus?.has_processing || false,
                      'bg-orange',
                      fullChainData.processing,
                      <div className="space-y-3">
                        {fullChainData.processing.batches && fullChainData.processing.batches.length > 0 && (
                          fullChainData.processing.batches.slice(0, 2).map((pb) => (
                            <div key={pb.id} className="bg-white rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <p className="text-sm font-medium text-gray-800">{pb.product_name}</p>
                                  <p className="text-xs text-gray-500">{pb.batch_code}</p>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${
                                  pb.status === 'completed' ? 'bg-green-100 text-green-700' :
                                  pb.status === 'processing' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {pb.status === 'completed' ? '已完成' : pb.status === 'processing' ? '加工中' : pb.status}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500">原料用量</span>
                                  <span className="text-gray-800">{pb.raw_material_quantity} kg</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500">产出量</span>
                                  <span className="text-gray-800">{pb.output_quantity} {pb.output_unit}</span>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                        {fullChainData.processing.records && Object.keys(fullChainData.processing.records).length > 0 && (
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-500 mb-2">加工工序</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {fullChainData.processing.records[Number(Object.keys(fullChainData.processing.records)[0])]?.slice(0, 4).map((step) => (
                                <span key={step.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                  {step.process_name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${currentStatus?.has_inventory ? getBatchColor(displayIndex) : 'bg-gray-300'} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <Warehouse className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '仓储库存',
                      <Warehouse className="w-4 h-4 text-cyan-600" />,
                      currentStatus?.has_inventory || false,
                      'bg-cyan',
                      fullChainData.inventory,
                      <div className="space-y-2">
                        {fullChainData.inventory && fullChainData.inventory.length > 0 && (
                          fullChainData.inventory.slice(0, 3).map((item) => (
                            <div key={item.id} className="bg-white rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-800">{item.item_name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  item.status === 'in_stock' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {item.status === 'in_stock' ? '在库' : item.status === 'out_of_stock' ? '已出库' : item.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span>数量: {item.quantity} {item.unit}</span>
                                <span>位置: {item.storage_location}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className={`absolute -left-[1.75rem] top-0 w-5 h-5 rounded-full ${currentStatus?.has_sales ? getBatchColor(displayIndex) : 'bg-gray-300'} border-4 border-white shadow-sm flex items-center justify-center`}>
                      <ShoppingCart className="w-3 h-3 text-white" />
                    </div>
                    {getStageCard(
                      '终端销售',
                      <ShoppingCart className="w-4 h-4 text-pink-600" />,
                      currentStatus?.has_sales || false,
                      'bg-pink',
                      fullChainData.sales,
                      <div className="space-y-2">
                        {fullChainData.sales.order_items && fullChainData.sales.order_items.length > 0 && (
                          fullChainData.sales.order_items.slice(0, 3).map((item) => {
                            const order = fullChainData.sales.orders?.[String(item.order_id)] || fullChainData.sales.orders?.[item.order_id];
                            return (
                              <div key={item.id} className="bg-white rounded-lg p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium text-gray-800">{item.item_name}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    order?.status === 'completed' ? 'bg-green-100 text-green-700' :
                                    order?.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                                    order?.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {order?.status === 'completed' ? '已完成' :
                                     order?.status === 'shipped' ? '已发货' :
                                     order?.status === 'pending' ? '待处理' : order?.status}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-gray-500">
                                  <span>订单号: {order?.order_no}</span>
                                  <span>数量: {item.quantity} {item.unit}</span>
                                  <span>金额: ¥{item.amount?.toLocaleString()}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">请选择一个种子批次</p>
                <p className="text-gray-400 text-sm mt-2">查看该批次的完整生命周期追溯信息</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加种子批次</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">批次编号</label>
                <input
                  type="text"
                  value={String(formData.batch_code || '')}
                  onChange={(e) => setFormData({ ...formData, batch_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="请输入批次编号"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">供应商</label>
                <select
                  value={String(formData.supplier_code || '')}
                  onChange={(e) => setFormData({ ...formData, supplier_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="">请选择供应商</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.supplier_code}>
                      {supplier.name} ({supplier.supplier_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">品种名称</label>
                <input
                  type="text"
                  value={String(formData.variety_name || '')}
                  onChange={(e) => setFormData({ ...formData, variety_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="请输入品种名称"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">净含量(kg)</label>
                  <input
                    type="number"
                    value={(formData.net_weight as number | undefined) ?? ''}
                    onChange={(e) => setFormData({ ...formData, net_weight: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">发芽率(%)</label>
                  <input
                    type="number"
                    value={(formData.germination_rate as number | undefined) ?? ''}
                    onChange={(e) => setFormData({ ...formData, germination_rate: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">纯度(%)</label>
                  <input
                    type="number"
                    value={(formData.purity as number | undefined) ?? ''}
                    onChange={(e) => setFormData({ ...formData, purity: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">存放位置</label>
                  <input
                    type="text"
                    value={String(formData.storage_location || '')}
                    onChange={(e) => setFormData({ ...formData, storage_location: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  取消
                </button>
                <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetailModal && selectedBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-800">种子批次详情</h3>
              <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">批次编号</p>
                <p className="font-medium text-gray-800">{selectedBatch.batch_code}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">品种名称</p>
                <p className="font-medium text-gray-800">{selectedBatch.variety_name}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">繁育基地</p>
                <p className="font-medium text-gray-800">{selectedBatch.breeding_base}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">净含量</p>
                <p className="font-medium text-gray-800">{selectedBatch.net_weight} kg</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">发芽率</p>
                <p className="font-medium text-gray-800">{selectedBatch.germination_rate}%</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">纯度</p>
                <p className="font-medium text-gray-800">{selectedBatch.purity}%</p>
              </div>
            </div>
            <div className="mb-4">
              <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <FileCheck className="w-4 h-4" />
                质量检测记录
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">检测项目</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">检测值</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">标准值</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">是否合格</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">检测日期</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {qualityTests.map((test) => (
                      <tr key={test.id}>
                        <td className="px-4 py-2 text-sm text-gray-800">{test.test_item}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{test.test_value}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{test.standard_value}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            test.is_qualified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {test.is_qualified ? '合格' : '不合格'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">{test.test_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mb-4 pt-4 border-t border-gray-200">
              <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Package className="w-4 h-4" />
                溯源二维码
              </h4>
              <div className="flex items-start gap-6">
                <div className="p-4 bg-gray-50 rounded-lg shrink-0">
                  {qrcodeData ? (
                    <img src={qrcodeData} alt="溯源二维码" className="w-32 h-32" />
                  ) : (
                    <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center">
                      <span className="text-gray-400 text-xs">生成中...</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-500 mb-2">扫码溯源</p>
                  <p className="text-xs text-gray-400">使用手机扫码可查看该批次的全链条溯源信息</p>
                  <p className="text-xs text-gray-400 mt-1">批次编号: {selectedBatch?.batch_code}</p>
                  {qrcodeUrl && (
                    <p className="text-xs text-gray-400 mt-1 break-all">扫码链接: {qrcodeUrl}</p>
                  )}
                  {qrcodeData && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        onClick={handleDownloadQrcode}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        下载 PNG
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintQrcode}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        打印贴纸
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyQrcodeLink}
                        disabled={!qrcodeUrl}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                        {copied ? '已复制' : '复制链接'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}