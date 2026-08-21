import { Line } from 'react-chartjs-2';
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
import { useMemo } from 'react';
import type { Sensor, Measurement } from '../types';

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

interface SensorTrendChartProps {
  measurements: Measurement[];
  sensors: Sensor[];
}

const sensorTypeConfig: Record<string, { min: number; max: number; color: string; step: number; decimals: number }> = {
  temperature: { min: -10, max: 50, color: '#ef4444', step: 5, decimals: 1 },
  humidity: { min: 0, max: 100, color: '#3b82f6', step: 10, decimals: 0 },
  ph: { min: 4, max: 10, color: '#8b5cf6', step: 0.5, decimals: 1 },
  light: { min: 0, max: 100000, color: '#eab308', step: 10000, decimals: 0 },
  illumination: { min: 0, max: 200000, color: '#eab308', step: 20000, decimals: 0 },
  wind_speed: { min: 0, max: 50, color: '#14b8a6', step: 5, decimals: 1 },
  pesticide: { min: 0, max: 10, color: '#dc2626', step: 0.5, decimals: 2 },
  soil_moisture: { min: 0, max: 100, color: '#16a34a', step: 10, decimals: 0 },
  co2: { min: 300, max: 2000, color: '#f97316', step: 200, decimals: 0 },
  environmental: { min: 0, max: 100, color: '#06b6d4', step: 10, decimals: 1 },
  // 土壤多参数（RS485 8项）独立配置，避免全部压到 environmental 的 0~100 灰线
  conductivity: { min: 0, max: 20000, color: '#2563eb', step: 2000, decimals: 0 },
  nitrogen: { min: 0, max: 2000, color: '#16a34a', step: 200, decimals: 0 },
  phosphorus: { min: 0, max: 2000, color: '#dc2626', step: 200, decimals: 0 },
  potassium: { min: 0, max: 2000, color: '#7c3aed', step: 200, decimals: 0 },
  salinity: { min: 0, max: 2000, color: '#d97706', step: 200, decimals: 0 },
  soil_temperature: { min: -10, max: 50, color: '#b91c1c', step: 5, decimals: 1 },
};

const getItemColor = (itemName: string, sensorType: string): string => {
  const lowerName = itemName.toLowerCase();
  if (lowerName.includes('电导率')) return '#2563eb';          // 蓝色系
  if (lowerName.includes('氮') && !lowerName.includes('磷') && !lowerName.includes('钾')) return '#16a34a';  // 绿色
  if (lowerName.includes('磷')) return '#dc2626';              // 红色
  if (lowerName.includes('钾')) return '#7c3aed';              // 紫色
  if (lowerName.includes('盐分')) return '#d97706';            // 琥珀色
  if (lowerName.includes('土壤温度')) return '#b91c1c';        // 暗红（与空气温度区分开）
  if (lowerName.includes('土壤湿度')) return '#059669';        // 青绿（与空气湿度区分开）
  if (lowerName.includes('温度')) return '#ef4444';
  if (lowerName.includes('湿度')) return '#3b82f6';
  if (lowerName.includes('ph') || lowerName.includes('酸碱度')) return '#8b5cf6';
  if (lowerName.includes('光照')) return '#eab308';
  if (lowerName.includes('农药')) return '#dc2626';
  if (lowerName.includes('co2') || lowerName.includes('二氧化碳')) return '#f97316';
  return sensorTypeConfig[sensorType]?.color || '#6b7280';
};

const removeOutliers = (values: number[], typeConfig?: { min: number; max: number }): { cleaned: number[]; outliers: number[] } => {
  if (values.length < 4) return { cleaned: values, outliers: [] };

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const cleaned: number[] = [];
  const outliers: number[] = [];

  values.forEach((v) => {
    if (typeConfig) {
      if (v >= typeConfig.min && v <= typeConfig.max) {
        cleaned.push(v);
      } else {
        outliers.push(v);
      }
    } else if (v >= lowerBound && v <= upperBound) {
      cleaned.push(v);
    } else {
      outliers.push(v);
    }
  });

  return { cleaned, outliers };
};

