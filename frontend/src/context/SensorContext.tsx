import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { api, sensorApi } from '../services/api';

interface MeasurementItem {
  name: string;
  value: number;
  unit: string;
}

interface SensorTypeInfo {
  code: string;
  name: string;
  default_items: Array<{ name: string; unit: string; min: number; max: number }>;
  threshold: number;
}

interface SensorState {
  isSimulating: boolean;
  isAutoSubmitting: boolean;
  isHardwareConnected: boolean;
  isHardwareConnecting: boolean;
  hardwareError: string;
  selectedSensor: string | null;
  selectedSensorName: string;
  selectedSensorType: string;
  items: MeasurementItem[];
  seedBatchCode: string;
  plotCode: string;
  autoReport: boolean;
  sensorTypes: SensorTypeInfo[];
}

interface SensorContextType {
  state: SensorState;
  startSimulation: (sensorId: string, sensorName: string, sensorType: string, items: MeasurementItem[], seedBatchCode: string, plotCode: string, autoReport: boolean, sensorTypes: SensorTypeInfo[]) => void;
  stopSimulation: () => void;
  startAutoSubmit: () => void;
  stopAutoSubmit: () => void;
  startHardware: (sensorId: string, sensorName: string, sensorType: string, items: MeasurementItem[], seedBatchCode: string, plotCode: string, autoReport: boolean, sensorTypes: SensorTypeInfo[]) => void;
  stopHardware: () => void;
  updateSelectedSensor: (sensorId: string | null, sensorName: string, sensorType: string) => void;
  updateItems: (items: MeasurementItem[]) => void;
  updateSeedBatchCode: (code: string) => void;
  updatePlotCode: (code: string) => void;
  updateAutoReport: (auto: boolean) => void;
  updateSensorTypes: (types: SensorTypeInfo[]) => void;
  setOnDataSubmitted: (callback: () => void) => void;
  resetState: () => void;
}

const SensorContext = createContext<SensorContextType | undefined>(undefined);

let simulationInterval: number | null = null;
let autoSubmitInterval: number | null = null;
let onDataSubmittedCallback: (() => void) | null = null;

const generateSimulatedValue = (baseValue: number, variance: number = 5): number => {
  return parseFloat((baseValue + (Math.random() - 0.5) * variance).toFixed(3));
};

const simulateReadingByType = (item: { name: string; value: number; unit: string }, sensorType: string, defaultItem?: { min: number; max: number }): { name: string; value: number; unit: string } => {
  if (defaultItem) {
    const range = defaultItem.max - defaultItem.min;
    const noise = (Math.random() - 0.5) * range * 0.1;
    let simulatedValue;

    switch (sensorType) {
      case 'temperature':
        simulatedValue = 25 + noise;
        break;
      case 'humidity':
        simulatedValue = 60 + noise;
        break;
      case 'ph':
        simulatedValue = 6.5 + noise * 0.2;
        break;
      case 'light':
        simulatedValue = 5000 + noise * 1000;
        break;
      case 'pesticide':
        simulatedValue = Math.max(0, 0.02 + noise * 0.01);
        break;
      case 'soil_moisture':
        simulatedValue = 40 + noise;
        break;
      case 'soil_multi': {
        // 全参数土壤传感器：8 项合理模拟
        switch (item.name) {
          case '土壤湿度':
            return { ...item, value: Math.round((45 + noise) * 10) / 10 };
          case '土壤温度':
            return { ...item, value: Math.round((23 + noise) * 10) / 10 };
          case '电导率':
            return { ...item, value: Math.round(650 + noise * 20) };
          case 'pH值':
            return { ...item, value: Math.round((6.8 + noise * 0.1) * 10) / 10 };
          case '氮含量':
            return { ...item, value: Math.max(1, Math.round(42 + noise * 5)) };
          case '磷含量':
            return { ...item, value: Math.max(1, Math.round(55 + noise * 6)) };
          case '钾含量':
            return { ...item, value: Math.max(1, Math.round(120 + noise * 10)) };
          case '盐分':
            return { ...item, value: Math.max(1, Math.round(35 + noise * 4)) };
          default:
            return { ...item, value: defaultItem ? defaultItem.min + Math.random() * range : 25 };
        }
      }
      case 'co2':
        simulatedValue = 400 + noise * 50;
        break;
      default:
        simulatedValue = defaultItem.min + Math.random() * range;
    }

    return { ...item, value: Math.round(simulatedValue * 1000) / 1000 };
  }
  return { ...item, value: generateSimulatedValue(item.value || 25) };
};

