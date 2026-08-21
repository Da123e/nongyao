from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List

SENSOR_TYPES = {
    "temperature": {"name": "温度传感器", "default_items": [{"name": "温度", "unit": "℃", "min": -40, "max": 80}], "threshold": 35},
    "humidity": {"name": "湿度传感器", "default_items": [{"name": "湿度", "unit": "%RH", "min": 0, "max": 100}], "threshold": 85},
    "ph": {"name": "pH传感器", "default_items": [{"name": "pH值", "unit": "", "min": 0, "max": 14}], "threshold": 8.5},
    "light": {"name": "光照传感器", "default_items": [{"name": "光照强度", "unit": "lux", "min": 0, "max": 200000}], "threshold": 100000},
    "pesticide": {"name": "农药残留传感器", "default_items": [{"name": "农药残留", "unit": "mg/kg", "min": 0, "max": 1}], "threshold": 0.05},
    "soil_moisture": {"name": "土壤湿度传感器", "default_items": [{"name": "土壤湿度", "unit": "%", "min": 0, "max": 100}], "threshold": 90},
    "soil_multi": {
        "name": "全参数土壤传感器(RS485)",
        "default_items": [
            {"name": "土壤湿度", "unit": "%", "min": 0, "max": 100},
            {"name": "土壤温度", "unit": "℃", "min": -40, "max": 80},   # 原「温度」改为「土壤温度」，避免与空气温度传感器冲突
            {"name": "电导率", "unit": "us/cm", "min": 0, "max": 20000},
            {"name": "pH值", "unit": "", "min": 3, "max": 10},
            {"name": "氮含量", "unit": "mg/kg", "min": 0, "max": 2000},
            {"name": "磷含量", "unit": "mg/kg", "min": 0, "max": 2000},
            {"name": "钾含量", "unit": "mg/kg", "min": 0, "max": 2000},
            {"name": "盐分", "unit": "mg/kg", "min": 0, "max": 2000},
        ],
        "threshold": 2000,
    },
    "co2": {"name": "CO2传感器", "default_items": [{"name": "二氧化碳浓度", "unit": "ppm", "min": 0, "max": 10000}], "threshold": 5000},
    "no2": {"name": "二氧化氮传感器", "default_items": [{"name": "二氧化氮浓度", "unit": "ppm", "min": 0, "max": 20}], "threshold": 5},
    "o2": {"name": "氧气传感器", "default_items": [{"name": "氧气浓度", "unit": "%", "min": 0, "max": 100}], "threshold": 18},
    "nh3": {"name": "氨气传感器", "default_items": [{"name": "氨气浓度", "unit": "ppm", "min": 0, "max": 100}], "threshold": 25},
    "ch4": {"name": "甲烷传感器", "default_items": [{"name": "甲烷浓度", "unit": "ppm", "min": 0, "max": 10000}], "threshold": 5000},
    "wind_speed": {"name": "风速传感器", "default_items": [{"name": "风速", "unit": "m/s", "min": 0, "max": 100}], "threshold": 20},
    "pressure": {"name": "气压传感器", "default_items": [{"name": "气压", "unit": "hPa", "min": 300, "max": 1200}], "threshold": 1050},
    "rainfall": {"name": "雨量传感器", "default_items": [{"name": "降雨量", "unit": "mm", "min": 0, "max": 500}], "threshold": 100},
    "custom": {"name": "自定义传感器", "default_items": [{"name": "检测项目", "unit": "", "min": 0, "max": 100}], "threshold": 50},
}

class SensorCreate(BaseModel):
    device_id: str = Field(..., description="设备唯一标识")
    name: str = Field(..., description="传感器名称")
    type: str = Field(default="pesticide", description="传感器类型", enum=list(SENSOR_TYPES.keys()))
    location: Optional[str] = Field(None, description="安装位置")
    plot_code: Optional[str] = Field(None, description="关联地块编码")
    seed_batch_code: Optional[str] = Field(None, description="关联种子批次编码")
    threshold: Optional[float] = Field(None, description="阈值")
    custom_items: Optional[List[dict]] = Field(None, description="自定义检测项目")

class SensorUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    plot_code: Optional[str] = None
    seed_batch_code: Optional[str] = None
    threshold: Optional[float] = None
    status: Optional[str] = None
    custom_items: Optional[List[dict]] = None

class SensorResponse(BaseModel):
    id: int
    device_id: str
    name: str
    type: str
    type_name: str
    location: Optional[str]
    plot_code: Optional[str]
    seed_batch_code: Optional[str]
    threshold: float
    status: str
    last_report_time: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    default_items: List[dict]

    class Config:
        from_attributes = True

class MeasurementItem(BaseModel):
    name: str = Field(..., description="检测项目名称")
    value: float = Field(..., description="检测值")
    unit: str = Field(default="mg/kg", description="单位")

