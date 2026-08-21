import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  FileText,
  Search,
  Plus,
  X,
  PlusCircle,
  Trash2,
  Play,
  Pause,
  Wifi,
  WifiOff,
  Thermometer,
  Droplets,
  Zap,
  Leaf,
  Gauge,
  Sun,
  Wind,
  Beaker,
  Calendar,
  Clock,
  List,
} from 'lucide-react';
import { api, sensorApi, measurementApi, seedApi, plantingApi } from '../services/api';
import type { Sensor as SensorType, MeasurementItem, Measurement, DailySummary } from '../types';
import { useSensor } from '../context/SensorContext';
import SensorTrendChart from '../components/SensorTrendChart';
import { canManageSensors, canSubmitSensorData } from '../utils/roles';

interface SensorTypeInfo {
  code: string;
  name: string;
  default_items: Array<{ name: string; unit: string; min: number; max: number }>;
  threshold: number;
}

interface SensorWithType extends SensorType {
  type_name?: string;
  default_items?: Array<{ name: string; unit: string; min: number; max: number }>;
}

const sensorTypeIcons: Record<string, typeof Thermometer> = {
  temperature: Thermometer,
  humidity: Droplets,
  ph: Gauge,
  light: Sun,
  pesticide: Beaker,
  soil_moisture: Leaf,
  soil_multi: Leaf,
  co2: Wind,
  no2: Wind,
  o2: Wind,
  nh3: Wind,
  ch4: Wind,
  wind_speed: Wind,
  pressure: Gauge,
  rainfall: Droplets,
  custom: Zap,
};

const sensorUnitsMap: Record<string, string[]> = {
  temperature: ['℃'],
  humidity: ['%RH'],
  ph: [''],
  light: ['lux'],
  pesticide: ['mg/kg', 'μg/kg', 'ppb'],
  soil_moisture: ['%'],
  soil_multi: ['%', '℃', 'us/cm', '', 'mg/kg', 'mg/kg', 'mg/kg', 'mg/kg'],
  co2: ['ppm'],
  no2: ['ppm', 'ppb', 'μg/m³'],
  o2: ['%', 'ppm'],
  nh3: ['ppm', 'mg/m³'],
  ch4: ['ppm', '%'],
  wind_speed: ['m/s', 'km/h', 'mph'],
  pressure: ['hPa', 'kPa', 'mmHg'],
  rainfall: ['mm', 'cm', 'inch'],
  custom: ['℃', '%RH', '', 'lux', 'mg/kg', '%', 'ppm', 'μg/kg', 'ppb', 'm/s', 'hPa', 'mm', 'μg/m³', 'mg/m³', 'km/h', 'us/cm'],
};

