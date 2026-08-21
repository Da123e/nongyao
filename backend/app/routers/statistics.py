from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
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

router = APIRouter()


@router.get("/statistics/dashboard")
async def get_dashboard_statistics(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    today = datetime.now().date()

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

    pending_orders = db.query(func.count(Order.id)).filter(
        Order.status == "pending"
    ).scalar()

    qualified_reports = db.query(func.count(InspectionReport.id)).filter(
        InspectionReport.is_qualified == True
    ).scalar()

    over_limit_count = db.query(func.count(InspectionReport.id)).filter(
        InspectionReport.is_qualified == False
    ).scalar()

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
            "pendingOrders": pending_orders or 0,
            "qualifiedReports": qualified_reports or 0,
            "overLimitCount": over_limit_count or 0,
        }
    }
