from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, timedelta
from app.core.database import get_db
from app.models import Sensor, Measurement
from app.models.inspection import InspectionReport, PesticideResidueTest
from app.schemas import MeasurementCreate, MeasurementResponse, MeasurementListResponse
from app import ws
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.core.blockchain import add_record_to_blockchain, calculate_hash, sign_data
from app.core.ipfs import add_file_to_ipfs
from app.core.blockchain import generate_new_batch_id

router = APIRouter()

SENSOR_TYPE_RANGES = {
    'temperature': {'min': -40, 'max': 80},
    'humidity': {'min': 0, 'max': 100},
    'ph': {'min': 3, 'max': 10},
    'light': {'min': 0, 'max': 200000},
    'pesticide': {'min': 0, 'max': 10},
    'soil_moisture': {'min': 0, 'max': 100},
    'soil_multi': {'min': 0, 'max': 20000},
    'co2': {'min': 300, 'max': 2000},
    'environmental': {'min': 0, 'max': 100},
}

ITEM_NAME_MAPPING = {
    '温度': 'temperature',                 # 空气温度
    '土壤温度': 'soil_temperature',        # 土壤温度（soil_multi 专用，避免覆盖空气温度）
    '湿度': 'humidity',
    '空气湿度': 'humidity',
    'ph值': 'ph_value',
    '酸碱度': 'ph_value',
    '土壤湿度': 'soil_moisture',
    '土壤水分': 'soil_moisture',
    '含水率': 'soil_moisture',
    '光照强度': 'illumination',
    '风速': 'wind_speed',
    '农药残留': 'pesticide_residue',
    '二氧化碳浓度': 'co2',
    '电导率': 'conductivity',
    'ec': 'conductivity',
    '氮含量': 'nitrogen',
    '氮': 'nitrogen',
    '磷含量': 'phosphorus',
    '磷': 'phosphorus',
    '钾含量': 'potassium',
    '钾': 'potassium',
    '盐分': 'salinity',
    'co2': 'co2',
    'temperature': 'temperature',
    'soil_temperature': 'soil_temperature',
    'humidity': 'humidity',
    'ph_value': 'ph_value',
    'soil_moisture': 'soil_moisture',
    'illumination': 'illumination',
    'wind_speed': 'wind_speed',
    'conductivity': 'conductivity',
    'nitrogen': 'nitrogen',
    'phosphorus': 'phosphorus',
    'potassium': 'potassium',
    'salinity': 'salinity',
    'pesticide': 'pesticide_residue',
    'pesticide_residue': 'pesticide_residue',
}

def validate_sensor_value(value: float, sensor_type: str, item_name: Optional[str] = None) -> bool:
    """验证传感器值是否在合理范围内：优先按具体检测项目名查 SENSOR_TYPES[sensor_type].default_items，否则按传感器统一范围"""
    from app.schemas import SENSOR_TYPES
    # 优先：按项名匹配传感器的 default_items（每项有自己的 min/max）
    st = SENSOR_TYPES.get(sensor_type)
    if st and item_name is not None:
        for di in st.get('default_items', []):
            # 名称匹配：精确相等或互相包含（支持「氮含量」/「氮」这种别名）
            if di['name'] == item_name or di['name'] in item_name or item_name in di['name']:
                return di['min'] <= value <= di['max']
    # 兜底：传感器级统一范围（兼容旧逻辑）
    range_config = SENSOR_TYPE_RANGES.get(sensor_type)
    if not range_config:
        return True
    return range_config['min'] <= value <= range_config['max']

def resolve_item_to_env_key(item_name: str) -> Optional[str]:
    """将检测项目名（中文/英文）映射到 EnvironmentalData 的列名，支持大小写、别名模糊匹配"""
    if not item_name:
        return None
    clean = item_name.strip()
    # 先精确匹配（含大小写）
    if clean in ITEM_NAME_MAPPING:
        return ITEM_NAME_MAPPING[clean]
    lower_clean = clean.lower()
    # 大小写精确匹配
    if lower_clean in ITEM_NAME_MAPPING:
        return ITEM_NAME_MAPPING[lower_clean]
    # 中文/别名 字符串包含匹配
    for k, v in ITEM_NAME_MAPPING.items():
        if clean in k or k in clean or lower_clean == k.lower():
            return v
    # 特殊关键词兜底（避免上面漏掉）
    if any(k in clean for k in ('土壤水分', '土壤湿度', '含水率')):
        return 'soil_moisture'
    if 'pH' in clean or 'PH' in clean or 'ph' in clean.lower() or '酸碱度' in clean:
        return 'ph_value'
    if '电导率' in clean or 'EC' == clean.upper() or 'ec' == clean.lower():
        return 'conductivity'
    if '盐分' in clean:
        return 'salinity'
    return None

