"""
通知生成工具模块：业务操作（订单/检测/种子/库存/农药/物流）发生时，
自动向相关角色用户推送通知。
"""
from sqlalchemy.orm import Session
from app.models.auth import User, UserRole, Role, Notification
from datetime import datetime
from typing import Optional, List
from app.core.timezone import now_cn_naive


def _notify_user_id(
    db: Session,
    user_id: int,
    type: str,
    title: str,
    message: str,
) -> None:
    """为指定用户创建一条通知（不立即 commit,由调用方决定事务边界）"""
    n = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        read=False,
        created_at=now_cn_naive(),
    )
    db.add(n)


def create_notification(
    db: Session,
    user_id: int,
    type: str,
    title: str,
    message: str,
) -> None:
    """
    为单个用户创建一条通知
    :param db: 数据库会话
    :param user_id: 接收通知的用户 ID
    :param type: 通知类型 (warning / info / success)
    :param title: 通知标题
    :param message: 通知正文
    """
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        read=False,
        created_at=now_cn_naive(),
    )
    db.add(notification)


def notify_role_users(
    db: Session,
    role_name: str,
    type: str,
    title: str,
    message: str,
) -> int:
    """
    向某个角色的所有用户推送通知
    :param role_name: 角色名称 (admin / farmer / inspector / warehouse_manager / salesperson)
    :return: 通知发送数量
    """
    users = (
        db.query(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .filter(Role.name == role_name, User.is_active == True)
        .all()
    )
    for u in users:
        create_notification(db, u.id, type, title, message)
    return len(users)


def notify_admins(
    db: Session,
    type: str,
    title: str,
    message: str,
) -> int:
    """向所有管理员推送通知"""
    return notify_role_users(db, "admin", type, title, message)


def notify_inventory_low_stock(
    db: Session,
    item_code: str,
    item_name: str,
    current_qty: float,
    threshold: float,
    unit: str = "kg",
) -> int:
    """
    库存低于阈值时通知仓管员和管理员
    :return: 通知发送数量
    """
    title = "库存预警"
    message = (
        f"商品 {item_name}（编码 {item_code}）当前库存 {current_qty} {unit}，"
        f"已低于预警阈值 {threshold} {unit}，请及时补货。"
    )
    n1 = notify_role_users(db, "warehouse_manager", "warning", title, message)
    n2 = notify_admins(db, "warning", title, message)
    return n1 + n2


def notify_new_order(
    db: Session,
    order_no: str,
    store_name: Optional[str],
    total_amount: Optional[float],
) -> int:
    """新订单创建时通知销售员和管理员"""
    store = store_name or "客户"
    amount = f"，金额 ¥{total_amount}" if total_amount is not None else ""
    title = "新订单通知"
    message = f"新订单已创建（{order_no}，客户：{store}{amount}），请及时跟进。"
    n1 = notify_role_users(db, "salesperson", "success", title, message)
    n2 = notify_admins(db, "success", title, message)
    return n1 + n2


def notify_inspection_report(
    db: Session,
    report_code: str,
    report_type: str,
    is_qualified: bool,
) -> int:
    """
    检测报告创建时通知
    - 合格：通知管理员和检测员（info）
    - 不合格：通知管理员和检测员（warning）
    """
    title = "检测报告通知"
    if is_qualified:
        type_ = "success"
        message = f"检测报告 {report_code}（{report_type}）已生成，判定为合格。"
    else:
        type_ = "warning"
        message = (
            f"检测报告 {report_code}（{report_type}）判定为不合格，"
            f"请立即核查相关批次产品，暂停出库。"
        )
    n1 = notify_role_users(db, "inspector", type_, title, message)
    n2 = notify_admins(db, type_, title, message)
    return n1 + n2


def notify_seed_batch_registered(
    db: Session,
    batch_code: str,
    variety_name: Optional[str],
    uploader: Optional[str],
) -> int:
    """种子批次注册上链时通知管理员"""
    variety = f"，品种：{variety_name}" if variety_name else ""
    title = "种子批次上链"
    message = f"种子批次 {batch_code}{variety} 已成功登记上链，操作人：{uploader or '系统'}。"
    return notify_admins(db, "info", title, message)


def notify_pesticide_applied(
    db: Session,
    plot_code: str,
    pesticide_name: str,
    applicator: Optional[str],
    safety_interval_end: Optional[datetime],
) -> int:
    """农药施用记录创建时通知管理员"""
    title = "农药施用记录"
    safety = ""
    if safety_interval_end:
        safety = f"，安全间隔期至 {safety_interval_end.strftime('%Y-%m-%d')}"
    message = (
        f"地块 {plot_code} 已施用农药 {pesticide_name}，"
        f"施药人：{applicator or '未知'}{safety}。"
    )
    return notify_admins(db, "warning", title, message)


def notify_processing_batch_created(
    db: Session,
    batch_code: str,
    product_name: Optional[str],
    product_grade: Optional[str],
    operator: Optional[str],
) -> int:
    """加工批次创建时通知管理员"""
    title = "加工批次通知"
    product = f"，产品：{product_name}" if product_name else ""
    grade = f"（{product_grade}）" if product_grade else ""
    message = (
        f"加工批次 {batch_code} 已创建{product}{grade}，"
        f"操作人：{operator or '系统'}。"
    )
    return notify_admins(db, "info", title, message)


def notify_processing_batch_completed(
    db: Session,
    batch_code: str,
    product_name: Optional[str],
    output_quantity: Optional[float],
    operator: Optional[str],
) -> int:
    """加工批次完成入库时通知管理员和仓储管理员"""
    title = "加工完成入库通知"
    product = f"，产品：{product_name}" if product_name else ""
    qty = f"，产量：{output_quantity}kg" if output_quantity else ""
    message = (
        f"加工批次 {batch_code} 已完成{product}{qty}并自动入库，"
        f"操作人：{operator or '系统'}。"
    )
    warehouse = notify_role_users(db, "warehouse_manager", "success", title, message)
    admin = notify_admins(db, "success", title, message)
    return warehouse + admin


def notify_order_status_changed(
    db: Session,
    order_no: str,
    old_status: str,
    new_status: str,
    operator: Optional[str],
) -> int:
    """订单状态变更时通知销售员和管理员"""
    status_labels = {
        "pending": "待处理",
        "paid": "已付款",
        "shipped": "已发货",
        "completed": "已完成",
        "cancelled": "已取消",
        "refunded": "已退款",
    }
    title = "订单状态变更"
    old_label = status_labels.get(old_status, old_status)
    new_label = status_labels.get(new_status, new_status)
    message = (
        f"订单 {order_no} 状态已从「{old_label}」变更为「{new_label}」，"
        f"操作人：{operator or '系统'}。"
    )
    n1 = notify_role_users(db, "salesperson", "info", title, message)
    n2 = notify_admins(db, "info", title, message)
    return n1 + n2


def notify_logistics_created(
    db: Session,
    tracking_no: str,
    order_no: str,
    carrier: Optional[str],
    operator: Optional[str],
) -> int:
    """物流单创建时通知管理员、仓管员和销售员"""
    title = "物流单创建通知"
    carrier_info = f"，承运商：{carrier}" if carrier else ""
    message = (
        f"订单 {order_no} 的物流单（{tracking_no}）已创建{carrier_info}，"
        f"操作人：{operator or '系统'}。"
    )
    warehouse = notify_role_users(db, "warehouse_manager", "info", title, message)
    sales = notify_role_users(db, "salesperson", "info", title, message)
    admin = notify_admins(db, "info", title, message)
    return warehouse + sales + admin


def notify_logistics_status_changed(
    db: Session,
    tracking_no: str,
    order_no: str,
    old_status: str,
    new_status: str,
    current_location: Optional[str],
    operator: Optional[str],
) -> int:
    """物流状态变更时通知销售员、仓管员和管理员"""
    status_labels = {
        "pending": "待发货",
        "loading": "装载中",
        "in_transit": "运输中",
        "arrived": "已到达",
        "delivered": "已派送",
        "signed": "已签收",
        "completed": "已完成",
        "cancelled": "已取消",
    }
    title = "物流状态变更"
    old_label = status_labels.get(old_status, old_status)
    new_label = status_labels.get(new_status, new_status)
    location = f"，当前位置：{current_location}" if current_location else ""
    message = (
        f"物流单 {tracking_no}（订单 {order_no}）状态已从「{old_label}」"
        f"变更为「{new_label}」{location}，操作人：{operator or '系统'}。"
    )
    warehouse = notify_role_users(db, "warehouse_manager", "info", title, message)
    sales = notify_role_users(db, "salesperson", "info", title, message)
    admin = notify_admins(db, "info", title, message)
    return warehouse + sales + admin


def notify_inventory_deducted(
    db: Session,
    item_code: str,
    item_name: str,
    quantity: float,
    remaining: float,
    unit: str,
    order_no: str,
) -> int:
    """订单发货扣减库存时通知仓管员（若剩余低于阈值同时发预警）"""
    from app.models.inventory import InventoryItem
    title = "库存扣减通知"
    message = (
        f"订单 {order_no} 发货扣减商品 {item_name}（{item_code}）"
        f"{quantity}{unit}，剩余 {remaining}{unit}。"
    )
    n = notify_role_users(db, "warehouse_manager", "info", title, message)
    return n


def notify_stock_out(
    db: Session,
    item_code: str,
    item_name: str,
    unit: str = "kg",
) -> int:
    """商品售罄时通知仓管员和管理员"""
    title = "商品售罄预警"
    message = (
        f"商品 {item_name}（编码 {item_code}）已全部售出，当前库存 0{unit}，"
        f"请立即补货。"
    )
    n1 = notify_role_users(db, "warehouse_manager", "warning", title, message)
    n2 = notify_admins(db, "warning", title, message)
    return n1 + n2


def notify_order_cancelled(
    db: Session,
    order_no: str,
    customer_name: Optional[str],
    operator: Optional[str],
) -> int:
    """订单取消时通知相关角色"""
    title = "订单取消通知"
    customer = f"（客户：{customer_name}）" if customer_name else ""
    message = (
        f"订单 {order_no}{customer} 已取消，操作人：{operator or '系统'}。"
    )
    n1 = notify_role_users(db, "salesperson", "warning", title, message)
    n2 = notify_role_users(db, "warehouse_manager", "warning", title, message)
    n3 = notify_admins(db, "warning", title, message)
    return n1 + n2 + n3
