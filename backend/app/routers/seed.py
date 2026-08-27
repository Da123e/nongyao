from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime
from app.core.timezone import now_cn_naive
import hashlib
import json
import logging
from app.core.database import get_db
from app.core.blockchain import add_record_to_blockchain, calculate_hash
from app.models.seed import SeedSupplier, SeedBatch, SeedQualityTest
from app.models.blockchain import BlockchainRecord
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.schemas import SeedBatchCreate, SupplierCreate
from typing import Optional

logger = logging.getLogger(__name__)

router = APIRouter()


def generate_hash(data):
    return hashlib.sha256(str(data).encode()).hexdigest()


@router.post("/suppliers")
async def create_supplier(
    data: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:manage", current_user, db)
    
    if db.query(SeedSupplier).filter(SeedSupplier.supplier_code == data.supplier_code).first():
        raise HTTPException(status_code=400, detail="供应商编码已存在")
    
    supplier = SeedSupplier(**data.dict())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return {"status": "success", "data": supplier}


@router.get("/suppliers")
async def get_suppliers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    name: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:query", current_user, db)
    
    query = db.query(SeedSupplier)
    if name:
        query = query.filter(SeedSupplier.name.contains(name))
    
    total = query.count()
    suppliers = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": suppliers,
    }


@router.get("/suppliers/{supplier_code}")
async def get_supplier(
    supplier_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:query", current_user, db)
    
    supplier = db.query(SeedSupplier).filter(SeedSupplier.supplier_code == supplier_code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    return {"status": "success", "data": supplier}


@router.put("/suppliers/{supplier_code}")
async def update_supplier(
    supplier_code: str,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:manage", current_user, db)
    
    supplier = db.query(SeedSupplier).filter(SeedSupplier.supplier_code == supplier_code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    
    if 'name' in data:
        supplier.name = data['name']
    if 'contact_name' in data:
        supplier.contact_name = data['contact_name']
    if 'phone' in data:
        supplier.phone = data['phone']
    if 'address' in data:
        supplier.address = data['address']
    if 'credit_rating' in data:
        supplier.credit_rating = data['credit_rating']
    if 'is_active' in data:
        supplier.is_active = data['is_active']
    
    db.commit()
    db.refresh(supplier)
    return {"status": "success", "data": supplier}


@router.delete("/suppliers/{supplier_code}")
async def delete_supplier(
    supplier_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:manage", current_user, db)
    
    supplier = db.query(SeedSupplier).filter(SeedSupplier.supplier_code == supplier_code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    
    batch_count = db.query(SeedBatch).filter(SeedBatch.supplier_id == supplier.id).count()
    if batch_count > 0:
        raise HTTPException(status_code=400, detail="该供应商下存在种子批次，无法删除")
    
    db.delete(supplier)
    db.commit()
    return {"status": "success", "message": "供应商删除成功"}


@router.post("/batches")
async def create_batch(
    data: SeedBatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:manage", current_user, db)
    
    if db.query(SeedBatch).filter(SeedBatch.batch_code == data.batch_code).first():
        raise HTTPException(status_code=400, detail="批次编码已存在")
    
    supplier = db.query(SeedSupplier).filter(SeedSupplier.supplier_code == data.supplier_code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    
    batch = SeedBatch(
        batch_code=data.batch_code,
        supplier_id=supplier.id,
        variety_name=data.variety_name,
        breeding_base=data.breeding_base,
        production_date=data.production_date,
        net_weight=data.net_weight,
        germination_rate=data.germination_rate,
        purity=data.purity,
        moisture_content=data.moisture_content,
        disease_pest_test=data.disease_pest_test,
        third_party_certificate=data.third_party_certificate,
        storage_location=data.storage_location,
        keeper=data.keeper,
        purchase_contract_no=data.purchase_contract_no,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    blockchain_result = {"success": False, "message": "Blockchain upload skipped"}
    try:
        data_hash = calculate_hash(data.dict())

        blockchain_result = add_record_to_blockchain(
            record_type="seed_registration",
            batch_id=data.batch_code,
            seed_batch_id=data.batch_code,
            data_hash=data_hash,
            uploader_type=current_user.organization_type or "user",
        )

        if blockchain_result.get("success", False):
            batch.is_on_chain = True
            batch.blockchain_hash = blockchain_result.get("block_hash")

            blockchain_record = BlockchainRecord(
                batch_id=data.batch_code,
                seed_batch_id=data.batch_code,
                data_type="seed_registration",
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
    except Exception as e:
        logger.warning("Blockchain upload failed for batch %s: %s", data.batch_code, e, exc_info=True)
        db.rollback()

    return {"status": "success", "data": batch, "blockchain": blockchain_result}


@router.get("/batches")
async def get_batches(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    batch_code: str = None,
    variety_name: str = None,
    status: str = None,
    only_available: bool = Query(False, description="只显示有剩余量的批次"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:query", current_user, db)
    
    query = db.query(SeedBatch)
    if batch_code:
        query = query.filter(SeedBatch.batch_code.contains(batch_code))
    if variety_name:
        query = query.filter(SeedBatch.variety_name.contains(variety_name))
    if status:
        query = query.filter(SeedBatch.status == status)
    if only_available:
        query = query.filter(
            SeedBatch.total_quantity > 0,
            SeedBatch.used_quantity < SeedBatch.total_quantity
        )
    
    total = query.count()
    batches = query.offset((page - 1) * page_size).limit(page_size).all()
    
    result = []
    for b in batches:
        remaining = (b.total_quantity or 0) - (b.used_quantity or 0)
        result.append({
            "id": b.id,
            "batch_code": b.batch_code,
            "supplier_id": b.supplier_id,
            "variety_name": b.variety_name,
            "breeding_base": b.breeding_base,
            "production_date": b.production_date.isoformat() if b.production_date else None,
            "net_weight": b.net_weight,
            "total_quantity": b.total_quantity,
            "used_quantity": b.used_quantity or 0,
            "remaining_quantity": remaining,
            "germination_rate": b.germination_rate,
            "purity": b.purity,
            "moisture_content": b.moisture_content,
            "disease_pest_test": b.disease_pest_test,
            "storage_location": b.storage_location,
            "status": b.status,
            "supplier_name": b.supplier.name if b.supplier else None,
            "is_depleted": remaining <= 0 if b.total_quantity else False,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": result,
    }


@router.get("/batches/{batch_code}")
async def get_batch(
    batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:query", current_user, db)
    
    batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    
    tests = db.query(SeedQualityTest).filter(SeedQualityTest.batch_id == batch.id).all()
    
    return {
        "status": "success",
        "data": {
            "batch": batch,
            "quality_tests": tests,
        },
    }


@router.get("/batches/{batch_code}/full-chain")
async def get_batch_full_chain(
    batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:query", current_user, db)
    
    from app.models.planting import PlantingRecord, Plot, FarmingActivity, EnvironmentalData
    from app.models.pesticide import PesticideApplication, Pesticide
    from app.models.inspection import InspectionReport, PesticideResidueTest
    from app.models.processing import ProcessingBatch, ProcessingRecord
    from app.models.inventory import InventoryItem
    from app.models.sales import OrderItem, Order
    from app.models.blockchain import BlockchainRecord

    batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")

    supplier = db.query(SeedSupplier).filter(SeedSupplier.id == batch.supplier_id).first()
    quality_tests = db.query(SeedQualityTest).filter(SeedQualityTest.batch_id == batch.id).all()

    planting_records = db.query(PlantingRecord).filter(
        or_(
            PlantingRecord.batch_id == batch.id,
            PlantingRecord.seed_batch_code == batch_code,
        )
    ).all()
    plot_ids = [pr.plot_id for pr in planting_records]

    plots = {p.id: p for p in db.query(Plot).filter(Plot.id.in_(plot_ids)).all()} if plot_ids else {}

    # 构造过滤条件：避免把 False / True 塞进 or_，会变成 0/1 字面量，语义错误
    def add_cond(base_cond, *conds):
        for c in conds:
            if c is None or c is False:
                continue
            base_cond.append(c)

    fa_conds = [FarmingActivity.seed_batch_code == batch_code]
    add_cond(fa_conds, FarmingActivity.plot_id.in_(plot_ids) if plot_ids else None)
    farming_activities = db.query(FarmingActivity).filter(or_(*fa_conds)).all()

    pa_conds = [PesticideApplication.seed_batch_code == batch_code]
    add_cond(pa_conds, PesticideApplication.plot_id.in_(plot_ids) if plot_ids else None)
    pesticide_applications = db.query(PesticideApplication).filter(or_(*pa_conds)).all()

    ed_conds = [EnvironmentalData.seed_batch_code == batch_code]
    add_cond(ed_conds, EnvironmentalData.plot_id.in_(plot_ids) if plot_ids else None)
    environmental_data = (
        db.query(EnvironmentalData)
        .filter(or_(*ed_conds))
        .order_by(EnvironmentalData.record_time.desc())
        .limit(10)
        .all()
    )

    pesticides = {p.id: p for p in db.query(Pesticide).filter(Pesticide.id.in_([pa.pesticide_id for pa in pesticide_applications])).all()}

    processing_batches = db.query(ProcessingBatch).filter(
        or_(
            ProcessingBatch.seed_batch_id == batch.id,
            ProcessingBatch.seed_batch_code == batch_code,
        )
    ).all()
    processing_batch_codes = [pb.batch_code for pb in processing_batches]
    processing_batch_ids = [pb.id for pb in processing_batches]

    processing_records = {}
    for pb in processing_batches:
        processing_records[pb.id] = db.query(ProcessingRecord).filter(ProcessingRecord.batch_id == pb.id).order_by(ProcessingRecord.process_order).all()

    ins_conds = [
        InspectionReport.batch_id == batch.id,
        InspectionReport.seed_batch_code == batch_code,
    ]
    add_cond(
        ins_conds,
        InspectionReport.processing_batch_id.in_(processing_batch_ids) if processing_batch_ids else None,
        InspectionReport.plot_id.in_(plot_ids) if plot_ids else None,
    )
    inspection_reports = db.query(InspectionReport).filter(or_(*ins_conds)).all()

    residue_tests = {}
    for report in inspection_reports:
        residue_tests[report.id] = db.query(PesticideResidueTest).filter(PesticideResidueTest.report_id == report.id).all()

    inv_conds = [InventoryItem.seed_batch_code == batch_code]
    add_cond(
        inv_conds,
        InventoryItem.batch_code.in_(processing_batch_codes) if processing_batch_codes else None,
    )
    inventory_items = db.query(InventoryItem).filter(or_(*inv_conds)).all()

    oi_conds = [OrderItem.seed_batch_code == batch_code]
    add_cond(
        oi_conds,
        OrderItem.batch_code.in_(processing_batch_codes) if processing_batch_codes else None,
    )
    order_items = db.query(OrderItem).filter(or_(*oi_conds)).all()

    orders = {o.id: o for o in db.query(Order).filter(Order.id.in_([oi.order_id for oi in order_items])).all()} if order_items else {}

    # seed_batch_id 历史上两种含义：有时候是 batch.id 整型，有时候是 batch_code 字符串；
    # 加上新增的 seed_batch_code 语义字段，三个维度匹配一次，历史表也能查到数据。
    bc_conds = [
        BlockchainRecord.seed_batch_id == str(batch.id),
        BlockchainRecord.seed_batch_id == batch_code,
        BlockchainRecord.batch_id == batch_code,
    ]
    add_cond(bc_conds, BlockchainRecord.seed_batch_code == batch_code)
    blockchain_records = (
        db.query(BlockchainRecord)
        .filter(or_(*bc_conds))
        .order_by(BlockchainRecord.created_at.desc())
        .all()
    )
    
    return {
        "status": "success",
        "data": {
            "seed": {
                "batch": batch,
                "supplier": supplier,
                "quality_tests": quality_tests,
            },
            "planting": {
                "records": planting_records,
                "plots": plots,
                "farming_activities": farming_activities,
                "pesticide_applications": pesticide_applications,
                "pesticides": pesticides,
                "environmental_data": environmental_data,
            },
            "processing": {
                "batches": processing_batches,
                "records": processing_records,
            },
            "inspection": {
                "reports": inspection_reports,
                "residue_tests": residue_tests,
            },
            "inventory": inventory_items,
            "sales": {
                "order_items": order_items,
                "orders": orders,
            },
            "blockchain": {
                "records": blockchain_records,
                "total_records": len(blockchain_records),
                "is_on_chain": batch.is_on_chain,
            },
        },
    }


@router.post("/quality-tests")
async def create_quality_test(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:manage", current_user, db)
    
    batch_code = data.get("batch_code")
    test_item = data.get("test_item")
    test_value = data.get("test_value")
    standard_value = data.get("standard_value")
    is_qualified = data.get("is_qualified")
    
    if not batch_code or not test_item:
        raise HTTPException(status_code=400, detail="批次编码和检测项目为必填项")
    
    batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    
    test = SeedQualityTest(
        batch_id=batch.id,
        test_item=test_item,
        test_value=test_value,
        standard_value=standard_value,
        is_qualified=is_qualified,
        test_method=data.get("test_method"),
        inspector=data.get("inspector"),
        third_party_certificate=data.get("third_party_certificate"),
        blockchain_hash=generate_hash(f"{batch_code}{test_item}{test_value}{now_cn_naive()}"),
    )
    db.add(test)
    db.commit()
    db.refresh(test)
    return {"status": "success", "data": test}


@router.get("/quality-tests")
async def get_quality_tests(
    batch_code: str = None,
    test_date_start: datetime = None,
    test_date_end: datetime = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:query", current_user, db)
    
    query = db.query(SeedQualityTest)
    if batch_code:
        batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
        if batch:
            query = query.filter(SeedQualityTest.batch_id == batch.id)
    if test_date_start:
        query = query.filter(SeedQualityTest.test_date >= test_date_start)
    if test_date_end:
        query = query.filter(SeedQualityTest.test_date <= test_date_end)
    
    tests = query.all()
    return {"status": "success", "count": len(tests), "data": tests}
