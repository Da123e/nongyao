import { useState, useEffect, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Factory, Clock, X, Eye, ChevronDown, ChevronUp, Link2, CheckCircle } from 'lucide-react';
import { processingApi, seedApi } from '../services/api';
import type { ProcessingBatch, ProcessingRecord, SeedBatch } from '../types/index.ts';
import { BatchChainView } from '../components/BatchChainView';
import { canManageProcessing } from '../utils/roles';

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

export function ProcessingManage() {
  const [batches, setBatches] = useState<ProcessingBatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchRecords, setBatchRecords] = useState<Record<string, ProcessingRecord[]>>({});
  const [selectedBatch, setSelectedBatch] = useState<ProcessingBatch | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [seedBatches, setSeedBatches] = useState<SeedBatch[]>([]);
  const [selectedSeedBatchCode, setSelectedSeedBatchCode] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchBatches();
    fetchSeedBatches();
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [selectedSeedBatchCode]);

  const fetchBatches = async () => {
    try {
      const res = await processingApi.getBatches({ seed_batch_code: selectedSeedBatchCode || undefined });
      setBatches(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch batches:', err);
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

  const handleCreate = () => {
    setFormData({});
    setShowModal(true);
  };

  // 从首页快捷卡跳转带 ?action=xxx 参数时自动打开对应弹窗
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'new') {
      handleCreate();
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
      await processingApi.createBatch(formData);
      setShowModal(false);
      fetchBatches();
    } catch (err: any) {
      console.error('Failed to create batch:', err);
      const errorMsg = err?.response?.data?.detail || '创建失败，请稍后重试';
      alert(errorMsg);
    }
  };

  const handleCompleteBatch = async (batch: ProcessingBatch) => {
    const defaultPrice = batch.product_grade === '特级' ? 20 : batch.product_grade === '一级' ? 15 : 10;
    const priceInput = prompt(
      `完成批次 ${batch.batch_code} 并入库\n\n` +
      `产品: ${batch.product_name} (${batch.product_grade || '普通'})\n` +
      `产量: ${batch.output_quantity} ${batch.output_unit || 'kg'}\n\n` +
      `请入库单价 (元/kg)，留空则使用默认值 ${defaultPrice}：`,
      String(defaultPrice)
    );
    if (priceInput === null) return;
    const unitPrice = parseFloat(priceInput);
    if (isNaN(unitPrice) || unitPrice < 0) {
      alert('请输入有效的单价（不小于0的数字）');
      return;
    }
    try {
      await processingApi.updateBatchStatus(batch.batch_code, { 
        status: 'completed',
        unit_price: unitPrice
      });
      alert(`批次 ${batch.batch_code} 已完成，库存已自动更新\n单价: ¥${unitPrice}/kg，总价值: ¥${((batch.output_quantity || 0) * unitPrice).toFixed(2)}`);
      fetchBatches();
    } catch (err: any) {
      console.error('Failed to complete batch:', err);
      const errorMsg = err?.response?.data?.detail || '操作失败，请稍后重试';
      alert(errorMsg);
    }
  };

  const toggleBatchDetail = async (batchCode: string) => {
    if (expandedBatch === batchCode) {
      setExpandedBatch(null);
    } else {
      setExpandedBatch(batchCode);
      if (!batchRecords[batchCode]) {
        try {
          const res = await processingApi.getRecords({ batch_code: batchCode });
          setBatchRecords({ ...batchRecords, [batchCode]: res.data.data || [] });
        } catch (err) {
          console.error('Failed to fetch processing records:', err);
        }
      }
    }
  };

  const handleViewBatch = (batch: ProcessingBatch) => {
    setSelectedBatch(batch);
    setShowDetail(true);
  };

  const handleViewChain = (batchCode: string) => {
    setSelectedBatchCode(batchCode);
    setShowChainView(true);
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
              placeholder="搜索批次编号..."
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
        {canManageProcessing() && (
          <button onClick={handleCreate} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
            <Plus className="w-4 h-4" />
            添加批次
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">批次编号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种子批次</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">产品名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">产品等级</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">加工日期</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">原料量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">产量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches
                .filter((b) => {
                  if (!searchTerm) return true;
                  const term = searchTerm.toLowerCase();
                  return (
                    (b.batch_code?.toLowerCase().includes(term) || false) ||
                    (b.seed_batch_code?.toLowerCase().includes(term) || false) ||
                    (b.product_name?.toLowerCase().includes(term) || false) ||
                    (b.product_grade?.toLowerCase().includes(term) || false)
                  );
                })
                .map((batch, index) => {
                  const batchIndex = seedBatches.findIndex(b => b.batch_code === batch.seed_batch_code);
                  const colorIndex = batchIndex >= 0 ? batchIndex : index;
                  return (
                    <Fragment key={batch.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <button onClick={() => toggleBatchDetail(batch.batch_code)} className="text-gray-400 hover:text-green-500">
                            {expandedBatch === batch.batch_code ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-green-700">{batch.batch_code}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getBatchColor(colorIndex)}`}></div>
                            <span className={`text-sm font-medium ${getBatchTextColor(colorIndex)}`}>
                              {formatBatchName(batch.seed_batch_code || '')}
                            </span>
                            <span className="text-xs text-gray-400">{batch.seed_batch_code}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-800">{batch.product_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{batch.product_grade}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{batch.processing_date}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{batch.raw_material_quantity ?? '-'} kg</td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {batch.output_quantity != null ? `${batch.output_quantity} ${batch.output_unit || 'kg'}` : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            batch.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                            batch.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {batch.status === 'processing' ? '加工中' : batch.status === 'completed' ? '已完成' : batch.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-right">
                          <div className="flex items-center justify-end gap-1">
                            {batch.status === 'processing' && canManageProcessing() && (
                              <button
                                onClick={() => handleCompleteBatch(batch)}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                                title="完成加工并入库"
                              >
                                <CheckCircle className="w-3 h-3" />
                                完成
                              </button>
                            )}
                            {batch.seed_batch_code && (
                              <button onClick={() => handleViewChain(batch.seed_batch_code!)} className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}>
                                <Link2 className="w-3 h-3" />
                                溯源
                              </button>
                            )}
                            <button onClick={() => handleViewBatch(batch)} className="text-gray-400 hover:text-green-500" title="查看详情">
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedBatch === batch.batch_code && (
                        <tr>
                          <td colSpan={10} className="px-6 py-4 bg-gray-50">
                            <div className="ml-6">
                              <h4 className="text-sm font-medium text-gray-700 mb-3">加工工序记录</h4>
                              <div className="grid grid-cols-4 gap-4">
                                {batchRecords[batch.batch_code]?.map((record, idx) => (
                                  <div key={record.id} className="bg-white p-3 rounded-lg border border-gray-200">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-xs font-medium">
                                        {record.process_order || idx + 1}
                                      </span>
                                      <span className="text-sm font-medium text-gray-800">{record.process_name}</span>
                                    </div>
                                    <p className="text-xs text-gray-500">{record.start_time} - {record.end_time}</p>
                                    <p className="text-xs text-gray-500 mt-1">操作员: {record.operator}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">进行中批次</p>
              <p className="text-2xl font-bold text-gray-800">{batches.filter(b => b.status === 'processing').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <Factory className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">本月加工量</p>
              <p className="text-2xl font-bold text-gray-800">{batches.reduce((sum, b) => sum + (b.output_quantity || 0), 0).toLocaleString()} kg</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Factory className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">产品种类</p>
              <p className="text-2xl font-bold text-gray-800">{new Set(batches.map(b => b.product_name)).size}</p>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加加工批次</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">批次编号</label>
                <input
                  type="text"
                  value={formData.batch_code || ''}
                  onChange={(e) => setFormData({ ...formData, batch_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="请输入批次编号"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">种子批次</label>
                <select
                  value={formData.seed_batch_code || ''}
                  onChange={(e) => {
                    const selectedCode = e.target.value;
                    const selectedBatch = seedBatches.find((b: any) => b.batch_code === selectedCode);
                    const updatedData: any = { ...formData, seed_batch_code: selectedCode };
                    if (selectedBatch) {
                      if (!formData.raw_material_quantity && selectedBatch.net_weight) {
                        updatedData.raw_material_quantity = selectedBatch.net_weight;
                      }
                      if (selectedBatch.variety_name) {
                        updatedData.product_name = formData.product_name || `${selectedBatch.variety_name}加工成品`;
                      }
                    }
                    setFormData(updatedData);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="">请选择种子批次</option>
                  {seedBatches
                    .filter((b: any) => !b.is_depleted)
                    .map((batch: any) => {
                      const remaining = batch.remaining_quantity ?? batch.net_weight ?? 0;
                      const total = batch.total_quantity ?? batch.net_weight ?? 0;
                      return (
                        <option key={batch.id} value={batch.batch_code}>
                          {batch.batch_code} - {batch.variety_name} (剩余: {remaining}{total ? `/${total}` : ''}kg)
                        </option>
                      );
                    })}
                </select>
                {(() => {
                  const selected = seedBatches.find((b: any) => b.batch_code === formData.seed_batch_code);
                  if (selected) {
                    const remaining = selected.remaining_quantity ?? selected.net_weight ?? 0;
                    return (
                      <p className="mt-1 text-xs text-gray-500">
                        可用库存: <span className={remaining > 0 ? 'text-green-600 font-medium' : 'text-red-600'}>{remaining} kg</span>
                        {selected.total_quantity && <span className="text-gray-400"> (总量: {selected.total_quantity} kg)</span>}
                        {selected.net_weight && <span className="text-gray-400">, 净重: {selected.net_weight} kg</span>}
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">产品名称</label>
                <select
                  value={formData.product_name || ''}
                  onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="">请选择产品类型</option>
                  <option value="花生油">花生油</option>
                  <option value="鲜花生">鲜花生</option>
                  <option value="炒花生">炒花生</option>
                  <option value="花生酱">花生酱</option>
                  <option value="其他">其他</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">产品等级</label>
                  <input
                    type="text"
                    value={formData.product_grade || ''}
                    onChange={(e) => setFormData({ ...formData, product_grade: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="如: 一级"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">加工日期</label>
                  <input
                    type="date"
                    value={formData.processing_date || ''}
                    onChange={(e) => setFormData({ ...formData, processing_date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">原料量(kg)</label>
                  {(() => {
                    const selected = seedBatches.find((b: any) => b.batch_code === formData.seed_batch_code);
                    const maxAllowed = selected ? (selected.remaining_quantity ?? selected.net_weight ?? 0) : null;
                    return (
                      <>
                        <input
                          type="number"
                          value={formData.raw_material_quantity || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (maxAllowed !== null && val > maxAllowed) {
                              alert(`原料量不能超过种子批次剩余库存 ${maxAllowed}kg`);
                              return;
                            }
                            setFormData({ ...formData, raw_material_quantity: val });
                          }}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                          required
                          max={maxAllowed ?? undefined}
                        />
                        {maxAllowed !== null && (
                          <p className="mt-1 text-xs text-gray-500">
                            最大允许: <span className="font-medium text-orange-600">{maxAllowed} kg</span>
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    产量(kg)
                    <span className="text-xs text-gray-400 ml-1">(建议为原料量的 85%)</span>
                  </label>
                  <input
                    type="number"
                    value={formData.output_quantity ?? ''}
                    onChange={(e) => setFormData({ ...formData, output_quantity: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder={formData.raw_material_quantity ? `建议: ${(formData.raw_material_quantity * 0.85).toFixed(1)}` : '请输入产量'}
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetail && selectedBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">加工批次详情</h3>
              <button onClick={() => setShowDetail(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">批次编号</p>
                <p className="font-medium text-gray-800">{selectedBatch.batch_code}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">种子批次编号</p>
                <p className="font-medium text-gray-800">{selectedBatch.seed_batch_code}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">产品名称</p>
                  <p className="font-medium text-gray-800">{selectedBatch.product_name}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">产品等级</p>
                  <p className="font-medium text-gray-800">{selectedBatch.product_grade}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">原料量</p>
                  <p className="font-medium text-gray-800">{selectedBatch.raw_material_quantity ?? '-'} kg</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">产量</p>
                  <p className="font-medium text-gray-800">
                    {selectedBatch.output_quantity != null 
                      ? `${selectedBatch.output_quantity} ${selectedBatch.output_unit || 'kg'}` 
                      : '-'}
                  </p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">加工日期</p>
                <p className="font-medium text-gray-800">{selectedBatch.processing_date}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-sm ${
                  selectedBatch.status === 'processing' ? 'bg-blue-100 text-blue-700' : 
                  selectedBatch.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {selectedBatch.status === 'processing' ? '加工中' : 
                   selectedBatch.status === 'completed' ? '已完成' : selectedBatch.status}
                </span>
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