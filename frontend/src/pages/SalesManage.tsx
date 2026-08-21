import { useState, useEffect } from 'react';
import { Plus, Search, ShoppingCart, Truck, User, X, Eye, Package, Link2, MapPin, Edit3 } from 'lucide-react';
import { salesApi, seedApi } from '../services/api';
import type { Order, Customer, OrderItem, SeedBatch } from '../types/index.ts';
import { BatchChainView } from '../components/BatchChainView';
import { canManageSales } from '../utils/roles';

const carriers = ['顺丰速运', '中通快递', '圆通速递', '申通快递', '韵达快递', 'EMS', '京东物流', '德邦物流', '其他'];

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

const logisticsStatusOptions = [
  { value: 'pending', label: '待发货' },
  { value: 'shipped', label: '已发货' },
  { value: 'transit', label: '运输中' },
  { value: 'arrived', label: '已到达' },
  { value: 'delivered', label: '已签收' },
];

export function SalesManage() {
  const [activeTab, setActiveTab] = useState<'orders' | 'customers'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'order' | 'customer'>('order');
  const [formData, setFormData] = useState<any>({});
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [seedBatches, setSeedBatches] = useState<SeedBatch[]>([]);
  const [showLogisticsModal, setShowLogisticsModal] = useState(false);
  const [logisticsFormData, setLogisticsFormData] = useState<any>({});
  const [editingLogistics, setEditingLogistics] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
    fetchSeedBatches();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      if (activeTab === 'orders') {
        const res = await salesApi.getOrders();
        setOrders(res.data || []);
      } else {
        const res = await salesApi.getCustomers();
        setCustomers(res.data || []);
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

  const handleCreate = () => {
    setModalType(activeTab === 'orders' ? 'order' : 'customer');
    setFormData({});
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'order') {
        await salesApi.createOrder(formData);
      } else {
        await salesApi.createCustomer(formData);
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      console.error('Failed to create:', err);
    }
  };

  const handleViewDetail = async (order: Order) => {
    try {
      const res = await salesApi.getOrderDetail(order.id);
      setSelectedOrder(res.data);
      setShowOrderDetail(true);
    } catch (err) {
      console.error('Failed to fetch order detail:', err);
      setSelectedOrder({ ...order, items: [] });
      setShowOrderDetail(true);
    }
  };

  const handleAddLogistics = (orderId: number) => {
    setCurrentOrderId(orderId);
    setEditingLogistics(false);
    setLogisticsFormData({
      tracking_no: '',
      carrier: '',
      status: 'shipped',
      origin: '',
      destination: '',
      current_location: '',
    });
    setShowLogisticsModal(true);
  };

  const handleEditLogistics = (orderId: number, logistics: any) => {
    setCurrentOrderId(orderId);
    setEditingLogistics(true);
    setLogisticsFormData({
      tracking_no: logistics.tracking_no || '',
      carrier: logistics.carrier || '',
      status: logistics.status || 'shipped',
      origin: logistics.origin || '',
      destination: logistics.destination || '',
      current_location: logistics.current_location || '',
      vehicle_no: logistics.vehicle_no || '',
      driver_name: logistics.driver_name || '',
      driver_phone: logistics.driver_phone || '',
    });
    setShowLogisticsModal(true);
  };

  const handleSubmitLogistics = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logisticsFormData.tracking_no) {
      alert('请输入运单号');
      return;
    }
    if (!logisticsFormData.carrier) {
      alert('请选择承运商');
      return;
    }
    try {
      if (editingLogistics) {
        await salesApi.updateLogistics(selectedOrder.logistics.id, logisticsFormData);
      } else {
        await salesApi.addLogistics(currentOrderId!, logisticsFormData);
      }
      setShowLogisticsModal(false);
      fetchData();
      if (showOrderDetail && selectedOrder) {
        handleViewDetail(selectedOrder);
      }
    } catch (err: any) {
      console.error('Failed to save logistics:', err);
      if (err.response?.data?.detail) {
        alert(err.response.data.detail);
      } else {
        alert('保存物流信息失败，请重试');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'orders' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              订单管理
            </span>
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'customers' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <User className="w-4 h-4" />
              客户管理
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
          {canManageSales() && (
            <button onClick={handleCreate} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
              <Plus className="w-4 h-4" />
              {activeTab === 'orders' ? '创建订单' : '添加客户'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'orders' ? (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单编号</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">客户</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">下单日期</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单金额</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">支付状态</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders
                  .filter((order) => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    const customer = customers.find(c => c.id === order.customer_id);
                    return (
                      (order.order_no?.toLowerCase().includes(term) || false) ||
                      (customer?.name?.toLowerCase().includes(term) || false) ||
                      (customer?.customer_code?.toLowerCase().includes(term) || false) ||
                      (order.status?.toLowerCase().includes(term) || false)
                    );
                  })
                  .map((order) => {
                    const customer = customers.find(c => c.id === order.customer_id);
                    return (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-green-700">{order.order_no}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{customer?.name || `#${order.customer_id}`}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{order.order_date}</td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-800">¥{order.total_amount?.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            order.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                            order.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {order.status === 'pending' ? '待处理' : order.status === 'shipped' ? '已发货' : order.status === 'completed' ? '已完成' : order.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            order.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {order.payment_status === 'paid' ? '已支付' : '未支付'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleViewDetail(order)} className="text-gray-400 hover:text-green-500">
                              <Eye className="w-4 h-4" />
                            </button>
                            {order.status === 'pending' && (
                              <button onClick={() => handleAddLogistics(order.id)} className="text-gray-400 hover:text-blue-500">
                                <Truck className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">客户编码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">客户名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">联系人</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">电话</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">客户类型</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">信用额度</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers
                  .filter((customer) => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      (customer.customer_code?.toLowerCase().includes(term) || false) ||
                      (customer.name?.toLowerCase().includes(term) || false) ||
                      (customer.contact_name?.toLowerCase().includes(term) || false) ||
                      (customer.phone?.toLowerCase().includes(term) || false)
                    );
                  })
                  .map((customer) => (
                    <tr key={customer.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-green-700">{customer.customer_code}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{customer.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{customer.contact_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{customer.phone}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{customer.customer_type}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">¥{customer.credit_limit?.toLocaleString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">待处理订单</p>
              <p className="text-2xl font-bold text-gray-800">{orders.filter(o => o.status === 'pending').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Truck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">已发货订单</p>
              <p className="text-2xl font-bold text-gray-800">{orders.filter(o => o.status === 'shipped').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">本月销售额</p>
              <p className="text-2xl font-bold text-gray-800">¥{orders.reduce((sum, o) => sum + (o.total_amount || 0), 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <User className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">客户数量</p>
              <p className="text-2xl font-bold text-gray-800">{customers.length}</p>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {modalType === 'order' ? '创建订单' : '添加客户'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {modalType === 'order' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">订单编号</label>
                    <input
                      type="text"
                      value={formData.order_no || ''}
                      onChange={(e) => setFormData({ ...formData, order_no: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入订单编号"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">客户</label>
                    <select
                      value={formData.customer_id || ''}
                      onChange={(e) => setFormData({ ...formData, customer_id: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择客户</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.customer_code} - {customer.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">订单金额</label>
                      <input
                        type="number"
                        value={formData.total_amount || ''}
                        onChange={(e) => setFormData({ ...formData, total_amount: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">支付状态</label>
                      <select
                        value={formData.payment_status || ''}
                        onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      >
                        <option value="unpaid">未支付</option>
                        <option value="paid">已支付</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">收货地址</label>
                    <textarea
                      value={formData.shipping_address || ''}
                      onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入收货地址"
                      rows={3}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">客户编码</label>
                    <input
                      type="text"
                      value={formData.customer_code || ''}
                      onChange={(e) => setFormData({ ...formData, customer_code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入客户编码"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">客户名称</label>
                    <input
                      type="text"
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入客户名称"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">联系人</label>
                      <input
                        type="text"
                        value={formData.contact_name || ''}
                        onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
                      <input
                        type="text"
                        value={formData.phone || ''}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                      <input
                        type="email"
                        value={formData.email || ''}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="请输入邮箱"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">客户类型</label>
                      <select
                        value={formData.customer_type || ''}
                        onChange={(e) => setFormData({ ...formData, customer_type: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">请选择类型</option>
                        <option value="批发商">批发商</option>
                        <option value="零售商">零售商</option>
                        <option value="个人客户">个人客户</option>
                        <option value="企业客户">企业客户</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
                    <textarea
                      value={formData.address || ''}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入地址"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">信用额度</label>
                    <input
                      type="number"
                      value={formData.credit_limit || ''}
                      onChange={(e) => setFormData({ ...formData, credit_limit: parseFloat(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入信用额度"
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

      {showOrderDetail && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-800">订单详情</h3>
              <button onClick={() => setShowOrderDetail(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">订单编号</p>
                <p className="font-medium text-gray-800">{selectedOrder.order_no}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">客户ID</p>
                <p className="font-medium text-gray-800">#{selectedOrder.customer_id}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">订单金额</p>
                <p className="font-medium text-gray-800">¥{selectedOrder.total_amount?.toLocaleString()}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">订单状态</p>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  selectedOrder.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  selectedOrder.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                  selectedOrder.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {selectedOrder.status === 'pending' ? '待处理' : selectedOrder.status === 'shipped' ? '已发货' : selectedOrder.status === 'completed' ? '已完成' : selectedOrder.status}
                </span>
              </div>
            </div>
            {selectedOrder.shipping_address && (
              <div className="mb-6">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-gray-500 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-500">收货地址</p>
                      <p className="font-medium text-gray-800">{selectedOrder.shipping_address}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-4">
              <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Package className="w-4 h-4" />
                订单商品
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">商品名称</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">批次</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">种子批次</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">单价</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">金额</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedOrder.items?.map((item: OrderItem, index: number) => {
                      const batchIndex = seedBatches.findIndex(b => b.batch_code === item.seed_batch_code);
                      const colorIndex = batchIndex >= 0 ? batchIndex : index;
                      return (
                        <tr key={item.id}>
                          <td className="px-4 py-2 text-sm text-gray-800">{item.item_name}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{item.batch_code}</td>
                          <td className="px-4 py-2">
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
                          <td className="px-4 py-2 text-sm text-gray-600">{item.quantity} {item.unit}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">¥{item.unit_price}</td>
                          <td className="px-4 py-2 text-sm text-gray-800">¥{item.amount}</td>
                          <td className="px-4 py-2 text-sm text-right">
                            {item.seed_batch_code && (
                              <button onClick={() => { setSelectedBatchCode(item.seed_batch_code!); setShowChainView(true); }} className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}>
                                <Link2 className="w-3 h-3" />
                                溯源
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedOrder.logistics && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Truck className="w-4 h-4" />
                    物流信息
                  </h4>
                  <button 
                    onClick={() => handleEditLogistics(selectedOrder.id, selectedOrder.logistics)}
                    className="flex items-center gap-1 text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Edit3 className="w-3 h-3" />
                    更新物流
                  </button>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div>
                      <p className="text-xs text-gray-500">运单号</p>
                      <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.tracking_no}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">承运商</p>
                      <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.carrier}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">当前状态</p>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        selectedOrder.logistics.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        selectedOrder.logistics.status === 'shipped' || selectedOrder.logistics.status === 'transit' ? 'bg-blue-100 text-blue-700' :
                        selectedOrder.logistics.status === 'arrived' ? 'bg-orange-100 text-orange-700' :
                        selectedOrder.logistics.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {logisticsStatusOptions.find(s => s.value === selectedOrder.logistics.status)?.label || selectedOrder.logistics.status}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">当前位置</p>
                      <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.current_location || '运输中'}</p>
                    </div>
                  </div>
                  {selectedOrder.logistics.origin || selectedOrder.logistics.destination ? (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {selectedOrder.logistics.origin && (
                        <div>
                          <p className="text-xs text-gray-500">发货地</p>
                          <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.origin}</p>
                        </div>
                      )}
                      {selectedOrder.logistics.destination && (
                        <div>
                          <p className="text-xs text-gray-500">收货地</p>
                          <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.destination}</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {selectedOrder.logistics.vehicle_no || selectedOrder.logistics.driver_name ? (
                    <div className="grid grid-cols-2 gap-3">
                      {selectedOrder.logistics.vehicle_no && (
                        <div>
                          <p className="text-xs text-gray-500">车牌号</p>
                          <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.vehicle_no}</p>
                        </div>
                      )}
                      {selectedOrder.logistics.driver_name && (
                        <div>
                          <p className="text-xs text-gray-500">司机信息</p>
                          <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.driver_name} {selectedOrder.logistics.driver_phone ? `(${selectedOrder.logistics.driver_phone})` : ''}</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showChainView && (
        <BatchChainView batchCode={selectedBatchCode} onClose={() => setShowChainView(false)} />
      )}

      {showLogisticsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingLogistics ? '更新物流信息' : '添加物流信息'}
              </h3>
              <button onClick={() => setShowLogisticsModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitLogistics} className="space-y-4">
              {!editingLogistics && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">运单号</label>
                    <input
                      type="text"
                      value={logisticsFormData.tracking_no || ''}
                      onChange={(e) => setLogisticsFormData({ ...logisticsFormData, tracking_no: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入运单号"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">承运商</label>
                    <select
                      value={logisticsFormData.carrier || ''}
                      onChange={(e) => setLogisticsFormData({ ...logisticsFormData, carrier: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择承运商</option>
                      {carriers.map((carrier) => (
                        <option key={carrier} value={carrier}>{carrier}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">发货地</label>
                      <input
                        type="text"
                        value={logisticsFormData.origin || ''}
                        onChange={(e) => setLogisticsFormData({ ...logisticsFormData, origin: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="请输入发货地"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">收货地</label>
                      <input
                        type="text"
                        value={logisticsFormData.destination || ''}
                        onChange={(e) => setLogisticsFormData({ ...logisticsFormData, destination: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="请输入收货地"
                        required
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">物流状态</label>
                  <select
                    value={logisticsFormData.status || 'shipped'}
                    onChange={(e) => setLogisticsFormData({ ...logisticsFormData, status: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    {logisticsStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">当前位置</label>
                  <input
                    type="text"
                    value={logisticsFormData.current_location || ''}
                    onChange={(e) => setLogisticsFormData({ ...logisticsFormData, current_location: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="如：临沂市兰山区"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">车牌号</label>
                  <input
                    type="text"
                    value={logisticsFormData.vehicle_no || ''}
                    onChange={(e) => setLogisticsFormData({ ...logisticsFormData, vehicle_no: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入车牌号"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">司机姓名</label>
                  <input
                    type="text"
                    value={logisticsFormData.driver_name || ''}
                    onChange={(e) => setLogisticsFormData({ ...logisticsFormData, driver_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="请输入司机姓名"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">司机电话</label>
                <input
                  type="text"
                  value={logisticsFormData.driver_phone || ''}
                  onChange={(e) => setLogisticsFormData({ ...logisticsFormData, driver_phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="请输入司机电话"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowLogisticsModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
                  {editingLogistics ? '更新物流' : '添加物流'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}