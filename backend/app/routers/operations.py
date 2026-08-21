from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.core.database import get_db
from app.models.auth import User
from app.auth import get_current_active_user
from app.models.inventory import InventoryTransaction, InventoryItem
from app.models.sales import Order
from app.models.inspection import InspectionReport
from app.models.seed import SeedBatch
from app.models.planting import PlantingRecord, Plot
from app.models.pesticide import PesticideApplication
from app.models.processing import ProcessingBatch
from typing import List
from datetime import datetime

router = APIRouter()


def format_time(created_at) -> str:
    if not created_at:
        return "未知时间"
    now = datetime.now()
    delta = now - created_at
    minutes = int(delta.total_seconds() / 60)
    if minutes < 60:
        return f"{minutes}分钟前"
    hours = int(minutes / 60)
    if hours < 24:
        return f"{hours}小时前"
    days = int(hours / 24)
    if days < 30:
        return f"{days}天前"
    return created_at.strftime("%Y-%m-%d")


@router.get("/operations/recent", response_model=List[dict])
async def get_recent_operations(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    operations = []

    inventory_transactions = db.query(
        InventoryTransaction.created_at,
        InventoryTransaction.transaction_type,
        InventoryItem.item_name,
        InventoryTransaction.operator,
    ).join(InventoryItem, InventoryTransaction.item_id == InventoryItem.id)\
        .order_by(desc(InventoryTransaction.created_at))\
        .limit(limit)\
        .all()

    for t in inventory_transactions:
        action = "库存入库完成" if t.transaction_type == "in" else "库存出库完成"
        if t.item_name:
            action += f" ({t.item_name})"
        operations.append({
            "time": t.created_at,
            "type": "inventory",
            "action": action,
            "user": t.operator or "系统用户",
            "icon": "Package",
            "color": "cyan",
        })

    orders = db.query(
        Order.created_at,
        Order.store_name,
    ).order_by(desc(Order.created_at))\
        .limit(limit)\
        .all()

    for o in orders:
        action = f"新订单已创建 ({o.store_name or '客户订单'})"
        operations.append({
            "time": o.created_at,
            "type": "sales",
            "action": action,
            "user": "系统用户",
            "icon": "ShoppingCart",
            "color": "pink",
        })

    reports = db.query(
        InspectionReport.created_at,
        InspectionReport.report_code,
        InspectionReport.inspector,
    ).order_by(desc(InspectionReport.created_at))\
        .limit(limit)\
        .all()

    for r in reports:
        action = f"检测报告已创建 ({r.report_code})"
        operations.append({
            "time": r.created_at,
            "type": "inspection",
            "action": action,
            "user": r.inspector or "系统用户",
            "icon": "FileText",
            "color": "purple",
        })

    seed_batches = db.query(
        SeedBatch.created_at,
        SeedBatch.batch_code,
        SeedBatch.keeper,
    ).order_by(desc(SeedBatch.created_at))\
        .limit(limit)\
        .all()

    for s in seed_batches:
        action = f"种子批次已注册 ({s.batch_code})"
        operations.append({
            "time": s.created_at,
            "type": "seed",
            "action": action,
            "user": s.keeper or "系统用户",
            "icon": "Wheat",
            "color": "green",
        })

    planting_records = db.query(
        PlantingRecord.created_at,
        Plot.plot_code,
        PlantingRecord.farmer,
    ).join(Plot, PlantingRecord.plot_id == Plot.id)\
        .order_by(desc(PlantingRecord.created_at))\
        .limit(limit)\
        .all()

    for p in planting_records:
        action = f"种植记录已更新 ({p.plot_code})"
        operations.append({
            "time": p.created_at,
            "type": "planting",
            "action": action,
            "user": p.farmer or "系统用户",
            "icon": "Leaf",
            "color": "emerald",
        })

    pesticide_applications = db.query(
        PesticideApplication.created_at,
        PesticideApplication.applicator,
    ).order_by(desc(PesticideApplication.created_at))\
        .limit(limit)\
        .all()

    for pa in pesticide_applications:
        action = f"农药施用记录已创建 ({pa.applicator})"
        operations.append({
            "time": pa.created_at,
            "type": "pesticide",
            "action": action,
            "user": pa.applicator or "系统用户",
            "icon": "FlaskConical",
            "color": "blue",
        })

    processing_batches = db.query(
        ProcessingBatch.created_at,
        ProcessingBatch.batch_code,
    ).order_by(desc(ProcessingBatch.created_at))\
        .limit(limit)\
        .all()

    for pb in processing_batches:
        action = f"加工批次已创建 ({pb.batch_code})"
        operations.append({
            "time": pb.created_at,
            "type": "processing",
            "action": action,
            "user": "系统用户",
            "icon": "Factory",
            "color": "orange",
        })

    operations.sort(key=lambda x: x["time"], reverse=True)
    operations = operations[:limit]

    for op in operations:
        op["time_str"] = format_time(op["time"])
        del op["time"]

    return operations
