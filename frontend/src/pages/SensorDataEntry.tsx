import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Lock,
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
  Cpu,
  FlaskConical,
  Edit3,
  LineChart,
} from 'lucide-react';
import { api, sensorApi, measurementApi, seedApi, plantingApi } from '../services/api';
import type { Sensor as SensorType, MeasurementItem, Measurement, DailySummary } from '../types';
import { useSensor } from '../context/SensorContext';
import SensorTrendChart from '../components/SensorTrendChart';
import { canManageSensors, canSubmitSensorData } from '../utils/roles';
import { ingestLiveMeasurement, subscribeLiveData } from '../utils/liveSensorData';
import type { LiveMeasurementPayload } from '../utils/liveSensorData';
import { getTodayCn, getYesterdayCn, formatDateTimeCn } from '../utils/date';

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
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [plantingRecords, setPlantingRecords] = useState<any[]>([]);
  const [selectedPlotCode, setSelectedPlotCode] = useState('');
  // 该批次「是否已绑定到固定地块」：如果是 → 地块下拉禁用，自动锁定
  const [batchLockedPlot, setBatchLockedPlot] = useState<string | null>(null);

  // 根据 planting_records 构建 seed_batch_code -> plot_code 的 1:1 映射
  // 设计前提：1 个种子批次只种在 1 块地上
  const getPlotByBatch = useCallback((batchCode: string): string | null => {
    if (!batchCode) return null;
    const rec = plantingRecords.find((r) => r.seed_batch_code === batchCode);
    return rec?.plot_code || null;
  }, [plantingRecords]);
  const [items, setItems] = useState<MeasurementItem[]>([{ name: '', value: 0, unit: '' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoReport, setAutoReport] = useState(false);
  const [lastReport, setLastReport] = useState<any>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [queryDate, setQueryDate] = useState<string>(getTodayCn());
  const [useDateFilter, setUseDateFilter] = useState(false);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [showAddSensorModal, setShowAddSensorModal] = useState(false);
  const [newSensor, setNewSensor] = useState({ device_id: '', name: '', type: 'pesticide', location: '', threshold: 0.05 });
  const [inputMode, setInputMode] = useState<'manual' | 'simulate' | 'hardware'>('manual');
  const [showAllMeasurements, setShowAllMeasurements] = useState(false);
  const MEASUREMENTS_DISPLAY_LIMIT = 50;
  // 页面模式：录入数据 vs 查看分析
  const [pageMode, setPageMode] = useState<'entry' | 'analysis'>('entry');
  // 传感器页独立的 WebSocket 连接（确保用户直接访问 /sensor 时也能收到实时数据）
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setWsConnected] = useState(false);

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
    // 只有有数据提交权限的角色才需要加载批次/地块/种植记录（用于下拉选择）
    // 只读角色（warehouse_manager/salesperson）没有 planting:query 权限，调用会 403
    if (canSubmitSensorData()) {
      fetchSeedBatches();
      fetchPlots();
      fetchPlantingRecords();
    }
    // --- 传感器页独立 WebSocket 连接：与首页同款 ws 逻辑，独立维护 ---
    const connectWebSocket = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      const token = localStorage.getItem('token');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws${token ? `?token=${token}` : ''}`;
      try {
        wsRef.current = new WebSocket(wsUrl);
        wsRef.current.onopen = () => setWsConnected(true);
        wsRef.current.onmessage = (evt) => {
          try {
            if (evt?.data && typeof evt.data === 'string') {
              const payload = JSON.parse(evt.data);
              if (payload?.type === 'new_measurement') {
                // 先写入全局实时分发中心，下方单独的 subscribeLiveData 监听器会 append 到 measurements
                ingestLiveMeasurement(payload);
                // 触发传感器列表 + 统计重拉（用于更新状态卡片上的"在线"小标记和汇总）
                fetchSensors();
              }
            }
          } catch (e) {
            console.warn('Sensor page WS message parse failed:', e);
          }
        };
        wsRef.current.onerror = () => setWsConnected(false);
        wsRef.current.onclose = () => {
          setWsConnected(false);
          reconnectTimerRef.current = setTimeout(connectWebSocket, 5000);
        };
      } catch {
        reconnectTimerRef.current = setTimeout(connectWebSocket, 5000);
      }
    };
    connectWebSocket();
    return () => {
      try { wsRef.current?.close(); } catch {}
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 批次 ⇄ 地块 自动锁定逻辑（核心：1 批次 ⇒ 1 地块）---
  useEffect(() => {
    const locked = seedBatchCode ? getPlotByBatch(seedBatchCode) : null;
    setBatchLockedPlot(locked);
    if (locked) {
      // 已绑定 → 自动填入，用户不用再选
      setSelectedPlotCode(locked);
    } else if (!seedBatchCode) {
      // 清空批次 → 不自动恢复任何手动选择，保持原样
    }
  }, [seedBatchCode, getPlotByBatch]);

  // --- 从首页跳转带过来的 plot_code 参数，自动预选地块 + 切换到分析模式 ---
  useEffect(() => {
    const urlPlotCode = searchParams.get('plot_code');
    if (urlPlotCode && plots.length > 0) {
      const exists = plots.some((p: any) => p.plot_code === urlPlotCode);
      if (exists && !batchLockedPlot) {
        setSelectedPlotCode(urlPlotCode);
      }
      // 自动查找该地块的传感器并选中（优先用 plot_code 字段，回退到 location 匹配）
      const matchedSensor = sensors.find(
        (s: SensorWithType) => s.plot_code === urlPlotCode || (s.location && s.location.includes(urlPlotCode))
      );
      if (matchedSensor && !selectedSensor) {
        setSelectedSensor(matchedSensor.device_id);
      }
      // 切换到查看分析模式
      setPageMode('analysis');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots]);

  // 从首页快捷卡跳转带 ?action=xxx 参数时自动切换到对应输入模式并触发连接/模拟
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'connect') {
      setInputMode('hardware');
      toggleHardwareConnection();
    } else if (action === 'simulate') {
      setInputMode('simulate');
      toggleSimulation();
    }
    if (action) {
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // 仅「非模拟/非硬件」模式用 default_items 初始化 value=0
        //    模拟/硬件模式下数值由 SensorContext 实时写入，避免被 sensors 更新意外清零
        if (sensor.default_items && sensor.default_items.length > 0) {
          if (!sensorState.isSimulating && !sensorState.isHardwareConnected) {
            setItems(
              sensor.default_items.map((item) => ({
                name: item.name,
                value: 0,
                unit: item.unit || '',
              }))
            );
          }
        } else if (!sensorState.isSimulating && !sensorState.isHardwareConnected) {
          setItems([{ name: '', value: 0, unit: '' }]);
        }
      } else if (!sensorState.isSimulating && !sensorState.isHardwareConnected) {
        setItems([{ name: '', value: 0, unit: '' }]);
      }
    } else if (!sensorState.isSimulating && !sensorState.isHardwareConnected) {
      setItems([{ name: '', value: 0, unit: '' }]);
      setMeasurements([]);
      setInputMode('manual');
      setAutoReport(false);
      setSeedBatchCode('');
    }
  }, [selectedSensor, sensors, seedBatchCode, sensorState.isSimulating, sensorState.isHardwareConnected]);

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

  const fetchPlantingRecords = async () => {
    try {
      const response = await plantingApi.getPlantingRecords();
      const list = response.data?.data || response.data || [];
      setPlantingRecords(
        // 去重：同一个 seed_batch_code 保留第一条（理论上 1:1，保险起见）
        Array.from(
          new Map(list.map((r: any) => [r.seed_batch_code, r])).values()
        )
      );
    } catch (error) {
      console.error('Failed to fetch planting records:', error);
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

  const fetchSensorMeasurements = async (deviceId: string, batchCode?: string, date?: string, plotCode?: string) => {
    try {
      const effectiveDate = date ?? (useDateFilter ? queryDate : undefined);
      // plotCode 传参优先；如果没传则退回到当前选中的 selectedPlotCode（entry mode 可能只传 deviceId）
      const finalPlotCode = plotCode ?? selectedPlotCode;
      const finalBatchCode = batchCode ?? (seedBatchCode || undefined);
      const response = await measurementApi.getBySensor(deviceId, 500, finalBatchCode, effectiveDate, finalPlotCode || undefined);
      setMeasurements(response.data.data || []);

      // 拉当日汇总：只要选了日期过滤或传入了 date，就顺带拉；否则不查
      if (effectiveDate) {
        try {
          const sum = await measurementApi.getDailySummary(deviceId, effectiveDate, finalBatchCode, finalPlotCode || undefined);
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

  // 选中传感器变化时自动拉取数据（分析模式必需）
  useEffect(() => {
    if (selectedSensor) {
      fetchSensorMeasurements(selectedSensor, seedBatchCode || undefined, queryDate, selectedPlotCode);
    } else {
      setMeasurements([]);
      setDailySummary(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSensor, selectedPlotCode]);

  // 种子批次切换时（entry Tab 用户手动选了批次）：当前传感器有就重拉
  useEffect(() => {
    if (selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode || undefined, queryDate, selectedPlotCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedBatchCode]);

  // 日期筛选控件变化（分析 Tab 里 checkbox/datepicker 或 今天/昨天）：如果传感器已选则重拉
  useEffect(() => {
    if (selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode || undefined, queryDate, selectedPlotCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDateFilter, queryDate]);

  // 切换到分析Tab时，强制刷新数据（确保提交后的数据立即可见）
  useEffect(() => {
    if (pageMode === 'analysis' && selectedSensor) {
      fetchSensorMeasurements(selectedSensor, seedBatchCode || undefined, queryDate, selectedPlotCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode]);

  // 兜底轮询：即使 WS 断开，每 12 秒主动拉一次（首页同款兜底节奏）
  //  · 分析 Tab：刷新 measurement + daily summary + 传感器状态
  //  · 录入 Tab：只刷新传感器状态（确保在线/离线徽章实时）
  useEffect(() => {
    const tick = () => {
      fetchSensors();
      if (pageMode === 'analysis' && selectedSensor) {
        fetchSensorMeasurements(selectedSensor, seedBatchCode || undefined, queryDate, selectedPlotCode);
      }
    };
    tick();
    const t = window.setInterval(tick, 12000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, selectedSensor, seedBatchCode, selectedPlotCode, queryDate]);

  // WebSocket 实时数据：当前选中的设备/地块匹配时 append 到 measurements，让趋势图实时增长
  const measurementsRef = useRef<Measurement[]>([]);
  useEffect(() => {
    measurementsRef.current = measurements;
  }, [measurements]);

  useEffect(() => {
    const currentSensor = sensors.find((s) => s.device_id === selectedSensor);
    const currentPlot = currentSensor?.plot_code || selectedPlotCode;
    const currentDeviceId = currentSensor?.device_id;

    const unsub = subscribeLiveData((payload: LiveMeasurementPayload) => {
      // 命中条件：设备号匹配 或 地块匹配
      const match = (payload.device_id === currentDeviceId) || (currentPlot && payload.plot_code === currentPlot);
      if (!match) return;
      // 把新点转成 Measurement 格式追加（每条 item 单独一条 Measurement 记录，Chart.js 能识别）
      const toAppend: Measurement[] = [];
      for (const item of payload.items) {
        const name = item.item_name || item.name || '';
        const value = item.measured_value ?? item.value;
        const unit = item.measurement_unit ?? item.unit ?? '';
        if (value === undefined || value === null) continue;
        toAppend.push({
          id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sensor_id: currentSensor?.id ?? 0,
          device_id: payload.device_id,
          sensor_type: currentSensor?.type_name || '',
          item_name: name,
          item_key: item.item_key || item.key || name,
          value: Number(value),
          unit: unit || '',
          plot_code: payload.plot_code ?? null,
          seed_batch_code: payload.seed_batch_code ?? null,
          source_hint: payload.type,
          timestamp: payload.timestamp,
          created_at: payload.timestamp,
          is_over_limit: false,
          raw_data: null,
          updated_at: payload.timestamp,
        });
      }
      if (toAppend.length === 0) return;
      // 合并并控制上限 500
      const merged = [...measurementsRef.current, ...toAppend].slice(-500);
      setMeasurements(merged);
    });
    return unsub;
  }, [selectedSensor, selectedPlotCode, sensors]);

  

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

    // 根据当前模式确定数据来源
    let sourceHint: string | null = null;
    if (sensorState.isSimulating) {
      sourceHint = 'SIMULATED';
    } else if (sensorState.isHardwareConnected) {
      sourceHint = 'MANUAL_HARDWARE';
    }

    try {
      const endpoint = autoReport ? '/measurements/data/auto-report' : '/measurements/data';

      const params = new URLSearchParams();
      if (seedBatchCode) params.set('seed_batch_code', seedBatchCode);
      if (selectedPlotCode) params.set('plot_code', selectedPlotCode);

      // 构造请求体：包含 source_hint 用于后端区分数据来源
      const requestBody: any = {
        device_id: selectedSensor,
        items: validItems.map((item) => ({
          name: item.name,
          value: parseFloat(item.value.toFixed(3)),
          unit: item.unit,
          ...(sourceHint ? { source_hint: sourceHint } : {}),
        })),
      };
      if (sourceHint) {
        requestBody.source_hint = sourceHint;
      }

      const response = await api.post(
        endpoint,
        requestBody,
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
        // 无论是否自动提交，都刷新数据以确保分析页可见
        if (seedBatchCode && selectedSensor) {
          fetchSensorMeasurements(selectedSensor, seedBatchCode, undefined, selectedPlotCode);
        } else if (selectedSensor) {
          fetchSensorMeasurements(selectedSensor, undefined, undefined, selectedPlotCode);
        } else {
          fetchLatestMeasurements();
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
      {!canSubmitSensorData() && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-700">
          <Lock className="w-4 h-4 flex-shrink-0" />
          <span>只读模式：当前账号无数据提交权限，仅可查看传感器列表与历史测量记录。如需采集数据，请使用 admin / farmer / inspector 账号登录。</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <Activity className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">
              {pageMode === 'entry' ? '传感器数据录入' : '传感器数据分析'}
            </h1>
            <p className="text-sm text-gray-500">
              {pageMode === 'entry'
                ? '支持手动录入和模拟实时数据采集，覆盖种植全流程环境监测'
                : '查看历史趋势图、测量记录和日统计，精准掌握地块环境变化'}
            </p>
          </div>
          {/* 模式切换 Tab */}
          <div className="flex bg-gray-100 rounded-lg p-1 ml-4">
            <button
              onClick={() => setPageMode('entry')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                pageMode === 'entry'
                  ? 'bg-white text-green-700 shadow-sm font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="flex items-center gap-1">
                <Edit3 className="w-3.5 h-3.5" />
                录入数据
              </span>
            </button>
            <button
              onClick={() => setPageMode('analysis')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                pageMode === 'analysis'
                  ? 'bg-white text-green-700 shadow-sm font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="flex items-center gap-1">
                <LineChart className="w-3.5 h-3.5" />
                查看分析
              </span>
            </button>
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

      {/* 录入模式：左侧大表单，右侧辅助信息（最新报告 + 注册传感器） */}
      {pageMode === 'entry' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左 2/3：录入表单 */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">数据录入</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择传感器</label>
                <select
                  value={selectedSensor || ''}
                  onChange={(e) => {
                    if (sensorState.isSimulating) stopSimulation();
                    if (sensorState.isAutoSubmitting) stopAutoSubmit();
                    if (sensorState.isHardwareConnected || sensorState.isHardwareConnecting) stopHardware();
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
                    {seedBatches.map((batch) => {
                      const bound = getPlotByBatch(batch.batch_code);
                      const plotName = bound
                        ? plots.find((p) => p.plot_code === bound)?.name || bound
                        : '未种植';
                      return (
                        <option key={batch.batch_code} value={batch.batch_code}>
                          {batch.batch_code} - {batch.variety_name}（{plotName}）
                        </option>
                      );
                    })}
                  </select>
                </div>
                {seedBatchCode && batchLockedPlot && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-green-700 bg-green-50 rounded-md px-3 py-1.5">
                    <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    该批次已种植于「
                    {plots.find((p) => p.plot_code === batchLockedPlot)?.name || batchLockedPlot}」
                    ，地块已自动锁定，无需重复选择。
                  </div>
                )}
                {seedBatchCode && !batchLockedPlot && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    该批次暂未查到种植记录，请在下面手动选择要关联的地块。
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  选择地块
                  <span className="text-xs text-gray-400 ml-2">
                    {batchLockedPlot
                      ? '（已由种子批次自动锁定）'
                      : '（选中后，数据将关联到该地块；留空则用传感器绑定的地块）'}
                  </span>
                </label>
                <select
                  value={selectedPlotCode}
                  onChange={(e) => setSelectedPlotCode(e.target.value)}
                  disabled={!!batchLockedPlot}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 ${
                    batchLockedPlot ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''
                  }`}
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

                {inputMode === 'simulate' && canSubmitSensorData() && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleSimulation}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        sensorState.isSimulating ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                      disabled={!selectedSensor}
                    >
                      {sensorState.isSimulating ? (
                        <><Pause className="w-4 h-4" />停止模拟</>
                      ) : (
                        <><Play className="w-4 h-4" />开始模拟</>
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
                        <><RefreshCw className="w-4 h-4 animate-spin" />停止上传</>
                      ) : (
                        <><Send className="w-4 h-4" />自动上传</>
                      )}
                    </button>
                    {sensorState.isAutoSubmitting && (
                      <span className="flex items-center gap-1 text-sm text-green-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> 每5秒上传
                      </span>
                    )}
                  </div>
                )}
                {inputMode === 'simulate' && !canSubmitSensorData() && (
                  <div className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                    只读模式：当前账号无「传感器数据提交」权限。
                  </div>
                )}

                {inputMode === 'hardware' && canSubmitSensorData() && (
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
                        <><WifiOff className="w-4 h-4" />断开硬件</>
                      ) : sensorState.isHardwareConnecting ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" />连接中...</>
                      ) : (
                        <><Wifi className="w-4 h-4" />连接硬件</>
                      )}
                    </button>
                    {sensorState.isHardwareConnecting && (
                      <span className="flex items-center gap-1 text-sm text-yellow-600">
                        <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" /> 正在检测硬件设备...
                      </span>
                    )}
                    {sensorState.isHardwareConnected && (
                      <span className="flex items-center gap-1 text-sm text-green-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> 硬件已连接，每5秒上传数据...
                      </span>
                    )}
                    {sensorState.hardwareError && (
                      <span className="flex items-center gap-1 text-sm text-red-600 mt-1">
                        <span className="w-2 h-2 bg-red-500 rounded-full" /> {sensorState.hardwareError}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {selectedSensor && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox" id="autoReport" checked={autoReport}
                    onChange={(e) => setAutoReport(e.target.checked)}
                    className="w-4 h-4 text-green-500" disabled={!isPesticideSensor()}
                  />
                  <label htmlFor="autoReport" className={`text-sm ${isPesticideSensor() ? 'text-gray-700' : 'text-gray-400'}`}>
                    自动生成检测报告（仅农药残留传感器）
                  </label>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">检测项目</label>
                  <button onClick={handleAddItem} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700">
                    <Plus className="w-4 h-4" /> 添加项目
                  </button>
                </div>
                {items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <input
                      type="text" value={item.name}
                      onChange={(e) => handleItemChange(index, 'name', e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="检测项目名称"
                    />
                    <input
                      type="number" value={item.value}
                      onChange={(e) => handleItemChange(index, 'value', parseFloat(e.target.value) || 0)}
                      className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="数值" min="0" step="0.001"
                    />
                    <select
                      value={item.unit}
                      onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">单位</option>
                      {getCurrentUnits().map((unit) => (
                        <option key={unit} value={unit}>{unit || 'pH'}</option>
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
                    <span className="ml-2">(超过此值标记为超标)</span>
                  </p>
                </div>
              )}

              {canSubmitSensorData() && (
                <button
                  onClick={handleSubmit} disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400 transition-colors"
                >
                  {isSubmitting ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />提交中...</>
                  ) : (
                    <><Send className="w-4 h-4" />{autoReport ? '提交并生成报告' : '提交数据'}</>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* 右 1/3：最新检测报告 + 已注册传感器（点击可快速切换选中） */}
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
                        <><CheckCircle className="w-5 h-5 text-green-500" /><span className="font-medium text-green-600">合格</span></>
                      ) : (
                        <><AlertTriangle className="w-5 h-5 text-red-500" /><span className="font-medium text-red-600">不合格</span></>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">已注册传感器</h2>
                <span className="text-xs text-gray-400">共 {sensors.length} 台</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {sensors.length > 0 ? (
                  sensors.map((sensor) => {
                    const Icon = getSensorTypeIcon(sensor.type);
                    return (
                      <div
                        key={sensor.device_id}
                        onClick={() => setSelectedSensor(sensor.device_id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedSensor === sensor.device_id
                            ? 'border-green-500 bg-green-50 shadow-sm'
                            : 'border-gray-100 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`w-4 h-4 ${sensor.status === 'online' ? 'text-green-500' : 'text-gray-400'}`} />
                          <span className="text-sm font-medium text-gray-800">{sensor.name}</span>
                          {sensor.status === 'online' ? (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-medium">在线</span>
                          ) : (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">离线</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{sensor.type_name} · {sensor.location || '未设置位置'}</p>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-4 text-gray-400">
                    <PlusCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">点击上方「添加传感器」按钮注册第一台</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分析模式：单列布局，按 筛选 → 汇总 → 趋势 → 记录 → 传感器 顺序展示 */}
      {pageMode === 'analysis' && (
        <div className="space-y-5">
          {/* Row 0：筛选条件（传感器/地块/日期） */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Search className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">筛选条件</h2>
                <p className="text-[11.5px] text-gray-500">选择传感器 + 地块 + 日期，下方趋势图与记录会自动同步更新</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4">
                <label className="block text-[11.5px] font-medium text-gray-600 mb-1">传感器</label>
                <select
                  value={selectedSensor || ''}
                  onChange={(e) => setSelectedSensor(e.target.value || null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                >
                  <option value="">-- 请选择传感器 --</option>
                  {sensors.map((s) => (
                    <option key={s.device_id} value={s.device_id}>
                      {s.name} ({s.type_name}) · {s.status === 'online' ? '在线' : '离线'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11.5px] font-medium text-gray-600 mb-1">地块（可选）</label>
                <select
                  value={selectedPlotCode}
                  onChange={(e) => setSelectedPlotCode(e.target.value)}
                  disabled={!!batchLockedPlot}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-50 disabled:text-gray-500 text-sm"
                >
                  <option value="">{batchLockedPlot ? `已锁定 ${batchLockedPlot}` : '不关联地块'}</option>
                  {plots.map((p) => (
                    <option key={p.plot_code} value={p.plot_code}>
                      {p.name || p.plot_code} ({p.plot_code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-5">
                <div className="flex items-end flex-wrap gap-2">
                  <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox" checked={useDateFilter}
                      onChange={(e) => setUseDateFilter(e.target.checked)}
                      className="w-3.5 h-3.5 text-green-600"
                    /> 按日期过滤
                  </label>
                  <input
                    type="date" value={queryDate}
                    max={getTodayCn()}
                    disabled={!useDateFilter}
                    onChange={(e) => setQueryDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <button
                    onClick={() => {
                      const d = getTodayCn();
                      setQueryDate(d);
                      if (seedBatchCode && selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode, d);
                      else if (selectedSensor) fetchSensorMeasurements(selectedSensor, undefined, d);
                    }}
                    className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >今天</button>
                  <button
                    onClick={() => {
                      const yesterday = getYesterdayCn();
                      setQueryDate(yesterday);
                      if (seedBatchCode && selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode, yesterday);
                      else if (selectedSensor) fetchSensorMeasurements(selectedSensor, undefined, yesterday);
                    }}
                    className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >昨天</button>
                  <button
                    onClick={() => {
                      if (seedBatchCode && selectedSensor) fetchSensorMeasurements(selectedSensor, seedBatchCode, queryDate);
                      else if (selectedSensor) fetchSensorMeasurements(selectedSensor, undefined, queryDate);
                    }}
                    className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"
                  >查询</button>
                </div>
              </div>
            </div>
          </div>

          {/* Row 1：当日汇总 KPI */}
          {selectedSensor ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  当日汇总 {useDateFilter ? `（${queryDate}）` : '（全部历史）'}
                </h3>
                {dailySummary && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-600">
                    <span>总采样：<b className="text-gray-800 text-sm">{dailySummary.total_samples ?? 0}</b> 条</span>
                    <span>开始：<b className="text-gray-800 text-sm">{dailySummary.first_time ?? '-'}</b></span>
                    <span>结束：<b className="text-gray-800 text-sm">{dailySummary.last_time ?? '-'}</b></span>
                    <span>累计：<b className="text-gray-800 text-sm">{Math.round(dailySummary.total_minutes ?? 0)}</b> 分钟</span>
                  </div>
                )}
              </div>
              {dailySummary && dailySummary.items?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[540px]">
                    <thead className="bg-emerald-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">检测项目</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">采样次数</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">平均值</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">最小值</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">最大值</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">单位</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {dailySummary.items.map((s: any, i: number) => (
                        <tr key={i} className="hover:bg-emerald-50/40">
                          <td className="px-3 py-2 text-gray-800 font-medium">{s.item_name}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{s.count}</td>
                          <td className="px-3 py-2 text-right text-green-700 font-medium tabular-nums">{s.avg ?? '-'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{s.min ?? '-'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{s.max ?? '-'}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{s.unit || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-400 border border-dashed border-gray-200 rounded-lg">
                  {selectedSensor ? '当天（或所选区间）暂无测量数据' : '请先选择传感器'}
                </div>
              )}
            </div>
          ) : null}

          {/* Row 2：历史趋势图（全宽） */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <LineChart className="w-4 h-4 text-emerald-600" />
                历史趋势图
                <span className="text-[11px] font-normal text-gray-400">
                  {measurements.length > 0 ? `共 ${measurements.length} 条采样点 · WS 实时同步` : ''}
                </span>
              </h3>
            </div>
            <SensorTrendChart measurements={measurements} sensors={sensors} />
          </div>

          {/* Row 3：历史测量记录（全宽，含状态/来源标识） */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <List className="w-4 h-4 text-emerald-600" />
                历史测量记录
                <span className="text-[11px] font-normal text-gray-400">
                  {measurements.length > 0 ? `共 ${measurements.length} 条${useDateFilter ? ` · ${queryDate}` : ''}` : ''}
                </span>
              </h3>
              {measurements.length > MEASUREMENTS_DISPLAY_LIMIT && (
                <button
                  onClick={() => setShowAllMeasurements((v) => !v)}
                  className="text-xs text-green-600 hover:text-green-700 border border-green-200 rounded-md px-3 py-1 bg-green-50 font-medium"
                >
                  {showAllMeasurements
                    ? `只显示前${MEASUREMENTS_DISPLAY_LIMIT}条`
                    : `展开全部（${measurements.length}条）`}
                </button>
              )}
            </div>

            {measurements.length === 0 ? (
              <div className="text-center py-10 text-gray-400 border border-dashed border-gray-200 rounded-lg">
                <List className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium text-gray-500">暂无测量记录</p>
                <p className="text-xs text-gray-400 mt-1">
                  {selectedSensor
                    ? '请先切换到「录入数据」Tab 手动录入 / 开启模拟采集 / 连接硬件'
                    : '请在上方筛选条件中选择一个传感器'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto border border-gray-100 rounded-lg">
                <table className="w-full text-xs min-w-[680px]">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                        <Clock className="inline w-3 h-3 mr-1" />采样时间
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">检测项目</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">数值</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">单位</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600 whitespace-nowrap">地块 / 批次</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600 whitespace-nowrap">
                        <Cpu className="inline w-3 h-3 mr-1" />数据来源
                      </th>
                      <th className="px-3 py-2 text-center font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {(showAllMeasurements ? measurements : measurements.slice(0, MEASUREMENTS_DISPLAY_LIMIT)).map((m, i) => {
                      const tSrc = (m as any).timestamp || (m as any).created_at || (m as any).record_time;
                      const timeStr = formatDateTimeCn(tSrc, { withSecond: true });
                      const sh = (m.source_hint || '').trim();
                      const sourceBadge = (() => {
                        switch (sh) {
                          case 'SIMULATED':
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10.5px] font-medium" title="前端模拟采集，非硬件真实值">
                                <FlaskConical className="w-3 h-3" />模拟
                              </span>
                            );
                          case 'HARDWARE_RS485':
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10.5px] font-medium" title="RS485 桥接脚本真实硬件读数">
                                <Cpu className="w-3 h-3" />RS485 硬件
                              </span>
                            );
                          case 'HARDWARE_RS485_SIM':
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10.5px] font-medium" title="RS485 桥接脚本模拟数据">
                                <FlaskConical className="w-3 h-3" />RS485 模拟
                              </span>
                            );
                          case 'MANUAL_HARDWARE':
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10.5px] font-medium" title="WebSerial 硬件直连">
                                <Cpu className="w-3 h-3" />WebSerial 硬件
                              </span>
                            );
                          case 'MANUAL_ENTRY':
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10.5px] font-medium" title="手动输入数值">
                                手动录入
                              </span>
                            );
                          case 'new_measurement':
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10.5px] font-medium animate-pulse" title="WebSocket 实时到达">
                                <Wifi className="w-3 h-3" />WS 实时
                              </span>
                            );
                          default:
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 text-[10.5px]" title="未标记来源的历史数据">
                                未知
                              </span>
                            );
                        }
                      })();
                      return (
                        <tr key={`${m.id ?? i}-${i}`} className="hover:bg-green-50/40">
                          <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap tabular-nums">{timeStr}</td>
                          <td className="px-3 py-1.5 text-gray-800 font-medium">{m.item_name}</td>
                          <td className="px-3 py-1.5 text-right text-gray-700 tabular-nums font-medium">{Number.isFinite(Number(m.value)) ? Number(m.value) : '-'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500">{m.unit || '-'}</td>
                          <td className="px-3 py-1.5 text-center text-[11px] text-gray-500 whitespace-nowrap">
                            {m.plot_code || m.seed_batch_code
                              ? <>
                                  {m.plot_code && <span className="inline-block px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 mr-1">{m.plot_code}</span>}
                                  {m.seed_batch_code && <span className="inline-block px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">{m.seed_batch_code}</span>}
                                </>
                              : '-'}
                          </td>
                          <td className="px-3 py-1.5 text-center">{sourceBadge}</td>
                          <td className="px-3 py-1.5 text-center">
                            {m.is_over_limit ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10.5px]">
                                <AlertTriangle className="w-3 h-3" />超标
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10.5px]">
                                <CheckCircle className="w-3 h-3" />正常
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!showAllMeasurements && measurements.length > MEASUREMENTS_DISPLAY_LIMIT && (
              <div className="text-center text-xs text-gray-400 pt-1">
                仅显示前 {MEASUREMENTS_DISPLAY_LIMIT} 条，点击上方按钮查看完整 {measurements.length} 条记录
              </div>
            )}
          </div>

          {/* Row 4：已注册传感器（4 列，点击快速切换分析目标）*/}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-600" />
                已注册传感器
              </h3>
              <span className="text-[11px] text-gray-400">点击卡片快速切换分析目标</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sensors.length > 0 ? (
                sensors.map((sensor) => {
                  const Icon = getSensorTypeIcon(sensor.type);
                  return (
                    <div
                      key={sensor.device_id}
                      onClick={() => setSelectedSensor(sensor.device_id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedSensor === sensor.device_id
                          ? 'border-green-500 bg-green-50 shadow-md ring-2 ring-green-200'
                          : 'border-gray-100 hover:border-gray-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          sensor.status === 'online' ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          <Icon className={`w-4 h-4 ${sensor.status === 'online' ? 'text-green-600' : 'text-gray-400'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-800 truncate">{sensor.name}</p>
                          <p className="text-[11px] text-gray-500 truncate">{sensor.type_name}</p>
                        </div>
                        {sensor.status === 'online' ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-medium">在线</span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">离线</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 truncate">📍 {sensor.location || '未设置位置'}</p>
                    </div>
                  );
                })
              ) : (
                <div className="col-span-full text-center py-6 text-gray-400 border border-dashed border-gray-200 rounded-lg">
                  <PlusCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium text-gray-500">还没有任何传感器</p>
                  <p className="text-xs text-gray-400 mt-1">请先点击右上角「添加传感器」注册第一台设备</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
