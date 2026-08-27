from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.core.timezone import now_cn_naive
from typing import Optional
import hashlib
from app.core.database import get_db
from app.core.blockchain import add_record_to_blockchain, calculate_hash
from app.models.planting import Plot, PlantingRecord, EnvironmentalData, FarmingActivity, FarmWorker, FarmEquipment
from app.models.seed import SeedBatch
from app.models.blockchain import BlockchainRecord
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.schemas import EnvironmentalDataCreate, PlotCreate, PlantingRecordCreate, FarmingActivityCreate

router = APIRouter()


def generate_hash(data):
    return hashlib.sha256(str(data).encode()).hexdigest()


@router.post("/plots")
async def create_plot(
    data: PlotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:manage", current_user, db)
    
    if db.query(Plot).filter(Plot.plot_code == data.plot_code).first():
        raise HTTPException(status_code=400, detail="地块编码已存在")
    
    plot = Plot(**data.dict())
    db.add(plot)
    db.commit()
    db.refresh(plot)
    return {"status": "success", "data": plot}


@router.get("/plots")
async def get_plots(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    name: str = None,
    location: str = None,
    status: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:query", current_user, db)
    
    query = db.query(Plot)
    if name:
        query = query.filter(Plot.name.contains(name))
    if location:
        query = query.filter(Plot.location.contains(location))
    if status:
        query = query.filter(Plot.status == status)
    
    total = query.count()
    plots = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": plots,
    }


@router.post("/planting-records")
async def create_planting_record(
    data: PlantingRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:manage", current_user, db)
    
    plot = db.query(Plot).filter(Plot.plot_code == data.plot_code).first()
    if not plot:
        raise HTTPException(status_code=404, detail="地块不存在")
    
    if plot.status == "planted":
        raise HTTPException(status_code=400, detail=f"地块 {plot.plot_code} 已被占用，当前状态为 {plot.status}，无法重复种植")
    
    active_record = db.query(PlantingRecord).filter(
        PlantingRecord.plot_id == plot.id,
        PlantingRecord.status == "growing"
    ).first()
    if active_record:
        raise HTTPException(status_code=400, detail=f"地块 {plot.plot_code} 已有进行中的种植记录({active_record.seed_batch_code})，无法重复种植")
    
    batch = db.query(SeedBatch).filter(SeedBatch.batch_code == data.seed_batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="种子批次不存在")

    # 检查种子批次剩余量是否足够
    planting_qty = float(data.quantity_planted or 0)
    remaining = (batch.total_quantity or 0) - (batch.used_quantity or 0)
    if planting_qty > remaining and batch.total_quantity:
        raise HTTPException(
            status_code=400,
            detail=f"种子批次 {batch.batch_code} 剩余 {remaining}kg，不足以种植 {planting_qty}kg"
        )
    
    record = PlantingRecord(
        plot_id=plot.id,
        batch_id=batch.id,
        seed_batch_code=batch.batch_code,
        planting_date=data.planting_date or now_cn_naive(),
        expected_harvest_date=data.expected_harvest_date,
        planting_density=data.planting_density,
        quantity_planted=data.quantity_planted,
        farmer=data.farmer,
    )
    db.add(record)
    plot.status = "planted"

    # 更新种子批次已用量
    if planting_qty > 0:
        batch.used_quantity = (batch.used_quantity or 0) + planting_qty
        batch.updated_at = now_cn_naive()
        remaining_after = (batch.total_quantity or 0) - (batch.used_quantity or 0)
        if remaining_after <= 0 and batch.total_quantity:
            batch.status = "depleted"
    
    db.commit()
    db.refresh(record)
    
    data_hash = calculate_hash(data.dict())
    
    blockchain_result = add_record_to_blockchain(
        record_type="planting_record",
        batch_id="",
        seed_batch_id=batch.batch_code,
        data_hash=data_hash,
        uploader_type=current_user.organization_type or "user",
    )
    
    if blockchain_result.get("success", False):
        record.is_on_chain = True
        record.blockchain_hash = blockchain_result.get("block_hash")
        db.commit()
        
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=batch.batch_code,
            data_type="planting_record",
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
    
    return {"status": "success", "data": record, "blockchain": blockchain_result}


@router.get("/planting-records")
async def get_planting_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    plot_code: str = None,
    batch_code: str = None,
    seed_batch_code: str = None,
    status: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:query", current_user, db)
    
    query = db.query(PlantingRecord)
    if plot_code:
        plot = db.query(Plot).filter(Plot.plot_code == plot_code).first()
        if plot:
            query = query.filter(PlantingRecord.plot_id == plot.id)
    if batch_code:
        batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
        if batch:
            query = query.filter(PlantingRecord.batch_id == batch.id)
    if seed_batch_code:
        query = query.filter(PlantingRecord.seed_batch_code == seed_batch_code)
    if status:
        query = query.filter(PlantingRecord.status == status)
    
    total = query.count()
    records = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": records,
    }


@router.post("/environmental-data")
async def create_environmental_data(
    data: EnvironmentalDataCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:manage", current_user, db)
    
    plot = db.query(Plot).filter(Plot.plot_code == data.plot_code).first()
    if not plot:
        raise HTTPException(status_code=404, detail="地块不存在")
    
    seed_batch_code = data.seed_batch_code
    if not seed_batch_code:
        planting_record = db.query(PlantingRecord).filter(PlantingRecord.plot_id == plot.id).first()
        if planting_record:
            seed_batch_code = planting_record.seed_batch_code
    
    env_data = EnvironmentalData(
        plot_id=plot.id,
        seed_batch_code=seed_batch_code,
        temperature=data.temperature,
        humidity=data.humidity,
        soil_moisture=data.soil_moisture,
        soil_temperature=data.soil_temperature,
        ph_value=data.ph_value,
        illumination=data.illumination,
        wind_speed=data.wind_speed,
        conductivity=data.conductivity,
        nitrogen=data.nitrogen,
        phosphorus=data.phosphorus,
        potassium=data.potassium,
        salinity=data.salinity,
        data_source=data.data_source,
    )
    db.add(env_data)
    db.commit()
    db.refresh(env_data)
    return {"status": "success", "data": env_data}


@router.get("/environmental-data")
async def get_environmental_data(
    plot_code: str,
    hours: int = Query(24, ge=1, le=168),
    seed_batch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:query", current_user, db)
    
    plot = db.query(Plot).filter(Plot.plot_code == plot_code).first()
    if not plot:
        raise HTTPException(status_code=404, detail="地块不存在")
    
    since = now_cn_naive() - timedelta(hours=hours)
    query = db.query(EnvironmentalData).filter(
        EnvironmentalData.plot_id == plot.id,
        EnvironmentalData.record_time >= since,
    )
    
    if seed_batch_code:
        query = query.filter(EnvironmentalData.seed_batch_code == seed_batch_code)
    
    data = query.order_by(EnvironmentalData.record_time).all()
    
    if not data:
        query = db.query(EnvironmentalData).filter(EnvironmentalData.plot_id == plot.id)
        if seed_batch_code:
            query = query.filter(EnvironmentalData.seed_batch_code == seed_batch_code)
        data = query.order_by(EnvironmentalData.record_time.desc()).limit(20).all()
    
    return {"status": "success", "count": len(data), "data": data}


@router.post("/farming-activities")
async def create_farming_activity(
    data: FarmingActivityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:manage", current_user, db)
    
    plot = db.query(Plot).filter(Plot.plot_code == data.plot_code).first()
    if not plot:
        raise HTTPException(status_code=404, detail="地块不存在")
    
    activity = FarmingActivity(
        plot_id=plot.id,
        seed_batch_code=data.seed_batch_code,
        activity_type=data.activity_type,
        activity_date=data.activity_date or now_cn_naive(),
        description=data.description,
        worker_id=data.worker_id,
        equipment_id=data.equipment_id,
        notes=data.notes,
        blockchain_hash=generate_hash(f"{data.plot_code}{data.activity_type}{now_cn_naive()}"),
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return {"status": "success", "data": activity}


@router.get("/farming-activities")
async def get_farming_activities(
    plot_code: str = None,
    activity_type: str = None,
    activity_date_start: datetime = None,
    activity_date_end: datetime = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("planting:query", current_user, db)
    
    query = db.query(FarmingActivity)
    if plot_code:
        plot = db.query(Plot).filter(Plot.plot_code == plot_code).first()
        if plot:
            query = query.filter(FarmingActivity.plot_id == plot.id)
    if activity_type:
        query = query.filter(FarmingActivity.activity_type == activity_type)
    if activity_date_start:
        query = query.filter(FarmingActivity.activity_date >= activity_date_start)
    if activity_date_end:
        query = query.filter(FarmingActivity.activity_date <= activity_date_end)
    
    activities = query.order_by(FarmingActivity.activity_date.desc()).all()
    return {"status": "success", "count": len(activities), "data": activities}
