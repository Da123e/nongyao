from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    customer_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    contact_name = Column(String(50))
    phone = Column(String(20))
    email = Column(String(100))
    address = Column(String(200))
    customer_type = Column(String(20), index=True)
    credit_limit = Column(Float)
    credit_balance = Column(Float)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    orders = relationship("Order", back_populates="customer")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    order_date = Column(DateTime, default=datetime.now, index=True)
    delivery_date = Column(DateTime)
    status = Column(String(20), default="pending", index=True)
    total_amount = Column(Float)
    payment_status = Column(String(20), default="unpaid")
    payment_method = Column(String(20))
    shipping_address = Column(String(200))
    shipping_method = Column(String(20))
    store_name = Column(String(100))
    remarks = Column(Text)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    customer = relationship("Customer", back_populates="orders")
    items = relationship("OrderItem", back_populates="order")
    logistics = relationship("LogisticsTracking", back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    item_code = Column(String(50), index=True)
    item_name = Column(String(100), nullable=False)
    batch_code = Column(String(50), index=True)
    seed_batch_code = Column(String(50), index=True)
    processing_batch_id = Column(Integer, ForeignKey("processing_batches.id"), index=True)
    quantity = Column(Float, nullable=False)
    unit = Column(String(20), nullable=False)
    unit_price = Column(Float)
    amount = Column(Float)
    product_grade = Column(String(20))
    traceability_qr_code = Column(String(255))
    created_at = Column(DateTime, default=datetime.now)

    order = relationship("Order", back_populates="items")


class LogisticsTracking(Base):
    __tablename__ = "logistics_trackings"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    tracking_no = Column(String(50), index=True)
    carrier = Column(String(100))
    vehicle_no = Column(String(20))
    driver_name = Column(String(50))
    driver_phone = Column(String(20))
    status = Column(String(20), default="pending", index=True)
    origin = Column(String(200))
    destination = Column(String(200))
    departure_time = Column(DateTime)
    estimated_arrival_time = Column(DateTime)
    current_location = Column(String(200))
    temperature_records = Column(Text)
    gps_records = Column(Text)
    transit_records = Column(Text)
    signer = Column(String(50))
    sign_time = Column(DateTime)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    order = relationship("Order", back_populates="logistics")


class SalesRecord(Base):
    __tablename__ = "sales_records"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), nullable=False, index=True)
    processing_batch_code = Column(String(50), index=True)
    store_name = Column(String(100), index=True)
    sale_date = Column(DateTime, default=datetime.now, index=True)
    sale_quantity = Column(Float)
    sale_unit = Column(String(20))
    sale_amount = Column(Float)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)

    order = relationship("Order")
