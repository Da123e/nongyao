from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class Pesticide(Base):
    __tablename__ = "pesticides"

    id = Column(Integer, primary_key=True, index=True)
    pesticide_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    brand = Column(String(100))
    registration_no = Column(String(50), index=True)
    active_ingredient = Column(String(100))
    dosage_form = Column(String(50))
    concentration = Column(String(50))
    toxicity_level = Column(String(20))
    safety_interval = Column(Integer)
    usage_instructions = Column(Text)
    storage_requirements = Column(String(200))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_cn_default)
    updated_at = Column(DateTime, default=now_cn_default, onupdate=now_cn_default)

    purchases = relationship("PesticidePurchase", back_populates="pesticide")
    applications = relationship("PesticideApplication", back_populates="pesticide")


class PesticidePurchase(Base):
    __tablename__ = "pesticide_purchases"

    id = Column(Integer, primary_key=True, index=True)
    pesticide_id = Column(Integer, ForeignKey("pesticides.id"), nullable=False, index=True)
    supplier_name = Column(String(100), index=True)
    purchase_date = Column(DateTime, default=now_cn_default, index=True)
    quantity = Column(Float)
    unit = Column(String(20))
    unit_price = Column(Float)
    total_amount = Column(Float)
    contract_no = Column(String(50))
    invoice_no = Column(String(50))
    storage_location = Column(String(100))
    receiver = Column(String(50))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    pesticide = relationship("Pesticide", back_populates="purchases")


class PesticideApplication(Base):
    __tablename__ = "pesticide_applications"

    id = Column(Integer, primary_key=True, index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), nullable=False, index=True)
    pesticide_id = Column(Integer, ForeignKey("pesticides.id"), nullable=False, index=True)
    seed_batch_code = Column(String(50), index=True)
    application_date = Column(DateTime, default=now_cn_default, index=True)
    dosage = Column(Float)
    unit = Column(String(20))
    dilution_ratio = Column(String(50))
    target_pest = Column(String(100))
    applicator = Column(String(50))
    weather_condition = Column(String(100))
    safety_interval_end = Column(DateTime)
    is_compliant = Column(Boolean)
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    pesticide = relationship("Pesticide", back_populates="applications")


class FieldResidueTest(Base):
    __tablename__ = "field_residue_tests"

    id = Column(Integer, primary_key=True, index=True)
    seed_batch_code = Column(String(50), nullable=False, index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), nullable=False, index=True)
    test_date = Column(DateTime, default=now_cn_default, index=True)
    test_item = Column(String(100), nullable=False, index=True)
    limit_value = Column(Float)
    measured_value = Column(Float)
    unit = Column(String(20))
    is_over_limit = Column(Boolean)
    is_qualified = Column(Boolean)
    inspector = Column(String(50))
    test_method = Column(String(100))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)

    plot = relationship("Plot")