const SensorTrendChart = ({ measurements, sensors }: SensorTrendChartProps) => {
  const chartData = useMemo(() => {
    if (measurements.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const sortedMeasurements = [...measurements].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const itemGroups: Record<string, { values: number[]; timestamps: string[]; unit: string; sensorType: string; originalValues: number[] }> = {};

    sortedMeasurements.forEach((m) => {
      const sensor = sensors.find((s) => s.id === m.sensor_id);
      const key = `${m.item_name}_${m.sensor_id}`;

      if (!itemGroups[key]) {
        itemGroups[key] = {
          values: [],
          timestamps: [],
          unit: m.unit,
          sensorType: sensor?.type || 'environmental',
          originalValues: [],
        };
      }

      itemGroups[key].values.push(m.value);
      itemGroups[key].originalValues.push(m.value);
      itemGroups[key].timestamps.push(m.timestamp);
    });

    const labels = sortedMeasurements.map((m) => {
      const date = new Date(m.timestamp);
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    });

    const uniqueLabels = [...new Set(labels)];

    const datasets = Object.entries(itemGroups).map(([key, group], index) => {
      const [itemName] = key.split('_');
      const sensor = sensors.find((s) => s.type === group.sensorType);

      const values: number[] = [];
      uniqueLabels.forEach((label) => {
        const timestampIndex = group.timestamps.findIndex((t) => {
          const date = new Date(t);
          return (
            date.toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }) === label
          );
        });
        if (timestampIndex !== -1) {
          values.push(group.values[timestampIndex]);
        } else {
          values.push(NaN);
        }
      });

      return {
        label: `${itemName} (${sensor?.name || '传感器'})`,
        data: values,
        borderColor: getItemColor(itemName, group.sensorType),
        backgroundColor: `${getItemColor(itemName, group.sensorType)}20`,
        borderWidth: 2,
        pointRadius: measurements.length > 50 ? 0 : 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.4,
        yAxisID: `y${index}`,
      };
    });

    return { labels: uniqueLabels, datasets };
  }, [measurements, sensors]);

  const getYAxisConfigs = useMemo(() => {
    const configs: Record<string, { min: number; max: number; unit: string; position: 'left' | 'right'; decimals: number; step: number }> = {};
    
    chartData.datasets.forEach((dataset, index) => {
      const values = dataset.data.filter((v): v is number => !isNaN(v));
      if (values.length === 0) return;

      const [itemName] = dataset.label?.split('(')[0]?.trim().split('_') || [''];
      let sensorType = sensors.find((s) => dataset.label?.includes(s.name))?.type || 'environmental';
      
      const lowerName = itemName.toLowerCase();
      if (lowerName.includes('电导率')) sensorType = 'conductivity';
      else if (lowerName.includes('氮') && !lowerName.includes('磷') && !lowerName.includes('钾')) sensorType = 'nitrogen';
      else if (lowerName.includes('磷')) sensorType = 'phosphorus';
      else if (lowerName.includes('钾')) sensorType = 'potassium';
      else if (lowerName.includes('盐分')) sensorType = 'salinity';
      else if (lowerName.includes('土壤温度')) sensorType = 'soil_temperature';
      else if (lowerName.includes('土壤湿度')) sensorType = 'soil_moisture';
      else if (lowerName.includes('温度')) sensorType = 'temperature';
      else if (lowerName.includes('湿度')) sensorType = 'humidity';
      else if (lowerName.includes('ph') || lowerName.includes('酸碱度')) sensorType = 'ph';
      else if (lowerName.includes('光照')) sensorType = 'illumination';
      else if (lowerName.includes('风速')) sensorType = 'wind_speed';
      else if (lowerName.includes('农药')) sensorType = 'pesticide';
      else if (lowerName.includes('co2') || lowerName.includes('二氧化碳')) sensorType = 'co2';

      const typeConfig = sensorTypeConfig[sensorType];
      
      const { cleaned: cleanedValues } = removeOutliers(values, typeConfig);
      const displayValues = cleanedValues.length > 0 ? cleanedValues : values;

      const minVal = Math.min(...displayValues);
      const maxVal = Math.max(...displayValues);
      const range = maxVal - minVal;
      
      const padding = range * 0.2 || (typeConfig?.step || 10);
      let min = minVal - padding;
      let max = maxVal + padding;

      if (typeConfig) {
        min = Math.max(min, typeConfig.min);
        max = Math.min(max, typeConfig.max);
        if (min === max) {
          min -= typeConfig.step;
          max += typeConfig.step;
        }
      }

      const step = typeConfig?.step || (range > 0 ? range / 5 : 10);
      min = Math.floor(min / step) * step;
      max = Math.ceil(max / step) * step;

      configs[`y${index}`] = {
        min,
        max,
        unit: '',
        position: chartData.datasets.length === 1 ? 'left' : (index % 2 === 0 ? 'left' : 'right'),
        decimals: typeConfig?.decimals || 2,
        step,
      };
    });

    return configs;
  }, [chartData.datasets, sensors]);

  const options = useMemo(() => {
    const scales: Record<string, any> = {
      x: {
        display: true,
        title: {
          display: true,
          text: '时间',
          font: { size: 12 },
        },
        ticks: {
          maxRotation: 45,
          minRotation: 0,
          maxTicksLimit: Math.min(chartData.labels.length, 15),
          font: { size: 10 },
        },
        grid: {
          display: false,
        },
      },
    };

    chartData.datasets.forEach((dataset) => {
      const yAxisId = dataset.yAxisID;
      const config = getYAxisConfigs[yAxisId];
      
      scales[yAxisId] = {
        type: 'linear' as const,
        display: true,
        position: config?.position || 'left',
        min: config?.min,
        max: config?.max,
        ticks: {
          stepSize: config?.step || 10,
          font: { size: 10 },
          callback: (value: number) => value.toFixed(config?.decimals || 2),
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
      };
    });

    return {
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
            label: (context: any) => {
              const datasetLabel = context.dataset.label || '';
              const value = context.parsed.y;
              if (isNaN(value) || value === null || value === undefined) {
                return `${datasetLabel}: -`;
              }
              // 从 label 里提取出参数项名，匹配到 typeConfig 以获得合适的小数位
              const itemName = datasetLabel.split('(')[0]?.trim() || '';
              const lowerName = itemName.toLowerCase();
              let matchedType: string | undefined;
              if (lowerName.includes('电导率')) matchedType = 'conductivity';
              else if (lowerName.includes('氮') && !lowerName.includes('磷') && !lowerName.includes('钾')) matchedType = 'nitrogen';
              else if (lowerName.includes('磷')) matchedType = 'phosphorus';
              else if (lowerName.includes('钾')) matchedType = 'potassium';
              else if (lowerName.includes('盐分')) matchedType = 'salinity';
              else if (lowerName.includes('土壤温度')) matchedType = 'soil_temperature';
              else if (lowerName.includes('土壤湿度')) matchedType = 'soil_moisture';
              else if (lowerName.includes('温度')) matchedType = 'temperature';
              else if (lowerName.includes('湿度')) matchedType = 'humidity';
              else if (lowerName.includes('ph') || lowerName.includes('酸碱度')) matchedType = 'ph';
              else if (lowerName.includes('光照')) matchedType = 'illumination';
              else if (lowerName.includes('风速')) matchedType = 'wind_speed';
              else if (lowerName.includes('农药')) matchedType = 'pesticide';
              else if (lowerName.includes('co2') || lowerName.includes('二氧化碳')) matchedType = 'co2';
              const decimals = matchedType
                ? sensorTypeConfig[matchedType]?.decimals ?? 2
                : 2;
              return `${datasetLabel}: ${Number(value).toFixed(decimals)}`;
            },
          },
        },
      },
      scales,
    };
  }, [chartData, getYAxisConfigs]);

  if (measurements.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">历史趋势图</h2>
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="w-16 h-16 mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
          </div>
          <p>暂无测量数据</p>
          <p className="text-sm mt-1">开始传感器采集后将显示趋势图</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">历史趋势图</h2>
      <div className="h-72">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

export default SensorTrendChart;