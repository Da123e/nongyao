import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Eye, FlaskConical, ShoppingCart, X, Link2, Leaf } from 'lucide-react';
import { api, seedApi } from '../services/api';
import type { SeedBatch } from '../types';
import { BatchChainView } from '../components/BatchChainView';
import { canManagePesticide, canManagePesticideCatalog } from '../utils/roles';
import { formatDateCn } from '../utils/date';

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

const formatBatchName = (batchCode: string) => {
  const match = batchCode.match(/(\d{4})-(\d{3})/);
  if (match) {
    return `批次${match[2]}`;
  }
  return batchCode;
};

interface Pesticide {
  id: number;
  pesticide_code: string;
  name: string;
  brand: string;
  registration_no: string;
  active_ingredient: string;
  toxicity_level: string;
  safety_interval: number;
}

interface PesticideUsage {
  id: number;
  pesticide_id: number;
  pesticide_name: string;
  plot_id: number;
  plot_code?: string;
  seed_batch_code: string;
  application_date: string;
  dosage: number;
  unit: string;
  target_pest: string;
  applicator: string;
}

interface PesticidePurchase {
  id: number;
  pesticide_id: number;
  pesticide_name: string;
  supplier_name: string;
  purchase_date: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_amount: number;
  storage_location: string;
}

interface Plot {
  id: number;
  plot_code: string;
  name: string;
}

