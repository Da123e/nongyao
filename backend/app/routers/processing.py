from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from datetime import datetime
from app.core.timezone import now_cn_naive
import hashlib
import logging
from app.core.database import get_db
from app.core.blockchain import add_record_to_blockchain, calculate_hash
from app.core.qrcode_generator import generate_trace_qrcode
from app.models.processing import ProcessingBatch, ProcessingRecord
from app.models.seed import SeedBatch
from app.models.blockchain import BlockchainRecord
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.schemas import ProcessingBatchCreate, ProcessingBatchStatusUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


def generate_hash(data):
    return hashlib.sha256(str(data).encode()).hexdigest()


def _serialize_batch(b: ProcessingBatch) -> dict:
    return {
        "id": b.id,
        "batch_code": b.batch_code,
        "seed_batch_id": b.seed_batch_id,
        "seed_batch_code": b.seed_batch_code,
        "raw_material_batch": b.raw_material_batch,
        "raw_material_quantity": b.raw_material_quantity,
        "raw_material_unit": b.raw_material_unit,
        "processing_date": b.processing_date.isoformat() if b.processing_date else None,
        "product_name": b.product_name,
        "product_grade": b.product_grade,
        "output_quantity": b.output_quantity,
        "output_unit": b.output_unit,
        "status": b.status,
        "traceability_qr_code": b.traceability_qr_code,
        "blockchain_hash": b.blockchain_hash,
        "is_on_chain": b.is_on_chain,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


def _serialize_record(r: ProcessingRecord) -> dict:
    return {
        "id": r.id,
        "batch_id": r.batch_id,
        "seed_batch_code": r.seed_batch_code,
        "process_name": r.process_name,
        "process_order": r.process_order,
        "start_time": r.start_time.isoformat() if r.start_time else None,
        "end_time": r.end_time.isoformat() if r.end_time else None,
        "parameters": r.parameters,
        "additives_used": r.additives_used,
        "operator": r.operator,
        "equipment_used": r.equipment_used,
        "quality_check_result": r.quality_check_result,
        "notes": r.notes,
        "blockchain_hash": r.blockchain_hash,
        "is_on_chain": r.is_on_chain,
    }


@router.post("/batches")
async def create_processing_batch(
    data: ProcessingBatchCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:manage", current_user, db)

    if db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == data.batch_code).first():
        raise HTTPException(status_code=400, detail="加工批次编码已存在")

    seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == data.seed_batch_code).first()
    if not seed_batch:
        raise HTTPException(status_code=404, detail="种子批次不存在")

    remaining = (seed_batch.total_quantity or 0) - (seed_batch.used_quantity or 0)
    if seed_batch.total_quantity and remaining <= 0:
        raise HTTPException(status_code=400, detail=f"种子批次 {seed_batch.batch_code} 已无可用库存")

    raw_quantity = data.raw_material_quantity
    if raw_quantity is None and seed_batch.net_weight:
        raw_quantity = seed_batch.net_weight
    elif raw_quantity is None and remaining > 0:
        raw_quantity = remaining

    if raw_quantity and seed_batch.total_quantity:
        if raw_quantity > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"种子批次用量 ({raw_quantity}) 超过剩余库存 ({remaining})"
            )

    try:
        forwarded_scheme = request.headers.get("X-Forwarded-Proto") or request.url.scheme
        forwarded_host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
        qr_result = generate_trace_qrcode(
            data.batch_code,
            seed_batch.batch_code,
            request_host=forwarded_host,
            request_scheme=forwarded_scheme,
            mode='public',
        )
        qr_data_uri = qr_result.get('qrcode')
    except Exception as e:
        logger.warning("生成加工批次溯源二维码失败: %s", e)
        qr_data_uri = None

    batch = ProcessingBatch(
        batch_code=data.batch_code,
        seed_batch_id=seed_batch.id,
        seed_batch_code=seed_batch.batch_code,
        raw_material_batch=data.raw_material_batch,
        raw_material_quantity=raw_quantity,
        raw_material_unit=data.raw_material_unit or "kg",
        processing_date=data.processing_date or now_cn_naive(),
        product_name=data.product_name or f"{seed_batch.variety_name}加工成品",
        product_grade=data.product_grade,
        output_quantity=data.output_quantity if data.output_quantity is not None else (raw_quantity * 0.85 if raw_quantity else None),
        output_unit=data.output_unit or "kg",
        status=data.status or "processing",
        traceability_qr_code=qr_data_uri,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    if raw_quantity and seed_batch.total_quantity:
        seed_batch.used_quantity = (seed_batch.used_quantity or 0) + raw_quantity
        remaining_after = (seed_batch.total_quantity or 0) - (seed_batch.used_quantity or 0)
        if remaining_after <= 0:
            seed_batch.status = "depleted"
        db.commit()
    
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
            uploaded_at=now_cn_naive()
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

    return {"status": "success", "data": _serialize_batch(batch), "blockchain": blockchain_result}


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
        "data": [_serialize_batch(b) for b in batches],
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
            "batch": _serialize_batch(batch),
            "processing_records": [_serialize_record(r) for r in records],
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
        blockchain_hash=generate_hash(f"{batch_code}{process_name}{now_cn_naive()}"),
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
    return {"status": "success", "count": len(records), "data": [_serialize_record(r) for r in records]}


@router.patch("/batches/{batch_code}/status")
async def update_processing_batch_status(
    batch_code: str,
    data: ProcessingBatchStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("processing:manage", current_user, db)

    batch = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="加工批次不存在")

    new_status = data.status
    if not new_status:
        raise HTTPException(status_code=400, detail="状态字段为必填项")

    valid_statuses = ["processing", "completed", "cancelled"]
    if new_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"无效状态，可选值: {', '.join(valid_statuses)}")

    batch.status = new_status

    if new_status == "completed":
        from app.models.inventory import InventoryItem, Warehouse
        warehouse_id = data.warehouse_id
        if not warehouse_id:
            default_warehouse = db.query(Warehouse).filter(Warehouse.is_active == True).first()
            if default_warehouse:
                warehouse_id = default_warehouse.id
            else:
                raise HTTPException(status_code=400, detail="未找到可用仓库，请指定 warehouse_id")

        warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()

        if batch.output_quantity is None and batch.raw_material_quantity:
            batch.output_quantity = batch.raw_material_quantity * 0.85
            batch.output_unit = batch.output_unit or "kg"

        existing_item = db.query(InventoryItem).filter(
            InventoryItem.batch_code == batch.batch_code
        ).first()

        if not existing_item:
            max_id_item = db.query(InventoryItem).order_by(InventoryItem.id.desc()).first()
            next_id = (max_id_item.id + 1) if max_id_item else 1
            item_code = f"INV-PRO-{next_id:04d}"

            qr_data_uri = None
            try:
                from app.core.qrcode_generator import generate_trace_qrcode
                qr_result = generate_trace_qrcode(
                    item_code,
                    batch.seed_batch_code,
                    request_host=request.headers.get("X-Forwarded-Host") or request.headers.get("Host") or "localhost",
                    request_scheme=request.headers.get("X-Forwarded-Proto") or request.url.scheme,
                    mode='public',
                )
                qr_data_uri = qr_result.get('qrcode')
            except Exception as e:
                logger.warning("QR code generation for inventory item failed: %s", e)

            output_qty = batch.output_quantity or 0
            inventory_item = InventoryItem(
                warehouse_id=warehouse_id,
                warehouse_name=warehouse.name if warehouse else None,
                warehouse_location=warehouse.location if warehouse else None,
                item_code=item_code,
                item_name=batch.product_name or f"加工成品-{batch.batch_code}",
                item_type="成品",
                batch_code=batch.batch_code,
                seed_batch_code=batch.seed_batch_code,
                processing_batch_id=batch.id,
                quantity=output_qty,
                unit="kg",
                unit_price=data.unit_price or 0,
                total_value=output_qty * (data.unit_price or 0),
                min_stock=data.min_stock or 0,
                max_stock=data.max_stock or (output_qty) * 3,
                traceability_qr_code=qr_data_uri,
                status="in_stock",
            )
            db.add(inventory_item)

    db.commit()
    db.refresh(batch)

    if new_status == "completed":
        try:
            from app.utils.notifications_helper import notify_processing_batch_completed
            notify_processing_batch_completed(
                db,
                batch_code=batch.batch_code,
                product_name=batch.product_name,
                output_quantity=batch.output_quantity,
                operator=current_user.real_name or current_user.username,
            )
            db.commit()
        except Exception as e:
            logger.warning("notify_processing_batch_completed failed: %s", e)

    return {
        "status": "success",
        "data": {
            "id": batch.id,
            "batch_code": batch.batch_code,
            "seed_batch_code": batch.seed_batch_code,
            "product_name": batch.product_name,
            "product_grade": batch.product_grade,
            "output_quantity": batch.output_quantity,
            "status": batch.status,
            "processing_date": batch.processing_date.isoformat() if batch.processing_date else None,
        }
    }
