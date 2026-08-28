from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any
from collections import deque
from datetime import datetime, timedelta
from app.core.timezone import now_cn_naive
import logging
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

logger = logging.getLogger(__name__)

router = APIRouter()

# 首页实时 6 项环境参数内存聚合缓存（避免高频查询 MySQL）
#   key: plot_code；value: { plot_name, seed_batch_code, updated_at,
#         items: { canonical_key -> { value, unit, status, history: deque(maxlen=20) } } }
LATEST_PER_PLOT: Dict[str, Dict[str, Any]] = {}

# 6 项首页展示的 canonical key → 显示 label / 单位 / 合理阈值（用于徽章颜色）
#   对应「全参数土壤 RS485 传感器」标准量程
HOME_6_ENV_SCHEMA = [
    {"key": "soil_temperature", "label": "土壤温度", "unit": "°C",  "min_ok": 8,   "max_ok": 32},
    {"key": "soil_moisture",  "label": "土壤湿度", "unit": "%",   "min_ok": 15,  "max_ok": 85},
    {"key": "ph_value",       "label": "pH 值",  "unit": "",    "min_ok": 5.5, "max_ok": 7.5},
    {"key": "nitrogen",       "label": "氮 (N)",  "unit": "mg/kg", "min_ok": 30, "max_ok": 300},
    {"key": "phosphorus",     "label": "磷 (P)",  "unit": "mg/kg", "min_ok": 10, "max_ok": 200},
    {"key": "potassium",      "label": "钾 (K)",  "unit": "mg/kg", "min_ok": 50, "max_ok": 400},
]
# 同一项中文名 → canonical 的别名表（比 ITEM_NAME_MAPPING 更全）
ITEM_ALIAS_TO_HOME_KEY = {
    "土壤温度": "soil_temperature", "soil_temperature": "soil_temperature", "soil temp": "soil_temperature",
    "土壤湿度": "soil_moisture", "土壤水分": "soil_moisture", "含水率": "soil_moisture", "soil_moisture": "soil_moisture", "水分": "soil_moisture",
    "pH值": "ph_value", "酸碱度": "ph_value", "ph_value": "ph_value", "pH": "ph_value", "ph": "ph_value",
    "氮": "nitrogen", "氮含量": "nitrogen", "nitrogen": "nitrogen", "速效氮": "nitrogen", "碱解氮": "nitrogen",
    "磷": "phosphorus", "磷含量": "phosphorus", "phosphorus": "phosphorus", "速效磷": "phosphorus",
    "钾": "potassium", "钾含量": "potassium", "potassium": "potassium", "速效钾": "potassium",
}

def _resolve_canonical_key(item_name: Optional[str]) -> Optional[str]:
    if not item_name:
        return None
    key = ITEM_ALIAS_TO_HOME_KEY.get(item_name)
    if key:
        return key
    for alias, canonical in ITEM_ALIAS_TO_HOME_KEY.items():
        if alias in item_name or item_name in alias:
            return canonical
    return None


def _status_from_value(canonical_key: str, value: float) -> str:
    for row in HOME_6_ENV_SCHEMA:
        if row["key"] == canonical_key:
            if value < row["min_ok"] or value > row["max_ok"]:
                return "warn"
            return "ok"
    return "ok"


