import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, ShoppingCart, Truck, User, X, Eye, Package, Link2, MapPin, Edit3, Clock, Filter, AlertTriangle, BadgeCheck, PackageCheck, ArrowRightLeft, QrCode, Download, ArrowRight, Navigation, CheckCircle2, AlertCircle } from 'lucide-react';
import { salesApi, seedApi, processingApi } from '../services/api';
import type { Order, Customer, OrderItem, SeedBatch, LogisticsTracking } from '../types/index.ts';
import { BatchChainView } from '../components/BatchChainView';
import { canManageLogistics, canViewLogistics, canCreateOrders, canManageCustomers, canViewOrders } from '../utils/roles';
import { formatDateTimeCn } from '../utils/date';

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
  { value: 'pending', label: '待发货', color: 'bg-gray-100 text-gray-700' },
  { value: 'loading', label: '装车中', color: 'bg-amber-100 text-amber-700' },
  { value: 'in_transit', label: '运输中', color: 'bg-blue-100 text-blue-700' },
  { value: 'arrived', label: '已到达', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'delivered', label: '已派送', color: 'bg-teal-100 text-teal-700' },
  { value: 'signed', label: '已签收', color: 'bg-green-100 text-green-700' },
  { value: 'completed', label: '已完成', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'cancelled', label: '已取消', color: 'bg-red-100 text-red-700' },
];

const LOGISTICS_STATUS_GROUPS = {
  pending: ['pending'],
  in_transit: ['loading', 'in_transit'],
  arrived: ['arrived'],
  delivered: ['delivered', 'signed', 'completed'],
};

