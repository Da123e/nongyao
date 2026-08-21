from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict
from datetime import datetime
from app.core.database import get_db
from app.models import Sensor
from app.schemas import SensorCreate, SensorUpdate, SensorResponse, SENSOR_TYPES, SensorTypeInfo
from app.auth import get_current_active_user, require_permission
from app.models.auth import User

router = APIRouter()

def enrich_sensor_response(sensor: Sensor) -> dict:
    sensor_dict = {
        "id": sensor.id,
        "device_id": sensor.device_id,
        "name": sensor.name,
        "type": sensor.type,
        "type_name": SENSOR_TYPES.get(sensor.type, {}).get("name", sensor.type),
        "location": sensor.location,
        "plot_code": sensor.plot_code,
        "seed_batch_code": sensor.seed_batch_code,
        "threshold": sensor.threshold,
        "status": sensor.status,
        "last_report_time": sensor.last_report_time,
        "created_at": sensor.created_at,
        "updated_at": sensor.updated_at,
        "default_items": SENSOR_TYPES.get(sensor.type, {}).get("default_items", []),
    }
    return sensor_dict

@router.get("/types", response_model=List[SensorTypeInfo])
async def get_sensor_types(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return [{"code": k, "name": v["name"], "default_items": v["default_items"], "threshold": v["threshold"]} for k, v in SENSOR_TYPES.items()]

@router.get("/", response_model=List[Dict])
async def get_sensors(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("sensors:query", current_user, db)
    sensors = db.query(Sensor).all()
    return [enrich_sensor_response(s) for s in sensors]

@router.get("/{device_id}", response_model=Dict)
async def get_sensor(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("sensors:query", current_user, db)
    sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未找到")
    return enrich_sensor_response(sensor)

@router.post("/", response_model=Dict)
async def create_sensor(sensor: SensorCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("sensors:manage", current_user, db)
    existing = db.query(Sensor).filter(Sensor.device_id == sensor.device_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="设备ID已存在")
    
    sensor_data = sensor.dict(exclude={"custom_items"})
    if sensor.threshold is None:
        sensor_data["threshold"] = SENSOR_TYPES.get(sensor.type, {}).get("threshold", 50)
    
    db_sensor = Sensor(**sensor_data)
    db.add(db_sensor)
    db.commit()
    db.refresh(db_sensor)
    return enrich_sensor_response(db_sensor)

@router.put("/{device_id}", response_model=Dict)
async def update_sensor(device_id: str, sensor: SensorUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("sensors:manage", current_user, db)
    db_sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
    if not db_sensor:
        raise HTTPException(status_code=404, detail="传感器未找到")
    
    update_data = sensor.dict(exclude_unset=True, exclude={"custom_items"})
    if "type" in update_data and update_data["threshold"] is None:
        update_data["threshold"] = SENSOR_TYPES.get(update_data["type"], {}).get("threshold", 50)
    
    for key, value in update_data.items():
        setattr(db_sensor, key, value)
    
    db.commit()
    db.refresh(db_sensor)
    return enrich_sensor_response(db_sensor)

@router.delete("/{device_id}")
async def delete_sensor(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("sensors:manage", current_user, db)
    sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未找到")
    
    db.delete(sensor)
    db.commit()
    return {"status": "success", "message": "传感器已删除"}