export function PesticideManage() {
  const [activeTab, setActiveTab] = useState<'pesticides' | 'purchases' | 'usage'>('pesticides');
  const [pesticides, setPesticides] = useState<Pesticide[]>([]);
  const [usages, setUsages] = useState<PesticideUsage[]>([]);
  const [purchases, setPurchases] = useState<PesticidePurchase[]>([]);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [plantingRecords, setPlantingRecords] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'pesticide' | 'purchase' | 'usage'>('pesticide');
  const [showDetail, setShowDetail] = useState(false);
  const [selectedPesticide, setSelectedPesticide] = useState<Pesticide | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [seedBatches, setSeedBatches] = useState<SeedBatch[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchData();
    fetchSeedBatches();
    fetchPlots();
    if (activeTab === 'usage') {
      fetchPlantingRecords();
    }
  }, [activeTab]);

  const fetchData = async () => {
    try {
      if (activeTab === 'pesticides') {
        const res = await api.get('/pesticide/pesticides');
        setPesticides(res.data.data || []);
      } else if (activeTab === 'usage') {
        const res = await api.get('/pesticide/applications');
        const data = res.data.data || [];
        const pesticidesMap: Record<number, string> = {};
        pesticides.forEach(p => { pesticidesMap[p.id] = p.name; });
        const plotsMap: Record<number, string> = {};
        plots.forEach(p => { plotsMap[p.id] = p.plot_code; });
        setUsages(data.map((item: any) => ({
          ...item,
          pesticide_name: pesticidesMap[item.pesticide_id] || '未知农药',
          plot_code: plotsMap[item.plot_id] || `PLOT${item.plot_id}`,
        })));
      } else if (activeTab === 'purchases') {
        const res = await api.get('/pesticide/purchases');
        const data = res.data.data || [];
        const pesticidesMap: Record<number, string> = {};
        pesticides.forEach(p => { pesticidesMap[p.id] = p.name; });
        setPurchases(data.map((item: any) => ({
          ...item,
          pesticide_name: pesticidesMap[item.pesticide_id] || '未知农药',
        })));
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
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

  const fetchPlots = async () => {
    try {
      const res = await api.get('/planting/plots');
      setPlots(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch plots:', err);
    }
  };

  const fetchPlantingRecords = async () => {
    try {
      const res = await api.get('/planting/planting-records');
      setPlantingRecords(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch planting records:', err);
    }
  };

  const getPlotForSeedBatch = (seedBatchCode: string) => {
    const record = plantingRecords.find(r => r.seed_batch_code === seedBatchCode);
    if (record) {
      return plots.find(p => p.id === record.plot_id);
    }
    return null;
  };

  const getSeedBatchForPlot = (plotCode: string) => {
    const plot = plots.find(p => p.plot_code === plotCode);
    if (plot) {
      const record = plantingRecords.find(r => r.plot_id === plot.id && r.status === 'growing');
      return record?.seed_batch_code || '';
    }
    return '';
  };

  const handleAddPesticide = () => {
    setModalType('pesticide');
    setFormData({});
    setShowModal(true);
  };

  const handleAddPurchase = () => {
    setModalType('purchase');
    setFormData({});
    setShowModal(true);
  };

  const handleAddUsage = () => {
    setModalType('usage');
    setFormData({});
    setShowModal(true);
  };

  // 从首页快捷卡跳转带 ?action=xxx 参数时自动打开对应弹窗
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'new') {
      setActiveTab('pesticides');
      handleAddPesticide();
    } else if (action === 'purchase') {
      setActiveTab('purchases');
      handleAddPurchase();
    } else if (action === 'usage') {
      setActiveTab('usage');
      handleAddUsage();
    }
    if (action) {
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleViewPesticide = (pesticide: Pesticide) => {
    setSelectedPesticide(pesticide);
    setShowDetail(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'pesticide') {
        await api.post('/pesticide/pesticides', formData);
      } else if (modalType === 'purchase') {
        const pesticide = pesticides.find(p => p.id === formData.pesticide_id);
        await api.post('/pesticide/purchases', {
          ...formData,
          pesticide_code: pesticide?.pesticide_code || '',
        });
      } else if (modalType === 'usage') {
        const pesticide = pesticides.find(p => p.id === formData.pesticide_id);
        await api.post('/pesticide/applications', {
          ...formData,
          pesticide_id: formData.pesticide_id || 0,
          pesticide_code: pesticide?.pesticide_code || '',
          plot_code: formData.plot_code || '',
          application_date: formData.application_date ? `${formData.application_date}T00:00:00` : '',
          dosage: formData.dosage || 0,
          unit: formData.unit || 'kg/亩',
          application_method: formData.application_method || '',
          operator: formData.applicator || '',
        });
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      console.error('Failed to create:', err);
      const errorMsg = err?.response?.data?.detail || '添加失败，请稍后重试';
      alert(errorMsg);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('pesticides')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'pesticides' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4" />
              农药信息
            </span>
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'usage' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Leaf className="w-4 h-4" />
              使用记录
            </span>
          </button>
          <button
            onClick={() => setActiveTab('purchases')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'purchases' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              采购记录
            </span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          {canManagePesticide() && (
            <>
              {activeTab === 'pesticides' && canManagePesticideCatalog() && (
                <button onClick={handleAddPesticide} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                  <Plus className="w-4 h-4" />
                  添加农药
                </button>
              )}
              {activeTab === 'purchases' && (
                <button onClick={handleAddPurchase} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                  <Plus className="w-4 h-4" />
                  添加采购记录
                </button>
              )}
              {activeTab === 'usage' && (
                <button onClick={handleAddUsage} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                  <Plus className="w-4 h-4" />
                  添加使用记录
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'pesticides' ? (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">农药编码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">农药名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">品牌</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">登记证号</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">有效成分</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">毒性等级</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">安全间隔期(天)</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pesticides
                  .filter((p) => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      (p.pesticide_code?.toLowerCase().includes(term) || false) ||
                      (p.name?.toLowerCase().includes(term) || false) ||
                      (p.brand?.toLowerCase().includes(term) || false) ||
                      (p.registration_no?.toLowerCase().includes(term) || false) ||
                      (p.active_ingredient?.toLowerCase().includes(term) || false)
                    );
                  })
                  .map((pesticide) => (
                    <tr key={pesticide.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-green-700">{pesticide.pesticide_code}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{pesticide.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{pesticide.brand}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{pesticide.registration_no}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{pesticide.active_ingredient}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          pesticide.toxicity_level === '高毒' ? 'bg-red-100 text-red-700' :
                          pesticide.toxicity_level === '中毒' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {pesticide.toxicity_level}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{pesticide.safety_interval}</td>
                      <td className="px-6 py-4 text-sm text-right">
                        <button onClick={() => handleViewPesticide(pesticide)} className="text-gray-400 hover:text-green-500" title="查看详情">
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : activeTab === 'usage' ? (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">使用日期</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">农药名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种子批次</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">地块</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用量</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">防治对象</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作员</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usages
                  .filter((u) => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      (u.pesticide_name?.toLowerCase().includes(term) || false) ||
                      (u.seed_batch_code?.toLowerCase().includes(term) || false) ||
                      (u.plot_code?.toLowerCase().includes(term) || false) ||
                      (u.target_pest?.toLowerCase().includes(term) || false) ||
                      (u.applicator?.toLowerCase().includes(term) || false)
                    );
                  })
                  .map((usage, index) => {
                    const batchIndex = seedBatches.findIndex(b => b.batch_code === usage.seed_batch_code);
                    const colorIndex = batchIndex >= 0 ? batchIndex : index;
                    return (
                      <tr key={usage.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-600">{formatDateCn(usage.application_date)}</td>
                        <td className="px-6 py-4 text-sm text-gray-800">{usage.pesticide_name}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getBatchColor(colorIndex)}`}></div>
                            <span className={`text-sm font-medium ${getBatchTextColor(colorIndex)}`}>
                              {formatBatchName(usage.seed_batch_code)}
                            </span>
                            <span className="text-xs text-gray-400">{usage.seed_batch_code}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{usage.plot_code || `PLOT${usage.plot_id}`}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{usage.dosage} {usage.unit}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{usage.target_pest || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{usage.applicator || '-'}</td>
                        <td className="px-6 py-4 text-sm text-right">
                          <button onClick={() => { setSelectedBatchCode(usage.seed_batch_code); setShowChainView(true); }} className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}>
                            <Link2 className="w-3 h-3" />
                            溯源
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                {usages.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400">暂无农药使用记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">采购日期</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">农药名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">供应商</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">数量</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">单价</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">总金额</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">存放位置</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchases
                  .filter((p) => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      (p.pesticide_name?.toLowerCase().includes(term) || false) ||
                      (p.supplier_name?.toLowerCase().includes(term) || false) ||
                      (p.storage_location?.toLowerCase().includes(term) || false)
                    );
                  })
                  .map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-600">{formatDateCn(purchase.purchase_date)}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{purchase.pesticide_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{purchase.supplier_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{purchase.quantity} {purchase.unit}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">¥{purchase.unit_price}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-800">¥{purchase.total_amount}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{purchase.storage_location}</td>
                    </tr>
                  ))}
                {purchases.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400">暂无采购记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {modalType === 'pesticide' && '添加农药'}
                {modalType === 'purchase' && '添加采购记录'}
                {modalType === 'usage' && '添加使用记录'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {modalType === 'pesticide' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">农药编码</label>
                    <input
                      type="text"
                      value={formData.pesticide_code || ''}
                      onChange={(e) => setFormData({ ...formData, pesticide_code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入农药编码"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">农药名称</label>
                    <input
                      type="text"
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入农药名称"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
                    <input
                      type="text"
                      value={formData.brand || ''}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">登记证号</label>
                    <input
                      type="text"
                      value={formData.registration_no || ''}
                      onChange={(e) => setFormData({ ...formData, registration_no: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">有效成分</label>
                    <input
                      type="text"
                      value={formData.active_ingredient || ''}
                      onChange={(e) => setFormData({ ...formData, active_ingredient: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">毒性等级</label>
                      <select
                        value={formData.toxicity_level || ''}
                        onChange={(e) => setFormData({ ...formData, toxicity_level: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">请选择</option>
                        <option value="高毒">高毒</option>
                        <option value="中毒">中毒</option>
                        <option value="低毒">低毒</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">安全间隔期(天)</label>
                      <input
                        type="number"
                        value={formData.safety_interval || ''}
                        onChange={(e) => setFormData({ ...formData, safety_interval: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                </>
              )}
              {modalType === 'purchase' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">农药名称</label>
                    <select
                      value={formData.pesticide_id || ''}
                      onChange={(e) => setFormData({ ...formData, pesticide_id: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择农药</option>
                      {pesticides.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.pesticide_code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">供应商名称</label>
                    <input
                      type="text"
                      value={formData.supplier_name || ''}
                      onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入供应商名称"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">采购日期</label>
                    <input
                      type="date"
                      value={formData.purchase_date || ''}
                      onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">数量</label>
                      <input
                        type="number"
                        value={formData.quantity || ''}
                        onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="数量"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
                      <input
                        type="text"
                        value={formData.unit || 'kg'}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="单位"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单价(元)</label>
                      <input
                        type="number"
                        value={formData.unit_price || ''}
                        onChange={(e) => setFormData({ ...formData, unit_price: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="单价"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">总金额(元)</label>
                      <input
                        type="number"
                        value={formData.total_amount || ''}
                        onChange={(e) => setFormData({ ...formData, total_amount: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="总金额"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">存放位置</label>
                    <input
                      type="text"
                      value={formData.storage_location || ''}
                      onChange={(e) => setFormData({ ...formData, storage_location: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="存放位置"
                    />
                  </div>
                </>
              )}
              {modalType === 'usage' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">农药名称</label>
                    <select
                      value={formData.pesticide_id || ''}
                      onChange={(e) => setFormData({ ...formData, pesticide_id: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择农药</option>
                      {pesticides.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.pesticide_code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">种子批次</label>
                    {formData.plot_code && getSeedBatchForPlot(formData.plot_code) && formData.seed_batch_code === getSeedBatchForPlot(formData.plot_code) ? (
                      <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm text-green-700">
                          {formData.seed_batch_code}
                        </div>
                        <div className="text-xs text-green-600 mt-1">（根据地块自动关联）</div>
                      </div>
                    ) : (
                      <select
                        value={formData.seed_batch_code || ''}
                        onChange={(e) => {
                          const batchCode = e.target.value;
                          const plot = getPlotForSeedBatch(batchCode);
                          setFormData({ 
                            ...formData, 
                            seed_batch_code: batchCode,
                            plot_code: plot?.plot_code || '',
                          });
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        required
                      >
                        <option value="">请选择种子批次</option>
                        {seedBatches.map(b => {
                          const plot = getPlotForSeedBatch(b.batch_code);
                          const plotInfo = plot ? ` (${plot.plot_code} - ${plot.name})` : '';
                          return (
                            <option key={b.batch_code} value={b.batch_code}>
                              {b.batch_code} - {b.variety_name}{plotInfo}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">地块</label>
                    {formData.seed_batch_code && getPlotForSeedBatch(formData.seed_batch_code) ? (
                      <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm text-green-700">
                          {(() => {
                            const plot = getPlotForSeedBatch(formData.seed_batch_code);
                            return plot ? `${plot.plot_code} - ${plot.name}` : '';
                          })()}
                        </div>
                        <div className="text-xs text-green-600 mt-1">（根据种子批次自动关联）</div>
                      </div>
                    ) : (
                      <select
                        value={formData.plot_code || ''}
                        onChange={(e) => {
                          const plotCode = e.target.value;
                          const seedBatchCode = getSeedBatchForPlot(plotCode);
                          setFormData({ 
                            ...formData, 
                            plot_code: plotCode,
                            seed_batch_code: seedBatchCode || formData.seed_batch_code || '',
                          });
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        required
                      >
                        <option value="">请选择地块</option>
                        {plots.map(p => (
                          <option key={p.id} value={p.plot_code}>{p.plot_code} - {p.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">使用日期</label>
                    <input
                      type="date"
                      value={formData.application_date || ''}
                      onChange={(e) => setFormData({ ...formData, application_date: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">用量</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.dosage || ''}
                        onChange={(e) => setFormData({ ...formData, dosage: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="用量"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
                      <input
                        type="text"
                        value={formData.unit || 'kg/亩'}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="单位"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">防治对象</label>
                    <input
                      type="text"
                      value={formData.target_pest || ''}
                      onChange={(e) => setFormData({ ...formData, target_pest: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="防治对象"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">使用方法</label>
                    <select
                      value={formData.application_method || ''}
                      onChange={(e) => setFormData({ ...formData, application_method: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择使用方法</option>
                      <option value="喷雾">喷雾</option>
                      <option value="撒施">撒施</option>
                      <option value="灌根">灌根</option>
                      <option value="拌种">拌种</option>
                      <option value="熏蒸">熏蒸</option>
                      <option value="其他">其他</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">操作员</label>
                    <input
                      type="text"
                      value={formData.applicator || ''}
                      onChange={(e) => setFormData({ ...formData, applicator: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="操作员"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">天气条件</label>
                    <input
                      type="text"
                      value={formData.weather_condition || ''}
                      onChange={(e) => setFormData({ ...formData, weather_condition: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="天气条件"
                    />
                  </div>
                </>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetail && selectedPesticide && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">农药详情</h3>
              <button onClick={() => setShowDetail(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">农药编码</p>
                <p className="font-medium text-gray-800">{selectedPesticide.pesticide_code}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">农药名称</p>
                <p className="font-medium text-gray-800">{selectedPesticide.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">品牌</p>
                  <p className="font-medium text-gray-800">{selectedPesticide.brand}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">登记证号</p>
                  <p className="font-medium text-gray-800">{selectedPesticide.registration_no}</p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">有效成分</p>
                <p className="font-medium text-gray-800">{selectedPesticide.active_ingredient}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">毒性等级</p>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    selectedPesticide.toxicity_level === '高毒' ? 'bg-red-100 text-red-700' :
                    selectedPesticide.toxicity_level === '中毒' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {selectedPesticide.toxicity_level}
                  </span>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">安全间隔期</p>
                  <p className="font-medium text-gray-800">{selectedPesticide.safety_interval} 天</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showChainView && (
        <BatchChainView batchCode={selectedBatchCode} onClose={() => setShowChainView(false)} />
      )}
    </div>
  );
}