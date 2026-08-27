from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default

class Sensor(Base):
    __tablename__ = "sensors"
    
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), index=True)
    type = Column(String(50), index=True)
    location = Column(String(200))
    plot_code = Column(String(50), index=True)
    seed_batch_code = Column(String(50), index=True)
    threshold = Column(Float, default=0.0)
    status = Column(String(20), default="offline")
    last_report_time = Column(DateTime)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)
    
    measurements = relationship("Measurement", back_populates="sensor", cascade="all, delete-orphan")

class Measurement(Base):
    __tablename__ = "measurements"
    
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensors.id"))
    seed_batch_code = Column(String(50), index=True)
    # 记录该测量值绑定的地块（硬件传感器可切换地块，切换后历史测量值仍能追溯到当时的地块）
    plot_code = Column(String(50), index=True)
    timestamp = Column(DateTime, default=now_cn_default)
    item_name = Column(String(100), index=True)
    value = Column(Float, nullable=False)
    # 单位：默认 NULL，避免误写为农药残留的 mg/kg（温度/湿度/光照/氮磷钾各有不同单位）
    # 写入时优先取 payload item.unit；缺省则由测量路由按 SENSOR_TYPES[sensor.type].default_items 自动匹配
    unit = Column(String(20), nullable=True, default=None)
    is_over_limit = Column(Boolean, default=False, index=True)
    # 数据来源标记：用于「模拟」与「真实硬件」一眼区分
    #   SIMULATED          → 前端传感器页面手动点击"开始模拟"生成
    #   MANUAL_HARDWARE    → 前端传感器页面手动连接 Web Serial 硬件采集
    #   HARDWARE_RS485     → rs485_bridge.py 真硬件串口直接写入
    #   HARDWARE_RS485_SIM → rs485_bridge.py --simulate 模式写入
    source_hint = Column(String(32), nullable=True, default=None, index=True)
    raw_data = Column(String(500))
    
    sensor = relationship("Sensor", back_populates="measurements")
