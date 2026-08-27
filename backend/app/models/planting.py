from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text, PrimaryKeyConstraint, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class Plot(Base):
    __tablename__ = "plots"

    id = Column(Integer, primary_key=True, index=True)
    plot_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    location = Column(String(200), index=True)
    area = Column(Float)
    soil_type = Column(String(50))
    irrigation_source = Column(String(100))
    soil_test_report = Column(String(255))
    irrigation_water_test = Column(String(255))
    owner = Column(String(100))
    base_name = Column(String(100))
    public_key = Column(Text)
    status = Column(String(20), default="available", index=True)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    planting_records = relationship("PlantingRecord", back_populates="plot")
    environmental_data = relationship("EnvironmentalData", back_populates="plot")
    farming_activities = relationship("FarmingActivity", back_populates="plot")


class PlantingRecord(Base):
    __tablename__ = "planting_records"

    id = Column(Integer, primary_key=True, index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), nullable=False, index=True)
    batch_id = Column(Integer, ForeignKey("seed_batches.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), nullable=False, index=True)
    planting_date = Column(DateTime, default=now_cn_default, index=True)
    expected_harvest_date = Column(DateTime)
    planting_density = Column(Float)
    quantity_planted = Column(Float)
    farmer = Column(String(50))
    status = Column(String(20), default="growing", index=True)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    plot = relationship("Plot", back_populates="planting_records")
    seed_batch = relationship("SeedBatch", back_populates="planting_records")


class EnvironmentalData(Base):
    __tablename__ = "environmental_data"

    id = Column(Integer, primary_key=True, index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), index=True)
    record_time = Column(DateTime, default=now_cn_default, index=True)

    __table_args__ = (
        PrimaryKeyConstraint('id'),
        Index('idx_env_plot_batch', 'plot_id', 'seed_batch_code'),
    )
    temperature = Column(Float)
    humidity = Column(Float)
    soil_moisture = Column(Float)
    soil_temperature = Column(Float)  # 土壤温度（soil_multi 专用，避免和空气温度 temperature 列冲突）
    ph_value = Column(Float)
    illumination = Column(Float)
    wind_speed = Column(Float)
    conductivity = Column(Float)       # 电导率 us/cm
    nitrogen = Column(Float)           # 氮 mg/kg
    phosphorus = Column(Float)         # 磷 mg/kg
    potassium = Column(Float)          # 钾 mg/kg
    salinity = Column(Float)           # 盐分 mg/kg
    data_source = Column(String(50))
    blockchain_hash = Column(String(64), index=True)
    created_at = Column(DateTime, default=now_cn_default)

    plot = relationship("Plot", back_populates="environmental_data")


class FarmingActivity(Base):
    __tablename__ = "farming_activities"

    id = Column(Integer, primary_key=True, index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), index=True)
    activity_type = Column(String(50), nullable=False, index=True)
    activity_date = Column(DateTime, default=now_cn_default, index=True)
    
    __table_args__ = (
        Index('idx_activity_plot_batch', 'plot_id', 'seed_batch_code'),
    )
    description = Column(Text)
    worker_id = Column(Integer, ForeignKey("farm_workers.id"), index=True)
    equipment_id = Column(Integer, ForeignKey("farm_equipment.id"), index=True)
    photos = Column(String(500))
    notes = Column(Text)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    plot = relationship("Plot", back_populates="farming_activities")
    worker = relationship("FarmWorker")
    equipment = relationship("FarmEquipment")


class FarmWorker(Base):
    __tablename__ = "farm_workers"

    id = Column(Integer, primary_key=True, index=True)
    worker_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    phone = Column(String(20))
    role = Column(String(50))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)


class FarmEquipment(Base):
    __tablename__ = "farm_equipment"

    id = Column(Integer, primary_key=True, index=True)
    equipment_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    type = Column(String(50))
    model = Column(String(100))
    status = Column(String(20), default="available", index=True)
    operator = Column(String(50))
    maintenance_date = Column(DateTime)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)


class HarvestRecord(Base):
    __tablename__ = "harvest_records"

    id = Column(Integer, primary_key=True, index=True)
    harvest_code = Column(String(50), unique=True, index=True, nullable=False)
    seed_batch_code = Column(String(50), nullable=False, index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), nullable=False, index=True)
    harvest_date = Column(DateTime, default=now_cn_default, index=True)
    harvest_quantity = Column(Float)
    sorting_result = Column(String(200))
    quality_level = Column(String(20))
    inspector = Column(String(50))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    plot = relationship("Plot")