export function SensorDataEntry() {
  const {
    state: sensorState,
    startSimulation,
    stopSimulation,
    startAutoSubmit,
    stopAutoSubmit,
    startHardware,
    stopHardware,
    updateSensorTypes,
    setOnDataSubmitted,
  } = useSensor();

  const [sensors, setSensors] = useState<SensorWithType[]>([]);
  const [sensorTypes, setSensorTypes] = useState<SensorTypeInfo[]>([]);
  const [selectedSensor, setSelectedSensor] = useState<string | null>(null);
  const [seedBatchCode, setSeedBatchCode] = useState('');
  const [seedBatches, setSeedBatches] = useState<any[]>([]);
  const [plots, setPlots] = useState<any[]>([]);
  const [selectedPlotCode, setSelectedPlotCode] = useState('');
  const [items, setItems] = useState<MeasurementItem[]>([{ name: '', value: 0, unit: '' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoReport, setAutoReport] = useState(false);
  const [lastReport, setLastReport] = useState<any>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [queryDate, setQueryDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [useDateFilter, setUseDateFilter] = useState(true);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [showAddSensorModal, setShowAddSensorModal] = useState(false);
  const [newSensor, setNewSensor] = useState({ device_id: '', name: '', type: 'pesticide', location: '', threshold: 0.05 });
  const [inputMode, setInputMode] = useState<'manual' | 'simulate' | 'hardware'>('manual');
  const [showAllMeasurements, setShowAllMeasurements] = useState(false);
  const MEASUREMENTS_DISPLAY_LIMIT = 50;

  const getCurrentSensorTypeInfo = useCallback((): SensorTypeInfo | undefined => {
    if (!selectedSensor) return undefined;
    const sensor = sensors.find((s) => s.device_id === selectedSensor);
    if (!sensor) return undefined;
    return sensorTypes.find((t) => t.code === sensor.type);
  }, [selectedSensor, sensors, sensorTypes]);

  const getCurrentUnits = useCallback((): string[] => {
    const sensorTypeInfo = getCurrentSensorTypeInfo();
    if (!sensorTypeInfo) return ['℃', '%RH', '', 'lux', 'mg/kg', '%', 'ppm', 'μg/kg', 'ppb'];
    return sensorUnitsMap[sensorTypeInfo.code] || ['℃', '%RH', '', 'lux', 'mg/kg', '%', 'ppm', 'μg/kg', 'ppb'];
  }, [getCurrentSensorTypeInfo]);

  const isPesticideSensor = useCallback(() => {
    const sensorTypeInfo = getCurrentSensorTypeInfo();
    return sensorTypeInfo?.code === 'pesticide';
  }, [getCurrentSensorTypeInfo]);

  const connectHardware = () => {
    if (!selectedSensor) {
      alert('请先选择传感器');
      return;
    }
    const sensor = sensors.find((s) => s.device_id === selectedSensor);
    if (!sensor) return;

    if (!('serial' in navigator)) {
      alert('您的浏览器不支持Web Serial API，请使用Chrome或Edge浏览器');
      return;
    }

    const plotCode = selectedPlotCode || sensor.plot_code || '';
    startHardware(selectedSensor, sensor.name, sensor.type, items, seedBatchCode, plotCode, autoReport, sensorTypes);
    setInputMode('hardware');
  };

  const toggleHardwareConnection = () => {
    if (sensorState.isHardwareConnected) {
      stopHardware();
      setInputMode('manual');
      alert('硬件连接已断开');
    } else {
      connectHardware();
    }
  };

  useEffect(() => {
    fetchSensors();
    fetchSensorTypes();
    fetchSeedBatches();
    fetchPlots();
  }, []);

  useEffect(() => {
    setOnDataSubmitted(() => {
      if (seedBatchCode && selectedSensor) {
        fetchSensorMeasurements(selectedSensor, seedBatchCode);
      } else if (selectedSensor) {
        fetchSensorMeasurements(selectedSensor);
      } else {
        fetchLatestMeasurements();
      }
    });
  }, [seedBatchCode, selectedSensor]);

  useEffect(() => {
    if (selectedSensor) {
      const sensor = sensors.find((s) => s.device_id === selectedSensor);
      if (sensor) {
        if (sensor.type !== 'pesticide') {
          setAutoReport(false);
        }
        if (!seedBatchCode && sensor.seed_batch_code) {
          setSeedBatchCode(sensor.seed_batch_code);
        }
        if (sensor.default_items && sensor.default_items.length > 0) {
          setItems(
            sensor.default_items.map((item) => ({
              name: item.name,
              value: 0,
              unit: item.unit || '',
            }))
          );
        } else {
          setItems([{ name: '', value: 0, unit: '' }]);
        }
      } else {
        setItems([{ name: '', value: 0, unit: '' }]);
      }
    } else {
      setItems([{ name: '', value: 0, unit: '' }]);
      setMeasurements([]);
      setInputMode('manual');
      setAutoReport(false);
      setSeedBatchCode('');
    }
  }, [selectedSensor, sensors, seedBatchCode]);

  useEffect(() => {
    // 切换传感器/日期/批次时，默认收起"展开全部"，避免大列表撑爆页面
    setShowAllMeasurements(false);

    if (seedBatchCode && selectedSensor) {
      fetchSensorMeasurements(selectedSensor, seedBatchCode);
    } else if (selectedSensor) {
      fetchSensorMeasurements(selectedSensor);
    } else {
      setMeasurements([]);
      setDailySummary(null);
    }
  }, [seedBatchCode, selectedSensor, queryDate, useDateFilter]);

  useEffect(() => {
    if (sensorState.isSimulating) {
      setInputMode('simulate');
    } else if (sensorState.isHardwareConnected) {
      setInputMode('hardware');
    }
    if (sensorState.selectedSensor) {
      setSelectedSensor(sensorState.selectedSensor);
    }
  }, []);

  useEffect(() => {
    if (sensorState.isSimulating || sensorState.isHardwareConnected) {
      setItems(sensorState.items);
    }
  }, [sensorState.items, sensorState.isSimulating, sensorState.isHardwareConnected]);

  const fetchSensors = async () => {
    try {
      const response = await sensorApi.getAll();
      const newSensors = response.data;
      setSensors(newSensors);

      if (selectedSensor) {
        const sensorExists = newSensors.some((s: any) => s.device_id === selectedSensor);
        if (!sensorExists) {
          setSelectedSensor(null);
          setInputMode('manual');
          stopSimulation();
          stopAutoSubmit();
          stopHardware();
        }
      }
    } catch (error) {
      console.error('Failed to fetch sensors:', error);
    }
  };

  const fetchSensorTypes = async () => {
    try {
      const response = await sensorApi.getTypes();
      setSensorTypes(response.data);
      updateSensorTypes(response.data);
    } catch (error) {
      console.error('Failed to fetch sensor types:', error);
    }
  };

  const fetchSeedBatches = async () => {
    try {
      const response = await seedApi.getBatches();
      setSeedBatches(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch seed batches:', error);
    }
  };

  const fetchPlots = async () => {
    try {
      const response = await plantingApi.getPlots();
      setPlots(response.data?.data || response.data || []);
    } catch (error) {
      console.error('Failed to fetch plots:', error);
    }
  };

  const fetchLatestMeasurements = async () => {
    try {
      const response = await measurementApi.getLatest();
      setMeasurements(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch measurements:', error);
    }
  };

  const fetchSensorMeasurements = async (deviceId: string, batchCode?: string, date?: string) => {
    try {
      const effectiveDate = date ?? (useDateFilter ? queryDate : undefined);
      const response = await measurementApi.getBySensor(deviceId, 500, batchCode, effectiveDate);
      setMeasurements(response.data.data || []);

      // 拉当日汇总：只要选了日期过滤或传入了 date，就顺带拉；否则不查
      if (effectiveDate) {
        try {
          const sum = await measurementApi.getDailySummary(deviceId, effectiveDate, batchCode);
          setDailySummary(sum.data?.summary || null);
        } catch (err) {
          console.warn('Failed to fetch daily summary:', err);
          setDailySummary(null);
        }
      } else {
        setDailySummary(null);
      }
    } catch (error) {
      console.error('Failed to fetch sensor measurements:', error);
      setDailySummary(null);
    }
  };

  

  const handleAddItem = () => {
    const sensorTypeInfo = getCurrentSensorTypeInfo();
    const defaultUnit = sensorTypeInfo?.default_items[0]?.unit || '';
    setItems([...items, { name: '', value: 0, unit: defaultUnit }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (index: number, field: keyof MeasurementItem, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'name' && typeof value === 'string') {
      const sensorTypeInfo = getCurrentSensorTypeInfo();
      if (sensorTypeInfo && sensorTypeInfo.default_items) {
        const matchedItem = sensorTypeInfo.default_items.find(
          (item) => item.name.includes(value) || value.includes(item.name)
        );
        if (matchedItem) {
          newItems[index].unit = matchedItem.unit;
        }
      }
    }

    setItems(newItems);
  };

  const handleSubmit = async () => {
    if (!selectedSensor) {
      alert('请选择传感器');
      return;
    }

    const validItems = items.filter((item) => item.name && item.value >= 0);
    if (validItems.length === 0) {
      alert('请填写至少一个检测项目');
      return;
    }

    setIsSubmitting(true);

    try {
      const endpoint = autoReport ? '/measurements/data/auto-report' : '/measurements/data';

      const params = new URLSearchParams();
      if (seedBatchCode) params.set('seed_batch_code', seedBatchCode);
      if (selectedPlotCode) params.set('plot_code', selectedPlotCode);

      const response = await api.post(
        endpoint,
        {
          device_id: selectedSensor,
          items: validItems,
        },
        { params: params.toString() ? params : undefined }
      );

      if (response.data.status === 'success') {
        if (autoReport) {
          setLastReport(response.data);
          if (!sensorState.isAutoSubmitting) {
            alert(`检测报告已生成！报告编号: ${response.data.report_code}\n合格状态: ${response.data.is_qualified ? '合格' : '不合格'}`);
          }
        } else if (!sensorState.isAutoSubmitting) {
          alert('数据已提交');
        }
        if (!sensorState.isAutoSubmitting) {
          if (seedBatchCode && selectedSensor) {
            fetchSensorMeasurements(selectedSensor, seedBatchCode);
          } else if (selectedSensor) {
            fetchSensorMeasurements(selectedSensor);
          } else {
            fetchLatestMeasurements();
          }
        }
        if (!sensorState.isSimulating) {
          const sensor = sensors.find((s) => s.device_id === selectedSensor);
          if (sensor && sensor.default_items && sensor.default_items.length > 0) {
            setItems(
              sensor.default_items.map((item) => ({
                name: item.name,
                value: 0,
                unit: item.unit || '',
              }))
            );
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to submit data:', error);
      alert('提交失败: ' + (error.response?.data?.detail || '未知错误'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddSensor = async () => {
    if (!newSensor.device_id || !newSensor.name) {
      alert('请填写设备ID和传感器名称');
      return;
    }

    try {
      await sensorApi.create(newSensor);
      setShowAddSensorModal(false);
      setNewSensor({ device_id: '', name: '', type: 'pesticide', location: '', threshold: 0.05 });
      fetchSensors();
      alert('传感器添加成功');
    } catch (error: any) {
      alert('添加失败: ' + (error.response?.data?.detail || '未知错误'));
    }
  };

  const handleTypeChange = (type: string) => {
    const sensorType = sensorTypes.find((t) => t.code === type);
    setNewSensor((prev) => ({
      ...prev,
      type,
      threshold: sensorType?.threshold || 50,
    }));
  };

  const toggleSimulation = () => {
    if (sensorState.isSimulating) {
      stopSimulation();
      setInputMode('manual');
    } else {
      if (!selectedSensor) {
        alert('请先选择传感器');
        return;
      }
      const sensor = sensors.find((s) => s.device_id === selectedSensor);
      if (!sensor) return;
      
      const validItems = items.length > 0 && items[0].name ? items : 
        (sensor.default_items && sensor.default_items.length > 0
          ? sensor.default_items.map((item) => ({ name: item.name, value: 0, unit: item.unit || '' }))
          : [{ name: '', value: 0, unit: '' }]);
      
      const plotCode = selectedPlotCode || sensor.plot_code || '';
      startSimulation(selectedSensor, sensor.name, sensor.type, validItems, seedBatchCode, plotCode, autoReport, sensorTypes);
      setInputMode('simulate');
    }
  };

  const toggleAutoSubmit = () => {
    if (sensorState.isAutoSubmitting) {
      stopAutoSubmit();
    } else {
      if (!sensorState.isSimulating && !sensorState.isHardwareConnected) {
        if (!selectedSensor) {
          alert('请先选择传感器并开始模拟或连接硬件');
          return;
        }
        const sensor = sensors.find((s) => s.device_id === selectedSensor);
        if (!sensor) return;
        
        const validItems = items.length > 0 && items[0].name ? items : 
          (sensor.default_items && sensor.default_items.length > 0
            ? sensor.default_items.map((item) => ({ name: item.name, value: 0, unit: item.unit || '' }))
            : [{ name: '', value: 0, unit: '' }]);
        
        const plotCode = selectedPlotCode || sensor.plot_code || '';
        startSimulation(selectedSensor, sensor.name, sensor.type, validItems, seedBatchCode, plotCode, autoReport, sensorTypes);
      }
      startAutoSubmit();
    }
  };

  const getSensorById = (deviceId: string) => {
    return sensors.find((s) => s.device_id === deviceId);
  };

  const getSensorTypeIcon = (type: string) => {
    return sensorTypeIcons[type] || Activity;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <Activity className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">传感器数据录入</h1>
            <p className="text-sm text-gray-500">支持手动录入和模拟实时数据采集，覆盖种植全流程环境监测</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchSensors}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新传感器
          </button>
          {canManageSensors() && (
            <button
              onClick={() => setShowAddSensorModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              添加传感器
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">数据录入</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">选择传感器</label>
              <select
                value={selectedSensor || ''}
                onChange={(e) => {
                  if (sensorState.isSimulating) {
                    stopSimulation();
                  }
                  if (sensorState.isAutoSubmitting) {
                    stopAutoSubmit();
                  }
                  if (sensorState.isHardwareConnected || sensorState.isHardwareConnecting) {
                    stopHardware();
                  }
                  setSelectedSensor(e.target.value);
                  setInputMode('manual');
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">请选择传感器</option>
                {sensors.map((sensor) => {
                  const statusText = sensor.status === 'online' ? '在线' : '离线';
                  return (
                    <option key={sensor.device_id} value={sensor.device_id}>
                      {sensor.name} ({sensor.type_name}) - {sensor.location || '未设置位置'} [{statusText}]
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">选择种子批次（可选）</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={seedBatchCode}
                  onChange={(e) => setSeedBatchCode(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                >
                  <option value="">请选择种子批次</option>
                  {seedBatches.map((batch) => (
                    <option key={batch.batch_code} value={batch.batch_code}>
                      {batch.batch_code} - {batch.variety_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                选择地块
                <span className="text-xs text-gray-400 ml-2">（选中后，数据将关联到该地块；留空则用传感器绑定的地块）</span>
              </label>
              <select
                value={selectedPlotCode}
                onChange={(e) => setSelectedPlotCode(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">使用传感器默认地块</option>
                {plots.map((plot) => (
                  <option key={plot.plot_code} value={plot.plot_code}>
                    {plot.name} ({plot.plot_code}) - {plot.location || '未设置位置'}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="manualMode"
                  checked={inputMode === 'manual'}
                  onChange={() => {
                    setInputMode('manual');
                    if (sensorState.isSimulating) stopSimulation();
                    if (sensorState.isAutoSubmitting) stopAutoSubmit();
                    if (sensorState.isHardwareConnected || sensorState.isHardwareConnecting) stopHardware();
                  }}
                  className="w-4 h-4 text-green-500"
                  disabled={!selectedSensor}
                />
                <label htmlFor="manualMode" className={`text-sm ${selectedSensor ? 'text-gray-700' : 'text-gray-400'}`}>手动录入</label>
              </div>
              {canManageSensors() && (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      id="simulateMode"
                      checked={inputMode === 'simulate'}
                      onChange={() => {
                        setInputMode('simulate');
                        if (sensorState.isHardwareConnected || sensorState.isHardwareConnecting) stopHardware();
                      }}
                      className="w-4 h-4 text-green-500"
                      disabled={!selectedSensor}
                    />
                    <label htmlFor="simulateMode" className={`text-sm ${selectedSensor ? 'text-gray-700' : 'text-gray-400'}`}>模拟采集</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      id="hardwareMode"
                      checked={inputMode === 'hardware'}
                      onChange={() => {
                        setInputMode('hardware');
                        if (sensorState.isSimulating) stopSimulation();
                        if (sensorState.isAutoSubmitting) stopAutoSubmit();
                        if (sensorState.isHardwareConnecting) stopHardware();
                        connectHardware();
                      }}
                      className="w-4 h-4 text-green-500"
                      disabled={!selectedSensor}
                    />
                    <label htmlFor="hardwareMode" className={`text-sm ${selectedSensor ? 'text-gray-700' : 'text-gray-400'}`}>硬件接入</label>
                  </div>
                </>
              )}

              {inputMode === 'simulate' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleSimulation}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      sensorState.isSimulating ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                    disabled={!selectedSensor}
                  >
                    {sensorState.isSimulating ? (
                      <>
                        <Pause className="w-4 h-4" />
                        停止模拟
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        开始模拟
                      </>
                    )}
                  </button>
                  <button
                    onClick={toggleAutoSubmit}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      sensorState.isAutoSubmitting 
                        ? 'bg-orange-500 text-white hover:bg-orange-600' 
                        : !sensorState.isSimulating
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                    disabled={!sensorState.isSimulating}
                  >
                    {sensorState.isAutoSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        停止上传
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        自动上传
                      </>
                    )}
                  </button>
                  {sensorState.isAutoSubmitting && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      每3秒上传
                    </span>
                  )}
                </div>
              )}

              {inputMode === 'hardware' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleHardwareConnection}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      sensorState.isHardwareConnected 
                        ? 'bg-red-500 text-white hover:bg-red-600' 
                        : sensorState.isHardwareConnecting
                          ? 'bg-yellow-500 text-white cursor-wait'
                          : 'bg-purple-500 text-white hover:bg-purple-600'
                    }`}
                    disabled={!selectedSensor || sensorState.isHardwareConnecting}
                  >
                    {sensorState.isHardwareConnected ? (
                      <>
                        <WifiOff className="w-4 h-4" />
                        断开硬件
                      </>
                    ) : sensorState.isHardwareConnecting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        连接中...
                      </>
                    ) : (
                      <>
                        <Wifi className="w-4 h-4" />
                        连接硬件
                      </>
                    )}
                  </button>
                  {sensorState.isHardwareConnecting && (
                    <span className="flex items-center gap-1 text-sm text-yellow-600">
                      <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
                      正在检测硬件设备...
                    </span>
                  )}
                  {sensorState.isHardwareConnected && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      硬件已连接，每3秒上传数据...
                    </span>
                  )}
                  {sensorState.hardwareError && (
                    <span className="flex items-center gap-1 text-sm text-red-600 mt-1">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      {sensorState.hardwareError}
                    </span>
                  )}
                </div>
              )}
            </div>

            {selectedSensor && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoReport"
                  checked={autoReport}
                  onChange={(e) => setAutoReport(e.target.checked)}
                  className="w-4 h-4 text-green-500"
                  disabled={!isPesticideSensor()}
                />
                <label htmlFor="autoReport" className={`text-sm ${isPesticideSensor() ? 'text-gray-700' : 'text-gray-400'}`}>
                  自动生成检测报告（仅农药残留传感器）
                </label>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">检测项目</label>
                <button
                  onClick={handleAddItem}
                  className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
                >
                  <Plus className="w-4 h-4" />
                  添加项目
                </button>
              </div>

              {items.map((item, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => handleItemChange(index, 'name', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="检测项目名称"
                  />
                  <input
                    type="number"
                    value={item.value}
                    onChange={(e) => handleItemChange(index, 'value', parseFloat(e.target.value) || 0)}
                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="数值"
                    min="0"
                    step="0.001"
                  />
                  <select
                    value={item.unit}
                    onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">单位</option>
                    {getCurrentUnits().map((unit) => (
                      <option key={unit} value={unit}>
                        {unit || 'pH'}
                      </option>
                    ))}
                  </select>
                  {items.length > 1 && (
                    <button onClick={() => handleRemoveItem(index)} className="p-2 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {selectedSensor && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-600">
                  当前传感器阈值: {getSensorById(selectedSensor)?.threshold ?? '-'} {getSensorById(selectedSensor)?.default_items?.[0]?.unit || ''}
                  <span className="ml-2">(超过此值将标记为超标)</span>
                </p>
              </div>
            )}

            {canSubmitSensorData() && (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400 transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  {autoReport ? '提交并生成报告' : '提交数据'}
                </>
              )}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {lastReport && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-green-600" />
                <h2 className="text-lg font-semibold text-gray-800">最新检测报告</h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">报告编号</span>
                  <span className="font-medium text-gray-800">{lastReport.report_code}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">种子批次</span>
                  <span className="font-medium text-gray-800">{lastReport.seed_batch_code}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">检测项目数</span>
                  <span className="font-medium text-gray-800">{lastReport.measurements} 项</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">检测结果</span>
                  <div className="flex items-center gap-2">
                    {lastReport.is_qualified ? (
                      <>
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="font-medium text-green-600">合格</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <span className="font-medium text-red-600">不合格</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============ 日期选择器 + 当日统计 ============ */}
          {selectedSensor && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-green-600" />
                  历史查询
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useDateFilter}
                      onChange={(e) => setUseDateFilter(e.target.checked)}
                      className="w-4 h-4 text-green-600"
                    />
                    按日期过滤
                  </label>
                  <input
                    type="date"
                    value={queryDate}
                    max={new Date().toISOString().slice(0, 10)}
                    disabled={!useDateFilter}
                    onChange={(e) => setQueryDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <button
                    onClick={() => {
                      setQueryDate(new Date().toISOString().slice(0, 10));
                      if (seedBatchCode && selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode, new Date().toISOString().slice(0, 10));
                      else if (selectedSensor) fetchSensorMeasurements(selectedSensor, undefined, new Date().toISOString().slice(0, 10));
                    }}
                    className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    今天
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      const yesterday = new Date(today.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
                      setQueryDate(yesterday);
                      if (seedBatchCode && selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode, yesterday);
                      else if (selectedSensor) fetchSensorMeasurements(selectedSensor, undefined, yesterday);
                    }}
                    className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    昨天
                  </button>
                  <button
                    onClick={() => {
                      if (seedBatchCode && selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode, queryDate);
                      else if (selectedSensor) fetchSensorMeasurements(selectedSensor, undefined, queryDate);
                    }}
                    className="px-3 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600"
                  >
                    查询
                  </button>
                </div>
              </div>

              {/* 当日统计汇总 */}
              {dailySummary && (
                <div className="border border-gray-100 rounded-lg p-4 bg-gray-50 space-y-4">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
                    <span>查询日期：<b className="text-gray-800">{queryDate}</b></span>
                    <span>总采样数：<b className="text-gray-800">{dailySummary.total_samples}</b> 条</span>
                    <span>开始时间：<b className="text-gray-800">{dailySummary.first_time ?? '-'}</b></span>
                    <span>结束时间：<b className="text-gray-800">{dailySummary.last_time ?? '-'}</b></span>
                    <span>累计时长：<b className="text-gray-800">{dailySummary.total_minutes}</b> 分钟</span>
                  </div>
                  {dailySummary.items.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[680px]">
                        <thead className="bg-emerald-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">检测项目</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">采样次数</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">平均值</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">最小值</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">最大值</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">单位</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {dailySummary.items.map((s, i) => (
                            <tr key={i} className="hover:bg-emerald-50/40">
                              <td className="px-3 py-2 text-gray-800 font-medium">{s.item_name}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{s.count}</td>
                              <td className="px-3 py-2 text-right text-gray-700 text-green-700 font-medium">{s.avg ?? '-'}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{s.min ?? '-'}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{s.max ?? '-'}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{s.unit || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center text-sm text-gray-400 py-3">当天该传感器暂无测量数据</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ============ 历史测量记录（逐条） ============ */}
          {selectedSensor && measurements.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <List className="w-5 h-5 text-green-600" />
                  历史测量记录
                  <span className="text-xs font-normal text-gray-500">
                    共 {measurements.length} 条{useDateFilter ? `（${queryDate}）` : ''}
                  </span>
                </h3>
                {measurements.length > MEASUREMENTS_DISPLAY_LIMIT && (
                  <button
                    onClick={() => setShowAllMeasurements((v) => !v)}
                    className="text-xs text-green-600 hover:text-green-700 border border-green-200 rounded-md px-3 py-1 bg-green-50"
                  >
                    {showAllMeasurements
                      ? `收起（只显示前${MEASUREMENTS_DISPLAY_LIMIT}条）`
                      : `展开全部（${measurements.length}条）`}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-gray-100 rounded-lg">
                <table className="w-full text-xs min-w-[560px]">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                        <Clock className="inline w-3 h-3 mr-1" />
                        采样时间
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">检测项目</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">数值</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">单位</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {(showAllMeasurements
                      ? measurements
                      : measurements.slice(0, MEASUREMENTS_DISPLAY_LIMIT)
                    ).map((m, i) => {
                      const t = new Date(m.timestamp);
                      const timeStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
                      return (
                        <tr key={`${m.id ?? i}-${i}`} className="hover:bg-green-50/40">
                          <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap tabular-nums">{timeStr}</td>
                          <td className="px-3 py-1.5 text-gray-800 font-medium">{m.item_name}</td>
                          <td className="px-3 py-1.5 text-right text-gray-700 tabular-nums">{m.value}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500">{m.unit || '-'}</td>
                          <td className="px-3 py-1.5 text-center">
                            {m.is_over_limit ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px]">
                                <AlertTriangle className="w-3 h-3" />
                                超标
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[11px]">
                                <CheckCircle className="w-3 h-3" />
                                正常
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!showAllMeasurements && measurements.length > MEASUREMENTS_DISPLAY_LIMIT && (
                <div className="text-center text-xs text-gray-400 pt-1">
                  仅显示前 {MEASUREMENTS_DISPLAY_LIMIT} 条，点击上方「展开全部」查看 {measurements.length} 条完整记录
                </div>
              )}
            </div>
          )}

          <SensorTrendChart measurements={measurements} sensors={sensors} />

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">已注册传感器</h2>
            <div className="grid grid-cols-2 gap-3">
              {sensors.length > 0 ? (
                sensors.map((sensor) => {
                  const Icon = getSensorTypeIcon(sensor.type);
                  return (
                    <div
                      key={sensor.device_id}
                      onClick={() => setSelectedSensor(sensor.device_id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedSensor === sensor.device_id ? 'border-green-500 bg-green-50' : 'border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon
                          className={`w-4 h-4 ${sensor.status === 'online' ? 'text-green-500' : 'text-gray-400'}`}
                        />
                        <span className="text-sm font-medium text-gray-800">{sensor.name}</span>
                      </div>
                      <p className="text-xs text-gray-500">{sensor.type_name}</p>
                      <p className="text-xs text-gray-400">{sensor.location}</p>
                    </div>
                  );
                })
              ) : (
                <div className="col-span-2 text-center py-4 text-gray-400">
                  <PlusCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">点击上方按钮添加传感器</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showAddSensorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加传感器</h3>
              <button onClick={() => setShowAddSensorModal(false)} className="p-2 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">设备ID</label>
                <input
                  type="text"
                  value={newSensor.device_id}
                  onChange={(e) => setNewSensor((prev) => ({ ...prev, device_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="输入设备唯一标识"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">传感器名称</label>
                <input
                  type="text"
                  value={newSensor.name}
                  onChange={(e) => setNewSensor((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="输入传感器名称"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">传感器类型</label>
                <select
                  value={newSensor.type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {sensorTypes.map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">安装位置</label>
                <input
                  type="text"
                  value={newSensor.location}
                  onChange={(e) => setNewSensor((prev) => ({ ...prev, location: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="输入安装位置（可选）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">阈值</label>
                <input
                  type="number"
                  value={newSensor.threshold}
                  onChange={(e) => setNewSensor((prev) => ({ ...prev, threshold: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  step="0.001"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowAddSensorModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button onClick={handleAddSensor} className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
                  添加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
