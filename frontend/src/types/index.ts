export interface Sensor {
  id: number;
  device_id: string;
  name: string;
  type: string;
  type_name?: string;
  location: string | null;
  plot_code?: string | null;
  seed_batch_code?: string | null;
  threshold: number;
  status: string;
  last_report_time: string | null;
  created_at: string;
  updated_at: string;
  default_items?: Array<{ name: string; unit: string; min: number; max: number }>;
}

export interface SensorTypeInfo {
  code: string;
  name: string;
  default_items: Array<{ name: string; unit: string; min: number; max: number }>;
  threshold: number;
}

export interface MeasurementItem {
  name: string;
  value: number;
  unit: string;
}

export interface Measurement {
  id: number;
  sensor_id: number;
  seed_batch_code: string | null;
  timestamp: string;
  item_name: string;
  value: number;
  unit: string;
  is_over_limit: boolean;
  raw_data: string | null;
}

export interface MeasurementCreate {
  device_id: string;
  items: MeasurementItem[];
}

export interface MeasurementListResponse {
  status: string;
  count: number;
  data: Measurement[];
}

/** 单项目日汇总（count / avg / min / max + 单位） */
export interface DailySummaryItem {
  item_name: string;
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  unit: string;
}

/** 传感器某日整体汇总（供 /sensor 页面日统计卡片使用） */
export interface DailySummary {
  total_samples: number;
  first_time: string | null;
  last_time: string | null;
  total_minutes: number;
  items: DailySummaryItem[];
}

/** GET /measurements/daily-summary 的响应包体 */
export interface DailySummaryResponse {
  status: string;
  date: string;
  sensor_id: string;
  sensor_name: string;
  summary: DailySummary;
}

/** 首页最新环境记录（供 Dashboard 环境卡片使用） */
export interface LatestEnvironmentalRecord {
  plot_id: number;
  plot_code: string;
  plot_name: string;
  location: string | null;
  seed_batch_code: string | null;
  record_time: string | null;
  record_date: string | null;
  is_stale: boolean;
  temperature: number | null;
  humidity: number | null;
  soil_moisture: number | null;
  soil_temperature: number | null;
  ph_value: number | null;
  illumination: number | null;
  wind_speed: number | null;
  conductivity: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  salinity: number | null;
  data_source: string | null;
}

export interface SeedSupplier {
  id: number;
  supplier_code: string;
  name: string;
  contact_name: string;
  phone: string;
  address: string;
  credit_rating: string;
  is_active: boolean;
  created_at: string;
}

export interface SeedBatch {
  id: number;
  batch_code: string;
  supplier_id: number;
  supplier_name?: string;
  variety_name: string;
  breeding_base: string;
  production_date: string;
  net_weight: number;
  germination_rate: number;
  purity: number;
  moisture_content: number;
  storage_location: string;
  keeper: string;
  purchase_contract_no: string;
  status: string;
  blockchain_hash: string;
  ipfs_hash: string;
  is_on_chain: boolean;
  created_at: string;
}

export interface SeedQualityTest {
  id: number;
  batch_id: number;
  batch_code?: string;
  test_date: string;
  test_item: string;
  test_value: number;
  standard_value: number;
  is_qualified: boolean;
  test_method: string;
  inspector: string;
  third_party_certificate: string | null;
  blockchain_hash: string | null;
  ipfs_hash: string | null;
  created_at: string;
}

export interface Plot {
  id: number;
  plot_code: string;
  name: string;
  location: string;
  area: number;
  soil_type: string;
  irrigation_source: string;
  is_active: boolean;
  created_at: string;
}

export interface PlantingRecord {
  id: number;
  plot_id: number;
  plot_code?: string;
  batch_id: number;
  batch_code?: string;
  planting_date: string;
  expected_harvest_date: string;
  farmer: string;
  quantity_planted: number;
  status: string;
}

export interface EnvironmentalData {
  id: number;
  plot_id: number;
  record_time: string;
  temperature: number | null;
  humidity: number | null;
  soil_moisture: number | null;
  soil_temperature: number | null;
  ph_value: number | null;
  light_intensity?: number | null;
  illumination?: number | null;
  wind_speed?: number | null;
  conductivity?: number | null;
  nitrogen?: number | null;
  phosphorus?: number | null;
  potassium?: number | null;
  salinity?: number | null;
}

export interface FarmingActivity {
  id: number;
  plot_id: number;
  activity_type: string;
  activity_date: string;
  description: string;
  operator: string;
  equipment_used: string;
}

export interface Pesticide {
  id: number;
  pesticide_code: string;
  name: string;
  brand: string;
  registration_no: string;
  active_ingredient: string;
  dosage_form: string;
  toxicity_level: string;
  safety_interval: number;
  is_active: boolean;
}

export interface PesticidePurchase {
  id: number;
  pesticide_id: number;
  pesticide_name?: string;
  purchase_date: string;
  quantity: number;
  unit: string;
  unit_price: number;
  supplier: string;
  invoice_no: string;
}

export interface PesticideApplication {
  id: number;
  plot_id: number;
  plot_code?: string;
  pesticide_id: number;
  pesticide_name?: string;
  application_date: string;
  dosage: number;
  unit: string;
  applicator: string;
  safety_interval_end: string;
  is_compliant: boolean;
}

export interface InspectionReport {
  id: number;
  report_code: string;
  batch_id: number;
  batch_code?: string;
  report_type: string;
  report_date: string;
  inspector: string;
  inspection_agency: string;
  is_qualified: boolean;
  blockchain_hash: string;
}

