import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Eye, MapPin, Thermometer, Droplets, X, Package, Link2, Search, RefreshCw, Activity, Sun, Wind, Beaker } from 'lucide-react';
import { api, seedApi } from '../services/api';
import { BatchChainView } from '../components/BatchChainView';
import type { SeedBatch } from '../types/index.ts';
import { canManagePlanting } from '../utils/roles';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

interface Plot {
  id: number;
  plot_code: string;
  name: string;
  location: string;
  area: number;
  soil_type: string;
  irrigation_source: string;
  owner: string;
  status: string;
  planting_records?: any[];
}

interface PlantingRecord {
  id: number;
  plot_id: number;
  batch_id: number;
  seed_batch_code: string;
  planting_date: string;
  expected_harvest_date: string;
  planting_density: number;
  quantity_planted: number;
  farmer: string;
  status: string;
}

interface EnvironmentalData {
  record_time: string;
  temperature?: number;
  humidity?: number;
  soil_moisture?: number;
  soil_temperature?: number;
  ph_value?: number;
  illumination?: number;
  wind_speed?: number;
  conductivity?: number;
  nitrogen?: number;
  phosphorus?: number;
  potassium?: number;
  salinity?: number;
  pesticide_residue?: number;
}

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

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


export function PlantingManage() {
  const [activeTab, setActiveTab] = useState<'plots' | 'environment' | 'planting'>('plots');
  const [plots, setPlots] = useState<Plot[]>([]);
  const [plantingRecords, setPlantingRecords] = useState<PlantingRecord[]>([]);
  const [selectedPlot, setSelectedPlot] = useState<string>('');
  const [selectedPlotDetail, setSelectedPlotDetail] = useState<Plot | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'plot' | 'planting'>('plot');
  const [formData, setFormData] = useState<any>({});
  const [envData, setEnvData] = useState<EnvironmentalData[]>([]);
  const [showChainView, setShowChainView] = useState(false);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [seedBatches, setSeedBatches] = useState<SeedBatch[]>([]);
  const [selectedSeedBatchCode, setSelectedSeedBatchCode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [isRealtime, setIsRealtime] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const isRealtimeRef = useRef(isRealtime);

  useEffect(() => {
    isRealtimeRef.current = isRealtime;
  }, [isRealtime]);

  useEffect(() => {
    if (activeTab === 'plots') {
      fetchPlots();
    } else if (activeTab === 'planting') {
      fetchPlantingRecords();
      fetchSeedBatches();
      fetchPlots();
    } else if (activeTab === 'environment') {
      fetchPlots();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'environment') {
      if (selectedPlot) {
        fetchEnvData();
      } else {
        setEnvData([]);
      }
    }
  }, [activeTab, selectedPlot]);

  useEffect(() => {
    if (activeTab === 'planting') {
      fetchPlantingRecords();
    }
  }, [selectedSeedBatchCode]);

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
      let url = '/planting/planting-records';
      if (selectedSeedBatchCode) {
        url += `?seed_batch_code=${selectedSeedBatchCode}`;
      }
      const res = await api.get(url);
      setPlantingRecords(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch planting records:', err);
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

  const fetchEnvData = async () => {
    try {
      const url = `/planting/environmental-data?plot_code=${selectedPlot}&hours=24`;
      const res = await api.get(url);
      setEnvData(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch environmental data:', err);
      setEnvData([]);
    }
  };

  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    const token = localStorage.getItem('token');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8000/api/ws?token=${token}`;
    
    wsRef.current = new WebSocket(wsUrl);
    
    wsRef.current.onopen = () => {
      setWsConnected(true);
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_measurement' && selectedPlot) {
          if (data.plot_code && data.plot_code !== selectedPlot) {
            return;
          }
          
          const itemNameMapping: Record<string, string[]> = {
            temperature: ['温度', 'temperature', 'temp'],
            humidity: ['湿度', 'humidity'],
            soil_moisture: ['土壤湿度', 'soil_moisture'],
            ph_value: ['ph值', '酸碱度', 'ph', 'ph_value'],
            illumination: ['光照强度', '光照', 'illumination', 'light'],
            wind_speed: ['风速', 'wind_speed', 'wind'],
            pesticide_residue: ['农药残留', 'pesticide', 'pesticide_residue'],
            co2: ['二氧化碳浓度', 'co2', '二氧化碳'],
          };

          const getItemValue = (key: string) => {
            const names = itemNameMapping[key] || [key];
            for (const name of names) {
              const item = data.items.find((item: any) => 
                item.name.toLowerCase() === name.toLowerCase() || 
                item.name.toLowerCase().includes(name.toLowerCase()) ||
                name.toLowerCase().includes(item.name.toLowerCase())
              );
              if (item) return item.value;
            }
            return undefined;
          };

          const newItem: EnvironmentalData = {
            record_time: data.timestamp,
            temperature: getItemValue('temperature'),
            humidity: getItemValue('humidity'),
            soil_moisture: getItemValue('soil_moisture'),
            ph_value: getItemValue('ph_value'),
            illumination: getItemValue('illumination'),
            wind_speed: getItemValue('wind_speed'),
            pesticide_residue: getItemValue('pesticide_residue'),
          };
          setEnvData(prev => {
            const updated = [...prev, newItem].slice(-100);
            return updated;
          });
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };
    
    wsRef.current.onclose = () => {
      setWsConnected(false);
      if (isRealtimeRef.current) {
        setTimeout(() => {
          if (isRealtimeRef.current && !wsRef.current) {
            connectWebSocket();
          }
        }, 3000);
      }
    };
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setWsConnected(false);
    };
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    setIsRealtime(false);
  };

  const toggleRealtime = () => {
    if (isRealtime) {
      disconnectWebSocket();
    } else {
      setIsRealtime(true);
      connectWebSocket();
    }
  };

  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, []);

  const sensorTypeConfig: Record<string, { min: number; max: number; defaultStep: number; decimals: number; color: string; unit: string }> = {
    temperature: { min: -10, max: 50, defaultStep: 5, decimals: 1, color: 'rgb(239, 68, 68)', unit: '°C' },
    humidity: { min: 0, max: 100, defaultStep: 10, decimals: 0, color: 'rgb(59, 130, 246)', unit: '%' },
    soil_moisture: { min: 0, max: 100, defaultStep: 10, decimals: 0, color: 'rgb(34, 197, 94)', unit: '%' },
    soil_temperature: { min: -10, max: 50, defaultStep: 5, decimals: 1, color: 'rgb(185, 28, 28)', unit: '°C' },
    ph_value: { min: 4, max: 10, defaultStep: 0.5, decimals: 1, color: 'rgb(168, 85, 247)', unit: '' },
    illumination: { min: 0, max: 200000, defaultStep: 20000, decimals: 0, color: 'rgb(234, 179, 8)', unit: 'lux' },
    wind_speed: { min: 0, max: 50, defaultStep: 5, decimals: 1, color: 'rgb(0, 191, 255)', unit: 'm/s' },
    conductivity: { min: 0, max: 20000, defaultStep: 2000, decimals: 0, color: 'rgb(37, 99, 235)', unit: 'μS/cm' },
    nitrogen: { min: 0, max: 2000, defaultStep: 200, decimals: 0, color: 'rgb(34, 197, 94)', unit: 'mg/kg' },
    phosphorus: { min: 0, max: 2000, defaultStep: 200, decimals: 0, color: 'rgb(220, 38, 38)', unit: 'mg/kg' },
    potassium: { min: 0, max: 2000, defaultStep: 200, decimals: 0, color: 'rgb(124, 58, 237)', unit: 'mg/kg' },
    salinity: { min: 0, max: 2000, defaultStep: 200, decimals: 0, color: 'rgb(217, 119, 6)', unit: 'mg/kg' },
    pesticide_residue: { min: 0, max: 10, defaultStep: 0.5, decimals: 2, color: 'rgb(236, 72, 153)', unit: 'mg/kg' },
  };

  const removeOutliers = (values: number[], config?: { min: number; max: number }): { cleaned: number[]; outliers: number[] } => {
    if (values.length < 4) return { cleaned: values, outliers: [] };

    const cleaned: number[] = [];
    const outliers: number[] = [];

    if (config) {
      values.forEach(v => {
        if (v >= config.min && v <= config.max) {
          cleaned.push(v);
        } else {
          outliers.push(v);
        }
      });
      return { cleaned, outliers };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    values.forEach(v => {
      if (v >= lowerBound && v <= upperBound) {
        cleaned.push(v);
      } else {
        outliers.push(v);
      }
    });

    return { cleaned, outliers };
  };

  const calculateOptimalStep = (range: number, targetTicks: number = 5): number => {
    if (range <= 0) return 1;
    
    const rawStep = range / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    
    let step: number;
    if (normalized < 1.5) {
      step = magnitude;
    } else if (normalized < 3) {
      step = 2 * magnitude;
    } else if (normalized < 7) {
      step = 5 * magnitude;
    } else {
      step = 10 * magnitude;
    }
    
    return parseFloat(step.toFixed(10));
  };

  const generateDatasets = useMemo(() => {
    const datasets: any[] = [];
    let index = 0;

    const dataTypes = [
      { key: 'temperature', label: '空气温度' },
      { key: 'soil_temperature', label: '土壤温度' },
      { key: 'humidity', label: '空气湿度' },
      { key: 'soil_moisture', label: '土壤湿度' },
      { key: 'ph_value', label: 'pH值' },
      { key: 'conductivity', label: '电导率' },
      { key: 'nitrogen', label: '氮含量' },
      { key: 'phosphorus', label: '磷含量' },
      { key: 'potassium', label: '钾含量' },
      { key: 'salinity', label: '盐分' },
      { key: 'illumination', label: '光照强度' },
      { key: 'wind_speed', label: '风速' },
      { key: 'pesticide_residue', label: '农药残留' },
    ];

    dataTypes.forEach(({ key, label }) => {
      if (envData.some(d => (d as any)[key] !== undefined && (d as any)[key] !== null)) {
        const config = sensorTypeConfig[key];
        datasets.push({
          label: `${label} (${config.unit})`,
          data: envData.map((d) => (d as any)[key]),
          borderColor: config.color,
          backgroundColor: `${config.color}20`,
          fill: false,
          tension: 0.4,
          pointRadius: envData.length > 50 ? 0 : 2,
          pointHoverRadius: 6,
          yAxisID: `y${index}`,
          config,
        });
        index++;
      }
    });

    return datasets;
  }, [envData]);

  const formatTimeLabel = (timeStr: string) => {
    const date = new Date(timeStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffHours < 1) {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    } else if (diffHours < 24) {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    } else {
      return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
  };

  const generateScales = useMemo(() => {
    const datasets = generateDatasets;
    const scales: Record<string, any> = {
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 0,
          maxTicksLimit: Math.min(envData.length, 10),
          font: { size: 10 },
          callback: (tickValue: string | number) => {
            if (typeof tickValue === 'number') {
              return formatTimeLabel(envData[tickValue]?.record_time || '');
            }
            return tickValue;
          },
        },
        grid: {
          display: false,
        },
        title: {
          display: true,
          text: '时间',
          font: { size: 12 },
        },
      },
    };

    let index = 0;
    const dataTypes = [
      { key: 'temperature', label: '温度' },
      { key: 'humidity', label: '湿度' },
      { key: 'soil_moisture', label: '土壤湿度' },
      { key: 'ph_value', label: 'pH值' },
      { key: 'illumination', label: '光照' },
      { key: 'wind_speed', label: '风速' },
      { key: 'pesticide_residue', label: '农药残留' },
    ];

    dataTypes.forEach(({ key }) => {
      if (envData.some(d => (d as any)[key] !== undefined && (d as any)[key] !== null)) {
        const config = sensorTypeConfig[key];
        const values = envData.map((d) => (d as any)[key]).filter((v: any) => v !== undefined && v !== null);
        const { cleaned: cleanedValues } = removeOutliers(values, config);
        const displayValues = cleanedValues.length > 0 ? cleanedValues : values;
        
        let minVal: number, maxVal: number;
        if (displayValues.length > 0) {
          minVal = Math.min(...displayValues);
          maxVal = Math.max(...displayValues);
        } else {
          minVal = config.min;
          maxVal = config.max;
        }
        
        const range = maxVal - minVal;
        const padding = range * 0.15 || config.defaultStep;

        let min = minVal - padding;
        let max = maxVal + padding;
        min = Math.max(min, config.min);
        max = Math.min(max, config.max);

        if (min >= max) {
          min = config.min;
          max = config.max;
        }

        const adjustedRange = max - min;
        const step = calculateOptimalStep(adjustedRange, 5);

        min = Math.floor(min / step) * step;
        max = Math.ceil(max / step) * step;

        scales[`y${index}`] = {
          type: 'linear' as const,
          display: true,
          position: datasets.length === 1 ? 'left' : (index % 2 === 0 ? 'left' : 'right'),
          min,
          max,
          ticks: {
            stepSize: step,
            font: { size: 10 },
            callback: (value: number) => {
              const formatted = value.toFixed(config.decimals);
              return config.unit ? `${formatted} ${config.unit}` : formatted;
            },
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
          },
          title: {
            display: true,
            text: datasets[index]?.label?.split('(')[0]?.trim() || '',
            font: { size: 11 },
          },
        };
        index++;
      }
    });

    return scales;
  }, [envData, generateDatasets]);

  const handleViewPlot = (plot: Plot) => {
    setSelectedPlotDetail(plot);
  };

  const handleViewChain = (batchCode: string) => {
    setSelectedBatchCode(batchCode);
    setShowChainView(true);
  };

  const handleAddPlot = () => {
    setFormData({});
    setShowModal(true);
    setModalType('plot');
  };

  const handleAddPlantingRecord = () => {
    setFormData({});
    setShowModal(true);
    setModalType('planting');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === 'plot') {
        await api.post('/planting/plots', formData);
        setShowModal(false);
        fetchPlots();
      } else if (modalType === 'planting') {
        await api.post('/planting/planting-records', formData);
        setShowModal(false);
        fetchPlantingRecords();
      }
    } catch (err) {
      console.error('Failed to create:', err);
      alert('添加失败，请稍后重试');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('plots')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'plots' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              地块管理
            </span>
          </button>
          <button
            onClick={() => setActiveTab('planting')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'planting' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              种植记录
            </span>
          </button>
          <button
            onClick={() => setActiveTab('environment')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'environment' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Thermometer className="w-4 h-4" />
              环境监测
            </span>
          </button>
        </div>
        {activeTab === 'plots' && canManagePlanting() && (
          <button onClick={handleAddPlot} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
            <Plus className="w-4 h-4" />
            添加地块
          </button>
        )}
      </div>

      {activeTab === 'plots' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">地块编码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">地块名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">位置</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">面积(亩)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">土壤类型</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">灌溉水源</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">负责人</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plots.map((plot) => (
                  <tr key={plot.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-green-700">{plot.plot_code}</td>
                    <td className="px-6 py-4 text-sm text-gray-800">{plot.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{plot.location}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{plot.area}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{plot.soil_type}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{plot.irrigation_source}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{plot.owner}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        plot.status === 'planted' ? 'bg-green-100 text-green-700' :
                        plot.status === 'available' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {plot.status === 'planted' ? '种植中' : plot.status === 'available' ? '空闲' : plot.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      <button onClick={() => handleViewPlot(plot)} className="text-gray-400 hover:text-green-500" title="查看详情">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'planting' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {canManagePlanting() && (
              <button
                onClick={handleAddPlantingRecord}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加种植记录
              </button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索地块编码或农户..."
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种子批次</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">地块编码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种植日期</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">预计收获</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种植数量(kg)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">种植密度</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">农户</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plantingRecords
                  .filter((record) => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      (record.plot_id?.toString().toLowerCase().includes(term) || false) ||
                      (record.farmer?.toLowerCase().includes(term) || false) ||
                      (record.seed_batch_code?.toLowerCase().includes(term) || false)
                    );
                  })
                  .map((record, index) => {
                    const batchIndex = seedBatches.findIndex((b) => b.batch_code === record.seed_batch_code);
                    const colorIndex = batchIndex >= 0 ? batchIndex : index;
                    return (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getBatchColor(colorIndex)}`}></div>
                            <span className={`text-sm font-medium ${getBatchTextColor(colorIndex)}`}>
                              {formatBatchName(record.seed_batch_code)}
                            </span>
                            <span className="text-xs text-gray-400">{record.seed_batch_code}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-800">{record.plot_id}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{record.planting_date}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{record.expected_harvest_date}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{record.quantity_planted}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{record.planting_density}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{record.farmer}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            record.status === 'planted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {record.status === 'planted' ? '已种植' : record.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-right">
                          <button 
                            onClick={() => handleViewChain(record.seed_batch_code)} 
                            className={`flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-opacity-80 ${getBatchBgColor(colorIndex)} ${getBatchTextColor(colorIndex)}`}
                            title="查看全链条溯源"
                          >
                            <Link2 className="w-3 h-3" />
                            溯源
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex-1 max-w-md">
                <label className="block text-sm font-medium text-gray-700 mb-2">选择地块</label>
                <select
                  value={selectedPlot}
                  onChange={(e) => setSelectedPlot(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                >
                  <option value="">请选择地块</option>
                  {plots.map((plot) => (
                    <option key={plot.id} value={plot.plot_code}>{plot.plot_code} - {plot.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleRealtime}
                  disabled={!selectedPlot}
                  className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${
                    isRealtime
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : selectedPlot
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {isRealtime ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      停止实时
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4" />
                      开启实时
                    </>
                  )}
                </button>
                {wsConnected && (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    已连接
                  </span>
                )}
              </div>
            </div>
          </div>

          {selectedPlot && envData.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {(() => {
                const latestData = envData[envData.length - 1];
                const dataCards = [
                  {
                    key: 'temperature',
                    label: '温度',
                    icon: Thermometer,
                    bgColor: 'bg-red-100',
                    iconColor: 'text-red-500',
                    unit: '°C',
                    decimals: 1,
                  },
                  {
                    key: 'humidity',
                    label: '湿度',
                    icon: Droplets,
                    bgColor: 'bg-blue-100',
                    iconColor: 'text-blue-500',
                    unit: '%',
                    decimals: 0,
                  },
                  {
                    key: 'soil_moisture',
                    label: '土壤湿度',
                    icon: Droplets,
                    bgColor: 'bg-green-100',
                    iconColor: 'text-green-500',
                    unit: '%',
                    decimals: 0,
                  },
                  {
                    key: 'ph_value',
                    label: '土壤pH值',
                    icon: null,
                    bgColor: 'bg-yellow-100',
                    iconColor: 'text-yellow-500',
                    unit: '',
                    decimals: 1,
                  },
                  {
                    key: 'illumination',
                    label: '光照强度',
                    icon: Sun,
                    bgColor: 'bg-orange-100',
                    iconColor: 'text-orange-500',
                    unit: ' lux',
                    decimals: 0,
                  },
                  {
                    key: 'wind_speed',
                    label: '风速',
                    icon: Wind,
                    bgColor: 'bg-cyan-100',
                    iconColor: 'text-cyan-500',
                    unit: ' m/s',
                    decimals: 1,
                  },
                  {
                    key: 'pesticide_residue',
                    label: '农药残留',
                    icon: Beaker,
                    bgColor: 'bg-purple-100',
                    iconColor: 'text-purple-500',
                    unit: ' mg/kg',
                    decimals: 2,
                  },
                ];

                return dataCards.map((card) => {
                  const value = (latestData as any)[card.key];
                  if (value === undefined || value === null) return null;
                  
                  const formattedValue = parseFloat(value).toFixed(card.decimals);
                  const IconComponent = card.icon;

                  return (
                    <div key={card.key} className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 ${card.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                          {IconComponent ? (
                            <IconComponent className={`w-5 h-5 ${card.iconColor}`} />
                          ) : (
                            <span className={`${card.iconColor} text-lg font-bold`}>pH</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">{card.label}</p>
                          <p className="text-2xl font-bold text-gray-800">{formattedValue}{card.unit}</p>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {selectedPlot && envData.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">环境数据历史趋势</h3>
              <div className="h-96">
                <Line
                  data={{
                    labels: envData.map((_, i) => i),
                    datasets: generateDatasets,
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                      mode: 'index' as const,
                      intersect: false,
                    },
                    plugins: {
                      legend: {
                        position: 'top' as const,
                        labels: {
                          font: { size: 10 },
                          boxWidth: 12,
                        },
                      },
                      tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: 12,
                        titleFont: { size: 12 },
                        bodyFont: { size: 11 },
                        callbacks: {
                          title: (items: any[]) => {
                            if (items.length > 0) {
                              const index = items[0].dataIndex;
                              return formatTimeLabel(envData[index]?.record_time || '');
                            }
                            return '';
                          },
                          label: (context: any) => {
                            const label = context.dataset.label || '';
                            const config = context.dataset.config;
                            const decimals = config?.decimals || 2;
                            return `${label}: ${context.parsed.y.toFixed(decimals)}`;
                          },
                        },
                      },
                    },
                    scales: generateScales,
                  }}
                />
              </div>
            </div>
          )}

          {selectedPlot && envData.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Thermometer className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500">该地块暂无环境监测数据</p>
              <p className="text-sm text-gray-400 mt-2">环境数据将通过传感器自动采集或手动录入</p>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {modalType === 'plot' ? '添加地块' : '添加种植记录'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {modalType === 'plot' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">地块编码</label>
                    <input
                      type="text"
                      value={formData.plot_code || ''}
                      onChange={(e) => setFormData({ ...formData, plot_code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入地块编码"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">地块名称</label>
                    <input
                      type="text"
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入地块名称"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">位置</label>
                      <input
                        type="text"
                        value={formData.location || ''}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">面积(亩)</label>
                      <input
                        type="number"
                        value={formData.area || ''}
                        onChange={(e) => setFormData({ ...formData, area: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">土壤类型</label>
                      <input
                        type="text"
                        value={formData.soil_type || ''}
                        onChange={(e) => setFormData({ ...formData, soil_type: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">灌溉水源</label>
                      <input
                        type="text"
                        value={formData.irrigation_source || ''}
                        onChange={(e) => setFormData({ ...formData, irrigation_source: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">负责人</label>
                    <input
                      type="text"
                      value={formData.owner || ''}
                      onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">地块</label>
                    <select
                      value={formData.plot_code || ''}
                      onChange={(e) => setFormData({ ...formData, plot_code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择地块</option>
                      {plots.map((plot) => (
                        <option key={plot.id} value={plot.plot_code}>{plot.plot_code} - {plot.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">种子批次</label>
                    <select
                      value={formData.batch_code || ''}
                      onChange={(e) => setFormData({ ...formData, batch_code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      required
                    >
                      <option value="">请选择种子批次</option>
                      {seedBatches.map((batch) => (
                        <option key={batch.id} value={batch.batch_code}>{batch.batch_code} - {batch.variety_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">种植日期</label>
                      <input
                        type="date"
                        value={formData.planting_date || ''}
                        onChange={(e) => setFormData({ ...formData, planting_date: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">预计收获日期</label>
                      <input
                        type="date"
                        value={formData.expected_harvest_date || ''}
                        onChange={(e) => setFormData({ ...formData, expected_harvest_date: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">种植数量(kg)</label>
                      <input
                        type="number"
                        value={formData.quantity_planted || ''}
                        onChange={(e) => setFormData({ ...formData, quantity_planted: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">种植密度(株/亩)</label>
                      <input
                        type="number"
                        value={formData.planting_density || ''}
                        onChange={(e) => setFormData({ ...formData, planting_density: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">农户</label>
                    <input
                      type="text"
                      value={formData.farmer || ''}
                      onChange={(e) => setFormData({ ...formData, farmer: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="请输入农户姓名"
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

      {selectedPlotDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">地块详情</h3>
              <button onClick={() => setSelectedPlotDetail(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">地块编码</p>
                <p className="font-medium text-gray-800">{selectedPlotDetail.plot_code}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">地块名称</p>
                <p className="font-medium text-gray-800">{selectedPlotDetail.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">位置</p>
                  <p className="font-medium text-gray-800">{selectedPlotDetail.location}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">面积</p>
                  <p className="font-medium text-gray-800">{selectedPlotDetail.area} 亩</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">土壤类型</p>
                  <p className="font-medium text-gray-800">{selectedPlotDetail.soil_type}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">灌溉水源</p>
                  <p className="font-medium text-gray-800">{selectedPlotDetail.irrigation_source}</p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">负责人</p>
                <p className="font-medium text-gray-800">{selectedPlotDetail.owner}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-sm ${
                  selectedPlotDetail.status === 'planted' ? 'bg-green-100 text-green-700' : 
                  selectedPlotDetail.status === 'available' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {selectedPlotDetail.status === 'planted' ? '种植中' : 
                   selectedPlotDetail.status === 'available' ? '空闲' : selectedPlotDetail.status}
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