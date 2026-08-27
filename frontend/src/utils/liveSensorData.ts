/**
 * liveSensorData.ts — WebSocket 实时传感器数据分发中心
 *
 * 连接硬件/模拟上传后，后端会通过 WS 广播 `new_measurement` 消息。
 * 这个模块负责：
 *   1. 维护一个全局最新数据快照（供 6 格指标卡读取）
 *   2. 维护一个趋势缓冲队列（按 plot_code 累积数据点，供内嵌迷你趋势图实时 append）
 *   3. 提供订阅/反订阅 API，组件可按 plot_code 监听新数据
 *
 * 这样就不必每次 WS 消息到达时全量重新 fetch 24h 数据，而是 append 新点。
 */

export type SensorDataPoint = {
  t: string;         // ISO 时间戳
  v: number;         // 值
  key: string;       // 参数键（如 soil_temperature）
  label?: string;    // 参数中文标签
  unit?: string;     // 单位
};

export type LiveMeasurementPayload = {
  type: "new_measurement";
  device_id: string;
  timestamp: string;
  plot_code: string;
  seed_batch_code?: string;
  items: Array<{
    key?: string;
    name?: string;
    value?: number;
    unit?: string;
    item_key?: string;
    item_name?: string;
    measured_value?: number;
    measurement_unit?: string;
  }>;
};

/** 参数键名的多源归一化（后端 items 字段可能用不同命名） */
const KEY_MAP: Record<string, string> = {
  soil_temperature: "soil_temperature",
  soil_temp: "soil_temperature",
  temperature: "soil_temperature",
  "土壤温度": "soil_temperature",
  "温度值": "soil_temperature",
  soil_moisture: "soil_moisture",
  moisture: "soil_moisture",
  "土壤湿度": "soil_moisture",
  "土壤水分": "soil_moisture",
  "体积含水量": "soil_moisture",
  "含水率": "soil_moisture",
  ph: "ph_value",
  ph_value: "ph_value",
  "pH 值": "ph_value",
  "PH 值": "ph_value",
  ph_value_value: "ph_value",
  nitrogen: "nitrogen",
  "氮": "nitrogen",
  "氮含量": "nitrogen",
  phosphorus: "phosphorus",
  "磷": "phosphorus",
  "磷含量": "phosphorus",
  potassium: "potassium",
  "钾": "potassium",
  "钾含量": "potassium",
  conductivity: "conductivity",
  "电导率": "conductivity",
  ec: "conductivity",
  EC: "conductivity",
  salinity: "salinity",
  "盐度": "salinity",
  "盐分": "salinity",
  tds: "tds",
  TDS: "tds",
  "溶解性总固体": "tds",
};

const LABEL_MAP: Record<string, { label: string; unit: string }> = {
  soil_temperature: { label: "土壤温度", unit: "°C" },
  soil_moisture: { label: "土壤湿度", unit: "%" },
  ph_value: { label: "pH 值", unit: "" },
  nitrogen: { label: "氮 (N)", unit: "mg/kg" },
  phosphorus: { label: "磷 (P)", unit: "mg/kg" },
  potassium: { label: "钾 (K)", unit: "mg/kg" },
  conductivity: { label: "电导率", unit: "μS/cm" },
  salinity: { label: "盐分", unit: "mg/kg" },
  tds: { label: "TDS", unit: "mg/kg" },
};

/** 归一化一个参数名 */
function normalizeKey(raw: string): string | null {
  const k = KEY_MAP[raw];
  if (k) return k;
  // 兜底：contains 匹配
  for (const key of Object.keys(KEY_MAP)) {
    if (raw.includes(key) || key.includes(raw)) return KEY_MAP[key];
  }
  return null;
}

/** 从 items 数组中抽出 value（兼容多种字段名） */
function pickValue(item: any): number | null {
  const v = item.value ?? item.measured_value ?? item.v ?? item.reading;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function pickKey(item: any): string | null {
  return normalizeKey(item.key ?? item.item_key ?? item.name ?? item.item_name ?? "");
}
function pickUnit(item: any): string {
  return item.unit ?? item.measurement_unit ?? "";
}

// ---- 事件总线（极简） ----
type Listener = (payload: LiveMeasurementPayload, normalized: SensorDataPoint[]) => void;
const listeners: Set<Listener> = new Set();

// ---- 趋势缓冲（按 plot_code -> 参数键 -> 点列表） ----
// 最多存 24h * 1200 = 最多 2880 点/参数，避免内存无界
const MAX_POINTS_PER_PARAM = 2880;
const trendBuffer: Record<string, Record<string, SensorDataPoint[]>> = {};

/** 把一条 WS 消息写入缓冲，同时分发到监听器 */
export function ingestLiveMeasurement(payload: LiveMeasurementPayload) {
  const ts = payload.timestamp;
  const plotCode = payload.plot_code;
  const normalized: SensorDataPoint[] = [];

  for (const it of payload.items) {
    const key = pickKey(it);
    if (!key) continue;
    const v = pickValue(it);
    if (v === null) continue;
    const meta = LABEL_MAP[key];
    const pt: SensorDataPoint = {
      t: ts,
      v,
      key,
      label: meta?.label ?? "",
      unit: meta?.unit ?? pickUnit(it),
    };
    normalized.push(pt);

    // 入缓冲
    if (!trendBuffer[plotCode]) trendBuffer[plotCode] = {};
    if (!trendBuffer[plotCode][key]) trendBuffer[plotCode][key] = [];
    const arr = trendBuffer[plotCode][key];
    arr.push(pt);
    if (arr.length > MAX_POINTS_PER_PARAM) arr.shift();
  }

  // 分发
  for (const fn of listeners) {
    try { fn(payload, normalized); } catch (e) { /* noop */ }
  }
}

/** 订阅实时数据流。返回取消订阅函数 */
export function subscribeLiveData(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 按 plot_code 取缓冲里的趋势点（返回结构与 getPlotHistory 接口一致，方便直接合并） */
export function getBufferedSeries(plotCode: string) {
  const plot = trendBuffer[plotCode];
  if (!plot) return null;
  const series: Record<string, { label: string; unit: string; points: SensorDataPoint[] }> = {};
  const allTs: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(plot)) {
    const meta = LABEL_MAP[key];
    series[key] = {
      label: meta?.label ?? key,
      unit: meta?.unit ?? "",
      points: plot[key].slice(),
    };
    for (const p of plot[key]) {
      if (!seen.has(p.t)) { seen.add(p.t); allTs.push(p.t); }
    }
  }
  allTs.sort();
  return { series, timestamps: allTs };
}

/** 清空缓冲（重置场景下使用） */
export function clearBufferedSeries() {
  Object.keys(trendBuffer).forEach((k) => delete trendBuffer[k]);
}