export interface PesticideResidueTest {
  id: number;
  report_id: number;
  report_code?: string;
  test_item: string;
  limit_value: number;
  measured_value: number;
  unit: string;
  is_over_limit: boolean;
}

export interface ProcessingBatch {
  id: number;
  batch_code: string;
  seed_batch_id: number;
  seed_batch_code?: string;
  raw_material_batch: string;
  raw_material_quantity: number;
  product_name: string;
  product_grade: string;
  output_quantity: number;
  output_unit: string;
  processing_date: string;
  status: string;
  blockchain_hash: string;
}

export interface ProcessingRecord {
  id: number;
  batch_id: number;
  batch_code?: string;
  process_name: string;
  process_order: number;
  start_time: string;
  end_time: string;
  parameters: string;
  operator: string;
  equipment_used: string;
  quality_check_result: string;
}

export interface Warehouse {
  id: number;
  warehouse_code: string;
  name: string;
  location: string;
  type: string;
  capacity: number;
  temperature_range: string;
  humidity_range: string;
  manager: string;
  is_active: boolean;
}

export interface InventoryItem {
  id: number;
  warehouse_id: number;
  warehouse_name?: string;
  item_code: string;
  item_name: string;
  item_type: string;
  batch_code: string;
  seed_batch_id: number;
  seed_batch_code?: string;
  processing_batch_id: number;
  quantity: number;
  unit: string;
  unit_price: number;
  total_value: number;
  min_stock: number;
  max_stock: number;
  expiry_date: string;
  storage_location: string;
  status: string;
}

export interface InventoryTransaction {
  id: number;
  item_id: number;
  item_name?: string;
  transaction_type: string;
  quantity: number;
  unit: string;
  transaction_date: string;
  operator: string;
  source_document: string;
}

export interface Customer {
  id: number;
  customer_code: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  customer_type: string;
  credit_limit: number;
  is_active: boolean;
}

export interface Order {
  id: number;
  order_no: string;
  customer_id: number;
  customer_name?: string;
  order_date: string;
  delivery_date: string;
  status: string;
  total_amount: number;
  payment_status: string;
  shipping_address: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_code: string;
  item_name: string;
  batch_code: string;
  seed_batch_code?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  product_grade: string;
}

export interface LogisticsTracking {
  id: number;
  order_id: number;
  tracking_no: string;
  carrier: string;
  vehicle_no: string;
  driver_name: string;
  status: string;
  origin: string;
  destination: string;
  departure_time: string;
  estimated_arrival_time: string;
  current_location: string;
}

export interface BlockchainRecord {
  id: number;
  chain_id: string;
  data_hash: string;
  data_type: string;
  batch_code: string;
  upload_time: string;
  signature: string;
}

export interface BatchFullChainSeed {
  batch: SeedBatch;
  supplier: SeedSupplier | null;
  quality_tests: SeedQualityTest[];
}

export interface BatchFullChainPlanting {
  records: PlantingRecord[];
  plots: Record<number | string, Plot>;
  farming_activities: FarmingActivity[];
  pesticide_applications: PesticideApplication[];
  pesticides: Record<number | string, Pesticide>;
  environmental_data: EnvironmentalData[];
}

export interface BatchFullChainProcessing {
  batches: ProcessingBatch[];
  records: Record<number | string, ProcessingRecord[]>;
}

export interface BatchFullChainInspection {
  reports: InspectionReport[];
  residue_tests: Record<number, PesticideResidueTest[]>;
}

export interface BatchFullChainSales {
  order_items: OrderItem[];
  orders: Record<number | string, Order>;
}

export interface BatchFullChainData {
  seed: BatchFullChainSeed;
  planting: BatchFullChainPlanting;
  processing: BatchFullChainProcessing;
  inspection: BatchFullChainInspection;
  inventory: InventoryItem[];
  sales: BatchFullChainSales;
}

export interface TraceResult {
  seed_batch: {
    batch_code: string;
    variety_name: string;
    breeding_base: string;
    production_date: string;
    supplier: string;
    status: string;
  };
  planting: Array<{
    plot_code: string;
    plot_name: string;
    planting_date: string;
    status: string;
    farming_activities: Array<{
      activity_type: string;
      activity_date: string;
      description: string;
    }>;
    environmental_data: Array<{
      record_time: string;
      temperature: number | null;
      humidity: number | null;
      soil_moisture: number | null;
      soil_temperature?: number | null;
      ph_value: number | null;
      illumination?: number | null;
      wind_speed?: number | null;
      conductivity?: number | null;
      nitrogen?: number | null;
      phosphorus?: number | null;
      potassium?: number | null;
      salinity?: number | null;
      data_source?: string | null;
    }>;
  }>;
  pesticide_applications: Array<{
    pesticide_name: string;
    brand: string;
    application_date: string;
    dosage: number;
    is_compliant: boolean;
  }>;
  inspections: Array<{
    report_code: string;
    report_type: string;
    report_date: string;
    is_qualified: boolean;
    pesticide_residues: Array<{
      test_item: string;
      limit_value: number;
      measured_value: number;
      is_over_limit: boolean;
    }>;
  }>;
  processing: Array<{
    batch_code: string;
    product_name: string;
    processing_date: string;
    status: string;
    process_records: Array<{
      process_name: string;
      start_time: string;
      end_time: string;
    }>;
  }>;
  inventory: Array<{
    item_code: string;
    item_name: string;
    quantity: number;
    unit: string;
  }>;
  sales: Array<{
    order_no: string;
    item_name: string;
    quantity: number;
    order_date: string;
    status: string;
  }>;
}