export const SensorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SensorState>({
    isSimulating: false,
    isAutoSubmitting: false,
    isHardwareConnected: false,
    isHardwareConnecting: false,
    hardwareError: '',
    selectedSensor: null,
    selectedSensorName: '',
    selectedSensorType: '',
    items: [],
    seedBatchCode: '',
    plotCode: '',
    autoReport: false,
    sensorTypes: [],
  });

  // ref 镜像 state，确保所有 useCallback 闭包中能读到最新 selectedSensor
  const stateRef = useRef<SensorState>(state);
  stateRef.current = state;

  const lastValuesRef = useRef<Record<string, number>>({});

  // source_hint 使用同步 ref，避免 setState 批处理异步导致首包来源标记错误
  //   'SIMULATED'        → startSimulation 成功进入
  //   'MANUAL_HARDWARE'  → startHardware 成功进入
  //   null               → 均未启动 / 已停止，退化为 MANUAL_ENTRY（后端兜底）
  // 注意：ref 的写入必须和 setState 同步做，不能放到 useEffect，useEffect 仍然晚于同步调用的 startAutoSubmit()
  const activeSourceHintRef = useRef<string | null>(null);

  // ============ 硬件相关：useRef 持久化（避免 rerender 时句柄被重新赋值为 null 导致串口无法关闭）============
  //   portRef:           Web Serial 的 SerialPort 对象
  //   hardwarePollingTimer:  soil_multi 下每 3s 发 Modbus 查询的 setInterval id
  //   hardwareRunningRef:   readLoop 循环开关（boolean，避免停止后 reader.read() 仍然继续）
  //   readerRef / writerRef: Web Serial 的 readable/writable stream reader/writer 句柄（close 需要它们 cancel）
  const portRef = useRef<any>(null);
  const hardwarePollingTimerRef = useRef<number | null>(null);
  const hardwareRunningRef = useRef<boolean>(false);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  // 二进制 / ASCII 读取缓冲区（Web Serial read() 会把分片塞进来，必须持久化）
  const modbusBufferRef = useRef<Uint8Array>(new Uint8Array(0));
  const asciiBufferRef = useRef<string>('');

  const simulateReading = useCallback(() => {
    setState((prev) => {
      if (!prev.selectedSensor || prev.items.length === 0) return prev;

      const sensorTypeInfo = prev.sensorTypes.find((t) => t.code === prev.selectedSensorType);

      const newItems = prev.items.map((item) => {
        const baseValue = lastValuesRef.current[item.name] || item.value || 25;
        lastValuesRef.current[item.name] = baseValue;

        const defaultItem = sensorTypeInfo?.default_items.find((i) => i.name === item.name);
        return simulateReadingByType(item, prev.selectedSensorType, defaultItem);
      });

      return { ...prev, items: newItems };
    });
  }, []);

  const submitData = useCallback(() => {
    setState((currentState) => {
      if (!currentState.selectedSensor || currentState.items.length === 0) return currentState;

      const validItems = currentState.items.filter((item) => item.name && item.value >= 0);
      if (validItems.length === 0) return currentState;

      const endpoint = currentState.autoReport ? '/measurements/data/auto-report' : '/measurements/data';
      const params = new URLSearchParams();
      if (currentState.seedBatchCode) {
        params.set('seed_batch_code', currentState.seedBatchCode);
      }
      if (currentState.plotCode) {
        params.set('plot_code', currentState.plotCode);
      }

      // ===== 数据来源标记：严格按当前运行状态区分，避免「真硬件/模拟」混淆 =====
      //   优先读 activeSourceHintRef（同步变量），避免 React setState 异步批处理造成首包误判 MANUAL_ENTRY
      //   兜底读 state 布尔值（兼容定时器后续触发时 state 已 flush 的场景，双保险）
      let payloadSourceHint: string | null = activeSourceHintRef.current;
      if (!payloadSourceHint) {
        if (currentState.isSimulating) {
          payloadSourceHint = 'SIMULATED';
        } else if (currentState.isHardwareConnected) {
          payloadSourceHint = 'MANUAL_HARDWARE';
        }
      }
      const bodySource = payloadSourceHint;

      api.post(
        endpoint,
        {
          device_id: currentState.selectedSensor,
          source_hint: bodySource,
          items: validItems.map((item) => ({
            name: item.name,
            value: parseFloat(item.value.toFixed(3)),
            unit: item.unit,
            source_hint: (item as any).source_hint || bodySource,
          })),
        },
        { params: params.toString() ? params : undefined }
      ).then(() => {
        if (onDataSubmittedCallback) {
          onDataSubmittedCallback();
        }
      }).catch((error) => {
        console.error('Auto submit failed:', error);
      });

      return currentState;
    });
  }, []);

  const startSimulation = useCallback((sensorId: string, sensorName: string, sensorType: string, items: MeasurementItem[], seedBatchCode: string, plotCode: string, autoReport: boolean, sensorTypes: SensorTypeInfo[]) => {
    if (simulationInterval) clearInterval(simulationInterval);
    if (autoSubmitInterval) clearInterval(autoSubmitInterval);

    items.forEach((item) => {
      lastValuesRef.current[item.name] = item.value || 25;
    });

    // 同步写入 source_hint ref：必须在 setState 之前，保证后续同步调用能立即读到正确值
    activeSourceHintRef.current = 'SIMULATED';

    setState({
      isSimulating: true,
      isAutoSubmitting: false,
      isHardwareConnected: false,
      isHardwareConnecting: false,
      hardwareError: '',
      selectedSensor: sensorId,
      selectedSensorName: sensorName,
      selectedSensorType: sensorType,
      items,
      seedBatchCode,
      plotCode,
      autoReport,
      sensorTypes,
    });

    setTimeout(() => {
      simulateReading();
      simulationInterval = window.setInterval(() => {
        simulateReading();
      }, 5000);
    }, 100);
  }, []);

  const stopSimulation = useCallback(() => {
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    if (autoSubmitInterval) {
      clearInterval(autoSubmitInterval);
      autoSubmitInterval = null;
    }
    lastValuesRef.current = {};
    // 停止模拟：清理 source_hint ref，退化为 MANUAL_ENTRY
    if (activeSourceHintRef.current === 'SIMULATED') {
      activeSourceHintRef.current = null;
    }
    // 主动通知后端传感器离线，让状态立即更新（不等超时窗口）
    const deviceId = stateRef.current.selectedSensor;
    if (deviceId) {
      sensorApi.markOffline(deviceId).catch(() => {});
    }
    setState((prev) => ({ ...prev, isSimulating: false, isAutoSubmitting: false, isHardwareConnecting: false, items: [] }));
  }, []);

  const startAutoSubmit = useCallback(() => {
    if (autoSubmitInterval) clearInterval(autoSubmitInterval);

    setState((prev) => ({ ...prev, isAutoSubmitting: true }));

    submitData();
    autoSubmitInterval = window.setInterval(() => {
      submitData();
    }, 5000);
  }, [submitData]);

  const stopAutoSubmit = useCallback(() => {
    if (autoSubmitInterval) {
      clearInterval(autoSubmitInterval);
      autoSubmitInterval = null;
    }
    // 停止自动上传时，如果模拟/硬件也都已停止，才标记离线
    // 如果用户只是暂停上传但保持模拟运行，传感器仍视为在线（数据流暂歇）
    const deviceId = stateRef.current.selectedSensor;
    if (deviceId) {
      const st = stateRef.current;
      if (!st.isSimulating && !st.isHardwareConnected) {
        sensorApi.markOffline(deviceId).catch(() => {});
      }
    }
    setState((prev) => ({ ...prev, isAutoSubmitting: false }));
  }, []);

  // =========== Modbus RTU 工具函数 ===========
  // CRC16 (Modbus) 校验
  const crc16 = (data: Uint8Array): number => {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }
    return crc & 0xFFFF;
  };

  // 构造 Modbus 读 8 寄存器查询帧（地址0x01，功能0x03，寄存器地址0x0000~0x0007）
  const buildModbusReadQuery = (deviceAddr: number = 0x01, startReg: number = 0x0000, regCount: number = 0x0008): Uint8Array => {
    const frame = new Uint8Array(8);
    frame[0] = deviceAddr;                       // 地址
    frame[1] = 0x03;                             // 功能码
    frame[2] = (startReg >> 8) & 0xFF;           // 起始寄存器地址高字节
    frame[3] = startReg & 0xFF;                  // 起始寄存器地址低字节
    frame[4] = (regCount >> 8) & 0xFF;           // 寄存器数量高字节
    frame[5] = regCount & 0xFF;                  // 寄存器数量低字节
    const crc = crc16(frame.slice(0, 6));
    frame[6] = crc & 0xFF;                       // CRC低字节在前
    frame[7] = (crc >> 8) & 0xFF;                // CRC高字节
    return frame;
  };

  // 解析 Modbus 应答帧并转换为8项土壤参数
  const parseModbusResponse = (frame: Uint8Array): MeasurementItem[] | null => {
    // 期望长度：1(地址)+1(功能码)+1(长度)+16(数据)+2(CRC) = 21字节
    if (frame.length < 21) return null;
    if (frame[1] !== 0x03) return null;
    if (frame[2] !== 16) return null;

    // 校验CRC
    const crcCalc = crc16(frame.slice(0, 19));
    const crcResp = frame[19] | (frame[20] << 8);
    if (crcCalc !== crcResp) {
      console.warn('[Modbus] CRC 校验失败', crcCalc.toString(16), crcResp.toString(16));
      return null;
    }

    // 读 8 个 UINT16 寄存器（注意 温度 INT16 有符号）
    const readU16 = (off: number) => (frame[off] << 8) | frame[off + 1];
    const readS16 = (off: number) => {
      const v = readU16(off);
      return (v & 0x8000) ? v - 0x10000 : v;
    };

    const moistureRaw = readU16(3);    // 寄存器0x0000 含水率
    const tempRaw = readS16(5);        // 寄存器0x0001 温度 (INT16)
    const ecRaw = readU16(7);          // 寄存器0x0002 电导率
    const phRaw = readU16(9);          // 寄存器0x0003 PH
    const nRaw = readU16(11);          // 寄存器0x0004 氮
    const pRaw = readU16(13);          // 寄存器0x0005 磷
    const kRaw = readU16(15);          // 寄存器0x0006 钾
    const saltRaw = readU16(17);       // 寄存器0x0007 盐分

    const result: MeasurementItem[] = [
      { name: '土壤湿度',   value: Math.round(moistureRaw / 10 * 10) / 10,  unit: '%' },
      { name: '土壤温度',   value: Math.round(tempRaw / 10 * 10) / 10,      unit: '℃' },
      { name: '电导率',     value: ecRaw,                                   unit: 'us/cm' },
      { name: 'pH值',       value: Math.round(phRaw / 10 * 10) / 10,        unit: '' },
      { name: '氮含量',     value: nRaw,                                    unit: 'mg/kg' },
      { name: '磷含量',     value: pRaw,                                    unit: 'mg/kg' },
      { name: '钾含量',     value: kRaw,                                    unit: 'mg/kg' },
      { name: '盐分',       value: saltRaw,                                 unit: 'mg/kg' },
    ];
    return result;
  };

  // 通过 name 匹配并填回当前 items（保留 items 顺序和 unit，只更新 value）
  const applyParsedToItems = (parsed: MeasurementItem[], items: MeasurementItem[]): MeasurementItem[] => {
    return items.map((item) => {
      const found = parsed.find((p) =>
        p.name === item.name ||
        p.name.toLowerCase().includes(item.name.toLowerCase()) ||
        item.name.toLowerCase().includes(p.name.toLowerCase())
      );
      if (found) {
        return { ...item, value: found.value };
      }
      return item;
    });
  };

  // =========== ASCII 解析（兼容普通串口传感器） ===========
  const parseAsciiHardwareData = (data: string, _sensorType: string, items: MeasurementItem[]): MeasurementItem[] => {
    const lines = data.trim().split('\n');
    const newItems = [...items];

    lines.forEach((line) => {
      const [name, value] = line.split(':');
      if (name && value) {
        const itemIndex = newItems.findIndex((item) =>
          item.name.toLowerCase().includes(name.trim().toLowerCase()) ||
          name.trim().toLowerCase().includes(item.name.toLowerCase())
        );
        if (itemIndex !== -1) {
          newItems[itemIndex] = { ...newItems[itemIndex], value: parseFloat(value.trim()) };
        }
      }
    });

    return newItems;
  };

  const startHardware = useCallback((sensorId: string, sensorName: string, sensorType: string, items: MeasurementItem[], seedBatchCode: string, plotCode: string, autoReport: boolean, sensorTypes: SensorTypeInfo[]) => {
    if (simulationInterval) clearInterval(simulationInterval);
    if (autoSubmitInterval) clearInterval(autoSubmitInterval);
    if (hardwarePollingTimerRef.current) {
      clearInterval(hardwarePollingTimerRef.current);
      hardwarePollingTimerRef.current = null;
    }
    hardwareRunningRef.current = false;
    portRef.current = null;
    readerRef.current = null;
    writerRef.current = null;
    modbusBufferRef.current = new Uint8Array(0);
    asciiBufferRef.current = '';

    items.forEach((item) => {
      lastValuesRef.current[item.name] = item.value || 25;
    });

    setState({
      isSimulating: false,
      isAutoSubmitting: false,
      isHardwareConnected: false,
      isHardwareConnecting: true,
      hardwareError: '',
      selectedSensor: sensorId,
      selectedSensorName: sensorName,
      selectedSensorType: sensorType,
      items,
      seedBatchCode,
      plotCode,
      autoReport,
      sensorTypes,
    });

    if (!('serial' in navigator)) {
      setState((prev) => ({
        ...prev,
        isHardwareConnecting: false,
        isHardwareConnected: false,
        hardwareError: '您的浏览器不支持Web Serial API，请使用Chrome或Edge浏览器',
      }));
      return;
    }

    const isSoilMulti = sensorType === 'soil_multi';

    (navigator as any).serial.requestPort()
      .then(async (p: any) => {
        portRef.current = p;
        await p.open({
          baudRate: 9600,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          flowControl: 'none',
        });

        writerRef.current = p.writable?.getWriter();
        readerRef.current = p.readable?.getReader();

        setState((prev) => ({
          ...prev,
          isHardwareConnecting: false,
          isHardwareConnected: true,
          isAutoSubmitting: true,
        }));

        hardwareRunningRef.current = true;
        // 硬件串口打开成功 → 同步写入 source_hint ref = MANUAL_HARDWARE
        activeSourceHintRef.current = 'MANUAL_HARDWARE';

        // 数据读取循环（一直读，存在 buffer 中，轮询定时器解析）
        const readLoop = async () => {
          if (!readerRef.current) return;
          try {
            while (hardwareRunningRef.current) {
              const { value, done } = await readerRef.current.read();
              if (done) break;
              if (!value) continue;
              if (isSoilMulti) {
                // Modbus：把字节追加到二进制缓冲
                const prevBuffer = modbusBufferRef.current;
                const merged = new Uint8Array(prevBuffer.length + value.length);
                merged.set(prevBuffer, 0);
                merged.set(value, prevBuffer.length);
                modbusBufferRef.current = merged;
                let readBuffer = modbusBufferRef.current;
                // 收到数据大于等于 21 字节，尝试从头解析一帧
                while (readBuffer.length >= 21) {
                  // 找到 0x01 地址+0x03 功能码开头的位置
                  let startIdx = 0;
                  while (startIdx < readBuffer.length - 2) {
                    if (readBuffer[startIdx] === 0x01 && readBuffer[startIdx + 1] === 0x03) break;
                    startIdx++;
                  }
                  if (startIdx >= readBuffer.length - 20) {
                    // 没有完整帧可能，截断前面，保留末尾
                    modbusBufferRef.current = readBuffer.slice(startIdx);
                    break;
                  }
                  const frame = readBuffer.slice(startIdx, startIdx + 21);
                  const parsed = parseModbusResponse(frame);
                  if (parsed) {
                    // 更新 state 并提交
                    setState((prev) => ({
                      ...prev,
                      items: applyParsedToItems(parsed, prev.items.length ? prev.items : parsed),
                    }));
                    submitData();
                  }
                  // 丢弃已解析部分
                  readBuffer = readBuffer.slice(startIdx + 21);
                  modbusBufferRef.current = readBuffer;
                }
              } else {
                // ASCII 传感器：逐行解析
                asciiBufferRef.current += new TextDecoder().decode(value);
                let asciiBuffer = asciiBufferRef.current;
                while (asciiBuffer.includes('\n')) {
                  const idx = asciiBuffer.indexOf('\n');
                  const line = asciiBuffer.slice(0, idx);
                  asciiBuffer = asciiBuffer.slice(idx + 1);
                  asciiBufferRef.current = asciiBuffer;
                  if (line.trim()) {
                    setState((prev) => ({
                      ...prev,
                      items: parseAsciiHardwareData(line, sensorType, prev.items.length ? prev.items : items),
                    }));
                    submitData();
                  }
                }
              }
            }
          } catch (error) {
            console.error('Hardware read loop error:', error);
            if (hardwareRunningRef.current) {
              setState((prev) => ({
                ...prev,
                isHardwareConnected: false,
                hardwareError: '硬件读取已断开',
              }));
            }
          }
        };
        readLoop();

        // soil_multi：每 3 秒主动发送一次 Modbus 查询帧（RS485 是主从协议，必须问才答）
        if (isSoilMulti) {
          const queryFrame = buildModbusReadQuery(0x01, 0x0000, 0x0008);
          hardwarePollingTimerRef.current = window.setInterval(async () => {
            if (!writerRef.current || !hardwareRunningRef.current) return;
            try {
              await writerRef.current.write(queryFrame);
            } catch (e) {
              console.warn('发送 Modbus 查询失败:', e);
            }
          }, 3000);
          // 立即发一次
          if (writerRef.current) writerRef.current.write(queryFrame).catch(() => {});
        }
      })
      .catch((error: unknown) => {
        console.error('Hardware connection error:', error);
        hardwareRunningRef.current = false;
        setState((prev) => ({
          ...prev,
          isHardwareConnecting: false,
          isHardwareConnected: false,
          hardwareError: typeof error === 'object' && error && (error as Error).name === 'NotFoundError'
            ? '未选择设备或未检测到硬件'
            : '硬件连接失败，请检查设备是否正确连接',
        }));
      });
  }, [submitData]);

  const stopHardware = useCallback(() => {
    hardwareRunningRef.current = false;
    if (hardwarePollingTimerRef.current) {
      clearInterval(hardwarePollingTimerRef.current);
      hardwarePollingTimerRef.current = null;
    }
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    if (autoSubmitInterval) {
      clearInterval(autoSubmitInterval);
      autoSubmitInterval = null;
    }
    // 先 cancel reader/writer，避免 Web Serial 正在挂起 read() 直接 close() 报错
    try { readerRef.current?.cancel?.().catch(() => {}); } catch {}
    try { writerRef.current?.close?.().catch(() => {}); } catch {}
    readerRef.current = null;
    writerRef.current = null;
    // 尝试关闭串口
    try {
      portRef.current?.close?.().catch(() => {});
    } catch {}
    portRef.current = null;
    modbusBufferRef.current = new Uint8Array(0);
    asciiBufferRef.current = '';
    lastValuesRef.current = {};
    // 停止硬件：清理 MANUAL_HARDWARE source_hint
    if (activeSourceHintRef.current === 'MANUAL_HARDWARE') {
      activeSourceHintRef.current = null;
    }
    // 主动通知后端传感器离线
    const deviceId = stateRef.current.selectedSensor;
    if (deviceId) {
      sensorApi.markOffline(deviceId).catch(() => {});
    }
    setState((prev) => ({ ...prev, isHardwareConnected: false, isHardwareConnecting: false, isAutoSubmitting: false }));
  }, []);

  const updateSelectedSensor = useCallback((sensorId: string | null, sensorName: string, sensorType: string) => {
    setState((prev) => ({ ...prev, selectedSensor: sensorId, selectedSensorName: sensorName, selectedSensorType: sensorType }));
  }, []);

  const updateItems = useCallback((items: MeasurementItem[]) => {
    setState((prev) => ({ ...prev, items }));
  }, []);

  const updateSeedBatchCode = useCallback((code: string) => {
    setState((prev) => ({ ...prev, seedBatchCode: code }));
  }, []);

  const updatePlotCode = useCallback((code: string) => {
    setState((prev) => ({ ...prev, plotCode: code }));
  }, []);

  const updateAutoReport = useCallback((auto: boolean) => {
    setState((prev) => ({ ...prev, autoReport: auto }));
  }, []);

  const updateSensorTypes = useCallback((types: SensorTypeInfo[]) => {
    setState((prev) => ({ ...prev, sensorTypes: types }));
  }, []);

  const setOnDataSubmitted = useCallback((callback: () => void) => {
    onDataSubmittedCallback = callback;
  }, []);

  const resetState = useCallback(() => {
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    if (autoSubmitInterval) {
      clearInterval(autoSubmitInterval);
      autoSubmitInterval = null;
    }
    setState({
      isSimulating: false,
      isAutoSubmitting: false,
      isHardwareConnected: false,
      isHardwareConnecting: false,
      hardwareError: '',
      selectedSensor: null,
      selectedSensorName: '',
      selectedSensorType: '',
      items: [],
      seedBatchCode: '',
      plotCode: '',
      autoReport: false,
      sensorTypes: [],
    });
    lastValuesRef.current = {};
  }, []);

  useEffect(() => {
    return () => {
      if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
      }
      if (autoSubmitInterval) {
        clearInterval(autoSubmitInterval);
        autoSubmitInterval = null;
      }
      if (hardwarePollingTimerRef.current) {
        clearInterval(hardwarePollingTimerRef.current);
        hardwarePollingTimerRef.current = null;
      }
      hardwareRunningRef.current = false;
      try { readerRef.current?.cancel?.().catch(() => {}); } catch {}
      try { writerRef.current?.close?.().catch(() => {}); } catch {}
      readerRef.current = null;
      writerRef.current = null;
      try { portRef.current?.close?.().catch(() => {}); } catch {}
      portRef.current = null;
      lastValuesRef.current = {};
    };
  }, []);

  return (
    <SensorContext.Provider
      value={{
        state,
        startSimulation,
        stopSimulation,
        startAutoSubmit,
        stopAutoSubmit,
        startHardware,
        stopHardware,
        updateSelectedSensor,
        updateItems,
        updateSeedBatchCode,
        updatePlotCode,
        updateAutoReport,
        updateSensorTypes,
        setOnDataSubmitted,
        resetState,
      }}
    >
      {children}
    </SensorContext.Provider>
  );
};

export const useSensor = () => {
  const context = useContext(SensorContext);
  if (context === undefined) {
    throw new Error('useSensor must be used within a SensorProvider');
  }
  return context;
};