export function SalesManage() {
  const [activeTab, setActiveTab] = useState<'orders' | 'customers' | 'logistics'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [logisticsList, setLogisticsList] = useState<LogisticsTracking[]>([]);
  const [logisticsStatusFilter, setLogisticsStatusFilter] = useState<string>('all');
  const [logisticsCarrierFilter, setLogisticsCarrierFilter] = useState<string>('all');
  const [showLogisticsDetail, setShowLogisticsDetail] = useState(false);
  const [selectedLogistics, setSelectedLogistics] = useState<LogisticsTracking | null>(null);
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
  const [editingLogisticsId, setEditingLogisticsId] = useState<number | null>(null);
  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [itemFormData, setItemFormData] = useState<any>({});
  const [qrItem, setQrItem] = useState<OrderItem | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [processingBatches, setProcessingBatches] = useState<any[]>([]);
  const [submittingItem, setSubmittingItem] = useState(false);
  const [progressing, setProgressing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // 物流状态流转链：按顺序推进，支持快捷操作
  const LOGISTICS_FLOW = ['pending', 'loading', 'in_transit', 'arrived', 'delivered', 'signed', 'completed'];
  const getNextStatus = (currentStatus: string): string | null => {
    const idx = LOGISTICS_FLOW.indexOf(currentStatus);
    if (idx === -1 || idx >= LOGISTICS_FLOW.length - 1) return null;
    return LOGISTICS_FLOW[idx + 1];
  };
  const getStatusLabel = (val: string) => logisticsStatusOptions.find(s => s.value === val)?.label || val;

  const handleQuickProgress = async (logistics: any, nextStatus: string) => {
    setProgressing(true);
    try {
      const updateData: any = { status: nextStatus };
      // 推进到 in_transit 时自动填发货时间
      if (nextStatus === 'in_transit' && !logistics.departure_time) {
        updateData.departure_time = new Date().toISOString();
      }
      // 推进到 arrived 时记录当前位置为"到达"
      if (nextStatus === 'arrived') {
        updateData.current_location = logistics.destination || logistics.current_location;
      }
      // 推进到 delivered/signed 时自动写签收时间
      if (nextStatus === 'delivered' || nextStatus === 'signed') {
        updateData.sign_time = new Date().toISOString();
        updateData.current_location = logistics.destination || logistics.current_location;
      }
      await salesApi.updateLogistics(logistics.id, updateData);
      // 如果有订单关联的运单列表，刷新详情
      if (selectedOrder && selectedOrder.id === logistics.order_id) {
        const detailRes = await salesApi.getOrderDetail(logistics.order_id);
        setSelectedOrder(detailRes.data || detailRes);
      }
      alert(`物流状态已更新为「${getStatusLabel(nextStatus)}」`);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '更新失败';
      alert(msg);
    } finally {
      setProgressing(false);
    }
  };

  const handleUpdateLocation = async (logistics: any) => {
    const loc = prompt('请输入当前位置（如：驻马店市正阳县）', logistics.current_location || '');
    if (!loc) return;
    try {
      setProgressing(true);
      await salesApi.updateLogistics(logistics.id, { current_location: loc });
      if (selectedOrder && selectedOrder.id === logistics.order_id) {
        const detailRes = await salesApi.getOrderDetail(logistics.order_id);
        setSelectedOrder(detailRes.data || detailRes);
      }
      alert(`当前位置已更新为「${loc}」`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || '更新失败');
    } finally {
      setProgressing(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSeedBatches();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      if (activeTab === 'orders') {
        // 后端 GET /sales/orders 现已分页包装: {status, data, total, page, page_size}
        const res = await salesApi.getOrders({ page: 1, page_size: 100 });
        const payload = (res.data as any);
        const list: any[] = Array.isArray(payload?.data) ? payload.data : (Array.isArray(res.data) ? res.data : []);
        setOrders(list);
      } else if (activeTab === 'customers') {
        const res = await salesApi.getCustomers();
        setCustomers(res.data || []);
      } else {
        const res = await salesApi.getLogisticsList();
        setLogisticsList(((res.data as any)?.data as LogisticsTracking[]) || []);
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

  // 从首页快捷卡跳转带 ?action=xxx 或 ?tab=xxx 参数时自动切换
  useEffect(() => {
    const action = searchParams.get('action');
    const tab = searchParams.get('tab');
    if (action === 'new') {
      setActiveTab('orders');
      setModalType('order');
      setFormData({});
      setShowModal(true);
    }
    if (tab === 'customers') {
      setActiveTab('customers');
    } else if (tab === 'logistics') {
      setActiveTab('logistics');
    }
    if (action || tab) {
      searchParams.delete('action');
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const fetchProcessingBatches = async () => {
    try {
      const res = await processingApi.getBatches();
      const list = (res.data as any)?.data || res.data || [];
      setProcessingBatches(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to fetch processing batches:', err);
      setProcessingBatches([]);
    }
  };

  const handleAddItemClick = () => {
    setItemFormData({
      item_name: '',
      item_code: '',
      seed_batch_code: '',
      batch_code: '',
      processing_batch_id: '',
      quantity: '',
      unit: 'kg',
      unit_price: '',
      product_grade: '',
    });
    if (processingBatches.length === 0) {
      fetchProcessingBatches();
    }
    setShowAddItemModal(true);
  };

  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    if (!itemFormData.item_name || !itemFormData.quantity || !itemFormData.unit) {
      return;
    }
    setSubmittingItem(true);
    try {
      const payload: any = {
        item_name: itemFormData.item_name,
        quantity: Number(itemFormData.quantity),
        unit: itemFormData.unit,
      };
      if (itemFormData.item_code) payload.item_code = itemFormData.item_code;
      if (itemFormData.seed_batch_code) payload.seed_batch_code = itemFormData.seed_batch_code;
      if (itemFormData.batch_code) payload.batch_code = itemFormData.batch_code;
      if (itemFormData.processing_batch_id) payload.processing_batch_id = Number(itemFormData.processing_batch_id);
      if (itemFormData.unit_price !== '' && itemFormData.unit_price !== undefined) {
        payload.unit_price = Number(itemFormData.unit_price);
      }
      if (itemFormData.product_grade) payload.product_grade = itemFormData.product_grade;

      await salesApi.addOrderItem(selectedOrder.id, payload);
      setShowAddItemModal(false);
      // 刷新订单详情
      await handleViewDetail(selectedOrder);
    } catch (err: any) {
      console.error('Failed to add order item:', err);
      const detail = err?.response?.data?.detail || err?.message || '添加失败';
      alert(`添加商品失败：${detail}`);
    } finally {
      setSubmittingItem(false);
    }
  };

  const handleAddLogistics = (orderId: number) => {
    setCurrentOrderId(orderId);
    setEditingLogistics(false);
    setEditingLogisticsId(null);
    setLogisticsFormData({
      tracking_no: '',
      carrier: '',
      status: 'pending',
      origin: '',
      destination: '',
      current_location: '',
    });
    setShowLogisticsModal(true);
  };

  const handleEditLogistics = (orderId: number, logistics: any) => {
    setCurrentOrderId(orderId);
    setEditingLogistics(true);
    setEditingLogisticsId(logistics.id);
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
      if (editingLogistics && editingLogisticsId) {
        await salesApi.updateLogistics(editingLogisticsId, logisticsFormData);
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
          {(canCreateOrders() || canViewOrders()) && (
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
          )}
          {canManageCustomers() && (
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
          )}
          {canViewLogistics() && (
          <button
            onClick={() => setActiveTab('logistics')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'logistics' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Truck className="w-4 h-4" />
              物流运输{canManageLogistics() ? '' : ' (只读)'}
            </span>
          </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={activeTab === 'logistics' ? '搜索运单号/承运商/订单号...' : '搜索...'}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          {(activeTab === 'orders' && canCreateOrders()) || (activeTab === 'customers' && canManageCustomers()) ? (
            <button onClick={handleCreate} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
              <Plus className="w-4 h-4" />
              {activeTab === 'orders' ? '创建订单' : '添加客户'}
            </button>
          ) : null}
        </div>
      </div>

      {activeTab !== 'logistics' && (
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
                            order.status === 'paid' ? 'bg-indigo-100 text-indigo-700' :
                            order.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                            order.status === 'completed' ? 'bg-green-100 text-green-700' :
                            order.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                            order.status === 'refunded' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {order.status === 'pending' ? '待处理' :
                             order.status === 'paid' ? '已付款' :
                             order.status === 'shipped' ? '已发货' :
                             order.status === 'completed' ? '已完成' :
                             order.status === 'cancelled' ? '已取消' :
                             order.status === 'refunded' ? '已退款' : order.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const ps = order.payment_status || 'unpaid';
                            const psMap: Record<string, { cls: string; label: string }> = {
                              paid: { cls: 'bg-green-100 text-green-700', label: '已支付' },
                              unpaid: { cls: 'bg-red-100 text-red-700', label: '未支付' },
                              partial: { cls: 'bg-yellow-100 text-yellow-700', label: '部分支付' },
                              refund_pending: { cls: 'bg-orange-100 text-orange-700', label: '退款待处理' },
                              refunded: { cls: 'bg-gray-100 text-gray-500', label: '已退款' },
                            };
                            const info = psMap[ps] || { cls: 'bg-gray-100 text-gray-700', label: ps };
                            return <span className={`px-2 py-1 text-xs rounded-full ${info.cls}`}>{info.label}</span>;
                          })()}
                        </td>
                        <td className="px-6 py-4 text-sm text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleViewDetail(order)} className="text-gray-400 hover:text-green-500">
                              <Eye className="w-4 h-4" />
                            </button>
                            {order.status === 'pending' && canManageLogistics() && (
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单数</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">累计消费</th>
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
                      <td className="px-6 py-4 text-sm text-gray-700">
                        <span className="px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-700">
                          {customer.order_count || 0} 单
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-green-700">
                        ¥{(customer.total_spent || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">¥{customer.credit_limit?.toLocaleString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      )}

      {/* KPI 统计卡区（2~6 张） */}
      {activeTab === 'logistics' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {[
            { label: '运单总数', value: logisticsList.length, Icon: PackageCheck, bg: 'bg-blue-50', text: 'text-blue-600' },
            { label: '待发货', value: logisticsList.filter(l => LOGISTICS_STATUS_GROUPS.pending.includes(l.status)).length, Icon: Clock, bg: 'bg-yellow-50', text: 'text-yellow-600' },
            { label: '运输中', value: logisticsList.filter(l => LOGISTICS_STATUS_GROUPS.in_transit.includes(l.status)).length, Icon: Truck, bg: 'bg-indigo-50', text: 'text-indigo-600' },
            { label: '已到达/待签收', value: logisticsList.filter(l => LOGISTICS_STATUS_GROUPS.arrived.includes(l.status)).length, Icon: AlertTriangle, bg: 'bg-orange-50', text: 'text-orange-600' },
            { label: '已签收/完成', value: logisticsList.filter(l => LOGISTICS_STATUS_GROUPS.delivered.includes(l.status)).length, Icon: BadgeCheck, bg: 'bg-green-50', text: 'text-green-600' },
          ].map(({ label, value, Icon, bg, text }) => (
            <div key={label} className="min-w-[220px] bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-500 tracking-wide">{label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-gray-800 tabular-nums">{value}</p>
                </div>
                <div className={`w-11 h-11 rounded-xl ${bg} ${text} flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="min-w-[220px] bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium tracking-wide">待处理订单</p>
                <p className="text-2xl font-bold text-gray-800 tabular-nums">{orders.filter(o => o.status === 'pending').length}</p>
              </div>
            </div>
          </div>
          <div className="min-w-[220px] bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <Truck className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium tracking-wide">已发货订单</p>
                <p className="text-2xl font-bold text-gray-800 tabular-nums">{orders.filter(o => o.status === 'shipped').length}</p>
              </div>
            </div>
          </div>
          <div className="min-w-[220px] bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <ArrowRightLeft className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium tracking-wide">销售额合计</p>
                <p className="text-2xl font-bold text-gray-800 tabular-nums">¥{orders.reduce((sum, o) => sum + (o.total_amount || 0), 0).toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="min-w-[220px] bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium tracking-wide">客户数量</p>
                <p className="text-2xl font-bold text-gray-800 tabular-nums">{customers.length}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 主体表格区（横向滚动，含空态提示） */}
      {activeTab === 'logistics' && (
        <>
          {/* 物流筛选条（与搜索 Tab 头部分开的细粒度筛选，Status + Carrier Linear Tab 式） */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-medium text-gray-500 mr-1">状态：</span>
              {[
                { k: 'all', label: '全部' },
                ...logisticsStatusOptions.map(s => ({ k: s.value, label: s.label })),
              ].map(s => (
                <button
                  key={s.k}
                  onClick={() => setLogisticsStatusFilter(s.k)}
                  className={`relative px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                    logisticsStatusFilter === s.k
                      ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <span className="w-px h-4 bg-gray-200 mx-2" />
              <span className="text-xs font-medium text-gray-500 mr-1">承运商：</span>
              <select
                value={logisticsCarrierFilter}
                onChange={(e) => setLogisticsCarrierFilter(e.target.value)}
                className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-700 bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">全部承运商</option>
                {carriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {canManageLogistics() && (
              <button
                onClick={() => {
                  // 从待处理订单中选一个创建运单
                  const pendingOrders = orders.filter(o => o.status === 'pending');
                  if (pendingOrders.length === 0) {
                    alert('当前没有待发货的订单。请先在「订单管理」中创建订单。');
                    return;
                  }
                  if (pendingOrders.length === 1) {
                    handleAddLogistics(pendingOrders[0].id);
                    return;
                  }
                  const choices = pendingOrders.map((o, i) => `${i + 1}. ${o.order_no} (#${o.id}) - ¥${o.total_amount}`).join('\n');
                  const input = prompt(`请选择要创建运单的订单（输入序号 1-${pendingOrders.length}）:\n${choices}`);
                  if (!input) return;
                  const idx = parseInt(input) - 1;
                  if (idx < 0 || idx >= pendingOrders.length) { alert('无效序号'); return; }
                  handleAddLogistics(pendingOrders[idx].id);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl shadow-sm shadow-primary-200 hover:from-primary-700 hover:to-secondary-700 transition-all"
              >
                <Plus className="w-4 h-4" /> 为待发货订单创建运单
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-left">
                    <th className="px-5 py-3 font-medium">运单号</th>
                    <th className="px-5 py-3 font-medium">关联订单</th>
                    <th className="px-5 py-3 font-medium">承运商 / 车牌号</th>
                    <th className="px-5 py-3 font-medium">司机 / 电话</th>
                    <th className="px-5 py-3 font-medium">路线</th>
                    <th className="px-5 py-3 font-medium">预计到达</th>
                    <th className="px-5 py-3 font-medium">状态</th>
                    <th className="px-5 py-3 font-medium text-right pr-5">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    const filtered = logisticsList.filter(l => {
                      if (logisticsStatusFilter !== 'all' && l.status !== logisticsStatusFilter) return false;
                      if (logisticsCarrierFilter !== 'all' && l.carrier !== logisticsCarrierFilter) return false;
                      if (searchTerm) {
                        const term = searchTerm.toLowerCase();
                        if (!`${l.tracking_no || ''} ${l.carrier || ''} #${l.order_id || ''}`.toLowerCase().includes(term)) return false;
                      }
                      return true;
                    });
                    if (!filtered.length) {
                      return [
                        <tr key="empty">
                          <td colSpan={8} className="px-5">
                            <div className="py-16 flex flex-col items-center gap-3">
                              <div className="w-20 h-20 rounded-full bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">
                                <Truck className="w-10 h-10" />
                              </div>
                              <p className="text-sm font-semibold text-gray-600">暂无运单数据</p>
                              <p className="text-xs text-gray-400 max-w-sm text-center leading-relaxed">
                                切换到「订单管理」为待处理订单创建运单，或点击右上角「为待发货订单创建运单」。
                              </p>
                            </div>
                          </td>
                        </tr>,
                      ];
                    }
                    return filtered.map(l => {
                      const status = logisticsStatusOptions.find(s => s.value === l.status)?.label || l.status;
                      const statusCls =
                        ['delivered', 'signed', 'completed'].includes(l.status) ? 'bg-green-100 text-green-700'
                          : l.status === 'arrived' ? 'bg-orange-100 text-orange-700'
                          : ['in_transit', 'transit'].includes(l.status) ? 'bg-blue-100 text-blue-700'
                          : l.status === 'loading' ? 'bg-indigo-100 text-indigo-700'
                          : l.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                          : 'bg-yellow-100 text-yellow-700';
                      return (
                        <tr key={l.id} className="hover:bg-gray-50/70 transition-colors" style={{ height: 44 }}>
                          <td className="px-5 py-2 text-sm font-semibold text-primary-700 font-mono tracking-tight">{l.tracking_no}</td>
                          <td className="px-5 py-2 text-sm text-gray-700">#{l.order_id}</td>
                          <td className="px-5 py-2 text-sm text-gray-600">
                            <div className="font-medium text-gray-800">{l.carrier}</div>
                            {(l as any).vehicle_no && <div className="text-[11px] text-gray-400 mt-0.5">车牌：{(l as any).vehicle_no}</div>}
                          </td>
                          <td className="px-5 py-2 text-sm text-gray-600">
                            <div>{l.driver_name || '-'}</div>
                            {(l as any).driver_phone && <div className="text-[11px] text-gray-400 mt-0.5">{(l as any).driver_phone}</div>}
                          </td>
                          <td className="px-5 py-2 text-sm text-gray-600">
                            <div className="flex items-center gap-1.5 max-w-[280px]">
                              <MapPin className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              <span className="truncate">{l.origin || '-'}</span>
                              <ArrowRightLeft className="w-3 h-3 text-gray-300 shrink-0" />
                              <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              <span className="truncate">{l.destination || '-'}</span>
                            </div>
                          </td>
                          <td className="px-5 py-2 text-sm text-gray-600 tabular-nums">
                            {(l as any).estimated_arrival_time ? formatDateTimeCn((l as any).estimated_arrival_time) : '-'}
                          </td>
                          <td className="px-5 py-2">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${statusCls}`}>{status}</span>
                            {(l as any).current_location && (
                              <div className="text-[11px] text-gray-400 mt-1 max-w-[180px] truncate" title={(l as any).current_location}>📍 {(l as any).current_location}</div>
                            )}
                          </td>
                          <td className="px-5 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => { setSelectedLogistics(l); setShowLogisticsDetail(true); }}
                                title="运单详情"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {canManageLogistics() && (
                                <button
                                  onClick={() => handleEditLogistics(l.order_id, l)}
                                  title="编辑物流"
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
              <div className="flex items-center justify-between mb-3">
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Package className="w-4 h-4" />
                  订单商品
                </h4>
                {canCreateOrders() && selectedOrder.status !== 'completed' && (
                  <button
                    onClick={handleAddItemClick}
                    className="flex items-center gap-1 text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Plus className="w-3 h-3" />
                    添加商品
                  </button>
                )}
              </div>
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
                            <div className="flex items-center gap-1 justify-end">
                              {item.seed_batch_code && (
                                <button onClick={() => { setSelectedBatchCode(item.seed_batch_code!); setShowChainView(true); }} className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}>
                                  <Link2 className="w-3 h-3" />
                                  溯源
                                </button>
                              )}
                              {item.traceability_qr_code && (
                                <button onClick={() => { setQrItem(item); setShowQrModal(true); }} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-purple-50 text-purple-700 hover:bg-purple-100">
                                  <QrCode className="w-3 h-3" />
                                  二维码
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedOrder.logistics_list && selectedOrder.logistics_list.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <Truck className="w-4 h-4" />
                        物流信息 {selectedOrder.logistics_list.length > 1 && <span className="text-xs text-gray-400">({selectedOrder.logistics_list.length} 条)</span>}
                      </h4>
                    </div>
                    {selectedOrder.logistics_list.map((lg: any) => {
                      const statusInfo = logisticsStatusOptions.find(s => s.value === lg.status);
                      return (
                        <div key={lg.id} className="p-4 bg-blue-50 rounded-lg mb-2 last:mb-0">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                            <div>
                              <p className="text-xs text-gray-500">运单号</p>
                              <p className="text-sm font-medium text-gray-800">{lg.tracking_no}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">承运商</p>
                              <p className="text-sm font-medium text-gray-800">{lg.carrier}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">当前状态</p>
                              <span className={`px-2 py-1 text-xs rounded-full ${statusInfo?.color || 'bg-gray-100 text-gray-700'}`}>
                                {statusInfo?.label || lg.status}
                              </span>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">当前位置</p>
                              <p className="text-sm font-medium text-gray-800">{lg.current_location || '-'}</p>
                            </div>
                          </div>
                          {(lg.origin || lg.destination) && (
                            <div className="grid grid-cols-2 gap-3 mb-3">
                              {lg.origin && (
                                <div>
                                  <p className="text-xs text-gray-500">发货地</p>
                                  <p className="text-sm font-medium text-gray-800">{lg.origin}</p>
                                </div>
                              )}
                              {lg.destination && (
                                <div>
                                  <p className="text-xs text-gray-500">收货地</p>
                                  <p className="text-sm font-medium text-gray-800">{lg.destination}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {(lg.vehicle_no || lg.driver_name) && (
                            <div className="grid grid-cols-2 gap-3">
                              {lg.vehicle_no && (
                                <div>
                                  <p className="text-xs text-gray-500">车牌号</p>
                                  <p className="text-sm font-medium text-gray-800">{lg.vehicle_no}</p>
                                </div>
                              )}
                              {lg.driver_name && (
                                <div>
                                  <p className="text-xs text-gray-500">司机信息</p>
                                  <p className="text-sm font-medium text-gray-800">{lg.driver_name} {lg.driver_phone ? `(${lg.driver_phone})` : ''}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {canManageLogistics() && (
                            <div className="mt-3 pt-3 border-t border-blue-100 flex items-center gap-2">
                              <button
                                onClick={() => { setSelectedLogistics(lg); setShowLogisticsDetail(true); }}
                                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" /> 查看详情
                              </button>
                              {!['signed', 'completed', 'cancelled'].includes(lg.status) && (
                                <button
                                  onClick={() => { setCurrentOrderId(selectedOrder.id); setEditingLogistics(true); setEditingLogisticsId(lg.id); setLogisticsFormData({ tracking_no: lg.tracking_no, carrier: lg.carrier, status: lg.status, origin: lg.origin, destination: lg.destination, current_location: lg.current_location, vehicle_no: lg.vehicle_no, driver_name: lg.driver_name, driver_phone: lg.driver_phone }); setShowLogisticsModal(true); }}
                                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                >
                                  <Edit3 className="w-3 h-3" /> 编辑
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : selectedOrder.logistics ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <Truck className="w-4 h-4" />
                        物流信息
                      </h4>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
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
                          <span className={`px-2 py-1 text-xs rounded-full ${logisticsStatusOptions.find(s => s.value === selectedOrder.logistics.status)?.color || 'bg-gray-100 text-gray-700'}`}>
                            {logisticsStatusOptions.find(s => s.value === selectedOrder.logistics.status)?.label || selectedOrder.logistics.status}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">当前位置</p>
                          <p className="text-sm font-medium text-gray-800">{selectedOrder.logistics.current_location || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
          </div>
        </div>
      )}

      {showAddItemModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                为订单 {selectedOrder.order_no} 添加商品
              </h3>
              <button onClick={() => setShowAddItemModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleItemSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">商品名称 *</label>
                  <input
                    type="text"
                    value={itemFormData.item_name || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, item_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="如：一级花生仁"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">商品编码</label>
                  <input
                    type="text"
                    value={itemFormData.item_code || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, item_code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="可选，留空自动生成"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">种子批次</label>
                  <select
                    value={itemFormData.seed_batch_code || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, seed_batch_code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">不指定</option>
                    {seedBatches.map((b) => (
                      <option key={b.id} value={b.batch_code}>{b.batch_code} - {b.variety_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">加工批次</label>
                  <select
                    value={itemFormData.processing_batch_id || ''}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const pb = processingBatches.find((p) => String(p.id) === String(pid));
                      setItemFormData({
                        ...itemFormData,
                        processing_batch_id: pid,
                        batch_code: pb?.batch_code || itemFormData.batch_code || '',
                      });
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">不指定</option>
                    {processingBatches.map((p) => (
                      <option key={p.id} value={p.id}>{p.batch_code} - {p.product_name || ''} ({p.product_grade || '-'})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">批次编码</label>
                  <input
                    type="text"
                    value={itemFormData.batch_code || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, batch_code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="加工批次编码（溯源二维码使用）"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">产品等级</label>
                  <select
                    value={itemFormData.product_grade || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, product_grade: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">不指定</option>
                    <option value="特级">特级</option>
                    <option value="一级">一级</option>
                    <option value="二级">二级</option>
                    <option value="三级">三级</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">数量 *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemFormData.quantity || ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, quantity: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="如：100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">单位 *</label>
                  <select
                    value={itemFormData.unit || 'kg'}
                    onChange={(e) => setItemFormData({ ...itemFormData, unit: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="吨">吨</option>
                    <option value="袋">袋</option>
                    <option value="箱">箱</option>
                    <option value="件">件</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">单价（元）</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemFormData.unit_price ?? ''}
                    onChange={(e) => setItemFormData({ ...itemFormData, unit_price: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="可选"
                  />
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
                提示：填写种子批次或加工批次后，系统将自动生成溯源二维码（消费者扫码可访问 /trace/public?batch=... 公开溯源页）。
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAddItemModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button
                  type="submit"
                  disabled={submittingItem}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submittingItem ? '提交中...' : '添加商品'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChainView && (
        <BatchChainView batchCode={selectedBatchCode} onClose={() => setShowChainView(false)} />
      )}

      {/* 订单商品溯源二维码展示 */}
      {showQrModal && qrItem?.traceability_qr_code && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-gray-800">商品溯源二维码</h3>
              </div>
              <button onClick={() => { setShowQrModal(false); setQrItem(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 text-center">
              <div className="bg-gray-50 rounded-xl p-4 mb-3 inline-block">
                <img src={qrItem.traceability_qr_code} alt="溯源二维码" className="w-48 h-48" />
              </div>
              <p className="text-sm text-gray-600 mb-1">{qrItem.item_name}</p>
              <p className="text-xs text-gray-400 mb-3">批次：{qrItem.seed_batch_code || '-'}</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => {
                    if (qrItem.traceability_qr_code) {
                      const link = document.createElement('a');
                      link.href = qrItem.traceability_qr_code;
                      link.download = `溯源二维码_${qrItem.seed_batch_code || ''}.png`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  下载 PNG
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/trace/public?batch=${qrItem.seed_batch_code || ''}`;
                    navigator.clipboard.writeText(url);
                    alert('溯源链接已复制');
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  复制链接
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-400">手机扫码即可查看该商品的全产业链溯源信息</p>
            </div>
          </div>
        </div>
      )}

      {showLogisticsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
                    value={logisticsFormData.status || 'pending'}
                    onChange={(e) => setLogisticsFormData({ ...logisticsFormData, status: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-500"
                    disabled={editingLogistics && ['signed', 'completed', 'cancelled'].includes(logisticsFormData.status)}
                  >
                    {(() => {
                      const currentIdx = LOGISTICS_FLOW.indexOf(logisticsFormData.status || 'pending');
                      return logisticsStatusOptions.filter(o => {
                        if (o.value === 'completed') return false;
                        if (o.value === 'cancelled') return true;
                        if (!editingLogistics) return true;
                        return LOGISTICS_FLOW.indexOf(o.value) >= currentIdx;
                      }).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ));
                    })()}
                  </select>
                  {editingLogistics && ['signed', 'completed', 'cancelled'].includes(logisticsFormData.status) && (
                    <p className="text-xs text-orange-600 mt-1">已签收/已完成/已取消运单不可修改状态</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">当前位置</label>
                  <input
                    type="text"
                    value={logisticsFormData.current_location || ''}
                    onChange={(e) => setLogisticsFormData({ ...logisticsFormData, current_location: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="如：驻马店市正阳县"
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

      {/* 运单详情 Modal（只读，含状态时间轴与客户签收） */}
      {showLogisticsDetail && selectedLogistics && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center">
                  <PackageCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-800">运单详情</h3>
                  <p className="text-xs text-gray-500 font-mono">{selectedLogistics.tracking_no}</p>
                </div>
              </div>
              <button onClick={() => setShowLogisticsDetail(false)} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="rounded-xl bg-gray-50 p-3.5">
                  <div className="text-[11px] font-medium text-gray-500">关联订单</div>
                  <div className="mt-0.5 text-sm font-semibold text-gray-800">#{selectedLogistics.order_id}</div>
                </div>
                <div className="rounded-xl bg-gray-50 p-3.5">
                  <div className="text-[11px] font-medium text-gray-500">承运商</div>
                  <div className="mt-0.5 text-sm font-semibold text-gray-800">{selectedLogistics.carrier}</div>
                </div>
                <div className="rounded-xl bg-gray-50 p-3.5">
                  <div className="text-[11px] font-medium text-gray-500">当前状态</div>
                  <div className="mt-0.5 text-sm font-semibold text-primary-700">
                    {logisticsStatusOptions.find(s => s.value === selectedLogistics.status)?.label || selectedLogistics.status}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-100 overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-gray-100">
                  <div className="p-5 bg-green-50/40">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-700 mb-1.5">
                      <MapPin className="w-3.5 h-3.5" /> 发货地
                    </div>
                    <div className="text-sm font-semibold text-gray-800">{selectedLogistics.origin || '-'}</div>
                  </div>
                  <div className="p-5 bg-red-50/40">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-red-700 mb-1.5">
                      <MapPin className="w-3.5 h-3.5" /> 收货地
                    </div>
                    <div className="text-sm font-semibold text-gray-800">{selectedLogistics.destination || '-'}</div>
                  </div>
                </div>
                <div className="border-t border-gray-100 p-4 text-xs text-gray-500 space-y-1.5">
                  <div>📍 当前位置：<span className="text-gray-700">{(selectedLogistics as any).current_location || '-'}</span></div>
                  <div>🚗 车牌：<span className="text-gray-700">{(selectedLogistics as any).vehicle_no || '-'}</span> · 司机：<span className="text-gray-700">{selectedLogistics.driver_name || '-'}</span></div>
                  <div>📞 联系电话：<span className="text-gray-700">{(selectedLogistics as any).driver_phone || '-'}</span></div>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-100 p-5">
                <div className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> 运输时间线
                </div>
                <ol className="relative border-l-2 border-gray-100 ml-2 space-y-3">
                  {LOGISTICS_FLOW.map((statusVal, i) => {
                    const allIdx = LOGISTICS_FLOW.indexOf(selectedLogistics.status);
                    const done = i <= allIdx;
                    const option = logisticsStatusOptions.find(o => o.value === statusVal);
                    const Icon = statusVal === 'delivered' ? BadgeCheck : (statusVal === 'pending' ? Clock : Truck);
                    return (
                      <li key={statusVal} className="ml-5">
                        <span className={`absolute -left-[9px] flex items-center justify-center w-4 h-4 rounded-full ring-4 ring-white ${done ? 'bg-primary-500' : 'bg-gray-300'}`}>
                          <Icon className={`w-2 h-2 text-white`} />
                        </span>
                        <div className={`text-sm font-medium ${done ? 'text-gray-800' : 'text-gray-400'}`}>{option?.label || statusVal}</div>
                        <div className="text-[11px] text-gray-400">{i === allIdx ? '当前节点' : i < allIdx ? '已完成' : '待流转'}</div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* === 终态提示 === */}
              {['signed', 'completed', 'cancelled'].includes(selectedLogistics.status) && (
                <div className={`rounded-2xl border p-4 flex items-start gap-3 ${selectedLogistics.status === 'cancelled' ? 'border-red-200 bg-red-50/40' : 'border-green-200 bg-green-50/40'}`}>
                  {selectedLogistics.status === 'cancelled' ? <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" /> : <BadgeCheck className="w-5 h-5 text-green-600 flex-shrink-0" />}
                  <div>
                    <div className="text-sm font-semibold text-gray-800">
                      {selectedLogistics.status === 'cancelled' ? '该运单已取消' : selectedLogistics.status === 'signed' ? '该运单已签收，无需继续更新物流' : '该运单已完成，无需继续更新物流'}
                    </div>
                    {selectedLogistics.status !== 'cancelled' && (
                      <div className="text-xs text-gray-500 mt-1">
                        签收人：{selectedLogistics.signer || '-'} · 签收时间：{selectedLogistics.sign_time ? new Date(selectedLogistics.sign_time).toLocaleString('zh-CN') : '-'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* === 物流快捷进度操作 === */}
              {canManageLogistics() && !['signed', 'completed', 'cancelled'].includes(selectedLogistics.status) && (() => {
                const nextStatus = getNextStatus(selectedLogistics.status);
                const isAtDestination = selectedLogistics.current_location === selectedLogistics.destination;
                const statusIdx = LOGISTICS_FLOW.indexOf(selectedLogistics.status);
                const arrivedIdx = LOGISTICS_FLOW.indexOf('arrived');
                return (
                  <div className="rounded-2xl border-2 border-dashed border-green-200 bg-green-50/40 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
                      <Navigation className="w-4 h-4" />
                      物流进度快捷更新
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* 快捷：更新当前位置 */}
                      <button
                        onClick={() => handleUpdateLocation(selectedLogistics)}
                        disabled={progressing}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        更新当前位置
                      </button>
                      {/* 快捷：推进到下一状态（签收必须走客户签收按钮，不能跳过） */}
                      {nextStatus && nextStatus !== 'signed' && (
                        <button
                          onClick={() => handleQuickProgress(selectedLogistics, nextStatus)}
                          disabled={progressing}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50 shadow-sm"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          推进到「{getStatusLabel(nextStatus)}」
                        </button>
                      )}
                      {/* 快捷：直接标记到达目的地（仅在到达前可用） */}
                      {!isAtDestination && selectedLogistics.destination && statusIdx < arrivedIdx && (
                        <button
                          onClick={() => handleQuickProgress(selectedLogistics, 'arrived')}
                          disabled={progressing}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 shadow-sm"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          到达「{selectedLogistics.destination}」
                        </button>
                      )}
                      {/* 快捷：客户签收（必须填写签收人，且只能从已派送状态进入） */}
                      {selectedLogistics.status === 'delivered' && (
                        <button
                          onClick={() => {
                            const signer = prompt('请输入签收人姓名', selectedLogistics.signer || '');
                            if (!signer) return;
                            setProgressing(true);
                            salesApi.updateLogistics(selectedLogistics.id, {
                              status: 'signed',
                              signer,
                              sign_time: new Date().toISOString(),
                              current_location: selectedLogistics.destination || selectedLogistics.current_location,
                            }).then(() => {
                              if (selectedOrder && selectedOrder.id === selectedLogistics.order_id) {
                                salesApi.getOrderDetail(selectedLogistics.order_id).then((r: any) => {
                                  setSelectedOrder(r.data || r);
                                });
                              }
                              setShowLogisticsDetail(false);
                              alert(`客户「${signer}」已签收`);
                            }).catch((e: any) => alert(e?.response?.data?.detail || e?.message || '签收失败'))
                              .finally(() => setProgressing(false));
                          }}
                          disabled={progressing}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          客户签收
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-green-600">
                      💡 运输途中可随时更新当前位置；已派送时请点击"客户签收"并填写签收人完成流转。
                    </p>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowLogisticsDetail(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">关闭</button>
                {canManageLogistics() && !['signed', 'completed', 'cancelled'].includes(selectedLogistics.status) && (
                  <button
                    onClick={() => {
                      setShowLogisticsDetail(false);
                      handleEditLogistics(selectedLogistics.order_id, selectedLogistics);
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl shadow-sm hover:from-primary-700 hover:to-secondary-700"
                  >编辑运单</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}