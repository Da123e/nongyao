from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class ProcessingBatch(Base):
    __tablename__ = "processing_batches"

    id = Column(Integer, primary_key=True, index=True)
    batch_code = Column(String(50), unique=True, index=True, nullable=False)
    seed_batch_id = Column(Integer, ForeignKey("seed_batches.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), nullable=False, index=True)
    harvest_code = Column(String(50), index=True)
    raw_material_batch = Column(String(50))
    raw_material_quantity = Column(Float)
    raw_material_unit = Column(String(20))
    raw_material_appearance = Column(String(200))
    mold_screening_result = Column(String(100))
    processing_date = Column(DateTime, default=now_cn_default, index=True)
    expected_finish_date = Column(DateTime)
    product_name = Column(String(100), index=True)
    product_grade = Column(String(20))
    output_quantity = Column(Float)
    output_unit = Column(String(20))
    traceability_qr_code = Column(Text)
    status = Column(String(20), default="processing", index=True)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    seed_batch = relationship("SeedBatch")
    processing_records = relationship("ProcessingRecord", back_populates="batch")


class ProcessingRecord(Base):
    __tablename__ = "processing_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("processing_batches.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), index=True)
    process_name = Column(String(100), nullable=False, index=True)
    process_order = Column(Integer, index=True)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    parameters = Column(Text)
    additives_used = Column(String(200))
    operator = Column(String(50))
    equipment_used = Column(String(100))
    quality_check_result = Column(String(100))
    notes = Column(Text)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    batch = relationship("ProcessingBatch", back_populates="processing_records")


class ProductQualityTest(Base):
    __tablename__ = "product_quality_tests"

    id = Column(Integer, primary_key=True, index=True)
    processing_batch_id = Column(Integer, ForeignKey("processing_batches.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), nullable=False, index=True)
    test_date = Column(DateTime, default=now_cn_default, index=True)
    test_type = Column(String(50), index=True)
    test_item = Column(String(100), nullable=False, index=True)
    limit_value = Column(Float)
    measured_value = Column(Float)
    unit = Column(String(20))
    is_qualified = Column(Boolean)
    inspection_agency = Column(String(100))
    certificate_no = Column(String(50))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    batch = relationship("ProcessingBatch")
