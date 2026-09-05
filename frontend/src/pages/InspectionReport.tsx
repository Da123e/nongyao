import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, FileText, CheckCircle, XCircle, Eye, X, Link2 } from 'lucide-react';
import { api, seedApi } from '../services/api';
import type { SeedBatch } from '../types';
import { BatchChainView } from '../components/BatchChainView';
import { canCreateInspection } from '../utils/roles';
import { formatDateTimeCn } from '../utils/date';

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
  // 格式 1: PB2026-001 / HB2026-003 等 「字母前缀 + YYYY-NNN」
  const pbMatch = batchCode.match(/([A-Z]{1,4})?(\d{4})-(\d{3})/);
  if (pbMatch) {
    return `批次${pbMatch[3]}`;
  }
  // 格式 2: BATCH-001 / SD-007 / 任意前缀-NNN
  const dashNum = batchCode.match(/-(\d{1,5})$/);
  if (dashNum) {
    return `批次${dashNum[1].padStart(3, '0')}`;
  }
  // 格式 3: PB20260818001 / 尾部纯数字 3+ 位
  const tailNum = batchCode.match(/(\d{3,6})$/);
  if (tailNum) {
    const num = tailNum[1];
    const short = num.length > 3 ? num.slice(-3) : num;
    return `批次${short.padStart(3, '0')}`;
  }
  return batchCode;
};

interface InspectionReportData {
  id: number;
  report_code: string;
  report_type: string;
  report_date: string;
  inspector: string;
  inspection_agency: string;
  is_qualified: boolean;
  certificate_no?: string;
  remarks?: string;
  seed_batch_code?: string;
}

interface ResidueTest {
  id: number;
  test_item: string;
  limit_value: number;
  measured_value: number;
  unit: string;
  is_over_limit: boolean;
  test_method?: string;
}

