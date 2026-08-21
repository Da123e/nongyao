from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import logging
from app.core.database import get_db
from app.models.sales import Customer, Order, OrderItem, LogisticsTracking
from app.models.auth import User
from app.auth import get_current_active_user, require_permission
from app.schemas import CustomerCreate, OrderCreate, LogisticsCreate
from datetime import datetime

router = APIRouter()


@router.get("/customers", response_model=List[dict])
async def get_customers(
    customer_type: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:query", current_user, db)
    
    query = db.query(Customer)
    if customer_type:
        query = query.filter(Customer.customer_type == customer_type)
    
    customers = query.all()
    return [
        {
            "id": c.id,
            "customer_code": c.customer_code,
            "name": c.name,
            "contact_name": c.contact_name,
            "phone": c.phone,
            "email": c.email,
            "address": c.address,
            "customer_type": c.customer_type,
            "credit_limit": c.credit_limit,
            "credit_balance": c.credit_balance,
            "is_active": c.is_active,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in customers
    ]


@router.post("/customers")
async def create_customer(
    customer_data: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)
    
    if db.query(Customer).filter(Customer.customer_code == customer_data.customer_code).first():
        raise HTTPException(status_code=400, detail="客户编码已存在")
    
    customer = Customer(**customer_data.dict())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    
    return {"message": "Customer created successfully", "customer_id": customer.id}


@router.get("/orders", response_model=List[dict])
async def get_orders(
    customer_id: int = None,
    status: str = None,
    payment_status: str = None,
    start_date: str = None,
    end_date: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:query", current_user, db)
    
    query = db.query(Order)
    if customer_id:
        query = query.filter(Order.customer_id == customer_id)
    if status:
        query = query.filter(Order.status == status)
    if payment_status:
        query = query.filter(Order.payment_status == payment_status)
    if start_date:
        query = query.filter(Order.order_date >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(Order.order_date <= datetime.fromisoformat(end_date))
    
    orders = query.order_by(Order.order_date.desc()).all()
    return [
        {
            "id": o.id,
            "order_no": o.order_no,
            "customer_id": o.customer_id,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
            "status": o.status,
            "total_amount": o.total_amount,
            "payment_status": o.payment_status,
            "payment_method": o.payment_method,
            "shipping_address": o.shipping_address,
            "shipping_method": o.shipping_method,
            "remarks": o.remarks,
        }
        for o in orders
    ]


@router.post("/orders")
async def create_order(
    order_data: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)

    if db.query(Order).filter(Order.order_no == order_data.order_no).first():
        raise HTTPException(status_code=400, detail="订单编号已存在")

    order = Order(**order_data.dict())
    db.add(order)
    db.commit()
    db.refresh(order)

    # 推送新订单通知给销售员和管理员
    try:
        from app.utils.notifications_helper import notify_new_order
        notify_new_order(
            db,
            order_no=order.order_no,
            store_name=getattr(order, "store_name", None),
            total_amount=getattr(order, "total_amount", None),
        )
        db.commit()
    except Exception as e:
        logging.getLogger(__name__).warning(f"notify_new_order failed: {e}")

    return {"message": "Order created successfully", "order_id": order.id}


@router.get("/orders/{order_id}", response_model=dict)
async def get_order_detail(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:query", current_user, db)
    
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    items = db.query(OrderItem).filter(OrderItem.order_id == order_id).all()
    logistics = db.query(LogisticsTracking).filter(LogisticsTracking.order_id == order_id).first()
    
    return {
        "id": order.id,
        "order_no": order.order_no,
        "customer_id": order.customer_id,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
        "status": order.status,
        "total_amount": order.total_amount,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "shipping_address": order.shipping_address,
        "shipping_method": order.shipping_method,
        "remarks": order.remarks,
        "items": [
            {
                "id": item.id,
                "item_code": item.item_code,
                "item_name": item.item_name,
                "batch_code": item.batch_code,
                "processing_batch_id": item.processing_batch_id,
                "quantity": item.quantity,
                "unit": item.unit,
                "unit_price": item.unit_price,
                "amount": item.amount,
                "product_grade": item.product_grade,
            }
            for item in items
        ],
        "logistics": {
            "id": logistics.id,
            "tracking_no": logistics.tracking_no,
            "carrier": logistics.carrier,
            "vehicle_no": logistics.vehicle_no,
            "driver_name": logistics.driver_name,
            "driver_phone": logistics.driver_phone,
            "status": logistics.status,
            "origin": logistics.origin,
            "destination": logistics.destination,
            "departure_time": logistics.departure_time.isoformat() if logistics.departure_time else None,
            "estimated_arrival_time": logistics.estimated_arrival_time.isoformat() if logistics.estimated_arrival_time else None,
            "current_location": logistics.current_location,
            "signer": logistics.signer,
            "sign_time": logistics.sign_time.isoformat() if logistics.sign_time else None,
        } if logistics else None,
    }


@router.put("/orders/{order_id}/status")
async def update_order_status(
    order_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)

    status = data.get("status")
    if not status:
        raise HTTPException(status_code=400, detail="状态为必填项")

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    order.updated_at = datetime.now()
    db.commit()

    return {"message": "Order status updated successfully", "status": status}


@router.post("/orders/{order_id}/logistics")
async def add_logistics(
    order_id: int,
    logistics_data: LogisticsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)
    
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    logistics = LogisticsTracking(order_id=order_id, **logistics_data.dict())
    db.add(logistics)
    db.commit()
    db.refresh(logistics)
    
    order.status = "shipped"
    order.updated_at = datetime.now()
    db.commit()
    
    return {"message": "Logistics tracking added successfully", "logistics_id": logistics.id}


@router.put("/logistics/{logistics_id}")
async def update_logistics(
    logistics_id: int,
    logistics_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)
    
    logistics = db.query(LogisticsTracking).filter(LogisticsTracking.id == logistics_id).first()
    if not logistics:
        raise HTTPException(status_code=404, detail="Logistics tracking not found")
    
    order = db.query(Order).filter(Order.id == logistics.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    allowed_fields = ['status', 'current_location', 'license_plate', 'driver_name', 'driver_phone']
    for key, value in logistics_data.items():
        if key in allowed_fields:
            setattr(logistics, key, value)
    
    logistics.updated_at = datetime.now()
    
    status_mapping = {
        "pending": "pending",
        "shipped": "shipped",
        "transit": "shipped",
        "arrived": "shipped",
        "delivered": "completed",
    }
    
    new_status = status_mapping.get(logistics.status)
    if new_status and order.status != new_status:
        status_priority = {"pending": 1, "shipped": 2, "completed": 3}
        current_priority = status_priority.get(order.status, 0)
        new_priority = status_priority.get(new_status, 0)
        
        if new_priority >= current_priority:
            order.status = new_status
            order.updated_at = datetime.now()
        else:
            raise HTTPException(status_code=400, detail=f"订单状态不能从 {order.status} 回退到 {new_status}")
    
    db.commit()
    
    return {"message": "Logistics tracking updated successfully"}


@router.get("/trace/{batch_code}", response_model=dict)
async def trace_by_batch(
    batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)
    
    from app.models.seed import SeedBatch, SeedSupplier
    from app.models.planting import PlantingRecord, Plot, FarmingActivity, EnvironmentalData
    from app.models.pesticide import PesticideApplication, Pesticide
    from app.models.inspection import InspectionReport, PesticideResidueTest
    from app.models.processing import ProcessingBatch, ProcessingRecord
    from app.models.inventory import InventoryItem
    from app.models.sales import OrderItem, Order
    
    seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not seed_batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    supplier = db.query(SeedSupplier).filter(SeedSupplier.id == seed_batch.supplier_id).first()
    
    planting_records = db.query(PlantingRecord).filter(PlantingRecord.batch_id == seed_batch.id).all()
    
    trace_data = {
        "seed_batch": {
            "batch_code": seed_batch.batch_code,
            "variety_name": seed_batch.variety_name,
            "breeding_base": seed_batch.breeding_base,
            "production_date": seed_batch.production_date.isoformat() if seed_batch.production_date else None,
            "net_weight": seed_batch.net_weight,
            "germination_rate": seed_batch.germination_rate,
            "purity": seed_batch.purity,
            "supplier": supplier.name if supplier else None,
            "status": seed_batch.status,
        },
        "planting": [],
        "pesticide_applications": [],
        "inspections": [],
        "processing": [],
        "inventory": [],
        "sales": [],
    }
    
    for record in planting_records:
        plot = db.query(Plot).filter(Plot.id == record.plot_id).first()
        activities = db.query(FarmingActivity).filter(FarmingActivity.plot_id == record.plot_id).all()
        env_data = db.query(EnvironmentalData).filter(EnvironmentalData.plot_id == record.plot_id).order_by(EnvironmentalData.record_time.desc()).limit(10).all()
        
        applications = db.query(PesticideApplication).filter(PesticideApplication.plot_id == record.plot_id).all()
        
        trace_data["planting"].append({
            "plot_code": plot.plot_code if plot else None,
            "plot_name": plot.name if plot else None,
            "location": plot.location if plot else None,
            "planting_date": record.planting_date.isoformat() if record.planting_date else None,
            "expected_harvest_date": record.expected_harvest_date.isoformat() if record.expected_harvest_date else None,
            "farmer": record.farmer,
            "status": record.status,
            "farming_activities": [
                {
                    "activity_type": a.activity_type,
                    "activity_date": a.activity_date.isoformat() if a.activity_date else None,
                    "description": a.description,
                }
                for a in activities
            ],
            "environmental_data": [
                {
                    "record_time": e.record_time.isoformat() if e.record_time else None,
                    "temperature": e.temperature,
                    "humidity": e.humidity,
                    "soil_moisture": e.soil_moisture,
                    "soil_temperature": e.soil_temperature,
                    "ph_value": e.ph_value,
                    "illumination": e.illumination,
                    "wind_speed": e.wind_speed,
                    "conductivity": e.conductivity,
                    "nitrogen": e.nitrogen,
                    "phosphorus": e.phosphorus,
                    "potassium": e.potassium,
                    "salinity": e.salinity,
                    "data_source": e.data_source,
                }
                for e in env_data
            ],
        })
        
        for app in applications:
            pesticide = db.query(Pesticide).filter(Pesticide.id == app.pesticide_id).first()
            trace_data["pesticide_applications"].append({
                "pesticide_name": pesticide.name if pesticide else None,
                "brand": pesticide.brand if pesticide else None,
                "registration_no": pesticide.registration_no if pesticide else None,
                "application_date": app.application_date.isoformat() if app.application_date else None,
                "dosage": app.dosage,
                "unit": app.unit,
                "applicator": app.applicator,
                "safety_interval_end": app.safety_interval_end.isoformat() if app.safety_interval_end else None,
                "is_compliant": app.is_compliant,
            })
    
    inspections = db.query(InspectionReport).filter(InspectionReport.batch_id == seed_batch.id).all()
    for insp in inspections:
        residues = db.query(PesticideResidueTest).filter(PesticideResidueTest.report_id == insp.id).all()
        trace_data["inspections"].append({
            "report_code": insp.report_code,
            "report_type": insp.report_type,
            "report_date": insp.report_date.isoformat() if insp.report_date else None,
            "inspector": insp.inspector,
            "inspection_agency": insp.inspection_agency,
            "is_qualified": insp.is_qualified,
            "pesticide_residues": [
                {
                    "test_item": r.test_item,
                    "limit_value": r.limit_value,
                    "measured_value": r.measured_value,
                    "unit": r.unit,
                    "is_over_limit": r.is_over_limit,
                }
                for r in residues
            ],
        })
    
    processing_batches = db.query(ProcessingBatch).filter(ProcessingBatch.seed_batch_id == seed_batch.id).all()
    for pb in processing_batches:
        records = db.query(ProcessingRecord).filter(ProcessingRecord.batch_id == pb.id).all()
        trace_data["processing"].append({
            "batch_code": pb.batch_code,
            "product_name": pb.product_name,
            "product_grade": pb.product_grade,
            "processing_date": pb.processing_date.isoformat() if pb.processing_date else None,
            "status": pb.status,
            "process_records": [
                {
                    "process_name": pr.process_name,
                    "process_order": pr.process_order,
                    "start_time": pr.start_time.isoformat() if pr.start_time else None,
                    "end_time": pr.end_time.isoformat() if pr.end_time else None,
                    "parameters": pr.parameters,
                    "operator": pr.operator,
                }
                for pr in records
            ],
        })
    
    processing_batch_codes = [pb.batch_code for pb in processing_batches]
    
    inventory_items = db.query(InventoryItem).filter(
        InventoryItem.batch_code.in_(processing_batch_codes) | 
        (InventoryItem.seed_batch_code == seed_batch.batch_code)
    ).all()
    for item in inventory_items:
        trace_data["inventory"].append({
            "item_code": item.item_code,
            "item_name": item.item_name,
            "quantity": item.quantity,
            "unit": item.unit,
            "status": item.status,
        })
    
    order_items = db.query(OrderItem).filter(
        OrderItem.batch_code.in_(processing_batch_codes) | 
        (OrderItem.seed_batch_code == batch_code)
    ).all()
    for oi in order_items:
        order = db.query(Order).filter(Order.id == oi.order_id).first()
        trace_data["sales"].append({
            "order_no": order.order_no if order else None,
            "item_name": oi.item_name,
            "quantity": oi.quantity,
            "unit": oi.unit,
            "unit_price": oi.unit_price,
            "order_date": order.order_date.isoformat() if order and order.order_date else None,
            "status": order.status if order else None,
        })
    
    return trace_data