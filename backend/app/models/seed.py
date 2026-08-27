from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class SeedSupplier(Base):
    __tablename__ = "seed_suppliers"

    id = Column(Integer, primary_key=True, index=True)
    supplier_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    contact_name = Column(String(50))
    phone = Column(String(20))
    address = Column(String(200))
    credit_rating = Column(String(20))
    public_key = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    batches = relationship("SeedBatch", back_populates="supplier")


class SeedBatch(Base):
    __tablename__ = "seed_batches"

    id = Column(Integer, primary_key=True, index=True)
    batch_code = Column(String(50), unique=True, index=True, nullable=False)
    supplier_id = Column(Integer, ForeignKey("seed_suppliers.id"), nullable=False, index=True)
    variety_name = Column(String(100), nullable=False, index=True)
    breeding_base = Column(String(200))
    production_date = Column(DateTime)
    net_weight = Column(Float)
    total_quantity = Column(Float)
    used_quantity = Column(Float, default=0)
    germination_rate = Column(Float)
    purity = Column(Float)
    moisture_content = Column(Float)
    disease_pest_test = Column(String(200))
    third_party_certificate = Column(String(255))
    storage_location = Column(String(100))
    keeper = Column(String(50))
    purchase_contract_no = Column(String(50))
    status = Column(String(20), default="stocked", index=True)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    @property
    def remaining_quantity(self):
        return (self.total_quantity or 0) - (self.used_quantity or 0)

    supplier = relationship("SeedSupplier", back_populates="batches")
    quality_tests = relationship("SeedQualityTest", back_populates="batch")
    planting_records = relationship("PlantingRecord", back_populates="seed_batch")


class SeedQualityTest(Base):
    __tablename__ = "seed_quality_tests"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("seed_batches.id"), nullable=False, index=True)
    test_date = Column(DateTime, default=now_cn_default, index=True)
    test_item = Column(String(100), nullable=False, index=True)
    test_value = Column(Float)
    standard_value = Column(Float)
    is_qualified = Column(Boolean)
    test_method = Column(String(100))
    inspector = Column(String(50))
    third_party_certificate = Column(String(255))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    created_at = Column(DateTime, default=now_cn_default)

    batch = relationship("SeedBatch", back_populates="quality_tests")
