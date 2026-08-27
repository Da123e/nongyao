from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.core.timezone import now_cn_naive
import hashlib
import logging
from app.core.database import get_db
from app.core.blockchain import add_record_to_blockchain, calculate_hash
from app.models.pesticide import Pesticide, PesticidePurchase, PesticideApplication
from app.models.planting import Plot, PlantingRecord
from app.models.seed import SeedBatch
from app.models.blockchain import BlockchainRecord
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.schemas import PesticideApplicationCreate

router = APIRouter()


def generate_hash(data):
    return hashlib.sha256(str(data).encode()).hexdigest()


@router.post("/pesticides")
async def create_pesticide(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("pesticide:manage", current_user, db)
    
    pesticide_code = data.get("pesticide_code")
    name = data.get("name")
    if not pesticide_code or not name:
        raise HTTPException(status_code=400, detail="农药编码和名称为必填项")
    
    if db.query(Pesticide).filter(Pesticide.pesticide_code == pesticide_code).first():
        raise HTTPException(status_code=400, detail="农药编码已存在")
    
    pesticide = Pesticide(
        pesticide_code=pesticide_code,
        name=name,
        brand=data.get("brand"),
        registration_no=data.get("registration_no"),
        active_ingredient=data.get("active_ingredient"),
        dosage_form=data.get("dosage_form"),
        concentration=data.get("concentration"),
        toxicity_level=data.get("toxicity_level"),
        safety_interval=data.get("safety_interval"),
        usage_instructions=data.get("usage_instructions"),
        storage_requirements=data.get("storage_requirements"),
    )
    db.add(pesticide)
    db.commit()
    db.refresh(pesticide)
    return {"status": "success", "data": pesticide}


@router.get("/pesticides")
async def get_pesticides(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    name: str = None,
    brand: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("pesticide:query", current_user, db)

    query = db.query(Pesticide)
    if name:
        query = query.filter(Pesticide.name.contains(name))
    if brand:
        query = query.filter(Pesticide.brand.contains(brand))
    
    total = query.count()
    pesticides = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": pesticides,
    }


@router.post("/purchases")
async def create_purchase(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("pesticide:record", current_user, db)
    
    pesticide_code = data.get("pesticide_code")
    supplier_name = data.get("supplier_name")
    quantity = data.get("quantity")
    unit = data.get("unit")
    if not pesticide_code or not supplier_name or quantity is None or not unit:
        raise HTTPException(status_code=400, detail="农药编码、供应商名称、数量和单位为必填项")
    
    pesticide = db.query(Pesticide).filter(Pesticide.pesticide_code == pesticide_code).first()
    if not pesticide:
        raise HTTPException(status_code=404, detail="农药不存在")
    
    unit_price = data.get("unit_price")
    total_amount = data.get("total_amount")
    if not total_amount and unit_price:
        total_amount = quantity * unit_price
    
    purchase = PesticidePurchase(
        pesticide_id=pesticide.id,
        supplier_name=supplier_name,
        quantity=quantity,
        unit=unit,
        unit_price=unit_price,
        total_amount=total_amount,
        contract_no=data.get("contract_no"),
        invoice_no=data.get("invoice_no"),
        storage_location=data.get("storage_location"),
        receiver=data.get("receiver"),
        blockchain_hash=generate_hash(f"{pesticide_code}{quantity}{now_cn_naive()}"),
    )
    db.add(purchase)
    db.commit()
    db.refresh(purchase)
    return {"status": "success", "data": purchase}


@router.get("/purchases")
async def get_purchases(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    pesticide_code: str = None,
    supplier_name: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("pesticide:query", current_user, db)
    
    query = db.query(PesticidePurchase)
    if pesticide_code:
        pesticide = db.query(Pesticide).filter(Pesticide.pesticide_code == pesticide_code).first()
        if pesticide:
            query = query.filter(PesticidePurchase.pesticide_id == pesticide.id)
    if supplier_name:
        query = query.filter(PesticidePurchase.supplier_name.contains(supplier_name))
    
    total = query.count()
    purchases = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": purchases,
    }


@router.post("/applications")
async def create_application(
    data: PesticideApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("pesticide:record", current_user, db)

    plot = db.query(Plot).filter(Plot.plot_code == data.plot_code).first()
    if not plot:
        raise HTTPException(status_code=404, detail="地块不存在")

    pesticide = db.query(Pesticide).filter(Pesticide.pesticide_code == data.pesticide_code).first()
    if not pesticide:
        raise HTTPException(status_code=404, detail="农药不存在")

    seed_batch_code = data.seed_batch_code
    if not seed_batch_code:
        planting_record = db.query(PlantingRecord).filter(PlantingRecord.plot_id == plot.id).first()
        if planting_record:
            seed_batch_code = planting_record.seed_batch_code

    safety_interval_end = None
    if pesticide.safety_interval:
        safety_interval_end = now_cn_naive() + timedelta(days=pesticide.safety_interval)

    application = PesticideApplication(
        plot_id=plot.id,
        pesticide_id=pesticide.id,
        dosage=data.dosage,
        unit=data.unit,
        dilution_ratio=data.dilution_ratio,
        target_pest=data.target_pest,
        applicator=data.operator,
        weather_condition=data.weather_condition,
        safety_interval_end=safety_interval_end,
        is_compliant=True,
        seed_batch_code=seed_batch_code,
    )
    db.add(application)
    db.commit()
    db.refresh(application)

    # 推送农药施用通知给管理员
    try:
        from app.utils.notifications_helper import notify_pesticide_applied
        notify_pesticide_applied(
            db,
            plot_code=plot.plot_code,
            pesticide_name=pesticide.name,
            applicator=data.operator,
            safety_interval_end=safety_interval_end,
        )
        db.commit()
    except Exception as e:
        logging.getLogger(__name__).warning(f"notify_pesticide_applied failed: {e}")

    if seed_batch_code:
        application_data = {
            "id": application.id,
            "plot_id": application.plot_id,
            "plot_code": plot.plot_code,
            "pesticide_id": application.pesticide_id,
            "pesticide_code": pesticide.pesticide_code,
            "pesticide_name": pesticide.name,
            "seed_batch_code": seed_batch_code,
            "application_date": application.application_date.isoformat() if application.application_date else None,
            "dosage": application.dosage,
            "unit": application.unit,
            "target_pest": application.target_pest,
            "applicator": application.applicator,
            "weather_condition": application.weather_condition,
            "safety_interval_end": application.safety_interval_end.isoformat() if application.safety_interval_end else None,
            "created_at": application.created_at.isoformat() if application.created_at else None,
        }
        data_hash = calculate_hash(application_data)
        
        blockchain_result = add_record_to_blockchain(
            record_type="pesticide_application",
            batch_id=seed_batch_code,
            seed_batch_id=seed_batch_code,
            data_hash=data_hash,
            uploader_type=current_user.organization_type or "user",
        )
        
        if blockchain_result.get("success", False):
            application.is_on_chain = True
            application.blockchain_hash = blockchain_result.get("block_hash")
            db.commit()
            
            blockchain_record = BlockchainRecord(
                batch_id=seed_batch_code,
                seed_batch_id=seed_batch_code,
                data_type="pesticide_application",
                data_hash=data_hash,
                blockchain_hash=blockchain_result.get("block_hash"),
                transaction_hash=blockchain_result.get("transaction_hash"),
                block_number=blockchain_result.get("block_number"),
                is_on_chain=True,
                uploaded_by=current_user.id,
                uploader_type=current_user.organization_type or "user",
                uploaded_at=now_cn_naive()
            )
            db.add(blockchain_record)
            db.commit()
    else:
        blockchain_result = {"success": False, "error": "未找到关联的种子批次"}
    
    return {"status": "success", "data": application, "blockchain": blockchain_result}


@router.get("/applications")
async def get_applications(
    plot_code: str = None,
    pesticide_code: str = None,
    application_date_start: datetime = None,
    application_date_end: datetime = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("pesticide:query", current_user, db)

    query = db.query(PesticideApplication)
    if plot_code:
        plot = db.query(Plot).filter(Plot.plot_code == plot_code).first()
        if plot:
            query = query.filter(PesticideApplication.plot_id == plot.id)
    if pesticide_code:
        pesticide = db.query(Pesticide).filter(Pesticide.pesticide_code == pesticide_code).first()
        if pesticide:
            query = query.filter(PesticideApplication.pesticide_id == pesticide.id)
    if application_date_start:
        query = query.filter(PesticideApplication.application_date >= application_date_start)
    if application_date_end:
        query = query.filter(PesticideApplication.application_date <= application_date_end)
    
    applications = query.order_by(PesticideApplication.application_date.desc()).all()
    return {"status": "success", "count": len(applications), "data": applications}
