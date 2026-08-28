from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
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
    result = []
    for w in warehouses:
        used = db.query(
            func.coalesce(func.sum(InventoryItem.quantity), 0)
        ).filter(InventoryItem.warehouse_id == w.id).scalar() or 0
        result.append({
            "id": w.id,
            "warehouse_code": w.warehouse_code,
            "name": w.name,
            "location": w.location,
            "type": w.type,
            "capacity": w.capacity,
            "used_capacity": used,
            "temperature_range": w.temperature_range,
            "humidity_range": w.humidity_range,
            "manager": w.manager,
            "is_active": w.is_active,
            "created_at": w.created_at.isoformat() if w.created_at else None,
        })
    return result


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
    result = []
    for item in items:
        warehouse = db.query(Warehouse).filter(Warehouse.id == item.warehouse_id).first()
        result.append({
            "id": item.id,
            "warehouse_id": item.warehouse_id,
            "warehouse_name": warehouse.name if warehouse else None,
            "warehouse_location": warehouse.location if warehouse else None,
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
            "storage_location": item.storage_location,
            "traceability_qr_code": item.traceability_qr_code,
            "status": item.status,
        })
    return result


@router.post("/inventory")
async def create_inventory_item(
    item_data: InventoryItemCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inventory:manage", current_user, db)
    
    item = InventoryItem(**item_data.dict())

    warehouse = db.query(Warehouse).filter(Warehouse.id == item_data.warehouse_id).first()
    if warehouse:
        item.warehouse_name = warehouse.name
        item.warehouse_location = warehouse.location

    if item.unit_price is None:
        item.unit_price = 0
    if item.total_value is None and item.quantity is not None:
        item.total_value = round(item.quantity * (item.unit_price or 0), 2)

    try:
        from app.core.qrcode_generator import generate_trace_qrcode
        from app.core.batch_resolver import resolve_seed_batch_code
        forwarded_scheme = request.headers.get("X-Forwarded-Proto") or request.url.scheme
        forwarded_host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
        # payload 归一化：种子批次 > 加工批次（反查归一化）> 商品编码兜底，保证扫码可直接命中
        raw_batch = item.seed_batch_code or item.batch_code or item.item_code
        qr_payload_batch = resolve_seed_batch_code(raw_batch, db) if raw_batch else raw_batch
        qr_result = generate_trace_qrcode(
            item.item_code,
            qr_payload_batch,
            request_host=forwarded_host,
            request_scheme=forwarded_scheme,
            mode='public',
        )
        item.traceability_qr_code = qr_result.get('qrcode')
    except Exception as e:
        logging.getLogger(__name__).warning(f"QR code generation failed for inventory item: {e}")

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
    transaction_dict = transaction_data.dict(exclude_unset=True)
    transaction_dict["operator"] = operator
    transaction_dict["total_amount"] = (transaction_dict.get("quantity") or 0) * (transaction_dict.get("unit_price") or 0)

    tx_item_data = {
        "item_id": item_id,
        "transaction_type": transaction_dict.get("transaction_type"),
        "quantity": transaction_dict.get("quantity"),
        "unit": transaction_dict.get("unit"),
        "unit_price": transaction_dict.get("unit_price"),
        "total_amount": transaction_dict["total_amount"],
        "operator": transaction_dict["operator"],
        "source_document": transaction_dict.get("source_document"),
        "remarks": transaction_dict.get("remarks"),
    }
    transaction = InventoryTransaction(**tx_item_data)
    db.add(transaction)
    
    if transaction_dict["transaction_type"] == "in":
        warehouse = db.query(Warehouse).filter(Warehouse.id == item.warehouse_id).first()
        if warehouse and warehouse.capacity:
            current_total = db.query(
                func.coalesce(func.sum(InventoryItem.quantity), 0)
            ).filter(InventoryItem.warehouse_id == item.warehouse_id).scalar()
            new_total = (current_total or 0) + transaction_dict["quantity"]
            if new_total > warehouse.capacity:
                raise HTTPException(
                    status_code=400,
                    detail=f"入库失败：仓库 {warehouse.name} 容量上限为 {warehouse.capacity}，当前总库存将达到 {new_total}"
                )
        if item.max_stock and (item.quantity + transaction_dict["quantity"]) > item.max_stock:
            raise HTTPException(
                status_code=400,
                detail=f"入库失败：入库后库存将达到 {item.quantity + transaction_dict['quantity']}kg，超过最高库存 {item.max_stock}kg"
            )
        old_qty = item.quantity or 0
        old_price = item.unit_price or 0
        tx_qty = transaction_dict["quantity"]
        tx_price = transaction_dict.get("unit_price")
        item.quantity = old_qty + tx_qty
        if tx_price is not None:
            old_total_value = old_qty * old_price
            new_total_value = tx_qty * tx_price
            item.unit_price = round((old_total_value + new_total_value) / item.quantity, 2) if item.quantity > 0 else tx_price
        elif item.unit_price is None:
            item.unit_price = 0
        item.total_value = round(item.quantity * (item.unit_price or 0), 2)
    elif transaction_dict["transaction_type"] == "out":
        if item.quantity < transaction_dict["quantity"]:
            raise HTTPException(status_code=400, detail=f"出库失败：库存不足，当前库存 {item.quantity}kg，申请出库 {transaction_dict['quantity']}kg")
        new_qty = item.quantity - transaction_dict["quantity"]
        if item.min_stock and new_qty < item.min_stock:
            raise HTTPException(status_code=400, detail=f"出库警告：出库后库存将降至 {new_qty}kg，低于最低库存线 {item.min_stock}kg")
        item.quantity = new_qty
        item.total_value = round(item.quantity * (item.unit_price or 0), 2)
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