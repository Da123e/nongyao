import { useState, useEffect } from 'react';
import { Plus, Search, FileText, CheckCircle, XCircle, Eye, X, Link2 } from 'lucide-react';
import { api, seedApi } from '../services/api';
import type { SeedBatch } from '../types';
import { BatchChainView } from '../components/BatchChainView';
import { canCreateInspection } from '../utils/roles';

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
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [selectedSeedBatchCode, setSelectedSeedBatchCode] = useState('');

  useEffect(() => {
    fetchReports();
    fetchSeedBatches();
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
                            <span className={`text-sm font-medium ${getBatchTextColor(colorIndex)}`}>
                              {formatBatchName(report.seed_batch_code)}
                            </span>
                            <span className="text-xs text-gray-400">{report.seed_batch_code}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-800">{report.report_type}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{new Date(report.report_date).toLocaleString()}</td>
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
                              onClick={() => { setSelectedBatchCode(report.seed_batch_code!); setShowChainView(true); }}
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
              <p className="font-medium text-gray-800">{new Date(selectedReport.report_date).toLocaleString()}</p>
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
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
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
                  onChange={(e) => setFormData({ ...formData, batch_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                >
                  <option value="">请选择种子批次（可选）</option>
                  {seedBatches.map((batch) => (
                    <option key={batch.id} value={batch.batch_code}>{formatBatchName(batch.batch_code)} - {batch.variety_name}</option>
                  ))}
                </select>
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