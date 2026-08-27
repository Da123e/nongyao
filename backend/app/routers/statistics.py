from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from app.core.timezone import now_cn_naive
from app.core.database import get_db
from app.auth import get_current_active_user
from app.models.auth import User
from app.models.sales import Order
from app.models.inspection import InspectionReport
from app.models.seed import SeedBatch
from app.models.planting import Plot
from app.models.pesticide import Pesticide
from app.models.processing import ProcessingBatch
from app.models.inventory import InventoryItem
from app.models.sensors import Sensor

router = APIRouter()


@router.get("/statistics/dashboard")
async def get_dashboard_statistics(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    today = now_cn_naive().date()

    total_users = db.query(func.count(User.id)).scalar()

    today_orders = db.query(func.count(Order.id)).filter(
        func.date(Order.created_at) == today
    ).scalar()

    pending_reviews = db.query(func.count(InspectionReport.id)).filter(
        InspectionReport.is_qualified.is_(None)
    ).scalar()

    total_seed_batches = db.query(func.count(SeedBatch.id)).scalar()
    total_plots = db.query(func.count(Plot.id)).scalar()
    total_pesticides = db.query(func.count(Pesticide.id)).scalar()
    total_reports = db.query(func.count(InspectionReport.id)).scalar()
    total_processing = db.query(func.count(ProcessingBatch.id)).scalar()
    total_inventory = db.query(func.count(InventoryItem.id)).scalar()
    total_orders = db.query(func.count(Order.id)).scalar()
    total_sensors = db.query(func.count(Sensor.id)).scalar()

    # 在线传感器：last_report_time 在 2 分钟内判定为在线（与 sensors.py 阈值一致）
    two_min_ago = now_cn_naive() - timedelta(minutes=2)
    online_sensors = db.query(func.count(Sensor.id)).filter(
        Sensor.last_report_time > two_min_ago
    ).scalar()

    # 库存预警：实际数量低于最小库存
    alerts_count = db.query(func.count(InventoryItem.id)).filter(
        InventoryItem.quantity < InventoryItem.min_stock
    ).scalar()

    pending_orders = db.query(func.count(Order.id)).filter(
        Order.status == "pending"
    ).scalar()

    # 今日创建且仍为 pending 的订单数（用于首页去重：todayOrders 与 pendingOrders 交集）
    today_pending_overlap = db.query(func.count(Order.id)).filter(
        Order.status == "pending",
        func.date(Order.created_at) == today
    ).scalar()

    qualified_reports = db.query(func.count(InspectionReport.id)).filter(
        InspectionReport.is_qualified == True
    ).scalar()

    over_limit_count = db.query(func.count(InspectionReport.id)).filter(
        InspectionReport.is_qualified == False
    ).scalar()

    total_sales_amount = db.query(func.coalesce(func.sum(Order.total_amount), 0)).scalar()
    pass_rate = (
        round(qualified_reports * 100.0 / total_reports, 2)
        if total_reports else 0.0
    )

    return {
        "status": "success",
        "data": {
            "totalUsers": total_users or 0,
            "todayOrders": today_orders or 0,
            "pendingReviews": pending_reviews or 0,
            "seedBatches": total_seed_batches or 0,
            "plantingPlots": total_plots or 0,
            "pesticides": total_pesticides or 0,
            "reports": total_reports or 0,
            "processingBatches": total_processing or 0,
            "inventoryItems": total_inventory or 0,
            "orders": total_orders or 0,
            "sensors": online_sensors or 0,
            "onlineSensors": online_sensors or 0,
            "totalSensors": total_sensors or 0,
            "sensorCount": online_sensors or 0,
            "pendingOrders": pending_orders or 0,
            "todayPendingOrderOverlap": today_pending_overlap or 0,
            "qualifiedReports": qualified_reports or 0,
            "overLimitCount": over_limit_count or 0,
            "inspectionPassRate": pass_rate,
            "totalSalesAmount": float(total_sales_amount or 0),
            "totalPlantingArea": total_plots or 0,
            "alerts": alerts_count or 0,
        }
    }
