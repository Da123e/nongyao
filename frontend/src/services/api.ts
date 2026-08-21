import axios from 'axios';
import type {
  Sensor,
  MeasurementCreate,
  MeasurementListResponse,
  DailySummaryResponse,
  LatestEnvironmentalRecord,
} from '../types/index.ts';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

const getErrorMessage = (data: any): string => {
  if (!data) return '操作失败，请稍后重试';
  
  if (typeof data.detail === 'string') {
    return data.detail;
  }
  
  if (Array.isArray(data.detail)) {
    return data.detail.map((item: any) => {
      if (item.loc && item.msg) {
        const field = item.loc[item.loc.length - 1];
        return `${field}: ${item.msg}`;
      }
      return item.msg || JSON.stringify(item);
    }).join('\n');
  }
  
  if (typeof data.detail === 'object') {
    return JSON.stringify(data.detail);
  }
  
  return data.message || data.error || '操作失败，请稍后重试';
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    } else if (error.response?.status === 500) {
      console.error('Server Error:', error.response.data);
      const message = getErrorMessage(error.response.data);
      alert(`服务器内部错误：${message}`);
    } else if (error.response?.status === 403) {
      console.warn('Permission denied for:', error.response.config.url);
      alert('权限不足，无法执行此操作');
    } else if (error.response?.status === 404) {
      console.error('Not Found:', error.response.data);
      const message = getErrorMessage(error.response.data);
      alert(message);
    } else if (error.response?.status === 422) {
      console.error('Validation Error:', error.response.data);
      const message = getErrorMessage(error.response.data);
      alert(`数据验证失败：\n${message}`);
    } else if (error.code === 'ERR_NETWORK') {
      console.error('Network Error:', error);
      alert('网络连接失败，请检查服务器是否运行');
    } else if (error.code === 'ECONNABORTED') {
      alert('请求超时，请重试');
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/token', { username, password }),
  getProfile: () => api.get('/auth/users/me'),
  seedData: () => api.post('/auth/seed-data'),
  updateProfile: (data: { username?: string; phone?: string; email?: string }) =>
    api.put('/auth/users/me', data),
  changePassword: (data: { old_password: string; new_password: string }) =>
    api.post('/auth/users/me/change-password', data),
};

export const seedApi = {
  getSuppliers: (params?: any) => api.get('/seed/suppliers', { params }),
  createSupplier: (data: any) => api.post('/seed/suppliers', data),
  getBatches: (params?: any) => api.get('/seed/batches', { params }),
  createBatch: (data: any) => api.post('/seed/batches', data),
  getBatch: (batchCode: string) => api.get(`/seed/batches/${batchCode}`),
  getBatchFullChain: (batchCode: string) => api.get(`/seed/batches/${batchCode}/full-chain`),
  getQualityTests: (batchCode?: string) => api.get('/seed/quality-tests', { params: { batch_code: batchCode } }),
  createQualityTest: (data: any) => api.post('/seed/quality-tests', data),
};

export const plantingApi = {
  getPlots: (params?: any) => api.get('/planting/plots', { params }),
  createPlot: (data: any) => api.post('/planting/plots', data),
  getPlantingRecords: (params?: any) => api.get('/planting/planting-records', { params }),
  createPlantingRecord: (data: any) => api.post('/planting/planting-records', data),
  getEnvironmentalData: (plotCode: string, hours?: number) =>
    api.get('/planting/environmental-data', { params: { plot_code: plotCode, hours: hours || 24 } }),
  createEnvironmentalData: (data: any) => api.post('/planting/environmental-data', data),
  getFarmingActivities: (params?: any) => api.get('/planting/farming-activities', { params }),
  createFarmingActivity: (data: any) => api.post('/planting/farming-activities', data),
};

export const inspectionApi = {
  getReports: (params?: any) => api.get('/inspection/reports', { params }),
  createReport: (data: any) => api.post('/inspection/reports', data),
  getReport: (reportCode: string) => api.get(`/inspection/reports/${reportCode}`),
  getResidueTests: (reportCode?: string) => api.get('/inspection/residue-tests', { params: { report_code: reportCode } }),
  createResidueTest: (data: any) => api.post('/inspection/residue-tests', data),
  traceByBatch: (batchCode: string) => api.get(`/inspection/trace/${batchCode}`),
  exportTracePdf: (batchCode: string) => api.get(`/inspection/trace/${batchCode}/pdf`, { responseType: 'blob' }),
};

export const processingApi = {
  getBatches: (params?: any) => api.get('/processing/batches', { params }),
  createBatch: (data: any) => api.post('/processing/batches', data),
  getBatch: (batchCode: string) => api.get(`/processing/batches/${batchCode}`),
  getRecords: (params?: any) => api.get('/processing/records', { params }),
  createRecord: (data: any) => api.post('/processing/records', data),
};