class MeasurementCreate(BaseModel):
    device_id: str = Field(..., description="设备ID")
    items: List[MeasurementItem] = Field(..., description="检测项目列表")

class MeasurementResponse(BaseModel):
    id: int
    sensor_id: int
    seed_batch_code: Optional[str]
    timestamp: datetime
    item_name: str
    value: float
    unit: str
    is_over_limit: bool
    raw_data: Optional[str]

    class Config:
        from_attributes = True

class MeasurementListResponse(BaseModel):
    status: str
    count: int
    data: List[MeasurementResponse]

class SensorTypeInfo(BaseModel):
    code: str
    name: str
    default_items: List[dict]
    threshold: float

class EnvironmentalDataCreate(BaseModel):
    plot_code: str = Field(..., description="地块编码")
    seed_batch_code: Optional[str] = Field(None, description="种子批次编码")
    temperature: Optional[float] = Field(None, description="温度(空气)")
    humidity: Optional[float] = Field(None, description="湿度")
    soil_moisture: Optional[float] = Field(None, description="土壤湿度")
    soil_temperature: Optional[float] = Field(None, description="土壤温度(soil_multi传感器专用，避免覆盖空气温度temperature列)")
    ph_value: Optional[float] = Field(None, description="pH值")
    illumination: Optional[float] = Field(None, description="光照强度")
    wind_speed: Optional[float] = Field(None, description="风速")
    conductivity: Optional[float] = Field(None, description="电导率(us/cm)")
    nitrogen: Optional[float] = Field(None, description="氮含量(mg/kg)")
    phosphorus: Optional[float] = Field(None, description="磷含量(mg/kg)")
    potassium: Optional[float] = Field(None, description="钾含量(mg/kg)")
    salinity: Optional[float] = Field(None, description="盐分(mg/kg)")
    data_source: Optional[str] = Field(None, description="数据来源")

class PesticideApplicationCreate(BaseModel):
    pesticide_id: int = Field(..., description="农药ID")
    pesticide_code: str = Field(..., description="农药编码")
    plot_code: str = Field(..., description="地块编码")
    seed_batch_code: Optional[str] = Field(None, description="种子批次编码")
    application_date: datetime = Field(..., description="使用日期")
    dosage: float = Field(..., description="使用剂量")
    unit: str = Field(..., description="单位")
    dilution_ratio: Optional[float] = Field(None, description="稀释比例")
    target_pest: Optional[str] = Field(None, description="防治对象")
    application_method: str = Field(..., description="使用方法")
    operator: str = Field(..., description="操作人员")
    weather_condition: Optional[str] = Field(None, description="天气条件")

class WarehouseCreate(BaseModel):
    warehouse_code: str = Field(..., description="仓库编码")
    name: str = Field(..., description="仓库名称")
    location: Optional[str] = Field(None, description="仓库位置")
    capacity: Optional[float] = Field(None, description="容量")
    manager: Optional[str] = Field(None, description="负责人")

class InventoryItemCreate(BaseModel):
    warehouse_id: int = Field(..., description="仓库ID")
    item_code: str = Field(..., description="商品编码")
    item_name: str = Field(..., description="商品名称")
    item_type: Optional[str] = Field(None, description="商品类型")
    batch_code: Optional[str] = Field(None, description="批次编码")
    seed_batch_code: Optional[str] = Field(None, description="种子批次编码")
    processing_batch_id: Optional[int] = Field(None, description="加工批次ID")
    quantity: float = Field(..., description="数量")
    unit: str = Field(..., description="单位")
    unit_price: Optional[float] = Field(None, description="单价")
    total_value: Optional[float] = Field(None, description="总价值")
    min_stock: Optional[float] = Field(None, description="最低库存")
    max_stock: Optional[float] = Field(None, description="最高库存")
    expiry_date: Optional[datetime] = Field(None, description="有效期")
    status: Optional[str] = Field(None, description="状态")

class InventoryTransactionCreate(BaseModel):
    transaction_type: str = Field(..., description="交易类型(in/out)")
    quantity: float = Field(..., description="数量")
    unit_price: Optional[float] = Field(None, description="单价")
    description: Optional[str] = Field(None, description="描述")
    operator: Optional[str] = Field(None, description="操作员")

class CustomerCreate(BaseModel):
    customer_code: str = Field(..., description="客户编码")
    name: str = Field(..., description="客户名称")
    contact_name: Optional[str] = Field(None, description="联系人")
    phone: Optional[str] = Field(None, description="电话")
    email: Optional[str] = Field(None, description="邮箱")
    address: Optional[str] = Field(None, description="地址")
    credit_limit: Optional[float] = Field(None, description="信用额度")

