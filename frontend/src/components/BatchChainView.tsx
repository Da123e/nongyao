import { useState, useEffect } from 'react';
import {
  Package,
  Sprout,
  Droplets,
  FileCheck,
  Factory,
  Warehouse,
  ShoppingCart,
  ArrowRight,
  X,
  Calendar,
  MapPin,
  User,
  Thermometer,
  Droplet,
  Leaf,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Hash,
  Scale,
  Building2,
  Utensils,
  Apple,
  Flame,
  GlassWater,
  Shield,
  Image,
  Link2,
  Database,
  ExternalLink,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { seedApi, api } from '../services/api';
import type { BatchFullChainData } from '../types/index.ts';
import { getCurrentRole, canViewSection, type UserRole } from '../utils/auth';

interface BatchChainViewProps {
  batchCode: string;
  onClose: () => void;
}

type SectionKey = 'seed' | 'planting' | 'pesticide' | 'processing' | 'inspection' | 'inventory' | 'sales';

export function BatchChainView({ batchCode, onClose }: BatchChainViewProps) {
  const [chainData, setChainData] = useState<BatchFullChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<SectionKey, boolean>>({
    seed: true,
    planting: true,
    pesticide: true,
    processing: true,
    inspection: true,
    inventory: true,
    sales: true,
  });
  const [blockchainStatus, setBlockchainStatus] = useState<any>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [chainValidity, setChainValidity] = useState<{ valid: boolean | null; details?: any }>({ valid: null });
  
  const currentRole = getCurrentRole();
  
  const getRoleLabel = (role: UserRole) => {
    const labels: Record<UserRole, string> = {
      admin: '系统管理员',
      farmer: '种植户',
      inspector: '质检员',
      warehouse_manager: '仓库管理员',
      salesperson: '销售人员',
      consumer: '消费者',
    };
    return labels[role];
  };

  useEffect(() => {
    if (batchCode) {
      fetchChainData();
    }
  }, [batchCode]);

  const fetchChainData = async () => {
    if (!batchCode) return;
    setLoading(true);
    try {
      const chainRes = await seedApi.getBatchFullChain(batchCode);
      
      if (chainRes && chainRes.data && chainRes.data.data) {
        setChainData(chainRes.data.data);
      } else {
        setChainData(null);
        return;
      }

      api.get(`/measurements/photos/${batchCode}`).then(res => {
        if (res.data && res.data.data) {
          setPhotos(res.data.data);
        }
      }).catch(() => {});

      api.get(`/blockchain/verify/${batchCode}`).then(res => {
        if (res.data) {
          const isSuccess = res.data.success !== false;
          if (isSuccess) {
            setChainValidity({
              valid: res.data.is_chain_valid || false,
              details: res.data,
            });
          } else {
            setChainValidity({
              valid: false,
              details: res.data,
            });
          }
        } else {
          setChainValidity({ valid: false, details: null });
        }
      }).catch((err) => {
        console.error('Blockchain verify error:', err);
        setChainValidity({ valid: false, details: null });
      });

      api.get('/blockchain/connection/status').then(res => {
        if (res.data) {
          setBlockchainStatus(res.data);
        }
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to fetch batch chain data:', err);
      setChainData(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: SectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('zh-CN');
    } catch {
      return '-';
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 w-full max-w-5xl">
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
          </div>
          <p className="text-center text-gray-500">正在加载批次全链条数据...</p>
        </div>
      </div>
    );
  }

  if (!chainData) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 w-full max-w-5xl text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">未能加载批次数据，请稍后重试</p>
          <button
            onClick={onClose}
            className="mt-6 px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  const { seed, planting, processing, inspection, inventory, sales } = chainData;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6" />
            <h2 className="text-xl font-bold">批次全链条溯源 - {batchCode}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-green-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Hash className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-gray-800">{seed.batch.batch_code}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-green-600" />
                  <span className="text-gray-600">{seed.batch.variety_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-green-600" />
                  <span className="text-gray-600">{seed.batch.breeding_base}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-blue-500" />
                  {blockchainStatus && !blockchainStatus.blockchain?.connected ? (
                    <span className="flex items-center gap-1 text-gray-500 text-sm">
                      <Database className="w-4 h-4" />
                      链未连接
                    </span>
                  ) : chainValidity.valid === null ? (
                    <span className="flex items-center gap-1 text-yellow-600 text-sm">
                      <RefreshCw className="w-4 h-4" />
                      链验证中
                    </span>
                  ) : chainValidity.valid ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      链完整
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-600 text-sm">
                      <XCircle className="w-4 h-4" />
                      链异常
                    </span>
                  )}
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  seed.batch.status === 'stocked' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {seed.batch.status === 'stocked' ? '已入库' : seed.batch.status}
                </span>
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {getRoleLabel(currentRole)}
                </span>
              </div>
            </div>

            {seed.batch.is_on_chain && seed.batch.blockchain_hash && (
              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-500" />
                  <span className="text-gray-500">区块链哈希:</span>
                  <span className="font-mono text-gray-700 truncate max-w-xs">{seed.batch.blockchain_hash}</span>
                </div>
                {seed.batch.ipfs_hash && (
                  <div className="flex items-center gap-2">
                    <Image className="w-4 h-4 text-orange-500" />
                    <span className="text-gray-500">IPFS:</span>
                    <span className="font-mono text-gray-700 truncate max-w-xs">{seed.batch.ipfs_hash}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <div className="absolute left-[1.25rem] top-0 bottom-0 w-0.5 bg-gray-200"></div>

            <div className="space-y-6">
              {canViewSection('seed', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-green-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <Package className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('seed')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">种子采购</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {seed.supplier?.name || '-'}
                    </span>
                  </div>
                  {expandedSections.seed ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.seed && (
                  <div className="mt-3 space-y-3">
                    <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">供应商</p>
                        <p className="font-medium text-gray-800">{seed.supplier?.name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">净含量</p>
                        <p className="font-medium text-gray-800">{seed.batch.net_weight} kg</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">发芽率</p>
                        <p className="font-medium text-gray-800">{seed.batch.germination_rate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">纯度</p>
                        <p className="font-medium text-gray-800">{seed.batch.purity}%</p>
                      </div>
                    </div>

                    {seed.quality_tests.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                          <FileCheck className="w-4 h-4" />
                          质量检测记录
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="px-3 py-2 text-left text-gray-500">检测项目</th>
                                <th className="px-3 py-2 text-left text-gray-500">检测值</th>
                                <th className="px-3 py-2 text-left text-gray-500">标准值</th>
                                <th className="px-3 py-2 text-left text-gray-500">检测日期</th>
                                <th className="px-3 py-2 text-left text-gray-500">结果</th>
                              </tr>
                            </thead>
                            <tbody>
                              {seed.quality_tests.map((test) => (
                                <tr key={test.id} className="border-t border-gray-100">
                                  <td className="px-3 py-2 text-gray-800">{test.test_item}</td>
                                  <td className="px-3 py-2 text-gray-600">{test.test_value}</td>
                                  <td className="px-3 py-2 text-gray-600">{test.standard_value}</td>
                                  <td className="px-3 py-2 text-gray-600">{formatDate(test.test_date)}</td>
                                  <td className="px-3 py-2">
                                    {test.is_qualified ? (
                                      <span className="flex items-center gap-1 text-green-600">
                                        <CheckCircle className="w-4 h-4" />
                                        <span className="text-xs">合格</span>
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-red-600">
                                        <XCircle className="w-4 h-4" />
                                        <span className="text-xs">不合格</span>
                                      </span>
                                    )}
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
              )}

              <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />

              {canViewSection('planting', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-lime-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <Sprout className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('planting')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">种植管理</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {planting.records.length} 条记录
                    </span>
                  </div>
                  {expandedSections.planting ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.planting && (
                  <div className="mt-3 space-y-3">
                    {planting.records.length > 0 ? (
                      planting.records.map((record) => {
                        const plot = planting.plots ? planting.plots[record.plot_id] : undefined;
                        return (
                          <div key={record.id} className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <span className="font-medium text-gray-800">
                                  {plot?.plot_code || '-'} - {plot?.name || '-'}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {formatDate(record.planting_date)} 种植
                                </span>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                record.status === 'planted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                              }`}>
                                {record.status === 'planted' ? '已种植' : record.status}
                              </span>
                            </div>
                            {plot && (
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-gray-400" />
                                  <span className="text-gray-600">{plot.location}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Scale className="w-4 h-4 text-gray-400" />
                                  <span className="text-gray-600">{plot.area} 亩</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <User className="w-4 h-4 text-gray-400" />
                                  <span className="text-gray-600">{record.farmer}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-4">暂无种植记录</p>
                    )}

                    {planting.environmental_data.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-3">环境监测数据（最新5条）</h4>
                        <div className="space-y-2">
                          {planting.environmental_data.slice(0, 5).map((data, idx) => {
                            const metrics = [
                              { icon: Thermometer, cls: 'text-red-500', label: '气温', value: data.temperature, unit: '°C' },
                              { icon: Flame, cls: 'text-orange-600', label: '土温', value: (data as any).soil_temperature, unit: '°C' },
                              { icon: Droplet, cls: 'text-blue-400', label: '空气湿度', value: data.humidity, unit: '%' },
                              { icon: Leaf, cls: 'text-green-600', label: '土壤湿度', value: data.soil_moisture, unit: '%' },
                              { icon: GlassWater, cls: 'text-purple-500', label: 'pH', value: data.ph_value, unit: '' },
                              { icon: Scale, cls: 'text-blue-600', label: '电导率', value: (data as any).conductivity, unit: 'μS/cm' },
                              { icon: Flame, cls: 'text-green-700', label: '氮', value: (data as any).nitrogen, unit: 'mg/kg' },
                              { icon: Flame, cls: 'text-red-500', label: '磷', value: (data as any).phosphorus, unit: 'mg/kg' },
                              { icon: Flame, cls: 'text-purple-600', label: '钾', value: (data as any).potassium, unit: 'mg/kg' },
                              { icon: Shield, cls: 'text-amber-600', label: '盐分', value: (data as any).salinity, unit: 'mg/kg' },
                            ].filter((m) => m.value !== null && m.value !== undefined && m.value !== '');
                            return (
                              <div key={data.id || idx} className="p-2 bg-gray-50 rounded-lg">
                                <p className="text-xs text-gray-500 mb-1">{formatDate(data.record_time)}</p>
                                <div className="flex flex-wrap gap-3">
                                  {metrics.map((m, i) => {
                                    const Icon = m.icon;
                                    return (
                                      <div key={i} className="flex items-center gap-1 text-xs">
                                        <Icon className={`w-3 h-3 ${m.cls}`} />
                                        <span className="text-gray-600">{m.label} {m.value}{m.unit}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />

              {canViewSection('pesticide', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-blue-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <Droplets className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('pesticide')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">农药管理</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {planting.pesticide_applications.length} 次施用
                    </span>
                  </div>
                  {expandedSections.pesticide ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.pesticide && (
                  <div className="mt-3">
                    {planting.pesticide_applications.length > 0 ? (
                      <div className="space-y-3">
                        {planting.pesticide_applications.map((app) => {
                          const pesticide = planting.pesticides ? planting.pesticides[app.pesticide_id] : undefined;
                          return (
                            <div key={app.id} className="bg-gray-50 rounded-lg p-4 flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div>
                                  <p className="font-medium text-gray-800">{pesticide?.name || '-'}</p>
                                  <p className="text-xs text-gray-500">{pesticide?.brand || '-'}</p>
                                </div>
                                <div className="text-sm">
                                  <span className="text-gray-600">{app.dosage} {app.unit}</span>
                                </div>
                                <div className="text-sm">
                                  <span className="text-gray-500">{formatDate(app.application_date)}</span>
                                </div>
                              </div>
                              {app.is_compliant ? (
                                <span className="flex items-center gap-1 text-green-600">
                                  <CheckCircle className="w-4 h-4" />
                                  <span className="text-xs">合规</span>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-red-600">
                                  <XCircle className="w-4 h-4" />
                                  <span className="text-xs">不合规</span>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-4">暂无农药施用记录</p>
                    )}
                  </div>
                )}
              </div>
              )}

              <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />

              {canViewSection('processing', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-orange-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <Factory className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('processing')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">加工管理</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {processing.batches.length} 个加工批次
                    </span>
                  </div>
                  {expandedSections.processing ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.processing && (
                  <div className="mt-3 space-y-3">
                    {processing.batches.length > 0 ? (
                      processing.batches.map((batch) => {
                        const getProductIcon = () => {
                          if (batch.product_name?.includes('花生油')) return <GlassWater className="w-5 h-5 text-amber-500" />;
                          if (batch.product_name?.includes('炒花生')) return <Flame className="w-5 h-5 text-orange-500" />;
                          if (batch.product_name?.includes('鲜花生')) return <Apple className="w-5 h-5 text-green-500" />;
                          if (batch.product_name?.includes('花生酱')) return <Utensils className="w-5 h-5 text-yellow-500" />;
                          return <Factory className="w-5 h-5 text-gray-500" />;
                        };

                        const getProductColor = () => {
                          if (batch.product_name?.includes('花生油')) return 'bg-amber-50 border-amber-200';
                          if (batch.product_name?.includes('炒花生')) return 'bg-orange-50 border-orange-200';
                          if (batch.product_name?.includes('鲜花生')) return 'bg-green-50 border-green-200';
                          if (batch.product_name?.includes('花生酱')) return 'bg-yellow-50 border-yellow-200';
                          return 'bg-gray-50 border-gray-200';
                        };

                        const getProductType = () => {
                          if (batch.product_name?.includes('花生油')) return '油品';
                          if (batch.product_name?.includes('炒花生')) return '炒制食品';
                          if (batch.product_name?.includes('鲜花生')) return '生鲜';
                          if (batch.product_name?.includes('花生酱')) return '调味品';
                          return '其他';
                        };

                        return (
                          <div key={batch.id} className={`rounded-lg p-4 border ${getProductColor()}`}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                  {getProductIcon()}
                                </div>
                                <div>
                                  <p className="font-medium text-gray-800">{batch.batch_code}</p>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-700">{batch.product_name}</span>
                                    <span className="text-xs text-gray-500">- {batch.product_grade}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded">
                                  {getProductType()}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  batch.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                                }`}>
                                  {batch.status === 'completed' ? '已完成' : batch.status}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-4 text-sm">
                              <div className="bg-white p-2 rounded">
                                <span className="text-gray-500 text-xs">原料投入</span>
                                <p className="font-medium text-gray-800">{batch.raw_material_quantity} kg</p>
                              </div>
                              <div className="bg-white p-2 rounded">
                                <span className="text-gray-500 text-xs">产出数量</span>
                                <p className="font-medium text-gray-800">{batch.output_quantity} kg</p>
                              </div>
                              <div className="bg-white p-2 rounded">
                                <span className="text-gray-500 text-xs">出成率</span>
                                <p className="font-medium text-gray-800">
                                  {batch.raw_material_quantity && batch.output_quantity
                                    ? ((batch.output_quantity / batch.raw_material_quantity) * 100).toFixed(1)
                                    : '0.0'}%
                                </p>
                              </div>
                              <div className="bg-white p-2 rounded">
                                <span className="text-gray-500 text-xs">加工日期</span>
                                <p className="font-medium text-gray-800">{formatDate(batch.processing_date)}</p>
                              </div>
                            </div>
                            {processing.records && processing.records[batch.id]?.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-gray-200">
                                <p className="text-xs text-gray-500 mb-2">加工工序</p>
                                <div className="flex flex-wrap gap-2">
                                  {processing.records[batch.id].map((record) => (
                                    <span key={record.id} className="text-xs bg-white text-blue-600 px-2 py-1 rounded border border-blue-200">
                                      {record.process_name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-4">暂无加工记录</p>
                    )}
                  </div>
                )}
              </div>
              )}

              <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />

              {canViewSection('inspection', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-purple-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <FileCheck className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('inspection')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">检测报告</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {inspection.reports.length} 份报告
                    </span>
                  </div>
                  {expandedSections.inspection ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.inspection && (
                  <div className="mt-3 space-y-3">
                    {inspection.reports.length > 0 ? (
                      inspection.reports.map((report) => (
                        <div key={report.id} className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="font-medium text-gray-800">{report.report_code}</p>
                              <p className="text-xs text-gray-500">{report.report_type}</p>
                            </div>
                            {report.is_qualified ? (
                              <span className="flex items-center gap-1 text-green-600">
                                <CheckCircle className="w-4 h-4" />
                                <span className="text-xs">合格</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-red-600">
                                <XCircle className="w-4 h-4" />
                                <span className="text-xs">不合格</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="text-gray-600">{formatDate(report.report_date)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <User className="w-4 h-4 text-gray-400" />
                              <span className="text-gray-600">{report.inspector}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Building2 className="w-4 h-4 text-gray-400" />
                              <span className="text-gray-600">{report.inspection_agency}</span>
                            </div>
                          </div>
                          {inspection.residue_tests && inspection.residue_tests[report.id]?.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="text-xs text-gray-500 mb-2">农药残留检测</p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-white">
                                      <th className="px-2 py-1 text-left text-gray-500">检测项目</th>
                                      <th className="px-2 py-1 text-left text-gray-500">限量值</th>
                                      <th className="px-2 py-1 text-left text-gray-500">实测值</th>
                                      <th className="px-2 py-1 text-left text-gray-500">结果</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inspection.residue_tests[report.id].map((test) => (
                                      <tr key={test.id}>
                                        <td className="px-2 py-1 text-gray-800">{test.test_item}</td>
                                        <td className="px-2 py-1 text-gray-600">{test.limit_value} {test.unit}</td>
                                        <td className="px-2 py-1 text-gray-600">{test.measured_value} {test.unit}</td>
                                        <td className="px-2 py-1">
                                          {test.is_over_limit ? (
                                            <span className="text-red-600 text-xs">超标</span>
                                          ) : (
                                            <span className="text-green-600 text-xs">合格</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-4">暂无检测报告</p>
                    )}
                  </div>
                )}
              </div>
              )}

              <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />

              {canViewSection('inventory', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-amber-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <Warehouse className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('inventory')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">库存管理</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {inventory.length} 项库存
                    </span>
                  </div>
                  {expandedSections.inventory ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.inventory && (
                  <div className="mt-3">
                    {inventory.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="px-3 py-2 text-left text-gray-500">商品编码</th>
                              <th className="px-3 py-2 text-left text-gray-500">商品名称</th>
                              <th className="px-3 py-2 text-left text-gray-500">批次</th>
                              <th className="px-3 py-2 text-left text-gray-500">数量</th>
                              <th className="px-3 py-2 text-left text-gray-500">单价</th>
                              <th className="px-3 py-2 text-left text-gray-500">仓库</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inventory.map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-3 py-2 text-gray-800">{item.item_code}</td>
                                <td className="px-3 py-2 text-gray-800">{item.item_name}</td>
                                <td className="px-3 py-2 text-gray-600">{item.batch_code}</td>
                                <td className="px-3 py-2 text-gray-600">{item.quantity} {item.unit}</td>
                                <td className="px-3 py-2 text-gray-600">{item.unit_price}</td>
                                <td className="px-3 py-2 text-gray-600">{item.warehouse_name || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-4">暂无库存记录</p>
                    )}
                  </div>
                )}
              </div>
              )}

              <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />

              {canViewSection('sales', currentRole) && (
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-emerald-500 border-4 border-white shadow-sm flex items-center justify-center">
                  <ShoppingCart className="w-3 h-3 text-white" />
                </div>

                <button
                  onClick={() => toggleSection('sales')}
                  className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-800">销售管理</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {sales.order_items.length} 笔订单
                    </span>
                  </div>
                  {expandedSections.sales ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {expandedSections.sales && (
                  <div className="mt-3">
                    {sales.order_items.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="px-3 py-2 text-left text-gray-500">订单号</th>
                              <th className="px-3 py-2 text-left text-gray-500">商品名称</th>
                              <th className="px-3 py-2 text-left text-gray-500">批次</th>
                              <th className="px-3 py-2 text-left text-gray-500">数量</th>
                              <th className="px-3 py-2 text-left text-gray-500">金额</th>
                              <th className="px-3 py-2 text-left text-gray-500">下单日期</th>
                              <th className="px-3 py-2 text-left text-gray-500">状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sales.order_items.map((item) => {
                              const order = sales.orders ? sales.orders[item.order_id] : undefined;
                              return (
                                <tr key={item.id} className="border-t border-gray-100">
                                  <td className="px-3 py-2 text-gray-800">{order?.order_no || '-'}</td>
                                  <td className="px-3 py-2 text-gray-800">{item.item_name}</td>
                                  <td className="px-3 py-2 text-gray-600">{item.batch_code}</td>
                                  <td className="px-3 py-2 text-gray-600">{item.quantity} {item.unit}</td>
                                  <td className="px-3 py-2 text-gray-600">{item.amount}</td>
                                  <td className="px-3 py-2 text-gray-600">{formatDate(order?.order_date)}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 rounded text-xs ${
                                      order?.status === 'completed' ? 'bg-green-100 text-green-700' : 
                                      order?.status === 'shipped' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                                    }`}>
                                      {order?.status === 'completed' ? '已完成' : 
                                       order?.status === 'shipped' ? '已发货' : order?.status || '-'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-4">暂无销售记录</p>
                    )}
                  </div>
                )}
              </div>
              )}

              {photos.length > 0 && (
                <>
                  <ArrowRight className="absolute left-[0.9rem] w-5 h-5 text-gray-300" />
                  <div className="relative pl-8">
                    <div className="absolute left-0 top-0 w-5 h-5 rounded-full bg-pink-500 border-4 border-white shadow-sm flex items-center justify-center">
                      <Image className="w-3 h-3 text-white" />
                    </div>

                    <div className="w-full bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-800">记录照片</span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {photos.length} 张
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {photos.map((photo, index) => (
                          <div key={photo.id || index} className="relative group">
                            <img
                              src={photo.gateway_url}
                              alt={photo.file_name || 'photo'}
                              className="w-full h-20 object-cover rounded-lg border border-gray-200"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                              <a
                                href={photo.gateway_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 bg-white rounded-full hover:bg-gray-100"
                              >
                                <ExternalLink className="w-4 h-4 text-gray-800" />
                              </a>
                            </div>
                            {photo.person_name && (
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                                <p className="text-xs text-white truncate">{photo.person_name}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-3">
                        照片存储在 IPFS 分布式存储网络中，哈希值已上链存证，不可篡改
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}