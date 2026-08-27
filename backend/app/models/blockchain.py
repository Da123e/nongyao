from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.core.timezone import now_cn_default


class BlockchainRecord(Base):
    __tablename__ = "blockchain_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), index=True)
    seed_batch_id = Column(String(100), index=True)
    # seed_batch_code：语义化批次编码（PB2026-001），溯源直接反查
    seed_batch_code = Column(String(100), index=True, nullable=True)
    data_type = Column(String(50), nullable=False, index=True)
    data_hash = Column(String(64), nullable=False, index=True)
    ipfs_hash = Column(String(100))
    blockchain_hash = Column(String(100))
    transaction_hash = Column(String(100))
    block_number = Column(Integer)
    is_on_chain = Column(Boolean, default=False)
    uploader_type = Column(String(50))
    uploaded_by = Column(Integer)
    uploaded_at = Column(DateTime, default=now_cn_default)
    signature = Column(Text)
    created_at = Column(DateTime, default=now_cn_default)

    # ------------------------------------------------------------------
    # 兼容兜底：老的 15 处 BlockchainRecord(...) 调用只写 seed_batch_id（或 batch_id）
    # 新建时若没传 seed_batch_code，自动按优先级推导，避免调用点全量改
    # ------------------------------------------------------------------
    def __init__(self, **kwargs):
        # 调用超类默认初始化
        super().__init__(**kwargs)
        # 初始化后如果 seed_batch_code 没值，自动回填（语义化优先 seed_batch_id）
        if not self.seed_batch_code:
            self.seed_batch_code = (
                self.seed_batch_id if isinstance(self.seed_batch_id, str) else None
            ) or (self.batch_id if isinstance(self.batch_id, str) else None)


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
    uploaded_at = Column(DateTime, default=now_cn_default)
    created_at = Column(DateTime, default=now_cn_default)