def update_latest_per_plot(
    plot_code: Optional[str],
    plot_name: Optional[str],
    seed_batch_code: Optional[str],
    items: List[Dict[str, Any]],   # [{name, value, unit}]
    updated_at: Optional[datetime] = None,
):
    """每次传感器入库后调用，把 6 项 + 历史点合并进内存缓存，首页秒级返回。"""
    if not plot_code:
        return
    now = updated_at or now_cn_naive()
    bucket = LATEST_PER_PLOT.get(plot_code) or {
        "plot_name": plot_name or plot_code,
        "seed_batch_code": seed_batch_code,
        "updated_at": now,
        "items": {},
    }
    bucket["plot_name"] = plot_name or bucket.get("plot_name") or plot_code
    if seed_batch_code:
        bucket["seed_batch_code"] = seed_batch_code
    bucket["updated_at"] = now
    for it in items:
        canonical = _resolve_canonical_key(it.get("name"))
        if not canonical:
            continue
        try:
            v = float(it.get("value"))
        except (TypeError, ValueError):
            continue
        prev = bucket["items"].get(canonical) or {
            "value": None,
            "unit": "",
            "status": "ok",
            "history": deque(maxlen=20),
            "updated_at": now,
        }
        prev["value"] = v
        prev["unit"] = str(it.get("unit") or prev.get("unit") or next(
            (r["unit"] for r in HOME_6_ENV_SCHEMA if r["key"] == canonical), ""
        ))
        prev["status"] = _status_from_value(canonical, v)
        prev["history"].append(v)
        prev["updated_at"] = now
        bucket["items"][canonical] = prev
    LATEST_PER_PLOT[plot_code] = bucket

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
    '温度值': 'soil_temperature',          # 寄存器 0x0001 别名
    '土壤温度': 'soil_temperature',        # 土壤温度（soil_multi 专用，避免覆盖空气温度）
    '湿度': 'humidity',
    '空气湿度': 'humidity',
    'ph值': 'ph_value',
    'pH 值': 'ph_value',
    'PH 值': 'ph_value',
    '酸碱度': 'ph_value',
    '土壤湿度': 'soil_moisture',
    '土壤水分': 'soil_moisture',
    '含水率': 'soil_moisture',
    '体积含水量': 'soil_moisture',        # 寄存器 0x0000 手册名
    '光照强度': 'illumination',
    '风速': 'wind_speed',
    '农药残留': 'pesticide_residue',
    '二氧化碳浓度': 'co2',
    '电导率': 'conductivity',
    'ec': 'conductivity',
    'EC': 'conductivity',
    '氮含量': 'nitrogen',
    '氮': 'nitrogen',
    '磷含量': 'phosphorus',
    '磷': 'phosphorus',
    '钾含量': 'potassium',
    '钾': 'potassium',
    '盐分': 'salinity',
    '盐度': 'salinity',
    'TDS': 'salinity',                    # TDS 与盐分相近；environmental_data 无独立 tds 列，归入 salinity
    'tds': 'salinity',
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

    now = now_cn_naive()
    results = []
    env_data_dict: dict = {}

    from app.models.planting import Plot, PlantingRecord, EnvironmentalData

    # 关联总原则：1 批次 ⟺ 1 地块（用户显式参数 > planting_records 1:1 反查
    # > 传感器自身绑定 > location 模糊匹配），统一推导后供 Measurement /
    # EnvironmentalData / WebSocket 广播共用，避免表内不一致。

    # ---- Step 1. 从显式参数 / Sensor 绑定取候选值 ----
    user_plot_code = plot_code or None
    user_seed_batch_code = seed_batch_code or None
    sensor_plot_code = sensor.plot_code or None
    sensor_seed_batch_code = sensor.seed_batch_code or None

    final_plot_code: Optional[str] = user_plot_code or sensor_plot_code
    final_seed_batch_code: Optional[str] = user_seed_batch_code or sensor_seed_batch_code
    final_plot: Optional[Plot] = None
    planting_record: Optional[PlantingRecord] = None

    # ---- Step 2. planting_records 1:1 双向交叉修正（最权威事实）----
    GROWING_STATUS_ALIASES = {"growing", "播种", "已播种", "生长期", "育苗期"}

    def _resolve_by_planting_records():
        """利用 planting_records 1:1 绑定，填充空缺 / 校验冲突。
        核心原则：用户显式选择 > sensor 自身绑定 > 种植记录补全。
        种植记录仅用于补全缺失项，绝不覆盖用户或传感器已显式指定的地块。"""
        nonlocal final_plot, final_plot_code, final_seed_batch_code, planting_record

        # 2-a) 先把手头已有的地块编码解析成 Plot 对象（显式参数 / sensor 绑定优先）
        if final_plot_code and not final_plot:
            p = db.query(Plot).filter(Plot.plot_code == final_plot_code).first()
            if p:
                final_plot = p

        # 2-b) 有地块但无批次：用该地块的种植记录补全批次
        if final_plot and not final_seed_batch_code:
            pr = (
                db.query(PlantingRecord)
                .filter(
                    PlantingRecord.plot_id == final_plot.id,
                    PlantingRecord.status.in_(list(GROWING_STATUS_ALIASES)),
                )
                .order_by(PlantingRecord.planting_date.desc())
                .first()
            )
            if pr and pr.seed_batch_code:
                planting_record = pr
                final_seed_batch_code = pr.seed_batch_code
            return

        # 2-c) 有批次但无地块：用该批次的种植记录补全地块
        # 说明：传感器只绑定了批次、没绑定地块，或上传 payload 只带了批次
        if final_seed_batch_code and not final_plot:
            pr = (
                db.query(PlantingRecord)
                .filter(PlantingRecord.seed_batch_code == final_seed_batch_code)
                .order_by(PlantingRecord.planting_date.desc())
                .first()
            )
            if pr:
                planting_record = pr
                p = db.query(Plot).filter(Plot.id == pr.plot_id).first()
                if p:
                    final_plot = p
                    final_plot_code = p.plot_code
                    # 以种植记录里的权威批次为准，覆盖 sensor 绑定中可能过期的批次
                    final_seed_batch_code = pr.seed_batch_code

    _resolve_by_planting_records()

    # ---- Step 3. 兜底：location 模糊匹配（仅当完全没显式地块时）----
    if not final_plot and not final_plot_code and sensor.location:
        hits = db.query(Plot).filter(Plot.location.contains(sensor.location)).all()
        if len(hits) == 1:
            final_plot = hits[0]
            final_plot_code = final_plot.plot_code
            # 命中后再做一次 1:1 补齐批次
            _resolve_by_planting_records()

    # ---- Step 4. 如果显式传了 plot_code 但不存在 → 直接报错（避免空 FK）----
    if user_plot_code and not final_plot:
        raise HTTPException(status_code=404, detail=f"地块编码不存在: {user_plot_code}")

    # Measurement.unit 自动匹配
    default_items_by_sensor = {}
    try:
        from app.schemas import SENSOR_TYPES

        default_items_by_sensor = (SENSOR_TYPES.get(sensor.type) or {}).get("default_items", []) or []
    except Exception:
        default_items_by_sensor = []

    def _resolve_unit(item_name: Optional[str], payload_unit: Optional[str]) -> str:
        if payload_unit:
            return payload_unit
        if not item_name:
            return ""
        # 1) 精确匹配
        for d in default_items_by_sensor:
            if d.get("name") == item_name:
                return d.get("unit") or ""
        # 2) 互相包含匹配（氮含量/氮 这种别名）
        clean = item_name.strip()
        for d in default_items_by_sensor:
            dn = d.get("name") or ""
            if dn and (clean in dn or dn in clean):
                return d.get("unit") or ""
        # 3) 全局常见别名兜底
        if clean in ("温度", "空气温度", "土壤温度", "soil_temperature", "temperature"):
            return "°C"
        if clean in ("湿度", "空气湿度", "土壤湿度", "土壤水分", "含水率", "humidity", "soil_moisture"):
            return "%"
        if clean in ("pH值", "酸碱度", "ph_value"):
            return ""
        if clean in ("光照强度", "光照", "illumination"):
            return "lux"
        if clean in ("风速", "wind_speed"):
            return "m/s"
        if clean in ("农药残留", "pesticide_residue", "氮含量", "氮", "磷含量", "磷", "钾含量", "钾", "盐分"):
            return "mg/kg"
        if clean in ("电导率", "EC", "ec", "conductivity"):
            return "μS/cm"
        if clean in ("二氧化碳浓度", "co2", "CO2", "二氧化氮浓度", "no2", "氨气浓度", "nh3", "甲烷浓度", "ch4", "氧气浓度", "o2"):
            return "ppm" if clean not in ("氧气浓度", "o2") else "%"
        return ""

    # 数据来源解析：item.source_hint > payload.source_hint > 默认 MANUAL_ENTRY
    #   SIMULATED          → 前端传感器页面手动「开始模拟」
    #   MANUAL_HARDWARE    → 前端传感器页面 Web Serial 连接硬件采集
    #   HARDWARE_RS485     → rs485_bridge.py 真硬件（默认模式）
    #   HARDWARE_RS485_SIM → rs485_bridge.py --simulate
    ALLOWED_SOURCE = {"SIMULATED", "MANUAL_HARDWARE", "HARDWARE_RS485", "HARDWARE_RS485_SIM", "MANUAL_ENTRY"}
    _bulk_source = getattr(data, "source_hint", None)
    _effective_bulk_source = _bulk_source if (_bulk_source and _bulk_source in ALLOWED_SOURCE) else None

    _env_data_source = _effective_bulk_source or "MANUAL_ENTRY"

    # 只要有活跃数据流（硬件 / 模拟采集自动上传 / 桥接脚本模拟）都标记为在线
    #   仅纯手动录入(MANUAL_ENTRY)不更新在线状态，避免手误点击一次让传感器显示在线
    if _env_data_source != "MANUAL_ENTRY":
        sensor.status = "online"
        sensor.last_report_time = now

    for idx, item in enumerate(data.items):
        is_valid = validate_sensor_value(item.value, sensor.type, item.name)
        is_over_limit = item.value > sensor.threshold or not is_valid
        resolved_unit = _resolve_unit(item.name, getattr(item, "unit", None) or None)
        # item.source_hint 优先级 > 整包级 source_hint
        _row_source = (getattr(item, "source_hint", None) or "").strip() or None
        if _row_source and _row_source not in ALLOWED_SOURCE:
            _row_source = None
        final_source_hint = _row_source or _effective_bulk_source or "MANUAL_ENTRY"
        measurement = Measurement(
            sensor_id=sensor.id,
            seed_batch_code=final_seed_batch_code,
            # 写入时刻绑定的地块 / 批次：和 EVD / WS 完全一致，sensor 以后切换不影响历史记录
            plot_code=final_plot_code,
            timestamp=now,
            item_name=item.name,
            value=item.value,
            unit=resolved_unit,
            is_over_limit=is_over_limit,
            source_hint=final_source_hint,
        )
        db.add(measurement)
        results.append(measurement)

        env_data_key = resolve_item_to_env_key(item.name)
        if env_data_key:
            env_data_dict[env_data_key] = item.value

    # ---- Step 5. 若 Sensor 自己的 plot/seed 与事实不一致 → 回写修正（避免下次再漂移）----
    sensor_plot_dirty = False
    if final_plot_code and sensor.plot_code != final_plot_code:
        sensor.plot_code = final_plot_code
        sensor_plot_dirty = True
    if final_seed_batch_code and sensor.seed_batch_code != final_seed_batch_code:
        sensor.seed_batch_code = final_seed_batch_code
        sensor_plot_dirty = True
    if sensor_plot_dirty:
        sensor.updated_at = now

    # ---- Step 6. EnvironmentalData：有 plot 就写；没有就跳过，但 Measurement 已保留 plot_code 不丢失 ----
    if final_plot and env_data_dict:
        env_data = EnvironmentalData(
            plot_id=final_plot.id,  # NOT NULL FK，final_plot 一定有值才进入
            seed_batch_code=final_seed_batch_code,
            record_time=now,
            temperature=env_data_dict.get("temperature"),
            humidity=env_data_dict.get("humidity"),
            soil_moisture=env_data_dict.get("soil_moisture"),
            soil_temperature=env_data_dict.get("soil_temperature"),
            ph_value=env_data_dict.get("ph_value"),
            illumination=env_data_dict.get("illumination"),
            wind_speed=env_data_dict.get("wind_speed"),
            conductivity=env_data_dict.get("conductivity"),
            nitrogen=env_data_dict.get("nitrogen"),
            phosphorus=env_data_dict.get("phosphorus"),
            potassium=env_data_dict.get("potassium"),
            salinity=env_data_dict.get("salinity"),
            data_source=_env_data_source,
        )
        db.add(env_data)

    # 入库落盘前先聚合进内存缓存
    update_latest_per_plot(
        plot_code=final_plot_code,
        plot_name=final_plot.name if final_plot else None,
        seed_batch_code=final_seed_batch_code,
        items=[
            {"name": it.name, "value": it.value, "unit": getattr(it, "unit", None) or ""}
            for it in data.items
        ],
        updated_at=now,
    )

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("传感器数据入库失败 plot=%s: %s", final_plot_code, e, exc_info=True)
        raise HTTPException(status_code=500, detail="传感器数据入库失败")

    for m in results:
        db.refresh(m)

    # WS 推送独立 try：即使推送失败，已落盘数据不受影响
    try:
        await ws.send_to_all({
            "type": "new_measurement",
            "device_id": data.device_id,
            "timestamp": now.isoformat(),
            "plot_code": final_plot_code,
            "seed_batch_code": final_seed_batch_code,
            "items": [item.dict() for item in data.items]
        })
    except Exception as e:
        logger.warning("WS 推送新测量数据失败 plot=%s: %s", final_plot_code, e)

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
        since = now_cn_naive() - timedelta(hours=hours)
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

    now = now_cn_naive()
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


