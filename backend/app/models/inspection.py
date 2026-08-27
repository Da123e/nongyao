from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class InspectionReport(Base):
    __tablename__ = "inspection_reports"

    id = Column(Integer, primary_key=True, index=True)
    report_code = Column(String(50), unique=True, index=True, nullable=False)
    batch_id = Column(Integer, ForeignKey("seed_batches.id"), index=True)
    seed_batch_code = Column(String(50), index=True)
    harvest_code = Column(String(50), index=True)
    processing_batch_id = Column(Integer, ForeignKey("processing_batches.id"), index=True)
    plot_id = Column(Integer, ForeignKey("plots.id"), index=True)
    report_type = Column(String(20), nullable=False, index=True)
    report_date = Column(DateTime, default=now_cn_default, index=True)
    test_items = Column(Text)
    test_results = Column(Text)
    inspector = Column(String(50))
    inspection_agency = Column(String(100))
    certificate_no = Column(String(50))
    is_qualified = Column(Boolean, index=True)
    remarks = Column(Text)
    file_path = Column(String(255))
    file_hash = Column(String(64))
    blockchain_hash = Column(String(64), index=True)
    ipfs_hash = Column(String(64), index=True)
    is_on_chain = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now_cn_default)


class PesticideResidueTest(Base):
    __tablename__ = "pesticide_residue_tests"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("inspection_reports.id"), nullable=False, index=True)
    test_item = Column(String(100), nullable=False, index=True)
    limit_value = Column(Float)
    measured_value = Column(Float)
    unit = Column(String(20), default="mg/kg")
    is_over_limit = Column(Boolean, default=False, index=True)
    is_qualified = Column(Boolean)
    test_method = Column(String(100))
    created_at = Column(DateTime, default=now_cn_default)
