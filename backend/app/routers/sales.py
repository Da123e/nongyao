from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
import logging
from app.core.database import get_db
from app.core.qrcode_generator import generate_trace_qrcode
from app.models.sales import Customer, Order, OrderItem, LogisticsTracking
from app.models.auth import User
from app.auth import get_current_active_user, require_permission
from app.schemas import CustomerCreate, OrderCreate, LogisticsCreate, OrderItemCreate
from datetime import datetime, timezone, timedelta
from app.core.timezone import now_cn_naive

logger = logging.getLogger(__name__)

router = APIRouter()

# ----------------------------------------------------------------------------
# 业务常量（物流 / 订单 状态机）
# ----------------------------------------------------------------------------
VALID_LOGISTICS_STATUSES = {
    "pending", "loading", "in_transit",
    "arrived", "delivered", "signed", "completed", "cancelled",
}

LOGISTICS_STATUS_TO_ORDER = {
    "pending": "pending",
    "loading": "paid",
    "in_transit": "shipped",
    "arrived": "shipped",
    "delivered": "completed",
    "signed": "completed",
    "completed": "completed",
    "cancelled": "cancelled",
}

VALID_ORDER_STATUSES = {
    "pending", "paid", "shipped", "completed", "cancelled", "refunded",
}

ORDER_STATUS_FLOW = ["pending", "paid", "shipped", "completed"]

ORDER_STATUS_PRIORITY = {
    "cancelled": 0, "refunded": 0,
    "pending":   1,
    "paid":      2,
    "shipped":   3,
    "completed": 4,
}