export function InspectionReport() {
  const [reports, setReports] = useState<InspectionReportData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReport, setSelectedReport] = useState<InspectionReportData | null>(null);
  const [residueTests, setResidueTests] = useState<ResidueTest[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [seedBatches, setSeedBatches] = useState<SeedBatch[]>([]);
  const [plantingRecords, setPlantingRecords] = useState<any[]>([]);
  const [plots, setPlots] = useState<any[]>([]);
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [selectedSeedBatchCode, setSelectedSeedBatchCode] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchReports();
    fetchSeedBatches();
    fetchPlantingRecords();
    fetchPlots();
  }, []);

  useEffect(() => {
    fetchReports();
  }, [selectedSeedBatchCode]);

  const fetchReports = async () => {
    try {
      let url = '/inspection/reports';
      if (selectedSeedBatchCode) {
        url += `?batch_code=${selectedSeedBatchCode}`;
      }
      const res = await api.get(url);
      setReports(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
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

  const fetchPlantingRecords = async () => {
    try {
      const res = await api.get('/planting/planting-records');
      setPlantingRecords(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch planting records:', err);
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

  const getPlotForSeedBatch = (seedBatchCode: string) => {
    const record = plantingRecords.find(r => r.seed_batch_code === seedBatchCode && r.status === 'growing');
    if (record) {
      return plots.find(p => p.id === record.plot_id);
    }
    return null;
  };

  const viewReportDetail = async (report: InspectionReportData) => {
    setSelectedReport(report);
    try {
      const res = await api.get(`/inspection/reports/${report.report_code}`);
      setResidueTests(res.data.data?.residue_tests || []);
    } catch (err) {
      console.error('Failed to fetch report details:', err);
      setResidueTests([]);
    }
  };

  const handleAddReport = () => {
    setFormData({});
    setShowModal(true);
  };

  // 从首页快捷卡跳转带 ?action=xxx 参数时自动打开对应弹窗
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'new') {
      handleAddReport();
    } else if (action === 'residue') {
      setFormData({ report_type: '农药残留检测' });
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
    if (formData.is_qualified === undefined) {
      alert('请选择检测结果');
      return;
    }
    try {
      await api.post('/inspection/reports', formData);
      setShowModal(false);
      fetchReports();
    } catch (err: any) {
      console.error('Failed to create report:', err);
      const errorMsg = err?.response?.data?.detail || '添加失败，请稍后重试';
      alert(errorMsg);
    }
  };

  const filteredReports = reports.filter(report => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (report.report_code?.toLowerCase().includes(term) || false) ||
      (report.report_type?.toLowerCase().includes(term) || false) ||
      (report.inspection_agency?.toLowerCase().includes(term) || false) ||
      (report.inspector?.toLowerCase().includes(term) || false) ||
      (report.seed_batch_code?.toLowerCase().includes(term) || false)
    );
  });

  const qualifiedRate = reports.length > 0
    ? ((reports.filter(r => r.is_qualified).length / reports.length) * 100).toFixed(1)
    : '0.0';

  const now = new Date();
  const monthlyReportCount = reports.filter(r => {
    const d = new Date(r.report_date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

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
              placeholder="搜索报告编号/类型/机构/检测员..."
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
              <option key={batch.id} value={batch.batch_code}>{formatBatchName(batch.batch_code)} - {batch.variety_name}</option>
            ))}
          </select>
        </div>
        {canCreateInspection() && (
          <button onClick={handleAddReport} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
            <Plus className="w-4 h-4" />
            添加报告
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">报告编号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种子批次</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">报告类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">检测日期</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">检测员</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">检测机构</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">检测结果</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredReports.length > 0 ? (
                filteredReports.map((report, index) => {
                  const batchIndex = report.seed_batch_code 
                    ? seedBatches.findIndex(b => b.batch_code === report.seed_batch_code) 
                    : -1;
                  const colorIndex = batchIndex >= 0 ? batchIndex : index;
                  return (
                    <tr key={report.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-green-700">{report.report_code}</td>
                      <td className="px-6 py-4">
                        {report.seed_batch_code ? (
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getBatchColor(colorIndex)}`}></div>
                            <span
                              className={`text-sm font-medium ${getBatchTextColor(colorIndex)}`}
                              title={report.seed_batch_code}
                            >
                              {formatBatchName(report.seed_batch_code)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-800">{report.report_type}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{formatDateTimeCn(report.report_date)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{report.inspector}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{report.inspection_agency}</td>
                      <td className="px-6 py-4">
                        {report.is_qualified ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-sm">合格</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600">
                            <XCircle className="w-4 h-4" />
                            <span className="text-sm">不合格</span>
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-right">
                        <div className="flex items-center justify-end gap-3">
                          {report.seed_batch_code && (
                            <button
                              onClick={() => {
                                const cleanCode = (report.seed_batch_code || '').trim();
                                if (!cleanCode) return;
                                setSelectedBatchCode(cleanCode);
                                setShowChainView(true);
                              }}
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}
                              title="查看全链条溯源"
                            >
                              <Link2 className="w-3 h-3" />
                              溯源
                            </button>
                          )}
                          <button
                            onClick={() => viewReportDetail(report)}
                            className="text-gray-400 hover:text-blue-500"
                            title="查看详情"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileText className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-500">暂无检测报告数据</p>
                    <p className="text-sm text-gray-400 mt-2">点击右上角"添加报告"按钮创建新报告</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedReport && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">报告详情</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">报告编号</p>
              <p className="font-medium text-gray-800">{selectedReport.report_code}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">报告类型</p>
              <p className="font-medium text-gray-800">{selectedReport.report_type}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">检测日期</p>
              <p className="font-medium text-gray-800">{formatDateTimeCn(selectedReport.report_date)}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">检测员</p>
              <p className="font-medium text-gray-800">{selectedReport.inspector || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">检测机构</p>
              <p className="font-medium text-gray-800">{selectedReport.inspection_agency || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">种子批次</p>
              <p className="font-medium text-gray-800">{selectedReport.seed_batch_code || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">证书编号</p>
              <p className="font-medium text-gray-800">{selectedReport.certificate_no || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">检测结论</p>
              <span className={`flex items-center gap-1 ${selectedReport.is_qualified ? 'text-green-600' : 'text-red-600'}`}>
                {selectedReport.is_qualified ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>合格</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    <span>不合格</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {residueTests.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">农药残留检测结果</h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-blue-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">检测项目</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">限量值(mg/kg)</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">实测值(mg/kg)</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">单位</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">判定</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {residueTests.map((test) => (
                      <tr key={test.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-800">{test.test_item}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{test.limit_value}</td>
                        <td className={`px-4 py-3 text-sm ${test.is_over_limit ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                          {test.measured_value}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{test.unit}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-sm ${test.is_over_limit ? 'text-red-600' : 'text-green-600'}`}>
                            {test.is_over_limit ? (
                              <>
                                <XCircle className="w-4 h-4" />
                                <span>超标</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-4 h-4" />
                                <span>合格</span>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedReport.remarks && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500 mb-1">备注</p>
              <p className="text-sm text-gray-700">{selectedReport.remarks}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">检测合格率</p>
              <p className="text-2xl font-bold text-gray-800">{qualifiedRate}%</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">本月报告数</p>
              <p className="text-2xl font-bold text-gray-800">{monthlyReportCount}</p>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加检测报告</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">报告编号</label>
                <input
                  type="text"
                  value={formData.report_code || ''}
                  onChange={(e) => setFormData({ ...formData, report_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="请输入报告编号"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">种子批次</label>
                <select
                  value={formData.batch_code || ''}
                  onChange={(e) => {
                    const batchCode = e.target.value;
                    const plot = getPlotForSeedBatch(batchCode);
                    setFormData({ 
                      ...formData, 
                      batch_code: batchCode,
                      plot_code: plot?.plot_code || formData.plot_code || '',
                    });
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                >
                  <option value="">请选择种子批次（可选）</option>
                  {seedBatches.map((batch) => (
                    <option key={batch.id} value={batch.batch_code}>
                      {formatBatchName(batch.batch_code)} - {batch.variety_name}
                      {getPlotForSeedBatch(batch.batch_code) ? ` (${getPlotForSeedBatch(batch.batch_code)?.plot_code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">关联地块</label>
                {formData.batch_code && getPlotForSeedBatch(formData.batch_code) ? (
                  <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="text-sm text-green-700">
                      {getPlotForSeedBatch(formData.batch_code)?.plot_code} - {getPlotForSeedBatch(formData.batch_code)?.name}
                    </div>
                    <div className="text-xs text-green-600 mt-1">（根据种子批次自动关联）</div>
                  </div>
                ) : (
                  <select
                    value={formData.plot_code || ''}
                    onChange={(e) => setFormData({ ...formData, plot_code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">请选择地块（可选）</option>
                    {plots.map((plot) => (
                      <option key={plot.id} value={plot.plot_code}>{plot.plot_code} - {plot.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">报告类型</label>
                <select
                  value={formData.report_type || ''}
                  onChange={(e) => setFormData({ ...formData, report_type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="">请选择报告类型</option>
                  <option value="种子质量检验">种子质量检验</option>
                  <option value="土壤检测">土壤检测</option>
                  <option value="农药残留检测">农药残留检测</option>
                  <option value="农药质量检测">农药质量检测</option>
                  <option value="成品质量检验">成品质量检验</option>
                  <option value="其他">其他</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">检测日期</label>
                  <input
                    type="date"
                    value={formData.report_date || ''}
                    onChange={(e) => setFormData({ ...formData, report_date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">检测员</label>
                  <input
                    type="text"
                    value={formData.inspector || ''}
                    onChange={(e) => setFormData({ ...formData, inspector: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">检测机构</label>
                <input
                  type="text"
                  value={formData.inspection_agency || ''}
                  onChange={(e) => setFormData({ ...formData, inspection_agency: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">检测结果</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                    type="radio"
                    name="is_qualified"
                    checked={formData.is_qualified === true}
                    onChange={() => setFormData({ ...formData, is_qualified: true })}
                    className="w-4 h-4 text-green-500"
                  />
                  <span className="text-sm text-gray-700">合格</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="is_qualified"
                    checked={formData.is_qualified === false}
                    onChange={() => setFormData({ ...formData, is_qualified: false })}
                    className="w-4 h-4 text-red-500"
                  />
                    <span className="text-sm text-gray-700">不合格</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={formData.remarks || ''}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  rows={3}
                  placeholder="请输入备注信息"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">保存</button>
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