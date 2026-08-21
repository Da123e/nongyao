from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import logging
from app.core.database import get_db
from app.models.inventory import Warehouse, InventoryItem, InventoryTransaction
from app.models.auth import User
from app.auth import get_current_active_user, require_permission
from app.schemas import WarehouseCreate, InventoryItemCreate, InventoryTransactionCreate
from datetime import datetime

router = APIRouter()


@router.get("/warehouses", response_model=List[dict])
async def get_warehouses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:query", current_user, db)
    warehouses = db.query(Warehouse).all()
    return [
        {
            "id": w.id,
            "warehouse_code": w.warehouse_code,
            "name": w.name,
            "location": w.location,
            "type": w.type,
            "capacity": w.capacity,
            "temperature_range": w.temperature_range,
            "humidity_range": w.humidity_range,
            "manager": w.manager,
            "is_active": w.is_active,
            "created_at": w.created_at.isoformat() if w.created_at else None,
        }
        for w in warehouses
    ]


@router.post("/warehouses")
async def create_warehouse(
    warehouse_data: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:manage", current_user, db)
    
    if db.query(Warehouse).filter(Warehouse.warehouse_code == warehouse_data.warehouse_code).first():
        raise HTTPException(status_code=400, detail="仓库编码已存在")
    
    warehouse = Warehouse(**warehouse_data.dict())
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    
    return {"message": "Warehouse created successfully", "warehouse_id": warehouse.id}


@router.get("/inventory", response_model=List[dict])
async def get_inventory(
    warehouse_id: int = None,
    item_type: str = None,
    status: str = None,
    seed_batch_code: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:query", current_user, db)
    
    query = db.query(InventoryItem)
    if warehouse_id:
        query = query.filter(InventoryItem.warehouse_id == warehouse_id)
    if item_type:
        query = query.filter(InventoryItem.item_type == item_type)
    if status:
        query = query.filter(InventoryItem.status == status)
    if seed_batch_code:
        query = query.filter(InventoryItem.seed_batch_code == seed_batch_code)
    
    items = query.all()
    return [
        {
            "id": item.id,
            "warehouse_id": item.warehouse_id,
            "item_code": item.item_code,
            "item_name": item.item_name,
            "item_type": item.item_type,
            "batch_code": item.batch_code,
            "seed_batch_code": item.seed_batch_code,
            "processing_batch_id": item.processing_batch_id,
            "quantity": item.quantity,
            "unit": item.unit,
            "unit_price": item.unit_price,
            "total_value": item.total_value,
            "min_stock": item.min_stock,
            "max_stock": item.max_stock,
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
            "status": item.status,
        }
        for item in items
    ]


@router.post("/inventory")
async def create_inventory_item(
    item_data: InventoryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:manage", current_user, db)
    
    item = InventoryItem(**item_data.dict())
    db.add(item)
    db.commit()
    db.refresh(item)
    
    return {"message": "Inventory item created successfully", "item_id": item.id}


@router.post("/inventory/{item_id}/transactions")
async def add_transaction(
    item_id: int,
    transaction_data: InventoryTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:manage", current_user, db)
    
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    
    operator = current_user.real_name or current_user.username
    transaction_dict = transaction_data.dict()
    transaction_dict["operator"] = operator
    transaction = InventoryTransaction(item_id=item_id, **transaction_dict)
    db.add(transaction)
    
    if transaction_dict["transaction_type"] == "in":
        item.quantity += transaction_dict["quantity"]
    elif transaction_dict["transaction_type"] == "out":
        if item.quantity < transaction_dict["quantity"]:
            raise HTTPException(status_code=400, detail="Insufficient stock")
        item.quantity -= transaction_dict["quantity"]
    
    item.total_value = item.quantity * (item.unit_price or 0)
    db.commit()

    # 库存低于阈值时向仓管员和管理员推送预警通知
    try:
        from app.utils.notifications_helper import notify_inventory_low_stock
        if item.min_stock is not None and item.quantity <= item.min_stock:
            notify_inventory_low_stock(
                db,
                item_code=item.item_code,
                item_name=item.item_name,
                current_qty=item.quantity,
                threshold=item.min_stock,
                unit=item.unit or "kg",
            )
            db.commit()
    except Exception as e:
        logging.getLogger(__name__).warning(f"notify_inventory_low_stock failed: {e}")

    return {"message": "Transaction recorded successfully", "transaction_id": transaction.id}


@router.get("/alerts", response_model=List[dict])
async def get_inventory_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:query", current_user, db)
    
    items = db.query(InventoryItem).all()
    alerts = []
    for item in items:
        if item.min_stock and item.quantity < item.min_stock:
            alerts.append({
                "id": item.id,
                "item_code": item.item_code,
                "item_name": item.item_name,
                "current_stock": item.quantity,
                "min_stock": item.min_stock,
                "threshold": item.min_stock,
                "unit": item.unit or '',
                "alert_type": "low_stock",
                "alert_level": "urgent",
                "message": f"库存不足：当前库存 {item.quantity}{item.unit}，低于最低库存 {item.min_stock}{item.unit}",
            })
        if item.max_stock and item.quantity > item.max_stock:
            alerts.append({
                "id": item.id,
                "item_code": item.item_code,
                "item_name": item.item_name,
                "current_stock": item.quantity,
                "max_stock": item.max_stock,
                "threshold": item.max_stock,
                "unit": item.unit or '',
                "alert_type": "over_stock",
                "alert_level": "warning",
                "message": f"库存超标：当前库存 {item.quantity}{item.unit}，超过最高库存 {item.max_stock}{item.unit}",
            })
    
    return alerts


@router.get("/transactions", response_model=List[dict])
async def get_transactions(
    item_id: int = None,
    transaction_type: str = None,
    start_date: str = None,
    end_date: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:query", current_user, db)
    
    query = db.query(InventoryTransaction)
    if item_id:
        query = query.filter(InventoryTransaction.item_id == item_id)
    if transaction_type:
        query = query.filter(InventoryTransaction.transaction_type == transaction_type)
    if start_date:
        query = query.filter(InventoryTransaction.transaction_date >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(InventoryTransaction.transaction_date <= datetime.fromisoformat(end_date))
    
    transactions = query.order_by(InventoryTransaction.transaction_date.desc()).all()
    return [
        {
            "id": t.id,
            "item_id": t.item_id,
            "transaction_type": t.transaction_type,
            "quantity": t.quantity,
            "unit": t.unit,
            "unit_price": t.unit_price,
            "total_amount": t.total_amount,
            "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
            "operator": t.operator,
            "source_document": t.source_document,
            "source_document_no": t.source_document_no,
        }
        for t in transactions
    ]