@router.post("/data")
async def receive_data(
    data: MeasurementCreate, 
    db: Session = Depends(get_db), 
    seed_batch_code: str = None,
    plot_code: str = None,
    current_user: User = Depends(get_current_active_user)
):
    await require_permission("sensors:submit", current_user, db)
    
    sensor = db.query(Sensor).filter(Sensor.device_id == data.device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未注册，请先注册设备")
    
    now = datetime.now()
    results = []
    env_data_dict: dict = {}
    
    for item in data.items:
        is_valid = validate_sensor_value(item.value, sensor.type, item.name)
        is_over_limit = item.value > sensor.threshold or not is_valid
        measurement = Measurement(
            sensor_id=sensor.id,
            seed_batch_code=seed_batch_code,
            timestamp=now,
            item_name=item.name,
            value=item.value,
            unit=item.unit,
            is_over_limit=is_over_limit
        )
        db.add(measurement)
        results.append(measurement)
        
        env_data_key = resolve_item_to_env_key(item.name)
        if env_data_key:
            env_data_dict[env_data_key] = item.value
    
    sensor.status = "online"
    sensor.last_report_time = now
    
    from app.models.planting import Plot, PlantingRecord, EnvironmentalData
    
    final_plot_code = plot_code or sensor.plot_code
    final_seed_batch_code = seed_batch_code or sensor.seed_batch_code
    
    if final_plot_code:
        plot = db.query(Plot).filter(Plot.plot_code == final_plot_code).first()
        if plot:
            if not final_seed_batch_code:
                planting_record = db.query(PlantingRecord).filter(
                    PlantingRecord.plot_id == plot.id,
                    PlantingRecord.status == "growing"
                ).order_by(PlantingRecord.planting_date.desc()).first()
                if planting_record:
                    final_seed_batch_code = planting_record.seed_batch_code
            
            env_data = EnvironmentalData(
                plot_id=plot.id,
                seed_batch_code=final_seed_batch_code,
                record_time=now,
                temperature=env_data_dict.get('temperature'),
                humidity=env_data_dict.get('humidity'),
                soil_moisture=env_data_dict.get('soil_moisture'),
                soil_temperature=env_data_dict.get('soil_temperature'),
                ph_value=env_data_dict.get('ph_value'),
                illumination=env_data_dict.get('illumination'),
                wind_speed=env_data_dict.get('wind_speed'),
                conductivity=env_data_dict.get('conductivity'),
                nitrogen=env_data_dict.get('nitrogen'),
                phosphorus=env_data_dict.get('phosphorus'),
                potassium=env_data_dict.get('potassium'),
                salinity=env_data_dict.get('salinity'),
                data_source="sensor",
            )
            db.add(env_data)
        else:
            raise HTTPException(status_code=404, detail=f"地块编码不存在: {final_plot_code}")
    else:
        if sensor.location:
            plots = db.query(Plot).filter(Plot.location.contains(sensor.location)).all()
            if len(plots) == 1:
                plot = plots[0]
                if not final_seed_batch_code:
                    planting_record = db.query(PlantingRecord).filter(
                        PlantingRecord.plot_id == plot.id,
                        PlantingRecord.status == "growing"
                    ).order_by(PlantingRecord.planting_date.desc()).first()
                    if planting_record:
                        final_seed_batch_code = planting_record.seed_batch_code

                env_data = EnvironmentalData(
                    plot_id=plot.id,
                    seed_batch_code=final_seed_batch_code,
                    record_time=now,
                    temperature=env_data_dict.get('temperature'),
                    humidity=env_data_dict.get('humidity'),
                    soil_moisture=env_data_dict.get('soil_moisture'),
                    soil_temperature=env_data_dict.get('soil_temperature'),
                    ph_value=env_data_dict.get('ph_value'),
                    illumination=env_data_dict.get('illumination'),
                    wind_speed=env_data_dict.get('wind_speed'),
                    conductivity=env_data_dict.get('conductivity'),
                    nitrogen=env_data_dict.get('nitrogen'),
                    phosphorus=env_data_dict.get('phosphorus'),
                    potassium=env_data_dict.get('potassium'),
                    salinity=env_data_dict.get('salinity'),
                    data_source="sensor",
                )
                db.add(env_data)
    
    db.commit()
    
    for m in results:
        db.refresh(m)
    
    await ws.send_to_all({
        "type": "new_measurement",
        "device_id": data.device_id,
        "timestamp": now.isoformat(),
        "plot_code": final_plot_code,
        "seed_batch_code": final_seed_batch_code,
        "items": [item.dict() for item in data.items]
    })
    
    return {"status": "success", "message": "数据已接收", "count": len(results)}

@router.get("/", response_model=MeasurementListResponse)
async def get_measurements(
    sensor_id: Optional[int] = None,
    device_id: Optional[str] = None,
    seed_batch_code: Optional[str] = None,
    limit: int = 100,
    hours: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await require_permission("sensors:query", current_user, db)
    
    query = db.query(Measurement)
    
    if sensor_id:
        query = query.filter(Measurement.sensor_id == sensor_id)
    elif device_id:
        sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
        if sensor:
            query = query.filter(Measurement.sensor_id == sensor.id)
    
    if seed_batch_code:
        query = query.filter(Measurement.seed_batch_code == seed_batch_code)
    
    if hours:
        since = datetime.now() - timedelta(hours=hours)
        query = query.filter(Measurement.timestamp >= since)
    
    measurements = query.order_by(Measurement.timestamp.desc()).limit(limit).all()
    
    return {
        "status": "success",
        "count": len(measurements),
        "data": measurements
    }

@router.get("/latest", response_model=MeasurementListResponse)
async def get_latest_measurements(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("sensors:query", current_user, db)

    latest = {}
    measurements = db.query(Measurement).order_by(Measurement.timestamp.desc()).all()

    for m in measurements:
        if m.sensor_id not in latest:
            latest[m.sensor_id] = m

    return {
        "status": "success",
        "count": len(latest),
        "data": list(latest.values())
    }

@router.get("/latest-environmental")
async def get_latest_environmental(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """获取各地块最新一条环境数据（供首页环境监测卡片使用）"""
    await require_permission("sensors:query", current_user, db)

    from sqlalchemy import func, literal
    from app.models.planting import Plot, EnvironmentalData

    # 子查询：每个 plot_id 最新一条记录的 id（用 id 精确匹配，避免同一时间戳返回重复行）
    latest_ids = db.query(
        func.max(EnvironmentalData.id).label('max_id')
    ).group_by(EnvironmentalData.plot_id).subquery()

    rows = db.query(EnvironmentalData, Plot).join(
        latest_ids,
        EnvironmentalData.id == latest_ids.c.max_id
    ).join(
        Plot, EnvironmentalData.plot_id == Plot.id
    ).all()

    now = datetime.now()
    result = []
    for env, plot in rows:
        # 判断数据是否过期（超过1小时未更新视为过期）
        is_stale = False
        if env.record_time:
            elapsed = (now - env.record_time).total_seconds()
            is_stale = elapsed > 3600

        result.append({
            "plot_id": plot.id,
            "plot_code": plot.plot_code,
            "plot_name": plot.name,
            "location": plot.location,
            "seed_batch_code": env.seed_batch_code,
            "record_time": env.record_time.isoformat() if env.record_time else None,
            "record_date": env.record_time.strftime('%Y-%m-%d') if env.record_time else None,
            "is_stale": is_stale,
            "temperature": env.temperature,
            "humidity": env.humidity,
            "soil_moisture": env.soil_moisture,
            "soil_temperature": env.soil_temperature,
            "ph_value": env.ph_value,
            "illumination": env.illumination,
            "wind_speed": env.wind_speed,
            "conductivity": env.conductivity,
            "nitrogen": env.nitrogen,
            "phosphorus": env.phosphorus,
            "potassium": env.potassium,
            "salinity": env.salinity,
            "data_source": env.data_source,
        })

    return {"status": "success", "count": len(result), "data": result}

@router.get("/sensor/{device_id}", response_model=MeasurementListResponse)
async def get_sensor_measurements(
    device_id: str,
    limit: int = 100,
    seed_batch_code: Optional[str] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """查询传感器的历史测量记录。可选 date 参数(YYYY-MM-DD)：只查某一天；不写返回最近 limit 条"""
    await require_permission("sensors:query", current_user, db)

    sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未找到")

    from sqlalchemy import func as sa_func

    query = db.query(Measurement).filter(Measurement.sensor_id == sensor.id)

    if seed_batch_code:
        query = query.filter(Measurement.seed_batch_code == seed_batch_code)

    if date:
        # 统一口径：DATE(timestamp) == date_str，避免时区/聚合覆盖问题
        try:
            from datetime import date as _date_type
            _parsed = _date_type.fromisoformat(date)  # 校验格式
        except Exception:
            raise HTTPException(status_code=400, detail="date 格式应为 YYYY-MM-DD")
        query = query.filter(sa_func.DATE(Measurement.timestamp) == date)

    measurements = query.order_by(Measurement.timestamp.desc()).limit(limit).all()

    return {
        "status": "success",
        "count": len(measurements),
        "data": measurements,
    }


@router.get("/daily-summary")
async def get_daily_summary(
    device_id: str,
    date: str,
    seed_batch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    某日数据汇总：对同一 sensor + 同一 DATE(timestamp) 的每一项检测值
    返回 count / avg / min / max / unit（单位取当天该项目出现最多的）
    """
    await require_permission("sensors:query", current_user, db)

    from sqlalchemy import func as sa_func

    # 校验 date 格式
    from datetime import date as _date_type
    try:
        _date_type.fromisoformat(date)
    except Exception:
        raise HTTPException(status_code=400, detail="date 格式应为 YYYY-MM-DD")

    sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未找到")

    query = db.query(
        Measurement.item_name,
        sa_func.count(Measurement.id).label("count"),
        sa_func.avg(Measurement.value).label("avg"),
        sa_func.min(Measurement.value).label("min"),
        sa_func.max(Measurement.value).label("max"),
    ).filter(
        Measurement.sensor_id == sensor.id,
        sa_func.DATE(Measurement.timestamp) == date,
    )
    if seed_batch_code:
        query = query.filter(Measurement.seed_batch_code == seed_batch_code)
    rows = query.group_by(Measurement.item_name).all()

    items = []
    for item_name, count, avg, min_v, max_v in rows:
        # 取当天出现次数最多的单位
        unit_row = db.query(Measurement.unit).filter(
            Measurement.sensor_id == sensor.id,
            Measurement.item_name == item_name,
            sa_func.DATE(Measurement.timestamp) == date,
        ).group_by(Measurement.unit).order_by(sa_func.count(Measurement.id).desc()).first()
        unit = unit_row[0] if unit_row else ''
        items.append({
            "item_name": item_name,
            "count": count,
            "avg": round(float(avg), 3) if avg is not None else None,
            "min": round(float(min_v), 3) if min_v is not None else None,
            "max": round(float(max_v), 3) if max_v is not None else None,
            "unit": unit,
        })

    # 采样间隔 / 采样总时长（基于当天首尾记录）
    times = db.query(
        sa_func.min(Measurement.timestamp).label("first"),
        sa_func.max(Measurement.timestamp).label("last"),
        sa_func.count(Measurement.id).label("total_rows"),
    ).filter(
        Measurement.sensor_id == sensor.id,
        sa_func.DATE(Measurement.timestamp) == date,
    ).first()
    total_rows = times.total_rows or 0
    first_time = times[0].isoformat() if times[0] else None
    last_time = times[1].isoformat() if times[1] else None
    total_minutes = 0.0
    if times[0] and times[1] and times[0] != times[1]:
        total_minutes = round((times[1] - times[0]).total_seconds() / 60.0, 1)

    return {
        "status": "success",
        "date": date,
        "sensor_id": sensor.device_id,
        "sensor_name": sensor.name,
        "summary": {
            "total_samples": total_rows,
            "first_time": first_time,
            "last_time": last_time,
            "total_minutes": total_minutes,
            "items": items,
        },
    }


@router.post("/data/auto-report")
async def receive_data_and_create_report(
    data: MeasurementCreate,
    seed_batch_code: str,
    harvest_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await require_permission("inspection:quality", current_user, db)
    
    sensor = db.query(Sensor).filter(Sensor.device_id == data.device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未注册，请先注册设备")
    
    if sensor.type != 'pesticide':
        raise HTTPException(status_code=400, detail="只有农药残留传感器才能生成检测报告")
    
    now = datetime.now()
    all_qualified = True
    measurements = []
    residue_tests = []
    
    for item in data.items:
        is_over_limit = item.value > sensor.threshold
        if is_over_limit:
            all_qualified = False
        
        measurement = Measurement(
            sensor_id=sensor.id,
            seed_batch_code=seed_batch_code,
            timestamp=now,
            item_name=item.name,
            value=item.value,
            unit=item.unit,
            is_over_limit=is_over_limit
        )
        db.add(measurement)
        measurements.append(measurement)
        
        residue_test = PesticideResidueTest(
            test_item=item.name,
            limit_value=sensor.threshold,
            measured_value=item.value,
            unit=item.unit,
            is_over_limit=is_over_limit
        )
        residue_tests.append(residue_test)
    
    sensor.status = "online"
    sensor.last_report_time = now
    
    report_code = generate_new_batch_id("IR")
    
    report = InspectionReport(
        report_code=report_code,
        report_type="农药残留检测",
        report_date=now,
        inspector=current_user.username,
        inspection_agency="传感器自动检测",
        is_qualified=all_qualified,
        seed_batch_code=seed_batch_code,
        harvest_code=harvest_code
    )
    db.add(report)
    db.flush()
    
    for test in residue_tests:
        test.report_id = report.id
        db.add(test)
    
    db.commit()
    
    for m in measurements:
        db.refresh(m)
    
    await ws.send_to_all({
        "type": "new_measurement",
        "device_id": data.device_id,
        "timestamp": now.isoformat(),
        "items": [item.dict() for item in data.items],
        "report_code": report_code,
        "is_qualified": all_qualified
    })
    
    return {
        "status": "success",
        "message": "数据已接收并生成检测报告",
        "report_code": report_code,
        "is_qualified": all_qualified,
        "seed_batch_code": seed_batch_code,
        "measurements": len(measurements)
    }


@router.post("/upload-photo")
async def upload_photo(
    file: UploadFile = File(...),
    seed_batch_code: Optional[str] = None,
    harvest_code: Optional[str] = None,
    processing_batch_code: Optional[str] = None,
    plot_code: Optional[str] = None,
    person_type: Optional[str] = None,
    person_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await require_permission("planting:manage", current_user, db)
    
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")
    
    file_content = await file.read()
    ipfs_result = add_file_to_ipfs(file_content, file.filename)
    
    if not ipfs_result.get('success'):
        raise HTTPException(status_code=500, detail="图片上传失败")
    
    from app.models.blockchain import IPFSFile
    
    ipfs_file = IPFSFile(
        ipfs_hash=ipfs_result.get('ipfs_hash'),
        file_hash=ipfs_result.get('file_hash'),
        file_name=file.filename,
        file_size=ipfs_result.get('size'),
        content_type=file.content_type,
        seed_batch_code=seed_batch_code,
        harvest_code=harvest_code,
        processing_batch_code=processing_batch_code,
        plot_code=plot_code,
        person_type=person_type,
        person_name=person_name,
        uploaded_by=current_user.id,
        uploaded_at=datetime.now()
    )
    db.add(ipfs_file)
    db.commit()
    
    return {
        "status": "success",
        "message": "图片上传成功",
        "ipfs_hash": ipfs_result.get('ipfs_hash'),
        "file_hash": ipfs_result.get('file_hash'),
        "file_name": file.filename,
        "gateway_url": ipfs_result.get('gateway_url'),
        "seed_batch_code": seed_batch_code,
        "person_type": person_type,
        "person_name": person_name
    }


@router.get("/photos/{seed_batch_code}")
async def get_seed_batch_photos(
    seed_batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await require_permission("trace:query", current_user, db)
    
    from app.models.blockchain import IPFSFile
    
    photos = db.query(IPFSFile).filter(IPFSFile.seed_batch_code == seed_batch_code).all()
    
    return {
        "status": "success",
        "count": len(photos),
        "data": [
            {
                "id": p.id,
                "ipfs_hash": p.ipfs_hash,
                "file_name": p.file_name,
                "person_type": p.person_type,
                "person_name": p.person_name,
                "uploaded_at": p.uploaded_at.isoformat(),
                "gateway_url": f"http://localhost:8080/ipfs/{p.ipfs_hash}"
            }
            for p in photos
        ]
    }