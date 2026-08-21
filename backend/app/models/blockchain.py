from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class BlockchainRecord(Base):
    __tablename__ = "blockchain_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), index=True)
    seed_batch_id = Column(String(100), index=True)
    data_type = Column(String(50), nullable=False, index=True)
    data_hash = Column(String(64), nullable=False, index=True)
    ipfs_hash = Column(String(100))
    blockchain_hash = Column(String(100))
    transaction_hash = Column(String(100))
    block_number = Column(Integer)
    is_on_chain = Column(Boolean, default=False)
    uploader_type = Column(String(50))
    uploaded_by = Column(Integer)
    uploaded_at = Column(DateTime, default=datetime.now)
    signature = Column(Text)
    created_at = Column(DateTime, default=datetime.now)


class IPFSFile(Base):
    __tablename__ = "ipfs_files"

    id = Column(Integer, primary_key=True, index=True)
    ipfs_hash = Column(String(100), unique=True, index=True, nullable=False)
    file_hash = Column(String(64), nullable=False)
    file_name = Column(String(255), index=True)
    content_type = Column(String(100))
    file_size = Column(Integer)
    related_id = Column(Integer)
    related_type = Column(String(50))
    batch_id = Column(String(100), index=True)
    seed_batch_code = Column(String(100), index=True)
    harvest_code = Column(String(100), index=True)
    processing_batch_code = Column(String(100), index=True)
    plot_code = Column(String(100), index=True)
    person_type = Column(String(50), index=True)
    person_name = Column(String(100))
    uploaded_by = Column(Integer)
    uploaded_at = Column(DateTime, default=datetime.now)
    created_at = Column(DateTime, default=datetime.now)