export const inventoryApi = {
  getWarehouses: () => api.get('/inventory/warehouses'),
  createWarehouse: (data: any) => api.post('/inventory/warehouses', data),
  getInventory: (params?: any) => api.get('/inventory/inventory', { params }),
  createInventoryItem: (data: any) => api.post('/inventory/inventory', data),
  addTransaction: (itemId: number, data: any) => api.post(`/inventory/inventory/${itemId}/transactions`, data),
  getAlerts: () => api.get('/inventory/alerts'),
  getTransactions: (params?: any) => api.get('/inventory/transactions', { params }),
};

export const salesApi = {
  getCustomers: (params?: any) => api.get('/sales/customers', { params }),
  createCustomer: (data: any) => api.post('/sales/customers', data),
  getOrders: (params?: any) => api.get('/sales/orders', { params }),
  createOrder: (data: any) => api.post('/sales/orders', data),
  getOrderDetail: (orderId: number) => api.get(`/sales/orders/${orderId}`),
  updateOrderStatus: (orderId: number, status: string) => api.put(`/sales/orders/${orderId}/status`, { status }),
  addLogistics: (orderId: number, data: any) => api.post(`/sales/orders/${orderId}/logistics`, data),
  updateLogistics: (logisticsId: number, data: any) => api.put(`/sales/logistics/${logisticsId}`, data),
};

export const blockchainApi = {
  getConnectionStatus: () => api.get('/blockchain/connection/status'),
  getIpfsStatus: () => api.get('/blockchain/ipfs/status'),
  generateBatchId: (prefix?: string) => api.post('/blockchain/batch-id/generate', null, { params: { prefix } }),
  registerSeedBatch: (data: any) => api.post('/blockchain/seed/register', data),
  recordPlanting: (data: any) => api.post('/blockchain/planting/record', data),
  recordPesticide: (data: any) => api.post('/blockchain/pesticide/application', data),
  recordResidueTest: (data: any) => api.post('/blockchain/residue/test', data),
  recordHarvest: (data: any) => api.post('/blockchain/harvest/record', data),
  recordProcessing: (data: any) => api.post('/blockchain/processing/batch', data),
  recordProductTest: (data: any) => api.post('/blockchain/product/test', data),
  recordStorage: (data: any) => api.post('/blockchain/storage/record', data),
  recordLogistics: (data: any) => api.post('/blockchain/logistics/record', data),
  recordSales: (data: any) => api.post('/blockchain/sales/record', data),
  generateQrcode: (data: any) => api.post('/blockchain/qrcode/generate', data),
  getTraceChain: (seedBatchCode: string) => api.get(`/blockchain/trace/${seedBatchCode}`),
  verifyBatch: (seedBatchCode: string) => api.get(`/blockchain/verify/${seedBatchCode}`),
  consumerTrace: (seedBatchCode: string) => api.get(`/blockchain/consumer/trace/${seedBatchCode}`),
  generateKeyPair: () => api.post('/blockchain/key/generate'),
  verifySignature: (data: any) => api.post('/blockchain/signature/verify', data),
};

export const sensorApi = {
  getAll: () => api.get<Sensor[]>('/sensors/'),
  getById: (deviceId: string) => api.get<Sensor>(`/sensors/${deviceId}`),
  create: (data: Omit<Sensor, 'id' | 'status' | 'last_report_time' | 'created_at' | 'updated_at' | 'type_name' | 'default_items'>) =>
    api.post<Sensor>('/sensors/', data),
  update: (deviceId: string, data: Partial<Sensor>) =>
    api.put<Sensor>(`/sensors/${deviceId}`, data),
  delete: (deviceId: string) => api.delete(`/sensors/${deviceId}`),
  getTypes: () => api.get('/sensors/types'),
};

export const measurementApi = {
  sendData: (data: MeasurementCreate) => api.post('/measurements/data', data),
  getAll: (params?: { sensor_id?: number; device_id?: string; limit?: number; hours?: number }) =>
    api.get<MeasurementListResponse>('/measurements/', { params }),
  getLatest: () => api.get<MeasurementListResponse>('/measurements/latest'),
  getLatestEnvironmental: () =>
    api.get<{ status: string; count: number; data: LatestEnvironmentalRecord[] }>(
      '/measurements/latest-environmental'
    ),
  getBySensor: (deviceId: string, limit?: number, seedBatchCode?: string, date?: string) =>
    api.get<MeasurementListResponse>(`/measurements/sensor/${deviceId}`, {
      params: { limit, seed_batch_code: seedBatchCode, date },
    }),
  getDailySummary: (deviceId: string, date: string, seedBatchCode?: string) =>
    api.get<DailySummaryResponse>('/measurements/daily-summary', {
      params: { device_id: deviceId, date, seed_batch_code: seedBatchCode },
    }),
};

export const notificationApi = {
  getNotifications: () => api.get('/notifications'),
  markAsRead: (id: number) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};

export const statisticsApi = {
  getDashboard: () => api.get('/statistics/dashboard'),
};

export const operationsApi = {
  getRecentOperations: (limit?: number) => api.get('/operations/recent', { params: { limit } }),
};

export { api };
export default api;
