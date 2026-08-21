from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base

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
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    
    measurements = relationship("Measurement", back_populates="sensor", cascade="all, delete-orphan")

class Measurement(Base):
    __tablename__ = "measurements"
    
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensors.id"))
    seed_batch_code = Column(String(50), index=True)
    timestamp = Column(DateTime, default=datetime.now)
    item_name = Column(String(100), index=True)
    value = Column(Float, nullable=False)
    unit = Column(String(20), default="mg/kg")
    is_over_limit = Column(Boolean, default=False)
    raw_data = Column(String(500))
    
    sensor = relationship("Sensor", back_populates="measurements")
