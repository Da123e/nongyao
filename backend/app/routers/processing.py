from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
import hashlib
import logging
from app.core.database import get_db
from app.core.blockchain import add_record_to_blockchain, calculate_hash
from app.models.processing import ProcessingBatch, ProcessingRecord
from app.models.seed import SeedBatch
from app.models.blockchain import BlockchainRecord
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.schemas import ProcessingBatchCreate

logger = logging.getLogger(__name__)

router = APIRouter()


def generate_hash(data):
    return hashlib.sha256(str(data).encode()).hexdigest()


@router.post("/batches")
async def create_processing_batch(
    data: ProcessingBatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:manage", current_user, db)

    if db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == data.batch_code).first():
        raise HTTPException(status_code=400, detail="加工批次编码已存在")

    seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == data.seed_batch_code).first()
    if not seed_batch:
        raise HTTPException(status_code=404, detail="种子批次不存在")

    batch = ProcessingBatch(
        batch_code=data.batch_code,
        seed_batch_id=seed_batch.id,
        seed_batch_code=seed_batch.batch_code,
        raw_material_batch=data.raw_material_batch,
        raw_material_quantity=data.raw_material_quantity,
        raw_material_unit=data.raw_material_unit,
        product_name=data.product_name,
        product_grade=data.product_grade,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    
    data_hash = calculate_hash(data.dict())
    
    blockchain_result = add_record_to_blockchain(
        record_type="processing_batch",
        batch_id=data.batch_code,
        seed_batch_id=data.seed_batch_code,
        data_hash=data_hash,
        uploader_type=current_user.organization_type or "user",
    )
    
    if blockchain_result.get("success", False):
        batch.is_on_chain = True
        batch.blockchain_hash = blockchain_result.get("block_hash")
        db.commit()
        
        blockchain_record = BlockchainRecord(
            batch_id=data.batch_code,
            seed_batch_id=data.seed_batch_code,
            data_type="processing_batch",
            data_hash=data_hash,
            blockchain_hash=blockchain_result.get("block_hash"),
            transaction_hash=blockchain_result.get("transaction_hash"),
            block_number=blockchain_result.get("block_number"),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    # 加工批次创建后通知管理员
    try:
        from app.utils.notifications_helper import notify_processing_batch_created
        notify_processing_batch_created(
            db,
            batch_code=batch.batch_code,
            product_name=batch.product_name,
            product_grade=batch.product_grade,
            operator=current_user.real_name or current_user.username,
        )
        db.commit()
    except Exception as e:
        logger.warning("notify_processing_batch_created failed: %s", e)

    return {"status": "success", "data": batch, "blockchain": blockchain_result}


@router.get("/batches")
async def get_processing_batches(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    batch_code: str = None,
    seed_batch_code: str = None,
    product_name: str = None,
    status: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:query", current_user, db)
    
    query = db.query(ProcessingBatch)
    if batch_code:
        query = query.filter(ProcessingBatch.batch_code.contains(batch_code))
    if seed_batch_code:
        seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == seed_batch_code).first()
        if seed_batch:
            query = query.filter(ProcessingBatch.seed_batch_id == seed_batch.id)
    if product_name:
        query = query.filter(ProcessingBatch.product_name.contains(product_name))
    if status:
        query = query.filter(ProcessingBatch.status == status)
    
    total = query.count()
    batches = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": batches,
    }


@router.get("/batches/{batch_code}")
async def get_processing_batch(
    batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:query", current_user, db)
    
    batch = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="加工批次不存在")
    
    records = db.query(ProcessingRecord).filter(ProcessingRecord.batch_id == batch.id).order_by(ProcessingRecord.process_order).all()
    
    return {
        "status": "success",
        "data": {
            "batch": batch,
            "processing_records": records,
        },
    }


@router.post("/records")
async def create_processing_record(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:manage", current_user, db)

    batch_code = data.get("batch_code")
    process_name = data.get("process_name")
    if not batch_code or not process_name:
        raise HTTPException(status_code=400, detail="加工批次编码和工序名称为必填项")

    batch = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="加工批次不存在")

    start_time = data.get("start_time")
    if start_time and isinstance(start_time, str):
        start_time = datetime.fromisoformat(start_time)
    end_time = data.get("end_time")
    if end_time and isinstance(end_time, str):
        end_time = datetime.fromisoformat(end_time)

    record = ProcessingRecord(
        batch_id=batch.id,
        process_name=process_name,
        process_order=data.get("process_order"),
        start_time=start_time,
        end_time=end_time,
        parameters=data.get("parameters"),
        operator=data.get("operator"),
        equipment_used=data.get("equipment_used"),
        quality_check_result=data.get("quality_check_result"),
        notes=data.get("notes"),
        blockchain_hash=generate_hash(f"{batch_code}{process_name}{datetime.now()}"),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"status": "success", "data": record}


@router.get("/records")
async def get_processing_records(
    batch_code: str = None,
    process_name: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:query", current_user, db)
    
    query = db.query(ProcessingRecord)
    if batch_code:
        batch = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == batch_code).first()
        if batch:
            query = query.filter(ProcessingRecord.batch_id == batch.id)
    if process_name:
        query = query.filter(ProcessingRecord.process_name.contains(process_name))
    
    records = query.order_by(ProcessingRecord.process_order).all()
    return {"status": "success", "count": len(records), "data": records}
