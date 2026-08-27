from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    warehouse_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    location = Column(String(200), index=True)
    type = Column(String(20))
    capacity = Column(Float)
    temperature_range = Column(String(50))
    humidity_range = Column(String(50))
    manager = Column(String(50))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    inventory_items = relationship("InventoryItem", back_populates="warehouse")


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False, index=True)
    item_code = Column(String(50), nullable=False, index=True)
    item_name = Column(String(100), nullable=False, index=True)
    item_type = Column(String(20))
    batch_code = Column(String(50), index=True)
    seed_batch_code = Column(String(50), index=True)
    processing_batch_id = Column(Integer, ForeignKey("processing_batches.id"), index=True)
    quantity = Column(Float, default=0)
    unit = Column(String(20))
    unit_price = Column(Float)
    total_value = Column(Float)
    min_stock = Column(Float)
    max_stock = Column(Float)
    expiry_date = Column(DateTime)
    storage_location = Column(String(100))
    traceability_qr_code = Column(Text)
    status = Column(String(20), default="in_stock", index=True)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    warehouse = relationship("Warehouse", back_populates="inventory_items")


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    transaction_type = Column(String(20), nullable=False, index=True)
    quantity = Column(Float)
    unit = Column(String(20))
    unit_price = Column(Float)
    total_amount = Column(Float)
    transaction_date = Column(DateTime, default=now_cn_default, index=True)
    operator = Column(String(50))
    source_document = Column(String(50))
    source_document_no = Column(String(50))
    remarks = Column(Text)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)


class StorageRecord(Base):
    __tablename__ = "storage_records"

    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False, index=True)
    batch_code = Column(String(50), index=True)
    seed_batch_code = Column(String(50), index=True)
    processing_batch_code = Column(String(50), index=True)
    item_code = Column(String(50))
    item_name = Column(String(100))
    storage_location = Column(String(100))
    quantity = Column(Float)
    unit = Column(String(20))
    temperature = Column(Float)
    humidity = Column(Float)
    record_time = Column(DateTime, default=now_cn_default, index=True)
    operator = Column(String(50))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    warehouse = relationship("Warehouse")