def _safe_cn_dt(value: Optional[datetime]) -> Optional[datetime]:
    """把 aware datetime (带 +08:00) 统一转换为 naive China-time,写入 DB.

    DB 列 / now_cn_default / now_cn_naive 统一使用 Asia/Shanghai naive datetime.
    """
    if value is None:
        return None
    if isinstance(value, datetime) and value.tzinfo is not None:
        offset = timezone(timedelta(hours=8))
        return value.astimezone(offset).replace(tzinfo=None)
    return value


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
    result = []
    for c in customers:
        order_count = db.query(Order).filter(Order.customer_id == c.id).count()
        total_spent = db.query(
            func.coalesce(func.sum(Order.total_amount), 0)
        ).filter(
            Order.customer_id == c.id,
            Order.status.in_(['paid', 'shipped', 'completed'])
        ).scalar() or 0
        result.append({
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
            "order_count": order_count,
            "total_spent": float(total_spent),
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return result


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


@router.get("/orders")
async def get_orders(
    customer_id: Optional[int] = None,
    status: Optional[str] = None,
    payment_status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=200, description="每页数量"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """销售订单分页列表（与 organizations / seed / processing / inspection 分页包装一致）。"""
    await require_permission("sales:query", current_user, db)

    query = db.query(Order)
    if customer_id:
        query = query.filter(Order.customer_id == customer_id)
    if status:
        query = query.filter(Order.status == status)
    if payment_status:
        query = query.filter(Order.payment_status == payment_status)
    if start_date:
        try:
            query = query.filter(Order.order_date >= _safe_cn_dt(datetime.fromisoformat(start_date)))
        except ValueError:
            raise HTTPException(status_code=422, detail="start_date 必须为 ISO8601 格式")
    if end_date:
        try:
            query = query.filter(Order.order_date <= _safe_cn_dt(datetime.fromisoformat(end_date)))
        except ValueError:
            raise HTTPException(status_code=422, detail="end_date 必须为 ISO8601 格式")

    total = query.count()
    orders = (
        query.order_by(Order.order_date.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    data = [
        {
            "id": o.id,
            "order_no": o.order_no,
            "customer_id": o.customer_id,
            "customer_name": o.customer.name if o.customer else None,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
            "status": o.status,
            "total_amount": o.total_amount,
            "payment_status": o.payment_status,
            "payment_method": o.payment_method,
            "shipping_address": o.shipping_address,
            "shipping_method": o.shipping_method,
            "remarks": o.remarks,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        }
        for o in orders
    ]
    return {
        "status": "success",
        "data": data,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
    }


@router.post("/orders")
async def create_order(
    order_data: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)

    if db.query(Order).filter(Order.order_no == order_data.order_no).first():
        raise HTTPException(status_code=400, detail="订单编号已存在")

    # 非法状态校验
    if order_data.status and order_data.status not in VALID_ORDER_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"订单状态非法,允许值: {sorted(VALID_ORDER_STATUSES)}",
        )

    # 后端强制重算 total_amount = sum(quantity * unit_price),不信任前端传值
    items = getattr(order_data, "items", None) or []
    recalculated_total = 0.0
    for it in items:
        try:
            qty = float(getattr(it, "quantity", 0) or 0)
            price = getattr(it, "unit_price", None)
            if price is None:
                continue
            recalculated_total += qty * float(price)
        except (TypeError, ValueError):
            continue
    recalculated_total = round(recalculated_total, 2) if items else (order_data.total_amount or 0)

    payload = order_data.dict(exclude={"total_amount"})
    payload["order_date"] = _safe_cn_dt(payload.get("order_date"))
    payload["delivery_date"] = _safe_cn_dt(payload.get("delivery_date"))
    order = Order(total_amount=recalculated_total, **payload)
    db.add(order)
    try:
        db.commit()
        db.refresh(order)
    except Exception as e:
        db.rollback()
        logger.exception("创建订单失败 order_no=%s: %s", order_data.order_no, e)
        raise HTTPException(status_code=500, detail="创建订单失败")

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
        logger.warning("notify_new_order failed order_id=%s: %s", order.id, e)
        db.rollback()

    return {"message": "Order created successfully", "order_id": order.id, "total_amount": order.total_amount}


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
    # 一个 Order 可关联多个运单，按创建时间倒序返回
    logistics_list = (
        db.query(LogisticsTracking)
        .filter(LogisticsTracking.order_id == order_id)
        .order_by(LogisticsTracking.created_at.desc(), LogisticsTracking.id.desc())
        .all()
    )

    # 为每个 item 回填 processing_batch_code + seed_batch_code
    # ProcessingBatch 可再 JOIN SeedBatch 兜底
    from app.models.processing import ProcessingBatch
    from app.models.seed import SeedBatch

    def _pb_and_sb(pb_id: Optional[int]):
        if not pb_id:
            return None, None, None
        pb = db.query(ProcessingBatch).filter(ProcessingBatch.id == pb_id).first()
        if not pb:
            return None, None, None
        sb_code = getattr(pb, "seed_batch_code", None)
        sb_id = getattr(pb, "seed_batch_id", None)
        if not sb_code and sb_id:
            sb = db.query(SeedBatch).filter(SeedBatch.id == sb_id).first()
            sb_code = sb.batch_code if sb else None
        return pb.batch_code, sb_code, pb.product_name

    items_list = []
    for item in items:
        pb_code, sb_code, product_name = _pb_and_sb(item.processing_batch_id)
        # OrderItem 行内 seed_batch_code 优先级最高 (add_order_item 写入的)
        effective_sb = item.seed_batch_code or sb_code
        effective_pb = item.batch_code or pb_code
        items_list.append({
            "id": item.id,
            "item_code": item.item_code,
            "item_name": item.item_name,
            "batch_code": effective_pb,
            "processing_batch_code": effective_pb,
            "processing_batch_id": item.processing_batch_id,
            "seed_batch_code": effective_sb,   # 前端溯源按钮按此字段 navigate
            "product_name": product_name,
            "quantity": item.quantity,
            "unit": item.unit,
            "unit_price": item.unit_price,
            "amount": item.amount,
            "product_grade": item.product_grade,
            "traceability_qr_code": getattr(item, "traceability_qr_code", None),
            "created_at": item.created_at.isoformat() if getattr(item, "created_at", None) else None,
        })

    customer_name = order.customer.name if order.customer else None
    logistics_resp = [
        {
            "id": lg.id,
            "tracking_no": lg.tracking_no,
            "carrier": lg.carrier,
            "vehicle_no": getattr(lg, "vehicle_no", None),
            "driver_name": lg.driver_name,
            "driver_phone": getattr(lg, "driver_phone", None),
            "status": lg.status,
            "origin": lg.origin,
            "destination": lg.destination,
            "departure_time": lg.departure_time.isoformat() if lg.departure_time else None,
            "estimated_arrival_time": lg.estimated_arrival_time.isoformat() if lg.estimated_arrival_time else None,
            "current_location": lg.current_location,
            "signer": lg.signer,
            "sign_time": lg.sign_time.isoformat() if lg.sign_time else None,
            "remarks": getattr(lg, "remarks", None),
            "created_at": lg.created_at.isoformat() if getattr(lg, "created_at", None) else None,
            "updated_at": lg.updated_at.isoformat() if getattr(lg, "updated_at", None) else None,
        }
        for lg in logistics_list
    ]

    return {
        "id": order.id,
        "order_no": order.order_no,
        "customer_id": order.customer_id,
        "customer_name": customer_name,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
        "status": order.status,
        "total_amount": order.total_amount,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "shipping_address": order.shipping_address,
        "shipping_method": order.shipping_method,
        "remarks": order.remarks,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
        "items": items_list,
        # 保持 logistics=第一条 + 新增 logistics_list 全量
        "logistics": logistics_resp[0] if logistics_resp else None,
        "logistics_list": logistics_resp,
    }


@router.post("/orders/{order_id}/items")
async def add_order_item(
    order_id: int,
    request: Request,
    item_data: OrderItemCreate,
    url_prefix: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """为订单添加商品明细，并同步生成溯源二维码写入 traceability_qr_code 字段。

    二维码 payload 为可被手机浏览器直接打开的 URL：/trace/public?batch=<batch_code>，
    消费者扫码即可跳转至公开溯源页，无需登录。
    生成失败时仅记录 warning，不阻断主流程（参考 processing.py L41-67 容错范式）。
    """
    await require_permission("sales:manage", current_user, db)

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # 确定用于溯源二维码的批次编码：优先加工批次编码，其次种子批次编码
    trace_batch_code = item_data.batch_code or item_data.seed_batch_code

    qr_data_uri = None
    if trace_batch_code:
        try:
            forwarded_scheme = request.headers.get("X-Forwarded-Proto") or request.url.scheme
            forwarded_host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
            # payload 归一化：优先显式填写的种子批次；否则把加工批次反查归一化为种子批次，
            # 保证二维码 payload 始终是消费者扫码可直接命中的 PB-xxx 编码
            from app.core.batch_resolver import resolve_seed_batch_code
            qr_payload_batch = item_data.seed_batch_code or resolve_seed_batch_code(trace_batch_code, db)
            qr_result = generate_trace_qrcode(
                trace_batch_code,
                qr_payload_batch or trace_batch_code,
                url_prefix=url_prefix,
                request_host=forwarded_host,
                request_scheme=forwarded_scheme,
                mode='public',
            )
            qr_data_uri = qr_result.get('qrcode')
        except Exception as e:
            logger.warning("生成订单商品溯源二维码失败 order_id=%s batch=%s: %s", order_id, trace_batch_code, e)
            qr_data_uri = None

    # 计算金额 = 数量 × 单价（若提供单价）
    amount = None
    if item_data.unit_price is not None:
        amount = round(item_data.quantity * item_data.unit_price, 2)

    order_item = OrderItem(
        order_id=order_id,
        item_code=item_data.item_code,
        item_name=item_data.item_name,
        batch_code=item_data.batch_code,
        seed_batch_code=item_data.seed_batch_code,
        processing_batch_id=item_data.processing_batch_id,
        quantity=item_data.quantity,
        unit=item_data.unit,
        unit_price=item_data.unit_price,
        amount=amount,
        product_grade=item_data.product_grade,
        traceability_qr_code=qr_data_uri,
    )
    db.add(order_item)

    # 同步更新订单总金额（累加商品金额）
    if amount is not None:
        order.total_amount = (order.total_amount or 0) + amount
        order.updated_at = now_cn_naive()

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("添加订单商品失败 order_id=%s: %s", order_id, e)
        raise HTTPException(status_code=500, detail="添加订单商品失败")
    db.refresh(order_item)

    return {
        "message": "Order item added successfully",
        "item_id": order_item.id,
        "traceability_qr_code": qr_data_uri,
        "amount": amount,
        "total_amount": order.total_amount,
    }


@router.put("/orders/{order_id}/status")
async def update_order_status(
    order_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("sales:manage", current_user, db)

    new_status = data.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="状态为必填项")

    if new_status not in VALID_ORDER_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"订单状态非法,允许值: {sorted(VALID_ORDER_STATUSES)}",
        )

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    old_status = order.status
    if order.status == new_status:
        return {"message": "Order status unchanged", "status": new_status}

    # 单向守卫: 防止 completed -> pending 非法回退
    cur_priority = ORDER_STATUS_PRIORITY.get(order.status, 0)
    new_priority = ORDER_STATUS_PRIORITY.get(new_status, 0)
    if new_priority < cur_priority and new_status not in ("cancelled", "refunded"):
        raise HTTPException(
            status_code=409,
            detail=f"订单状态不能从 {order.status} 回退到 {new_status}",
        )

    order.status = new_status
    order.updated_at = now_cn_naive()

    # 自动同步支付状态
    if new_status == 'paid' and order.payment_status != 'paid':
        order.payment_status = 'paid'
    elif new_status == 'cancelled' and order.payment_status == 'paid':
        order.payment_status = 'refund_pending'
    elif new_status == 'refunded':
        order.payment_status = 'refunded'

    try:
        db.commit()
        db.refresh(order)
    except Exception as e:
        db.rollback()
        logger.exception("更新订单状态失败 order_id=%s status=%s: %s", order_id, new_status, e)
        raise HTTPException(status_code=500, detail="更新订单状态失败")

    # 推送订单状态变更通知
    try:
        from app.utils.notifications_helper import (
            notify_order_status_changed, notify_order_cancelled
        )
        operator = current_user.username if current_user else None
        if new_status == "cancelled":
            customer_name = order.customer.name if order.customer else None
            notify_order_cancelled(db, order.order_no, customer_name, operator)
        else:
            notify_order_status_changed(db, order.order_no, old_status, new_status, operator)
        db.commit()
    except Exception as e:
        logger.warning("订单状态通知失败 order_id=%s: %s", order_id, e)
        db.rollback()

    return {"message": "Order status updated successfully", "status": new_status}


def _deduct_inventory_for_order(
    db: Session,
    order: Order,
    operator_name: str,
    tracking_ref: str,
):
    """发货扣减库存: 对 Order 中每个 item (有 processing_batch_id 或 batch_code) 找库存出库,并写入 InventoryTransaction.

    库存不足时抛 HTTPException(409), 调用方负责 rollback.
    """
    from app.models.inventory import InventoryItem, InventoryTransaction

    items = db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    low_stock_alerts = []
    stock_out_alerts = []
    for it in items:
        qty = float(it.quantity or 0)
        if qty <= 0 or not (it.processing_batch_id or it.batch_code or it.seed_batch_code):
            continue

        q = db.query(InventoryItem)
        if it.processing_batch_id:
            q = q.filter(InventoryItem.processing_batch_id == it.processing_batch_id)
        elif it.batch_code:
            q = q.filter(InventoryItem.batch_code == it.batch_code)
        else:
            q = q.filter(InventoryItem.seed_batch_code == it.seed_batch_code)
        inv = q.first()
        if not inv:
            logger.warning(
                "发货扣库存未找到对应库存项 order_id=%s processing_batch_id=%s batch=%s seed=%s",
                order.id, it.processing_batch_id, it.batch_code, it.seed_batch_code,
            )
            continue

        available = float(inv.quantity or 0)
        if available < qty:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"库存不足: 商品 {it.item_name or inv.item_name} "
                    f"现有 {available}{it.unit or inv.unit or ''}, 需要 {qty}"
                ),
            )

        old_qty = inv.quantity
        inv.quantity = round(available - qty, 4)
        unit = it.unit or inv.unit or 'kg'
        item_code = it.item_code or inv.item_code or ''
        item_name = it.item_name or inv.item_name or ''

        if inv.quantity <= 0:
            inv.status = "out_of_stock"
            stock_out_alerts.append((item_code, item_name, unit))
        elif inv.min_stock is not None and inv.quantity <= float(inv.min_stock):
            inv.status = "low_stock"
            low_stock_alerts.append((item_code, item_name, inv.quantity, inv.min_stock, unit))
        inv.updated_at = now_cn_naive()

        tx = InventoryTransaction(
            item_id=inv.id,
            transaction_type="out",
            quantity=qty,
            unit=unit,
            unit_price=float(it.unit_price) if it.unit_price is not None else inv.unit_price,
            total_amount=float(it.amount) if it.amount is not None else (
                round(qty * (inv.unit_price or 0), 2)
            ),
            transaction_date=now_cn_naive(),
            operator=operator_name,
            source_document="sales_order",
            source_document_no=(order.order_no or "") + (f"|{tracking_ref}" if tracking_ref else ""),
            remarks=f"订单发货自动扣库存 order_id={order.id}" + (f" tracking={tracking_ref}" if tracking_ref else ""),
        )
        db.add(tx)

    # 发送库存变动通知（不阻塞主事务）
    if low_stock_alerts or stock_out_alerts:
        try:
            from app.utils.notifications_helper import (
                notify_inventory_low_stock, notify_stock_out
            )
            for code, name, qty, threshold, unit in low_stock_alerts:
                notify_inventory_low_stock(db, code, name, qty, threshold, unit)
            for code, name, unit in stock_out_alerts:
                notify_stock_out(db, code, name, unit)
            db.commit()
        except Exception as e:
            logger.warning("库存预警通知失败 order_id=%s: %s", order.id, e)
            db.rollback()


@router.post("/orders/{order_id}/logistics")
async def add_logistics(
    order_id: int,
    logistics_data: LogisticsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("logistics:manage", current_user, db)

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    payload = logistics_data.dict()
    # 兼容 license_plate 字段，统一映射到 vehicle_no
    if "vehicle_no" not in payload or not payload["vehicle_no"]:
        payload["vehicle_no"] = payload.pop("license_plate", None) or payload.get("vehicle_no")
    if not payload.get("vehicle_no") and "license_plate" in logistics_data.__fields_set__:
        pass

    req_status = payload.get("status") or "pending"
    if req_status not in VALID_LOGISTICS_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"物流状态非法,允许值: {sorted(VALID_LOGISTICS_STATUSES)}",
        )
    payload["status"] = req_status

    if req_status in {"delivered", "signed", "completed"} and not payload.get("sign_time"):
        payload["sign_time"] = now_cn_naive()

    logistics = LogisticsTracking(order_id=order_id, **{k: v for k, v in payload.items() if hasattr(LogisticsTracking, k)})
    if not logistics.tracking_no:
        raise HTTPException(status_code=422, detail="运单号 tracking_no 必填")
    db.add(logistics)

    first_order_status = LOGISTICS_STATUS_TO_ORDER.get(req_status)
    if first_order_status:
        _apply_order_status_forward(order, first_order_status)

    if req_status in {"in_transit", "arrived", "delivered", "signed", "completed"}:
        _deduct_inventory_for_order(db, order, current_user.username, logistics.tracking_no)

    try:
        db.commit()
        db.refresh(logistics)
        db.refresh(order)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception("创建物流单失败 order_id=%s tracking=%s: %s", order_id, payload.get("tracking_no"), e)
        raise HTTPException(status_code=500, detail="创建物流单失败")

    # 推送物流单创建通知
    try:
        from app.utils.notifications_helper import notify_logistics_created
        operator = current_user.username if current_user else None
        notify_logistics_created(
            db,
            tracking_no=logistics.tracking_no,
            order_no=order.order_no,
            carrier=logistics.carrier,
            operator=operator,
        )
        db.commit()
    except Exception as e:
        logger.warning("物流创建通知失败 tracking=%s: %s", logistics.tracking_no, e)
        db.rollback()

    # 若订单状态有变化,同时推送订单状态通知
    try:
        from app.utils.notifications_helper import notify_order_status_changed
        if order.status != "pending":
            notify_order_status_changed(
                db, order.order_no, "pending", order.status,
                current_user.username if current_user else None,
            )
            db.commit()
    except Exception as e:
        logger.warning("订单状态通知失败 order=%s: %s", order.order_no, e)
        db.rollback()

    return {"message": "Logistics tracking added successfully", "logistics_id": logistics.id}


def _apply_order_status_forward(order: Order, target_status: str) -> None:
    """推进订单状态,强制经过合法流程（pending→paid→shipped→completed）。

    cancelled / refunded 可由任意状态直接进入。
    """
    if not target_status:
        return

    if target_status in ("cancelled", "refunded"):
        order.status = target_status
        order.updated_at = now_cn_naive()
        return

    if order.status == target_status:
        return

    cur_idx = ORDER_STATUS_FLOW.index(order.status) if order.status in ORDER_STATUS_FLOW else -1
    new_idx = ORDER_STATUS_FLOW.index(target_status) if target_status in ORDER_STATUS_FLOW else -1

    if new_idx > cur_idx:
        order.status = target_status
        order.updated_at = now_cn_naive()


@router.put("/logistics/{logistics_id}")
async def update_logistics(
    logistics_id: int,
    logistics_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("logistics:manage", current_user, db)

    logistics = db.query(LogisticsTracking).filter(LogisticsTracking.id == logistics_id).first()
    if not logistics:
        raise HTTPException(status_code=404, detail="Logistics tracking not found")

    order = db.query(Order).filter(Order.id == logistics.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    old_logistics_status = logistics.status
    old_order_status = order.status

    allowed_fields = [
        "status", "current_location",
        "vehicle_no", "driver_name", "driver_phone",
        "carrier", "origin", "destination",
        "departure_time", "estimated_arrival_time",
        "signer", "sign_time", "remarks",
        "transit_records", "temperature_records", "gps_records",
    ]

    new_status = logistics.status
    if "status" in logistics_data:
        new_status = logistics_data.get("status")
        if new_status is not None and new_status not in VALID_LOGISTICS_STATUSES:
            raise HTTPException(
                status_code=422,
                detail=f"物流状态非法,允许值: {sorted(VALID_LOGISTICS_STATUSES)}",
            )

    for key, value in logistics_data.items():
        if key == "license_plate":
            key, value = "vehicle_no", value
        if key in allowed_fields:
            if key in {"departure_time", "estimated_arrival_time", "sign_time"} and value is not None:
                if isinstance(value, str):
                    try:
                        value = datetime.fromisoformat(value)
                    except ValueError:
                        raise HTTPException(status_code=422, detail=f"{key} 必须为 ISO8601 格式")
                value = _safe_cn_dt(value)
            if key in {"transit_records", "temperature_records", "gps_records"} and value is not None and not isinstance(value, str):
                import json as _json
                try:
                    value = _json.dumps(value, ensure_ascii=False)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=422, detail=f"{key} JSON 序列化失败")
            setattr(logistics, key, value)

    logistics.updated_at = now_cn_naive()

    if new_status in {"delivered", "signed", "completed"} and logistics.sign_time is None:
        logistics.sign_time = now_cn_naive()
        if not logistics.signer and getattr(current_user, "username", None):
            logistics.signer = current_user.username

    target_order_status = LOGISTICS_STATUS_TO_ORDER.get(new_status)
    if target_order_status:
        cur_idx = ORDER_STATUS_FLOW.index(order.status) if order.status in ORDER_STATUS_FLOW else -1
        new_idx = ORDER_STATUS_FLOW.index(target_order_status) if target_order_status in ORDER_STATUS_FLOW else -1

        if target_order_status in ("cancelled", "refunded"):
            if order.status not in ("cancelled", "refunded"):
                order.status = target_order_status
                order.updated_at = now_cn_naive()
        elif new_idx != -1 and cur_idx != -1:
            if new_idx < cur_idx:
                raise HTTPException(
                    status_code=409,
                    detail=f"订单状态不能从 {order.status} 回退到 {target_order_status}",
                )
            if new_idx > cur_idx:
                order.status = target_order_status
                order.updated_at = now_cn_naive()

    shipping_statuses = {"in_transit", "arrived", "delivered", "signed", "completed"}
    was_shipped = old_order_status in {"shipped", "completed"}
    if new_status in shipping_statuses and not was_shipped:
        _deduct_inventory_for_order(db, order, current_user.username, logistics.tracking_no)

    try:
        db.commit()
        db.refresh(logistics)
        db.refresh(order)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception("更新物流单失败 logistics_id=%s: %s", logistics_id, e)
        raise HTTPException(status_code=500, detail="更新物流单失败")

    # 推送物流状态变更通知
    operator = current_user.username if current_user else None
    try:
        from app.utils.notifications_helper import (
            notify_logistics_status_changed, notify_order_status_changed
        )
        if new_status != old_logistics_status:
            notify_logistics_status_changed(
                db,
                tracking_no=logistics.tracking_no,
                order_no=order.order_no,
                old_status=old_logistics_status,
                new_status=new_status,
                current_location=logistics.current_location,
                operator=operator,
            )
        if order.status != old_order_status and old_order_status not in ("cancelled", "refunded"):
            notify_order_status_changed(
                db, order.order_no, old_order_status, order.status, operator,
            )
        db.commit()
    except Exception as e:
        logger.warning("物流状态通知失败 logistics_id=%s: %s", logistics_id, e)
        db.rollback()

    return {"message": "Logistics tracking updated successfully"}


@router.get("/logistics")
async def list_logistics(
    tracking_no: str | None = None,
    carrier: str | None = None,
    status: str | None = None,
    order_id: int | None = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """物流运输全局列表视图（SalesManage 第 3 Tab 数据源，权限 logistics:query）。"""
    await require_permission("logistics:query", current_user, db)

    query = db.query(LogisticsTracking)
    if tracking_no:
        query = query.filter(LogisticsTracking.tracking_no.like(f"%{tracking_no}%"))
    if carrier:
        query = query.filter(LogisticsTracking.carrier.like(f"%{carrier}%"))
    if status:
        query = query.filter(LogisticsTracking.status == status)
    if order_id:
        query = query.filter(LogisticsTracking.order_id == order_id)

    total = query.count()
    rows = query.order_by(LogisticsTracking.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "status": "success",
        "count": total,
        "page": page,
        "page_size": page_size,
        "data": [
            {
                "id": r.id,
                "order_id": r.order_id,
                "order_no": r.order.order_no if (r.order_id and r.order) else None,
                "customer_id": (r.order.customer_id) if (r.order_id and r.order) else None,
                "customer_name": (r.order.customer.name) if (r.order_id and r.order and r.order.customer) else None,
                "tracking_no": r.tracking_no,
                "carrier": r.carrier,
                "vehicle_no": getattr(r, "vehicle_no", None),
                "driver_name": r.driver_name,
                "driver_phone": getattr(r, "driver_phone", None),
                "status": r.status,
                "origin": r.origin,
                "destination": r.destination,
                "departure_time": r.departure_time.isoformat() if r.departure_time else None,
                "estimated_arrival_time": r.estimated_arrival_time.isoformat() if r.estimated_arrival_time else None,
                "current_location": r.current_location,
                "remarks": getattr(r, "remarks", None),
                "created_at": r.created_at.isoformat() if getattr(r, "created_at", None) else None,
                "updated_at": r.updated_at.isoformat() if getattr(r, "updated_at", None) else None,
            }
            for r in rows
        ],
    }


async def _build_trace_data(batch_code: str, db: Session) -> dict:
    from app.models.seed import SeedBatch, SeedSupplier
    from app.models.planting import PlantingRecord, Plot, FarmingActivity, EnvironmentalData
    from app.models.pesticide import PesticideApplication, Pesticide
    from app.models.inspection import InspectionReport, PesticideResidueTest
    from app.models.processing import ProcessingBatch, ProcessingRecord
    from app.models.inventory import InventoryItem
    from app.models.sales import OrderItem, Order
    from app.core.batch_resolver import resolve_seed_batch_code

    # 溯源编码归一化：二维码 payload 可能写入 PRC 加工批次 / ITM·INV 库存编码，
    # 统一解析为种子批次编码，保证消费者扫任意码均可命中（不命中则维持原 404 行为）
    batch_code = resolve_seed_batch_code(batch_code, db)

    seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not seed_batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    supplier = db.query(SeedSupplier).filter(SeedSupplier.id == seed_batch.supplier_id).first()

    # 关联条件统一：同时兼容 batch_id(FK) 和 seed_batch_code(字符串) 两种写法
    planting_records = db.query(PlantingRecord).filter(
        or_(
            PlantingRecord.batch_id == seed_batch.id,
            PlantingRecord.seed_batch_code == batch_code,
        )
    ).all()
    plot_ids = [pr.plot_id for pr in planting_records]

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
        activities = db.query(FarmingActivity).filter(
            or_(
                FarmingActivity.plot_id == record.plot_id,
                FarmingActivity.seed_batch_code == batch_code,
            )
        ).all()
        env_data = db.query(EnvironmentalData).filter(
            or_(
                EnvironmentalData.plot_id == record.plot_id,
                EnvironmentalData.seed_batch_code == batch_code,
            )
        ).order_by(EnvironmentalData.record_time.desc()).limit(10).all()

        applications = db.query(PesticideApplication).filter(
            or_(
                PesticideApplication.plot_id == record.plot_id,
                PesticideApplication.seed_batch_code == batch_code,
            )
        ).all()

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

    processing_batches = db.query(ProcessingBatch).filter(
        or_(
            ProcessingBatch.seed_batch_id == seed_batch.id,
            ProcessingBatch.seed_batch_code == batch_code,
        )
    ).all()
    processing_batch_ids = [pb.id for pb in processing_batches]

    inspections = db.query(InspectionReport).filter(
        or_(
            InspectionReport.batch_id == seed_batch.id,
            InspectionReport.seed_batch_code == batch_code,
            InspectionReport.processing_batch_id.in_(processing_batch_ids) if processing_batch_ids else False,
            InspectionReport.plot_id.in_(plot_ids) if plot_ids else False,
        )
    ).all()
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
        or_(
            InventoryItem.seed_batch_code == seed_batch.batch_code,
            InventoryItem.batch_code.in_(processing_batch_codes) if processing_batch_codes else False,
        )
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
        or_(
            OrderItem.seed_batch_code == batch_code,
            OrderItem.batch_code.in_(processing_batch_codes) if processing_batch_codes else False,
        )
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


@router.get("/trace/{batch_code}", response_model=dict)
async def trace_by_batch(
    batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)
    return await _build_trace_data(batch_code, db)


@router.get("/public/trace/{batch_code}", response_model=dict)
async def public_trace_by_batch(
    batch_code: str,
    db: Session = Depends(get_db),
):
    return await _build_trace_data(batch_code, db)