class OrderCreate(BaseModel):
    order_no: str = Field(..., description="订单编号")
    customer_id: int = Field(..., description="客户ID")
    order_date: Optional[datetime] = Field(None, description="订单日期")
    delivery_date: Optional[datetime] = Field(None, description="交货日期")
    status: Optional[str] = Field(None, description="状态")
    total_amount: Optional[float] = Field(None, description="总金额")
    payment_status: Optional[str] = Field(None, description="支付状态")
    payment_method: Optional[str] = Field(None, description="支付方式")
    shipping_address: Optional[str] = Field(None, description="收货地址")
    shipping_method: Optional[str] = Field(None, description="配送方式")
    remarks: Optional[str] = Field(None, description="备注")

class LogisticsCreate(BaseModel):
    tracking_no: str = Field(..., description="运单号")
    carrier: str = Field(..., description="承运商")
    current_location: Optional[str] = Field(None, description="当前位置")
    status: Optional[str] = Field(None, description="状态")
    driver_name: Optional[str] = Field(None, description="司机姓名")
    driver_phone: Optional[str] = Field(None, description="司机电话")

class SeedBatchCreate(BaseModel):
    batch_code: str = Field(..., description="批次编码")
    variety_name: str = Field(..., description="品种名称")
    supplier_code: str = Field(..., description="供应商编码")
    breeding_base: Optional[str] = Field(None, description="育种基地")
    production_date: Optional[datetime] = Field(None, description="生产日期")
    net_weight: Optional[float] = Field(None, description="净重")
    germination_rate: Optional[float] = Field(None, description="发芽率")
    purity: Optional[float] = Field(None, description="纯度")
    moisture_content: Optional[float] = Field(None, description="含水量")
    disease_pest_test: Optional[str] = Field(None, description="病虫害检验")
    third_party_certificate: Optional[str] = Field(None, description="第三方证书")
    storage_location: Optional[str] = Field(None, description="存放位置")
    keeper: Optional[str] = Field(None, description="保管人")
    purchase_contract_no: Optional[str] = Field(None, description="采购合同号")

class SupplierCreate(BaseModel):
    supplier_code: str = Field(..., description="供应商编码")
    name: str = Field(..., description="供应商名称")
    contact_name: Optional[str] = Field(None, description="联系人")
    phone: Optional[str] = Field(None, description="电话")
    address: Optional[str] = Field(None, description="地址")
    credit_rating: Optional[str] = Field(None, description="信用等级")

class ProcessingBatchCreate(BaseModel):
    batch_code: str = Field(..., description="批次编码")
    seed_batch_code: str = Field(..., description="种子批次编码")
    raw_material_batch: Optional[str] = Field(None, description="原料批次")
    raw_material_quantity: Optional[float] = Field(None, description="原料数量")
    raw_material_unit: Optional[str] = Field(None, description="原料单位")
    product_name: Optional[str] = Field(None, description="产品名称")
    product_grade: Optional[str] = Field(None, description="产品等级")

class InspectionReportCreate(BaseModel):
    report_code: str = Field(..., description="报告编号")
    report_type: str = Field(..., description="报告类型")
    batch_code: Optional[str] = Field(None, description="种子批次编码")
    processing_batch_code: Optional[str] = Field(None, description="加工批次编码")
    plot_code: Optional[str] = Field(None, description="地块编码")
    inspector: Optional[str] = Field(None, description="检验员")
    inspection_agency: Optional[str] = Field(None, description="检验机构")
    certificate_no: Optional[str] = Field(None, description="证书编号")
    is_qualified: bool = Field(..., description="是否合格")
    remarks: Optional[str] = Field(None, description="备注")

class PlotCreate(BaseModel):
    plot_code: str = Field(..., description="地块编码")
    name: str = Field(..., description="地块名称")
    location: Optional[str] = Field(None, description="位置")
    area: Optional[float] = Field(None, description="面积")
    soil_type: Optional[str] = Field(None, description="土壤类型")
    irrigation_source: Optional[str] = Field(None, description="灌溉水源")
    owner: Optional[str] = Field(None, description="所有者")

class PlantingRecordCreate(BaseModel):
    plot_code: str = Field(..., description="地块编码")
    seed_batch_code: str = Field(..., description="种子批次编码")
    planting_date: Optional[datetime] = Field(None, description="种植日期")
    expected_harvest_date: Optional[datetime] = Field(None, description="预计收获日期")
    planting_density: Optional[float] = Field(None, description="种植密度")
    quantity_planted: Optional[float] = Field(None, description="种植数量")
    farmer: Optional[str] = Field(None, description="种植户")

class FarmingActivityCreate(BaseModel):
    plot_code: str = Field(..., description="地块编码")
    seed_batch_code: Optional[str] = Field(None, description="种子批次编码")
    activity_type: str = Field(..., description="活动类型")
    activity_date: Optional[datetime] = Field(None, description="活动日期")
    description: Optional[str] = Field(None, description="描述")
    worker_id: Optional[int] = Field(None, description="工人ID")
    equipment_id: Optional[int] = Field(None, description="设备ID")
    notes: Optional[str] = Field(None, description="备注")