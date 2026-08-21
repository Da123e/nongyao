import { useState, useEffect } from 'react';
import { Plus, Search, Package, AlertTriangle, X, ArrowDownCircle, ArrowUpCircle, Link2 } from 'lucide-react';
import { inventoryApi, seedApi } from '../services/api';
import type { InventoryItem, SeedBatch } from '../types/index.ts';
import { BatchChainView } from '../components/BatchChainView';
import { canManageInventory } from '../utils/roles';

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

  useEffect(() => {
    fetchInventory();
    fetchAlerts();
    fetchSeedBatches();
    fetchWarehouses();
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [selectedSeedBatchCode]);

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
          <button onClick={handleAddItem} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
            <Plus className="w-4 h-4" />
            添加商品
          </button>
        )}
      </div>

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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">批次编号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种子批次</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">当前库存</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">最低/最高</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">单价</th>
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
                      <td className="px-6 py-4 text-sm text-gray-600">{item.item_type}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{item.batch_code}</td>
                      <td className="px-6 py-4">
                        {item.seed_batch_code ? (
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getBatchColor(colorIndex)}`}></div>
                            <span className={`text-sm font-medium ${getBatchTextColor(colorIndex)}`}>
                              {formatBatchName(item.seed_batch_code)}
                            </span>
                            <span className="text-xs text-gray-400">{item.seed_batch_code}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-800 font-medium">
                        {item.quantity} {item.unit}
                        {item.min_stock && item.quantity < item.min_stock && (
                          <span className="ml-2 text-xs text-red-500">⚠</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {item.min_stock} - {item.max_stock} {item.unit}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">¥{item.unit_price}</td>
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
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">数量</label>
                    <input
                      type="number"
                      value={formData.quantity || ''}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入数量"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">单据编号</label>
                    <input
                      type="text"
                      value={formData.source_document_no || ''}
                      onChange={(e) => setFormData({ ...formData, source_document_no: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入单据编号"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">操作员</label>
                    <input
                      type="text"
                      value={formData.operator || ''}
                      onChange={(e) => setFormData({ ...formData, operator: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入操作员"
                    />
                  </div>
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
    </div>
  );
}