@router.get("/ping-6", include_in_schema=False)
async def ping_6_healthcheck():
    """不鉴权的快速健康检查：用于确认 uvicorn live 进程已经加载了新版 measurements.py（带 dashboard-environment 路由）。"""
    return {"ok": True, "loaded": "dashboard-environment route is available",
            "routes": sorted(
                list({getattr(r, "path", "") for r in router.routes if getattr(r, "path", "").startswith("/")})
            )}


@router.get("/dashboard-environment")
async def get_dashboard_environment_aggregate(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    首页方案A：实时 6 项环境参数聚合（土温/土湿/pH/N/P/K）
    返回：所有地块（seed_data 中注册的 plot 全返，没数据返回空 items，这样 Demo 时没跑采集也有骨架）
      · 内存优先（ws/update_latest_per_plot 刚写的最新聚合）
      · 内存空 → 回退 latest-environmental 的 DB 最新汇总行
    每秒级返回，不查大表。
    """
    await require_permission("sensors:query", current_user, db)
    from app.models.planting import Plot
    from app.models.seed import SeedBatch
    from app.models import PlantingRecord

    plots = db.query(Plot).order_by(Plot.plot_code.asc()).all()
    # PlantingRecord 只有 plot_id FK（无 plot_code 字段），必须 JOIN Plot 表取 plot_code
    growing_rows = (
        db.query(PlantingRecord.seed_batch_code, Plot.plot_code)
          .join(Plot, Plot.id == PlantingRecord.plot_id)
          .filter(PlantingRecord.status.in_(["播种", "growing", "生长期", "育苗期", "已播种"]))
          .distinct()
          .all()
    )
    batch_map = {pc: sbc for sbc, pc in growing_rows if sbc and pc}

    def _canonical_from_row(row: Any) -> Dict[str, Any]:
        """把 latest-environmental 返回的 env 行，转成首页 6 项聚合格式。"""
        out = {}
        mapping = [
            ("soil_temperature", "土壤温度", "°C"),
            ("soil_moisture", "土壤湿度", "%"),
            ("ph_value", "pH 值", ""),
            ("nitrogen", "氮 (N)", "mg/kg"),
            ("phosphorus", "磷 (P)", "mg/kg"),
            ("potassium", "钾 (K)", "mg/kg"),
        ]
        for key, _label, unit in mapping:
            val = getattr(row, key, None)
            if val is None:
                continue
            try:
                v = float(val)
            except Exception:
                continue
            out[key] = {
                "value": v,
                "unit": unit,
                "status": _status_from_value(key, v),
                "history": [v],  # 回退模式历史只有 1 点，sparkline 会显示成直线
                "updated_at": getattr(row, "record_time", None) or now_cn_naive(),
            }
        return out

    plots_result = []
    now = now_cn_naive()
    # 预先 import EnvironmentalData
    from app.models.planting import EnvironmentalData

    for plot in plots:
        # 1. 优先命中内存聚合（WS 实时写入的最新数据）
        mem = LATEST_PER_PLOT.get(plot.plot_code)
        if mem and mem.get("items"):
            items_6 = []
            for schema in HOME_6_ENV_SCHEMA:
                canonical = schema["key"]
                it = mem.get("items", {}).get(canonical)
                if not it:
                    continue
                age_s = (now - it["updated_at"]).total_seconds() if it.get("updated_at") else 9999
                items_6.append({
                    "key": canonical,
                    "label": schema["label"],
                    "value": it.get("value"),
                    "unit": it.get("unit") or schema["unit"],
                    "status": it.get("status") or "ok",
                    "history": list(it.get("history") or []),
                    "age_s": age_s,
                    "updated_at": it["updated_at"].isoformat() if it.get("updated_at") else None,
                })
            bucket_age = (now - mem["updated_at"]).total_seconds() if mem.get("updated_at") else 9999
            plots_result.append({
                "plot_code": plot.plot_code,
                # 地块名称是 Plot 表静态元数据，不能被实时缓存中的错误名称覆盖
                "plot_name": plot.name,
                "location": plot.location,
                # 批次优先以种植记录 1:1 绑定为准，mem 中的 seed_batch_code 仅作兜底
                "seed_batch_code": batch_map.get(plot.plot_code) or mem.get("seed_batch_code"),
                "updated_at": mem["updated_at"].isoformat() if mem.get("updated_at") else None,
                "age_s": bucket_age,
                "items": items_6,
            })
            continue

        # 2. 内存空 → 回退：每个 plot 的最近一条 EnvironmentalData 汇总行
        env_row = (
            db.query(EnvironmentalData)
            .filter(EnvironmentalData.plot_id == plot.id)
            .order_by(EnvironmentalData.id.desc())
            .first()
        )
        items_6 = []
        if env_row is not None:
            converted = _canonical_from_row(env_row)
            rec_time = env_row.record_time or now
            for schema in HOME_6_ENV_SCHEMA:
                canonical = schema["key"]
                it = converted.get(canonical)
                if not it:
                    continue
                age_s = (now - rec_time).total_seconds()
                items_6.append({
                    "key": canonical,
                    "label": schema["label"],
                    "value": it.get("value"),
                    "unit": it.get("unit") or schema["unit"],
                    "status": it.get("status") or "ok",
                    "history": list(it.get("history") or []),
                    "age_s": age_s,
                    "updated_at": rec_time.isoformat() if rec_time else None,
                })
            bucket_age = (now - rec_time).total_seconds()
            plots_result.append({
                "plot_code": plot.plot_code,
                "plot_name": plot.name,
                "location": plot.location,
                "seed_batch_code": env_row.seed_batch_code or batch_map.get(plot.plot_code),
                "updated_at": rec_time.isoformat() if rec_time else None,
                "age_s": bucket_age,
                "items": items_6,
            })
            continue

        # 3. 无数据时仍返回 plot 元信息 + 空 items，前端显示空态骨架
        plots_result.append({
            "plot_code": plot.plot_code,
            "plot_name": plot.name,
            "location": plot.location,
            "seed_batch_code": batch_map.get(plot.plot_code),
            "updated_at": None,
            "age_s": None,
            "items": [],
        })

    return {
        "status": "success",
        "schema": [{"key": r["key"], "label": r["label"], "unit": r["unit"],
                    "min_ok": r["min_ok"], "max_ok": r["max_ok"]} for r in HOME_6_ENV_SCHEMA],
        "count": len(plots_result),
        "plots": plots_result,
    }

@router.get("/sensor/{device_id}", response_model=MeasurementListResponse)
async def get_sensor_measurements(
    device_id: str,
    limit: int = 100,
    seed_batch_code: Optional[str] = None,
    plot_code: Optional[str] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """查询传感器的历史测量记录。可选 date(YYYY-MM-DD) 查某一天；可选 plot_code 精确到地块。"""
    await require_permission("sensors:query", current_user, db)

    sensor = db.query(Sensor).filter(Sensor.device_id == device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未找到")

    from sqlalchemy import func as sa_func

    query = db.query(Measurement).filter(Measurement.sensor_id == sensor.id)

    if seed_batch_code:
        query = query.filter(Measurement.seed_batch_code == seed_batch_code)

    if plot_code:
        query = query.filter(Measurement.plot_code == plot_code)

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
    plot_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """某日数据汇总：count / avg / min / max / unit（按检测项分组）"""
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

    base_filters = [
        Measurement.sensor_id == sensor.id,
        sa_func.DATE(Measurement.timestamp) == date,
    ]
    if seed_batch_code:
        base_filters.append(Measurement.seed_batch_code == seed_batch_code)
    if plot_code:
        base_filters.append(Measurement.plot_code == plot_code)

    query = db.query(
        Measurement.item_name,
        sa_func.count(Measurement.id).label("count"),
        sa_func.avg(Measurement.value).label("avg"),
        sa_func.min(Measurement.value).label("min"),
        sa_func.max(Measurement.value).label("max"),
    ).filter(*base_filters)
    rows = query.group_by(Measurement.item_name).all()

    items = []
    for item_name, count, avg, min_v, max_v in rows:
        # 取当天出现次数最多的单位
        unit_query_filters = list(base_filters) + [Measurement.item_name == item_name]
        unit_row = db.query(Measurement.unit).filter(*unit_query_filters).group_by(Measurement.unit).order_by(sa_func.count(Measurement.id).desc()).first()
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
    ).filter(*base_filters).first()
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
    plot_code: Optional[str] = None,
    harvest_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await require_permission("inspection:quality", current_user, db)

    from app.models.planting import Plot, PlantingRecord

    sensor = db.query(Sensor).filter(Sensor.device_id == data.device_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="传感器未注册，请先注册设备")

    if sensor.type != "pesticide":
        raise HTTPException(status_code=400, detail="只有农药残留传感器才能生成检测报告")

    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="自动生成检测报告必须指定种子批次")

    now = now_cn_naive()
    all_qualified = True
    measurements = []
    residue_tests = []

    # 与 /data 保持同一套批次-地块 1:1 推导
    final_seed_batch_code = seed_batch_code
    final_plot_code = plot_code or sensor.plot_code
    final_plot: Optional[Plot] = None
    final_plot_id: Optional[int] = None

    # 已知批次 → 反查种植记录取 plot
    pr = (
        db.query(PlantingRecord)
        .filter(PlantingRecord.seed_batch_code == final_seed_batch_code)
        .order_by(PlantingRecord.planting_date.desc())
        .first()
    )
    if pr:
        p = db.query(Plot).filter(Plot.id == pr.plot_id).first()
        if p:
            final_plot = p
            final_plot_id = p.id
            final_plot_code = p.plot_code  # 1:1 强绑定，覆盖不一致的输入
    if not final_plot and final_plot_code:
        p = db.query(Plot).filter(Plot.plot_code == final_plot_code).first()
        if p:
            final_plot = p
            final_plot_id = p.id

    # 传感器绑定若和事实不一致 → 自修正
    sensor_plot_dirty = False
    if final_plot_code and sensor.plot_code != final_plot_code:
        sensor.plot_code = final_plot_code
        sensor_plot_dirty = True
    if sensor.seed_batch_code != final_seed_batch_code:
        sensor.seed_batch_code = final_seed_batch_code
        sensor_plot_dirty = True
    if sensor_plot_dirty:
        sensor.updated_at = now

    # source_hint 统一解析：item > 整包 > MANUAL_ENTRY
    ALLOWED_SOURCE_AR = {"SIMULATED", "MANUAL_HARDWARE", "HARDWARE_RS485", "HARDWARE_RS485_SIM", "MANUAL_ENTRY"}
    _bulk_source_ar = getattr(data, "source_hint", None)
    _effective_bulk_source_ar = _bulk_source_ar if (_bulk_source_ar and _bulk_source_ar in ALLOWED_SOURCE_AR) else None

    # 只要有活跃数据流（硬件 / 模拟采集自动上传 / 桥接脚本模拟）都标记为在线
    #   仅纯手动录入(MANUAL_ENTRY)不更新在线状态
    if _effective_bulk_source_ar and _effective_bulk_source_ar != "MANUAL_ENTRY":
        sensor.status = "online"
        sensor.last_report_time = now

    for item in data.items:
        is_over_limit = item.value > sensor.threshold
        if is_over_limit:
            all_qualified = False

        # 单位自动匹配（和 /data 保持一致，避免误写 mg/kg 逻辑）
        try:
            from app.schemas import SENSOR_TYPES

            def_items = (SENSOR_TYPES.get(sensor.type) or {}).get("default_items", []) or []
            matched_unit = next(
                (d.get("unit") or "" for d in def_items if d.get("name") == item.name),
                None,
            )
        except Exception:
            matched_unit = None
        resolved_unit = (getattr(item, "unit", None) or "") or matched_unit or "mg/kg"

        _row_ar = (getattr(item, "source_hint", None) or "").strip() or None
        if _row_ar and _row_ar not in ALLOWED_SOURCE_AR:
            _row_ar = None
        _final_src_ar = _row_ar or _effective_bulk_source_ar or "MANUAL_ENTRY"

        measurement = Measurement(
            sensor_id=sensor.id,
            seed_batch_code=final_seed_batch_code,
            plot_code=final_plot_code,
            timestamp=now,
            item_name=item.name,
            value=item.value,
            unit=resolved_unit,
            is_over_limit=is_over_limit,
            source_hint=_final_src_ar,
        )
        db.add(measurement)
        measurements.append(measurement)

        residue_test = PesticideResidueTest(
            test_item=item.name,
            limit_value=sensor.threshold,
            measured_value=item.value,
            unit=resolved_unit,
            is_over_limit=is_over_limit,
        )
        residue_tests.append(residue_test)

    report_code = generate_new_batch_id("IR")

    report = InspectionReport(
        report_code=report_code,
        report_type="农药残留检测",
        report_date=now,
        inspector=current_user.username,
        inspection_agency="传感器自动检测",
        is_qualified=all_qualified,
        seed_batch_code=final_seed_batch_code,
        plot_id=final_plot_id,
        harvest_code=harvest_code,
    )
    db.add(report)
    db.flush()

    for test in residue_tests:
        test.report_id = report.id
        db.add(test)

    # auto-report 模式同样同步聚合缓存
    update_latest_per_plot(
        plot_code=final_plot_code,
        plot_name=final_plot.name if final_plot else None,
        seed_batch_code=final_seed_batch_code,
        items=[
            {"name": it.name, "value": it.value, "unit": getattr(it, "unit", None) or ""}
            for it in data.items
        ],
        updated_at=now,
    )

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("传感器数据+检测报告入库失败 plot=%s: %s", final_plot_code, e, exc_info=True)
        raise HTTPException(status_code=500, detail="传感器数据与检测报告入库失败")

    for m in measurements:
        db.refresh(m)

    # WS 推送独立 try：即使推送失败，已落盘数据不受影响
    try:
        await ws.send_to_all({
            "type": "new_measurement",
            "device_id": data.device_id,
            "timestamp": now.isoformat(),
            "plot_code": final_plot_code,
            "seed_batch_code": final_seed_batch_code,
            "items": [item.dict() for item in data.items],
            "report_code": report_code,
            "is_qualified": all_qualified,
        })
    except Exception as e:
        logger.warning("WS 推送新测量+检测数据失败 plot=%s: %s", final_plot_code, e)

    return {
        "status": "success",
        "message": "数据已接收并生成检测报告",
        "report_code": report_code,
        "is_qualified": all_qualified,
        "seed_batch_code": final_seed_batch_code,
        "plot_code": final_plot_code,
        "measurements": len(measurements),
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
        uploaded_at=now_cn_naive()
    )
    db.add(ipfs_file)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("IPFS 文件元数据入库失败 hash=%s: %s", ipfs_result.get('ipfs_hash'), e, exc_info=True)
        raise HTTPException(status_code=500, detail="IPFS 文件元数据入库失败")
    db.refresh(ipfs_file)

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


@router.get("/plot/{plot_code}/history")
async def get_plot_history(
    plot_code: str,
    hours: int = Query(default=24, ge=1, le=168, description="查询最近 N 小时的数据，默认 24，最大 168(7天)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """获取指定地块最近 N 小时的环境数据历史，用于首页内嵌趋势图"""
    await require_permission("sensors:query", current_user, db)

    from app.models.planting import Plot, EnvironmentalData

    plot = db.query(Plot).filter(Plot.plot_code == plot_code).first()
    if not plot:
        raise HTTPException(status_code=404, detail="地块不存在")

    since = now_cn_naive() - timedelta(hours=hours)

    rows = (
        db.query(EnvironmentalData)
        .filter(
            EnvironmentalData.plot_id == plot.id,
            EnvironmentalData.record_time >= since
        )
        .order_by(EnvironmentalData.record_time.asc())
        .all()
    )

    # 按参数分组，形成 {key: {time: value}} 结构，便于前端画多线图
    series_map: Dict[str, Dict[str, Any]] = {}
    param_keys = [
        ("soil_temperature", "土壤温度", "°C"),
        ("soil_moisture", "土壤湿度", "%"),
        ("ph_value", "pH 值", ""),
        ("nitrogen", "氮 (N)", "mg/kg"),
        ("phosphorus", "磷 (P)", "mg/kg"),
        ("potassium", "钾 (K)", "mg/kg"),
    ]

    for key, label, unit in param_keys:
        pts = []
        for row in rows:
            val = getattr(row, key, None)
            if val is not None:
                pts.append({
                    "t": row.record_time.isoformat() if row.record_time else None,
                    "v": float(val),
                })
        if pts:
            series_map[key] = {"label": label, "unit": unit, "points": pts}

    # 时间戳列表（所有记录的时间并集）
    timestamps = sorted(set(
        row.record_time.isoformat() if row.record_time else None
        for row in rows
        if row.record_time
    ))

    return {
        "status": "success",
        "plot_code": plot_code,
        "plot_name": plot.name,
        "count": len(rows),
        "hours": hours,
        "timestamps": timestamps,
        "series": series_map,
    }