import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text, or_
from web3 import Web3

logger = logging.getLogger(__name__)
from eth_account import Account
from app.core.database import get_db
from app.core.config import settings
from app.core.timezone import now_cn_naive
from app.models.auth import User, Role, Permission, UserRole, RolePermission, Organization
from app.models.seed import SeedSupplier, SeedBatch
from app.models.inspection import InspectionReport, PesticideResidueTest
from app.models.sensors import Sensor, Measurement
from app.models.planting import Plot, PlantingRecord, FarmingActivity, EnvironmentalData
from app.models.pesticide import Pesticide, PesticidePurchase, PesticideApplication
from app.models.processing import ProcessingBatch, ProcessingRecord
from app.models.inventory import Warehouse, InventoryItem, InventoryTransaction
from app.models.sales import Order, OrderItem, Customer, LogisticsTracking


# 清理历史遗留的 2024 旧编码数据，避免与 2026 编码冲突
LEGACY_FORMAT_PATTERNS = {
    # 编码前缀（SQL LIKE 右侧用 % 通配）
    "batch_code_legacy": [
        "SB-2024%", "SB-2023%", "PB-2024%", "PB-2023%",
        "BATCH-%", "HB-2024%", "HB-2023%", "PRC-2024%",
        "INV-2024%", "ORD-2024%", "TRUCK-2024%",
    ],
    "plot_code_legacy": ["PLOT00%", "PLOT-OLD%"],
    "warehouse_code_legacy": ["WH000%", "WH-OLD%"],
    "customer_code_legacy": ["CU000%", "CU-OLD%"],
    "supplier_code_legacy": ["SUP-OLD%", "SUP-2024%"],
    "sensor_device_legacy": ["DEV-OLD%"],
    # 2026 新编码以外的 order_no / item_code 统一按包含 2024 / OLD 的后缀匹配
    "contains_2024": "%2024%",
    "contains_old": "%-OLD%",
}


def _like_any_expr(col_expr: str, patterns: list[str]) -> str:
    """
    生成「列 LIKE 任何 pattern」的 OR 连缀 SQL（MySQL/SQLite 双兼容）。
    col_expr 用 {col} 占位，后续 .format(col=...) 填入实际列名。
    """
    return "(" + " OR ".join([f"{{col}} LIKE '{p}'" for p in patterns]) + ")"


def purge_legacy_format_records(db: Session, commit: bool = True) -> dict:
    """
    删除所有 2024 旧格式 + BATCH-前缀 + -OLD 脏记录，避免与 2026 编码冲突。
    返回每个表删除的行数。MySQL / SQLite 双兼容。
    """
    deleted = {}

    def _del(tbl: str, where_sql: str):
        stmt = text(f"DELETE FROM {tbl} WHERE {where_sql}")
        try:
            curs = db.execute(stmt)
            deleted[tbl] = (deleted.get(tbl) or 0) + (getattr(curs, "rowcount", 0) or 0)
        except Exception as exc:
            logger.info("purge skip %s: %s", tbl, exc)
            deleted[f"{tbl}__skipped"] = str(exc)

    BATCH_LEGACY = _like_any_expr("{col}", LEGACY_FORMAT_PATTERNS["batch_code_legacy"])
    PLOT_LEGACY = _like_any_expr("{col}", LEGACY_FORMAT_PATTERNS["plot_code_legacy"])
    WH_LEGACY = _like_any_expr("{col}", LEGACY_FORMAT_PATTERNS["warehouse_code_legacy"])
    CU_LEGACY = _like_any_expr("{col}", LEGACY_FORMAT_PATTERNS["customer_code_legacy"])
    SUP_LEGACY = _like_any_expr("{col}", LEGACY_FORMAT_PATTERNS["supplier_code_legacy"])
    DEV_LEGACY = _like_any_expr("{col}", LEGACY_FORMAT_PATTERNS["sensor_device_legacy"])
    HAS_2024 = "({col} LIKE '" + LEGACY_FORMAT_PATTERNS["contains_2024"] + "')"
    HAS_OLD = "({col} LIKE '" + LEGACY_FORMAT_PATTERNS["contains_old"] + "')"

    def old_col(col: str, patterns: str = BATCH_LEGACY) -> str:
        """生成 列+旧前缀+2024+OLD 三重匹配"""
        return f"({patterns.format(col=col)} OR {HAS_2024.format(col=col)} OR {HAS_OLD.format(col=col)})"

    try:
        # 1. blockchain_records（子表，seed_batch_code 旧编码）
        _del("blockchain_records", old_col("seed_batch_code"))

        # 2. 订单子表：order_items + logistics_tracking → 再删 orders → 再删 customers
        _ord_old = (
            old_col("order_no")
            + f" OR customer_id IN (SELECT id FROM customers WHERE {old_col('customer_code', CU_LEGACY)})"
        )
        _del("order_items", f"order_id IN (SELECT id FROM orders WHERE {_ord_old})")
        try:
            _del("logistics_tracking", f"order_id IN (SELECT id FROM orders WHERE {_ord_old})")
        except Exception:  # SQLite 对 logistics_tracking 表可能不存在
            pass
        _del("orders", _ord_old)
        _del("customers", old_col("customer_code", CU_LEGACY))

        # 3. 库存：事务 → 项 → 仓库
        _wh_old = old_col("warehouse_code", WH_LEGACY)
        _item_old = (
            old_col("item_code")
            + f" OR warehouse_id IN (SELECT id FROM warehouses WHERE {_wh_old})"
            + f" OR {old_col('batch_code')}"
        )
        _del("inventory_transactions", f"item_id IN (SELECT id FROM inventory_items WHERE {_item_old})")
        _del("inventory_items", _item_old)
        _del("warehouses", _wh_old)

        # 4. 加工：记录 → 批次
        _proc_old = old_col("batch_code") + " OR " + old_col("seed_batch_code")
        _del("processing_records",
             "batch_id IN (SELECT id FROM processing_batches WHERE " + old_col("batch_code") + ")")
        _del("processing_batches", _proc_old)

        # 5. 检测：农残项 → 报告
        _ir_old = old_col("seed_batch_code") + " OR " + old_col("batch_code")
        _del("pesticide_residue_tests",
             "report_id IN (SELECT id FROM inspection_reports WHERE " + _ir_old + ")")
        _del("inspection_reports", _ir_old)

        # 6. 农药：施用 → 采购 → 农药条目
        _pp_old = (
            "plot_id IN (SELECT id FROM plots WHERE " + old_col("plot_code", PLOT_LEGACY) + ")"
            + " OR planting_record_id IN (SELECT id FROM planting_records WHERE "
            + old_col("plot_code", PLOT_LEGACY) + " OR " + old_col("seed_batch_code") + ")"
        )
        _del("pesticide_applications", _pp_old)
        try:
            _del("pesticide_purchases",
                 "supplier_id IN (SELECT id FROM seed_suppliers WHERE " + old_col("supplier_code", SUP_LEGACY) + ")")
        except Exception:
            pass
        try:
            _del("pesticides", HAS_2024.format("registration_no") + " OR " + HAS_OLD.format("registration_no") + " OR " + HAS_OLD.format("name"))
        except Exception:
            pass

        # 7. 环境：environmental_data → measurements → sensors → farming_activities → planting_records → plots
        _plot_old = old_col("plot_code", PLOT_LEGACY)
        _env_old = (
            "plot_id IN (SELECT id FROM plots WHERE " + _plot_old + ")"
            + " OR " + old_col("seed_batch_code")
        )
        _del("environmental_data", _env_old)
        _meas_old = _plot_old + " OR " + old_col("seed_batch_code")
        _del("measurements", _meas_old)
        _sen_old = (
            _plot_old
            + " OR " + old_col("seed_batch_code")
            + " OR " + old_col("device_id", DEV_LEGACY)
        )
        _del("sensors", _sen_old)
        try:
            _del("farming_activities",
                 "planting_record_id IN (SELECT id FROM planting_records WHERE "
                 + _plot_old + " OR " + old_col("seed_batch_code") + ")")
        except Exception:
            pass
        _pr_old = (
            _plot_old
            + " OR " + old_col("seed_batch_code")
            + " OR plot_id IN (SELECT id FROM plots WHERE " + _plot_old + ")"
        )
        _del("planting_records", _pr_old)
        _del("plots", _plot_old)

        # 8. 种子批次（依赖 supplier 的先删）→ 最后删供应商
        _sb_old = (
            old_col("batch_code")
            + " OR supplier_id IN (SELECT id FROM seed_suppliers WHERE " + old_col("supplier_code", SUP_LEGACY) + ")"
        )
        _del("seed_batches", _sb_old)
        _del("seed_suppliers", old_col("supplier_code", SUP_LEGACY))

    except Exception as exc:  # 清理失败绝不能影响 seed_data 主业务（外层兜底）
        logger.warning("purge_legacy_format_records outer skip: %s", exc, exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        deleted["__skipped__"] = str(exc)
        return deleted

    if commit:
        try:
            db.commit()
        except Exception as exc:
            logger.warning("purge commit failed: %s", exc)
            db.rollback()
            deleted["__commit_failed__"] = str(exc)
    logger.info("purge_legacy_format_records done: %s", deleted)
    return deleted


class LoginRequest(BaseModel):
    username: str
    password: str


class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

try:
    import bcrypt
    logger.info("bcrypt version: %s", bcrypt.__version__)
except ImportError:
    logger.warning("bcrypt not installed, password hashing may not work correctly")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

def generate_wallet():
    account = Account.create()
    pk_bytes = account.key
    pub_key = account._key_obj.public_key
    return {
        "private_key": pk_bytes.hex(),
        "public_key": pub_key.to_bytes().hex(),
        "wallet_address": account.address,
    }


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    if not settings.SECRET_KEY:
        raise HTTPException(status_code=500, detail="SECRET_KEY 未配置")
    
    to_encode = data.copy()
    # JWT exp 必须使用 UTC epoch seconds; python-jose 内部按 UTC 比较,使用本地时间会出现 ±8h 偏差
    now_utc = datetime.now(timezone.utc)
    if expires_delta:
        expire = now_utc + expires_delta
    else:
        expire = now_utc + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def get_user(db: Session, username: str):
    return db.query(User).options(joinedload(User.roles)).filter(User.username == username).first()


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = get_user(db, username=username)
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


async def require_permission(permission_code: str, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    if current_user.is_superuser:
        return True
    
    role_ids = [ur.role_id for ur in current_user.roles]
    permission_ids = [rp.permission_id for rp in db.query(RolePermission).filter(RolePermission.role_id.in_(role_ids)).all()]
    permissions = db.query(Permission).filter(Permission.id.in_(permission_ids)).all()
    
    if any(p.code == permission_code for p in permissions):
        return True
    
    raise HTTPException(status_code=403, detail="Insufficient permissions")


@router.post("/token")
async def login_for_access_token(login_data: LoginRequest, db: Session = Depends(get_db)):
    user = get_user(db, login_data.username)
    
    if user and not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用，请联系管理员",
        )
    
    if user:
        try:
            password_match = verify_password(login_data.password, user.hashed_password)
        except Exception:
            password_match = False
    else:
        password_match = False
    
    if not user or not password_match:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "user_id": user.id},
        expires_delta=access_token_expires,
    )
    
    role_names = []
    if user.roles:
        for ur in user.roles:
            role = db.query(Role).filter(Role.id == ur.role_id).first()
            if role:
                role_names.append(role.name)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_info": {
            "id": user.id,
            "username": user.username,
            "real_name": user.real_name,
            "email": user.email,
            "phone": user.phone,
            "is_superuser": user.is_superuser,
            "organization_type": user.organization_type,
            "roles": role_names,
            "wallet_address": user.wallet_address,
        }
    }


@router.get("/users/me")
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    roles = [ur.role.name for ur in current_user.roles] if current_user.roles else []
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "real_name": current_user.real_name,
        "phone": current_user.phone,
        "is_superuser": current_user.is_superuser,
        "wallet_address": current_user.wallet_address,
        "roles": roles,
        "preferences": current_user.preferences or {},
    }


@router.get("/users")
async def list_users(
    keyword: str | None = None,
    role: str | None = None,
    organization_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    q = db.query(User)
    if keyword:
        kw = f"%{keyword}%"
        q = q.filter(or_(User.username.like(kw), User.real_name.like(kw), User.email.like(kw)))
    if role:
        q = q.join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id).filter(Role.name == role)
    if organization_id:
        q = q.filter(User.organization_id == organization_id)

    users = q.order_by(User.created_at.desc()).all()
    return {
        "status": "success",
        "data": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "real_name": user.real_name,
                "phone": user.phone,
                "is_superuser": user.is_superuser,
                "is_active": user.is_active,
                "organization_type": user.organization_type,
                "organization_id": user.organization_id,
                "organization_name": (user.organization.name if (user.organization_id and user.organization) else None),
                "roles": [ur.role.name for ur in (user.roles or [])],
                "created_at": user.created_at.isoformat() if user.created_at else None,
            }
            for user in users
        ],
        "count": len(users),
    }


@router.post("/users")
async def create_user(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    username = data.get("username")
    password = data.get("password")
    role_name = data.get("role", "farmer")
    if not username or not password or not role_name:
        raise HTTPException(status_code=400, detail="用户名、密码和角色为必填项")

    db_user = get_user(db, username)
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        raise HTTPException(status_code=400, detail=f"角色 {role_name} 不存在")

    hashed_password = get_password_hash(password)
    wallet = generate_wallet()
    new_user = User(
        username=username,
        email=data.get("email"),
        hashed_password=hashed_password,
        real_name=data.get("real_name"),
        phone=data.get("phone"),
        organization_type=data.get("organization_type", role.role_type),
        organization_id=data.get("organization_id"),
        wallet_address=wallet["wallet_address"],
        public_key=wallet["public_key"],
        private_key=wallet["private_key"],
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    db.add(UserRole(user_id=new_user.id, role_id=role.id))
    db.commit()
    return {"message": "User created successfully", "user_id": new_user.id, "role": role_name, "username": username}


@router.get("/users/{user_id}")
async def get_user_by_id(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("system:manage", current_user, db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    roles = [ur.role.name for ur in (user.roles or [])]
    return {
        "id": user.id, "username": user.username, "email": user.email,
        "real_name": user.real_name, "phone": user.phone,
        "is_superuser": user.is_superuser, "is_active": user.is_active,
        "organization_type": user.organization_type, "organization_id": user.organization_id,
        "roles": roles,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.put("/users/{user_id}")
async def update_user(user_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("system:manage", current_user, db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    updatable = ["email", "real_name", "phone", "is_active", "organization_type", "organization_id"]
    for field in updatable:
        if field in data:
            setattr(user, field, data[field])

    # 如果传了新角色，替换现有角色
    if "role" in data:
        role_name = data["role"]
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            raise HTTPException(status_code=400, detail=f"角色 {role_name} 不存在")
        # 删除旧角色
        db.query(UserRole).filter(UserRole.user_id == user.id).delete()
        db.add(UserRole(user_id=user.id, role_id=role.id))

    # 如果传了新密码
    if "password" in data and data["password"]:
        user.hashed_password = get_password_hash(data["password"])

    db.commit()
    db.refresh(user)
    return {"message": "用户更新成功", "user_id": user.id}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    await require_permission("system:manage", current_user, db)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 软删除：设为不活跃
    user.is_active = False
    db.commit()
    return {"message": "用户已禁用", "user_id": user_id}


@router.post("/seed-data")
async def seed_data(db: Session = Depends(get_db)):
    """幂等初始化角色、权限、管理员账号及全链路业务演示数据（可安全重复调用）"""
    purge_result = purge_legacy_format_records(db, commit=True)

    # --- 1. 角色 ---
    role_defs = [
        ("admin", "系统管理员", "admin"),
        ("farmer", "种植户", "enterprise"),
        ("inspector", "质检员", "enterprise"),
        ("warehouse_manager", "仓库管理员", "enterprise"),
        ("salesperson", "销售人员", "enterprise"),
    ]
    role_map: dict[str, Role] = {}
    for name, desc, rtype in role_defs:
        role = db.query(Role).filter(Role.name == name).first()
        if not role:
            role = Role(name=name, description=desc, role_type=rtype)
            db.add(role)
            db.commit()
            db.refresh(role)
        role_map[name] = role

    # --- 2. 权限 ---
    perm_defs = [
        ("种子管理", "seed:manage", "seed"),
        ("种子查询", "seed:query", "seed"),
        ("种植管理", "planting:manage", "planting"),
        ("种植查询", "planting:query", "planting"),
        ("农药管理", "pesticide:manage", "pesticide"),
        ("农药查询", "pesticide:query", "pesticide"),
        ("农药记录", "pesticide:record", "pesticide"),
        ("质量检测", "inspection:quality", "inspection"),
        ("检测查询", "inspection:query", "inspection"),
        ("加工管理", "processing:manage", "processing"),
        ("加工查询", "processing:query", "processing"),
        ("库存管理", "inventory:manage", "inventory"),
        ("库存查询", "inventory:query", "inventory"),
        ("销售管理", "sales:manage", "sales"),
        ("销售查询", "sales:query", "sales"),
        ("物流管理", "logistics:manage", "sales"),
        ("物流查询", "logistics:query", "sales"),
        ("溯源查询", "trace:query", "blockchain"),
        ("系统管理", "system:manage", "system"),
        ("传感器管理", "sensors:manage", "sensors"),
        ("传感器查询", "sensors:query", "sensors"),
        ("传感器数据提交", "sensors:submit", "sensors"),
    ]
    perm_map: dict[str, Permission] = {}
    for name, code, module in perm_defs:
        perm = db.query(Permission).filter(Permission.code == code).first()
        if not perm:
            perm = Permission(name=name, code=code, description=name, module=module)
            db.add(perm)
            db.commit()
            db.refresh(perm)
        perm_map[code] = perm

    # --- 3. 角色-权限映射（基于权限代码，幂等） ---
    role_permissions = {
        "admin": [c for _, c, _ in perm_defs],  # 全部权限
        "farmer": [
            "seed:manage", "seed:query",
            "planting:manage", "planting:query",
            "pesticide:manage", "pesticide:query", "pesticide:record",
            # 农民负责田间施药后录入、农药残留自动检测（auto-report 要求 inspection:quality）
            "inspection:quality", "inspection:query",
            "trace:query",
            "sensors:manage", "sensors:query", "sensors:submit",
        ],
        "inspector": [
            "seed:query",
            "planting:query",                    # 质检员需要查看地块/种植记录以关联检测
            "inspection:quality", "inspection:query",
            "trace:query",
            "sensors:query", "sensors:submit",  # 质检员可以手动提交传感器数据补充证据
        ],
        "warehouse_manager": [
            "seed:manage", "seed:query",
            "processing:manage", "processing:query",
            "inventory:manage", "inventory:query",
            "sales:query",                       # 仓管员可查看订单（只读）
            "logistics:manage", "logistics:query", # 仓管员负责发货/物流全流程
            "trace:query",
            "sensors:query",
        ],
        "salesperson": [
            "seed:query",
            "sales:manage", "sales:query",        # 销售负责创建订单/管理客户
            "logistics:query",                    # 销售可查看物流（只读）
            "trace:query",
            "sensors:query",
        ],
    }

    for role_name, perm_codes in role_permissions.items():
        role = role_map[role_name]
        existing_permissions = db.query(RolePermission).filter(
            RolePermission.role_id == role.id
        ).all()
        existing_codes = {p.permission.code for p in existing_permissions}
        required_codes = set(perm_codes)

        for code in required_codes - existing_codes:
            perm = perm_map.get(code)
            if perm:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))

        for existing_perm in existing_permissions:
            if existing_perm.permission.code not in required_codes:
                db.delete(existing_perm)
        db.commit()

    # --- 4. 演示用户账号 ---
    test_users = [
        ("admin", "admin123", "系统管理员", "admin@example.com", "admin", True),
        ("farmer", "farmer123", "张种植", "farmer@example.com", "farmer", False),
        ("inspector", "inspector123", "王检验", "inspector@example.com", "inspector", False),
        ("warehouse", "warehouse123", "李仓库", "warehouse@example.com", "warehouse_manager", False),
        ("sales", "sales123", "赵销售", "sales@example.com", "salesperson", False),
    ]

    for username, password, real_name, email, role_name, is_superuser in test_users:
        user_role = role_map[role_name]
        existing_user = db.query(User).filter(User.username == username).first()
        
        if existing_user:
            existing_user.real_name = real_name
            existing_user.email = email
            existing_user.is_superuser = is_superuser
            existing_user.organization_type = user_role.role_type
            existing_user.hashed_password = get_password_hash(password)
            
            existing_user_roles = db.query(UserRole).filter(
                UserRole.user_id == existing_user.id
            ).all()
            
            if not existing_user_roles:
                db.add(UserRole(user_id=existing_user.id, role_id=user_role.id))
            else:
                has_correct_role = any(ur.role_id == user_role.id for ur in existing_user_roles)
                if not has_correct_role:
                    for ur in existing_user_roles:
                        db.delete(ur)
                    db.add(UserRole(user_id=existing_user.id, role_id=user_role.id))
            
            db.commit()
        else:
            user_wallet = generate_wallet()
            new_user = User(
                username=username,
                email=email,
                hashed_password=get_password_hash(password),
                real_name=real_name,
                is_active=True,
                is_superuser=is_superuser,
                organization_type=user_role.role_type,
                wallet_address=user_wallet["wallet_address"],
                public_key=user_wallet["public_key"],
                private_key=user_wallet["private_key"],
            )
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            db.add(UserRole(user_id=new_user.id, role_id=user_role.id))
            db.commit()

    # --- 4-0. 默认机构种子（监管/合作社/农检中心）---
    default_orgs = [
        ("ORG-JG-2026", "驻马店市农业农村局农产品质量安全监管处", "regulator", "李监管", "0396-8888001", "河南省驻马店市驿城区置地大道东段市农业农村局12F"),
        ("ORG-HZ-2026", "金生链花生种植专业合作社联合社", "enterprise", "周社长", "0396-8888002", "河南省驻马店市正阳县国家现代农业产业园合作社总部"),
        ("ORG-NJ-2026", "驻马店市农产品质量检验检测中心", "lab", "王主任", "0396-8888003", "河南省驻马店市驿城区检验检测园区1号楼"),
    ]
    org_map: dict[str, Organization] = {}
    for org_code, name, otype, contact, phone, address in default_orgs:
        existing = db.query(Organization).filter(Organization.org_code == org_code).first()
        if existing:
            existing.name = name
            existing.type = otype
            existing.contact_name = contact
            existing.phone = phone
            existing.address = address
            existing.is_active = True
            db.commit()
            db.refresh(existing)
            org_map[org_code] = existing
        else:
            n = Organization(org_code=org_code, name=name, type=otype, contact_name=contact, phone=phone, address=address, is_active=True)
            db.add(n)
            db.commit()
            db.refresh(n)
            org_map[org_code] = n
    user_to_org = {
        "admin": "ORG-JG-2026",
        "farmer": "ORG-HZ-2026",
        "warehouse": "ORG-HZ-2026",
        "sales": "ORG-HZ-2026",
        "inspector": "ORG-NJ-2026",
    }
    for uname, org_code in user_to_org.items():
        u = db.query(User).filter(User.username == uname).first()
        org_obj = org_map.get(org_code)
        if u and org_obj:
            u.organization_id = org_obj.id
    db.commit()

    # --- 4-a. 种子供应商 & 种子批次初始化（必须在检测报告/种植记录之前，否则关联 FK 查不到）---
    existing_suppliers_count = db.query(SeedSupplier).count()
    if existing_suppliers_count == 0:
        default_supplier = SeedSupplier(
            supplier_code="SUP-2026-001",
            name="河南省花生良种繁育有限公司",
            contact_name="周育种",
            phone="13900000001",
            address="河南省驻马店市正阳县花生科技园A区",
            credit_rating="AAA",
            is_active=True,
        )
        db.add(default_supplier)
        db.commit()
        db.refresh(default_supplier)
        supplier_id_1 = default_supplier.id

        backup_supplier = SeedSupplier(
            supplier_code="SUP-2026-002",
            name="豫花种业集团股份有限公司",
            contact_name="陈良种",
            phone="13900000002",
            address="河南省郑州市高新区种业产业园B座",
            credit_rating="AA",
            is_active=True,
        )
        db.add(backup_supplier)
        db.commit()
        db.refresh(backup_supplier)
        supplier_id_2 = backup_supplier.id
    else:
        sup1 = db.query(SeedSupplier).filter(SeedSupplier.supplier_code == "SUP-2026-001").first()
        sup2 = db.query(SeedSupplier).filter(SeedSupplier.supplier_code == "SUP-2026-002").first()
        supplier_id_1 = sup1.id if sup1 else db.query(SeedSupplier).first().id
        supplier_id_2 = sup2.id if sup2 else supplier_id_1

    # 种子批次：用稳定易记的编号，前端 formatBatchName 能识别
    batch_defs = [
        {
            "batch_code": "PB2026-001",
            "supplier_id": supplier_id_1,
            "variety_name": "豫花65号（高油酸花生）",
            "breeding_base": "河南省驻马店市正阳县花生科技园A区",
            "net_weight": 5000.0,
            "total_quantity": 5000.0,
            "used_quantity": 0.0,
            "germination_rate": 95.5,
            "purity": 98.2,
            "moisture_content": 12.3,
            "production_date": datetime(2026, 3, 15),
            "disease_pest_test": "合格",
            "storage_location": "1号恒温库A区-03排",
            "keeper": "保管员赵师傅",
            "purchase_contract_no": "HT-HS-2026-0315",
            "status": "stocked",
        },
        {
            "batch_code": "PB2026-002",
            "supplier_id": supplier_id_2,
            "variety_name": "豫花37号（高油花生）",
            "breeding_base": "河南省郑州市黄河滩区花生种植基地",
            "net_weight": 3500.0,
            "total_quantity": 3500.0,
            "used_quantity": 0.0,
            "germination_rate": 94.0,
            "purity": 97.8,
            "moisture_content": 11.8,
            "production_date": datetime(2026, 3, 22),
            "disease_pest_test": "合格",
            "storage_location": "1号恒温库A区-05排",
            "keeper": "保管员赵师傅",
            "purchase_contract_no": "HT-HS-2026-0322",
            "status": "stocked",
        },
    ]
    for bd in batch_defs:
        existing_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == bd["batch_code"]).first()
        if not existing_batch:
            db.add(SeedBatch(**bd))
    db.commit()

    # 清洗历史脏数据：将不存在的旧批次编码回写到真实批次
    orphan_reports = db.query(InspectionReport).filter(
        ~InspectionReport.seed_batch_code.in_(
            [b.batch_code for b in db.query(SeedBatch.batch_code).all()]
        )
    ).all()
    if orphan_reports:
        first_batch = db.query(SeedBatch).order_by(SeedBatch.id.asc()).first()
        second_batch = db.query(SeedBatch).order_by(SeedBatch.id.asc()).offset(1).first()
        for orphan in orphan_reports:
            if orphan.seed_batch_code == "BATCH-002" and second_batch:
                orphan.seed_batch_code = second_batch.batch_code
                orphan.batch_id = second_batch.id
            elif first_batch:
                orphan.seed_batch_code = first_batch.batch_code
                orphan.batch_id = first_batch.id
        db.commit()
    # 对有 seed_batch_code 但 batch_id 为空的报告，补齐 FK
    no_batch_id_reports = db.query(InspectionReport).filter(
        InspectionReport.seed_batch_code.isnot(None),
        InspectionReport.batch_id.is_(None),
    ).all()
    if no_batch_id_reports:
        batch_code_map = {b.batch_code: b.id for b in db.query(SeedBatch).all()}
        for r in no_batch_id_reports:
            if r.seed_batch_code in batch_code_map:
                r.batch_id = batch_code_map[r.seed_batch_code]
        db.commit()

    # --- 5. 检测报告初始数据 ---
    inspector_user = db.query(User).filter(User.username == "inspector").first()
    if inspector_user:
        batch_001 = db.query(SeedBatch).filter(SeedBatch.batch_code == "PB2026-001").first()
        batch_002 = db.query(SeedBatch).filter(SeedBatch.batch_code == "PB2026-002").first()
        if not batch_001 or not batch_002:
            fallback = db.query(SeedBatch).order_by(SeedBatch.id.asc()).limit(2).all()
            if fallback:
                batch_001 = batch_001 or fallback[0]
                batch_002 = batch_002 or (fallback[1] if len(fallback) > 1 else fallback[0])

        existing_reports = db.query(InspectionReport).count()
        if existing_reports == 0 and batch_001 and batch_002:
            reports_data = [
                {
                    "report_code": "IR-2024-001",
                    "seed_batch_code": batch_001.batch_code,
                    "batch_id": batch_001.id,
                    "report_type": "种子质量检验",
                    "report_date": datetime(2026, 8, 22, 17, 38, 54),
                    "test_items": '["发芽率", "纯度", "水分含量", "病虫害检测"]',
                    "test_results": '["95.5%", "98.2%", "12.3%", "合格"]',
                    "inspector": "王检验",
                    "inspection_agency": "河南省农科院质检中心",
                    "certificate_no": "HA-QC-2024-001",
                    "is_qualified": True,
                    "remarks": "检验合格",
                },
                {
                    "report_code": "IR-2024-002",
                    "seed_batch_code": batch_001.batch_code,
                    "batch_id": batch_001.id,
                    "report_type": "农药残留检测",
                    "report_date": datetime(2026, 8, 22, 10, 12, 30),
                    "test_items": '["吡虫啉", "百菌清", "多菌灵"]',
                    "test_results": '["0.01mg/kg", "未检出", "未检出"]',
                    "inspector": "王检验",
                    "inspection_agency": "驻马店市农检中心",
                    "certificate_no": "ZMD-QC-2024-002",
                    "is_qualified": True,
                    "remarks": "农药残留符合国家标准",
                },
                {
                    "report_code": "IR-2024-003",
                    "seed_batch_code": batch_002.batch_code,
                    "batch_id": batch_002.id,
                    "report_type": "土壤检测",
                    "report_date": datetime(2026, 8, 20, 9, 5, 12),
                    "test_items": '["pH值", "有机质含量", "氮含量", "磷含量", "钾含量"]',
                    "test_results": '["6.8", "2.5%", "120mg/kg", "80mg/kg", "150mg/kg"]',
                    "inspector": "李检验",
                    "inspection_agency": "河南省农科院质检中心",
                    "certificate_no": "HA-QC-2024-003",
                    "is_qualified": True,
                    "remarks": "土壤肥力良好",
                },
                {
                    "report_code": "IR-2024-004",
                    "seed_batch_code": batch_002.batch_code,
                    "batch_id": batch_002.id,
                    "report_type": "成品质量检验",
                    "report_date": datetime(2026, 8, 21, 16, 44, 28),
                    "test_items": '["含油率", "蛋白质含量", "油酸含量", "亚油酸含量"]',
                    "test_results": '["48.5%", "25.3%", "42.1%", "31.2%"]',
                    "inspector": "王检验",
                    "inspection_agency": "河南省农科院质检中心",
                    "certificate_no": "HA-QC-2024-004",
                    "is_qualified": True,
                    "remarks": "符合一级花生标准",
                },
            ]

            for report_data in reports_data:
                report = InspectionReport(**report_data)
                db.add(report)
            db.commit()

            reports = db.query(InspectionReport).all()
            residue_tests = [
                {"report_id": reports[1].id, "test_item": "吡虫啉", "limit_value": 0.05, "measured_value": 0.01, "unit": "mg/kg", "is_over_limit": False, "is_qualified": True},
                {"report_id": reports[1].id, "test_item": "百菌清", "limit_value": 0.1, "measured_value": 0.0, "unit": "mg/kg", "is_over_limit": False, "is_qualified": True},
                {"report_id": reports[1].id, "test_item": "多菌灵", "limit_value": 0.5, "measured_value": 0.0, "unit": "mg/kg", "is_over_limit": False, "is_qualified": True},
            ]

            for test_data in residue_tests:
                test = PesticideResidueTest(**test_data)
                db.add(test)
            db.commit()

    # --- 5-b. 仓库 / 客户 / 种植 / 农药 / 加工 / 库存 / 订单 业务数据 ---
    # 仓库
    warehouses_def = [
        {"warehouse_code": "WH001", "name": "主仓库", "location": "河南省驻马店市正阳县", "type": "普通仓库", "capacity": 100000, "manager": "赵师傅", "is_active": True},
        {"warehouse_code": "WH002", "name": "农药库", "location": "河南省驻马店市正阳县", "type": "化学品仓库", "capacity": 5000, "manager": "孙师傅", "is_active": True},
        {"warehouse_code": "WH003", "name": "成品库", "location": "河南省驻马店市正阳县", "type": "成品仓库", "capacity": 50000, "manager": "钱师傅", "is_active": True},
    ]
    for w in warehouses_def:
        if not db.query(Warehouse).filter(Warehouse.warehouse_code == w["warehouse_code"]).first():
            db.add(Warehouse(**w))
    db.commit()
    wh_map = {w.warehouse_code: w.id for w in db.query(Warehouse).all()}

    # 客户
    customers_def = [
        {"customer_code": "CUS001", "name": "郑州惠济食品原料有限公司", "contact_name": "周经理", "phone": "13500135000", "address": "河南省郑州市惠济区", "credit_limit": 100000, "is_active": True},
        {"customer_code": "CUS002", "name": "武汉华中农贸批发市场", "contact_name": "吴经理", "phone": "13600136000", "address": "湖北省武汉市洪山区", "credit_limit": 50000, "is_active": True},
        {"customer_code": "CUS003", "name": "广州天河食品采购中心", "contact_name": "郑老板", "phone": "13700137001", "address": "广东省广州市天河区", "credit_limit": 30000, "is_active": True},
    ]
    for c in customers_def:
        if not db.query(Customer).filter(Customer.customer_code == c["customer_code"]).first():
            db.add(Customer(**c))
    db.commit()
    cust_map = {c.customer_code: c.id for c in db.query(Customer).all()}

    batch_pb1 = db.query(SeedBatch).filter(SeedBatch.batch_code == "PB2026-001").first()
    batch_pb2 = db.query(SeedBatch).filter(SeedBatch.batch_code == "PB2026-002").first()
    if batch_pb1 is None or batch_pb2 is None:
        fallback_batches = db.query(SeedBatch).order_by(SeedBatch.id.asc()).limit(2).all()
        if fallback_batches:
            batch_pb1 = batch_pb1 or fallback_batches[0]
            batch_pb2 = batch_pb2 or (fallback_batches[1] if len(fallback_batches) > 1 else fallback_batches[0])

    # 种植地块
    plots_def = [
        {"plot_code": "PLOT-A", "name": "A号种植基地", "location": "河南省驻马店市正阳县花生科技园A区", "area": 80.0, "soil_type": "壤土", "irrigation_source": "汝河水源", "owner": "种植户孙大哥", "base_name": "豫花65号高油酸基地", "status": "planted"},
        {"plot_code": "PLOT-B", "name": "B号种植基地", "location": "河南省郑州市黄河滩区花生种植基地", "area": 65.0, "soil_type": "砂壤土", "irrigation_source": "地下水", "owner": "种植户李大哥", "base_name": "豫花37号高油基地", "status": "planted"},
        {"plot_code": "PLOT-C", "name": "C号种植基地", "location": "河南省驻马店市正阳县熊寨镇农高区", "area": 55.0, "soil_type": "黄褐土", "irrigation_source": "板桥水库", "owner": "种植户王大哥", "base_name": "豫花65号实验田", "status": "available"},
    ]
    for p in plots_def:
        if not db.query(Plot).filter(Plot.plot_code == p["plot_code"]).first():
            db.add(Plot(**p))
    db.commit()
    plot_map = {p.plot_code: p.id for p in db.query(Plot).all()}

    # 种植记录（关联真实 SeedBatch id + code 双写，保证溯源接口 or_ 双匹配命中）
    if batch_pb1 and batch_pb2:
        planting_def = [
            {"plot_id": plot_map["PLOT-A"], "batch_id": batch_pb1.id, "seed_batch_code": batch_pb1.batch_code,
             "planting_date": datetime(2026, 5, 6).date(), "expected_harvest_date": datetime(2026, 9, 10).date(),
             "planting_density": 16500, "quantity_planted": 5000, "farmer": "种植户孙大哥", "status": "growing"},
            {"plot_id": plot_map["PLOT-B"], "batch_id": batch_pb2.id, "seed_batch_code": batch_pb2.batch_code,
             "planting_date": datetime(2026, 5, 12).date(), "expected_harvest_date": datetime(2026, 9, 18).date(),
             "planting_density": 15500, "quantity_planted": 3500, "farmer": "种植户李大哥", "status": "growing"},
        ]
        for pr in planting_def:
            exists = db.query(PlantingRecord).filter(
                PlantingRecord.plot_id == pr["plot_id"],
                PlantingRecord.batch_id == pr["batch_id"],
            ).first()
            if not exists:
                db.add(PlantingRecord(**pr))
        db.commit()

        # 农事活动
        farming_def = [
            {"plot_id": plot_map["PLOT-A"], "seed_batch_code": batch_pb1.batch_code,
             "activity_type": "播种", "activity_date": datetime(2026, 5, 6).date(), "description": "人工点播，行距42cm，株距16cm，豫花65号高油酸"},
            {"plot_id": plot_map["PLOT-A"], "seed_batch_code": batch_pb1.batch_code,
             "activity_type": "施肥", "activity_date": datetime(2026, 5, 20).date(), "description": "施用高钾复合肥，每亩30kg，高油配方"},
            {"plot_id": plot_map["PLOT-A"], "seed_batch_code": batch_pb1.batch_code,
             "activity_type": "灌溉", "activity_date": datetime(2026, 6, 25).date(), "description": "滴灌补水 30mm，花期保水"},
            {"plot_id": plot_map["PLOT-B"], "seed_batch_code": batch_pb2.batch_code,
             "activity_type": "播种", "activity_date": datetime(2026, 5, 12).date(), "description": "机械条播，行距40cm，株距15cm，豫花37号高油"},
            {"plot_id": plot_map["PLOT-B"], "seed_batch_code": batch_pb2.batch_code,
             "activity_type": "中耕培土", "activity_date": datetime(2026, 6, 18).date(), "description": "开花期培土10cm，提高结荚率"},
        ]
        for fa in farming_def:
            exists = db.query(FarmingActivity).filter(
                FarmingActivity.plot_id == fa["plot_id"],
                FarmingActivity.activity_date == fa["activity_date"],
                FarmingActivity.activity_type == fa["activity_type"],
            ).first()
            if not exists:
                db.add(FarmingActivity(**fa))
        db.commit()

        # 环境数据
        env_times = [datetime(2026, 8, 22, 14, 0), datetime(2026, 8, 22, 14, 5), datetime(2026, 8, 22, 14, 10)]
        env_rows = [
            # PLOT-A 高油酸花生
            (plot_map["PLOT-A"], batch_pb1.batch_code, env_times[0], 33.2, 62, 30, 26.8, 6.8, 82000, 2.1, 1.25, 135, 88, 158, 0.62, "sensor"),
            (plot_map["PLOT-A"], batch_pb1.batch_code, env_times[1], 32.9, 63, 31, 27.0, 6.8, 83500, 2.0, 1.28, 136, 89, 160, 0.63, "sensor"),
            (plot_map["PLOT-A"], batch_pb1.batch_code, env_times[2], 33.5, 61, 29, 26.9, 6.9, 81800, 2.3, 1.22, 134, 87, 157, 0.61, "sensor"),
            # PLOT-B 高油花生
            (plot_map["PLOT-B"], batch_pb2.batch_code, env_times[0], 32.1, 68, 34, 28.5, 6.9, 78500, 1.9, 1.12, 128, 82, 152, 0.58, "sensor"),
            (plot_map["PLOT-B"], batch_pb2.batch_code, env_times[1], 32.4, 67, 33, 28.3, 6.9, 79200, 2.0, 1.15, 129, 83, 153, 0.59, "sensor"),
            (plot_map["PLOT-B"], batch_pb2.batch_code, env_times[2], 32.0, 69, 35, 28.6, 7.0, 78800, 1.8, 1.10, 127, 81, 151, 0.57, "sensor"),
        ]
        for (pid, sbc, ts, t, h, sm, st, ph, lux, ws, ec, n, p, k, s, src) in env_rows:
            exists = db.query(EnvironmentalData).filter(
                EnvironmentalData.plot_id == pid, EnvironmentalData.record_time == ts,
            ).first()
            if not exists:
                db.add(EnvironmentalData(
                    plot_id=pid, seed_batch_code=sbc, record_time=ts,
                    temperature=t, humidity=h, soil_moisture=sm, soil_temperature=st,
                    ph_value=ph, illumination=lux, wind_speed=ws, conductivity=ec,
                    nitrogen=n, phosphorus=p, potassium=k, salinity=s, data_source=src,
                ))
        db.commit()

    # 农药
    pesticides_def = [
        {"pesticide_code": "PES-001", "name": "吡虫啉", "brand": "拜耳", "registration_no": "PD2012-0001", "active_ingredient": "吡虫啉 10%",
         "dosage_form": "可湿性粉剂", "concentration": "10%", "toxicity_level": "低毒", "safety_interval": 7,
         "usage_instructions": "稀释1500-2000倍叶面喷雾", "storage_requirements": "阴凉干燥处保存", "is_active": True},
        {"pesticide_code": "PES-002", "name": "百菌清", "brand": "巴斯夫", "registration_no": "PD2008-0003", "active_ingredient": "百菌清 40%",
         "dosage_form": "悬浮剂", "concentration": "40%", "toxicity_level": "低毒", "safety_interval": 14,
         "usage_instructions": "稀释600-800倍喷雾", "storage_requirements": "避光保存", "is_active": True},
        {"pesticide_code": "PES-003", "name": "多菌灵", "brand": "江苏利民", "registration_no": "PD2005-0007", "active_ingredient": "多菌灵 50%",
         "dosage_form": "可湿性粉剂", "concentration": "50%", "toxicity_level": "低毒", "safety_interval": 14,
         "usage_instructions": "稀释500倍茎叶喷雾", "storage_requirements": "阴凉通风", "is_active": True},
    ]
    for p in pesticides_def:
        if not db.query(Pesticide).filter(Pesticide.pesticide_code == p["pesticide_code"]).first():
            db.add(Pesticide(**p))
    db.commit()
    pest_map = {p.pesticide_code: p.id for p in db.query(Pesticide).all()}

    # 农药施用记录（仅在有真实种子批次时写入）
    if batch_pb1 and batch_pb2:
        pest_apps = [
            {"plot_id": plot_map["PLOT-A"], "pesticide_id": pest_map["PES-001"], "seed_batch_code": batch_pb1.batch_code,
             "application_date": datetime(2026, 6, 8).date(), "dosage": 0.15, "unit": "kg/亩", "applicator": "种植户孙大哥",
             "safety_interval_end": datetime(2026, 6, 22).date(), "is_compliant": True},
            {"plot_id": plot_map["PLOT-A"], "pesticide_id": pest_map["PES-003"], "seed_batch_code": batch_pb1.batch_code,
             "application_date": datetime(2026, 7, 5).date(), "dosage": 0.30, "unit": "kg/亩", "applicator": "种植户孙大哥",
             "safety_interval_end": datetime(2026, 7, 26).date(), "is_compliant": True},
            {"plot_id": plot_map["PLOT-B"], "pesticide_id": pest_map["PES-002"], "seed_batch_code": batch_pb2.batch_code,
             "application_date": datetime(2026, 6, 22).date(), "dosage": 0.25, "unit": "L/亩", "applicator": "种植户李大哥",
             "safety_interval_end": datetime(2026, 7, 13).date(), "is_compliant": True},
        ]
        for pa in pest_apps:
            exists = db.query(PesticideApplication).filter(
                PesticideApplication.plot_id == pa["plot_id"],
                PesticideApplication.pesticide_id == pa["pesticide_id"],
                PesticideApplication.application_date == pa["application_date"],
            ).first()
            if not exists:
                db.add(PesticideApplication(**pa))
        db.commit()

    # 加工批次 + 工序记录
    if batch_pb1 and batch_pb2:
        proc_def = [
            {"batch_code": "PRC-2026-001", "seed_batch_id": batch_pb1.id, "seed_batch_code": batch_pb1.batch_code,
             "raw_material_quantity": 5000.0, "raw_material_unit": "kg",
             "processing_date": datetime(2026, 8, 18).date(), "product_name": "豫花65号高油酸花生仁",
             "product_grade": "一级", "output_quantity": 3600.0, "output_unit": "kg", "status": "completed"},
            {"batch_code": "PRC-2026-002", "seed_batch_id": batch_pb2.id, "seed_batch_code": batch_pb2.batch_code,
             "raw_material_quantity": 3500.0, "raw_material_unit": "kg",
             "processing_date": datetime(2026, 8, 19).date(), "product_name": "豫花37号高油花生仁",
             "product_grade": "特级", "output_quantity": 2450.0, "output_unit": "kg", "status": "processing"},
        ]
        proc_ids: dict[str, int] = {}
        for pb in proc_def:
            exists = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == pb["batch_code"]).first()
            if not exists:
                new_pb = ProcessingBatch(**pb)
                db.add(new_pb)
                db.flush()
                db.refresh(new_pb)
                proc_ids[pb["batch_code"]] = new_pb.id
            else:
                proc_ids[pb["batch_code"]] = exists.id
        db.commit()

        # 工序
        proc_steps = [
            ("PRC-2026-001", 1, "原料精选", datetime(2026, 8, 18, 8, 0), datetime(2026, 8, 18, 10, 0),
             "去杂风选+比重选，杂质率≤0.3%", "加工组王组长"),
            ("PRC-2026-001", 2, "脱壳分级", datetime(2026, 8, 18, 10, 30), datetime(2026, 8, 18, 14, 0),
             "一级/二级分级，出仁率72%", "加工组李师傅"),
            ("PRC-2026-001", 3, "色选+金探", datetime(2026, 8, 18, 14, 30), datetime(2026, 8, 18, 16, 0),
             "霉变粒剔除+金属异物探测", "加工组张师傅"),
            ("PRC-2026-001", 4, "真空包装", datetime(2026, 8, 18, 16, 30), datetime(2026, 8, 18, 18, 30),
             "5kg/袋，真空度≥0.085MPa", "包装组赵师傅"),
        ]
        for (pbc, order, name, st, et, params, op) in proc_steps:
            exists = db.query(ProcessingRecord).filter(
                ProcessingRecord.batch_id == proc_ids[pbc],
                ProcessingRecord.process_order == order,
            ).first()
            if not exists:
                db.add(ProcessingRecord(
                    batch_id=proc_ids[pbc], process_name=name, process_order=order,
                    start_time=st, end_time=et, parameters=params, operator=op,
                ))
        db.commit()

        # 库存
        wh_3 = wh_map.get("WH003")  # 成品库
        wh_1 = wh_map.get("WH001")  # 主仓/种子
        inv_def = [
            {"warehouse_id": wh_3, "item_code": "ITM-HSA-001", "item_name": "豫花65号高油酸花生仁（一级）",
             "batch_code": "PRC-2026-001", "seed_batch_code": batch_pb1.batch_code,
             "processing_batch_id": proc_ids["PRC-2026-001"],
             "quantity": 3100, "unit": "kg", "min_stock": 500, "storage_location": "成品库-A排-01货位",
             "status": "in_stock"},
            {"warehouse_id": wh_3, "item_code": "ITM-HSA-002", "item_name": "豫花37号高油花生仁（特级）",
             "batch_code": "PRC-2026-002", "seed_batch_code": batch_pb2.batch_code,
             "processing_batch_id": proc_ids["PRC-2026-002"],
             "quantity": 2450, "unit": "kg", "min_stock": 300, "storage_location": "成品库-B排-02货位",
             "status": "in_stock"},
            {"warehouse_id": wh_1, "item_code": "ITM-HSA-003", "item_name": "豫花65号留种种仁",
             "batch_code": batch_pb1.batch_code, "seed_batch_code": batch_pb1.batch_code,
             "quantity": 900, "unit": "kg", "min_stock": 600, "storage_location": "恒温库-A区",
             "status": "in_stock"},
        ]
        for inv in inv_def:
            if not db.query(InventoryItem).filter(InventoryItem.item_code == inv["item_code"]).first():
                db.add(InventoryItem(**inv))
        db.commit()
        inv_item_ids = {i.item_code: i.id for i in db.query(InventoryItem).all()}

        # 出入库流水
        inv_tx_def = [
            (inv_item_ids.get("ITM-HSA-001"), "入库", 3600, "kg", datetime(2026, 8, 18).date()),
            (inv_item_ids.get("ITM-HSA-001"), "出库", 500, "kg", datetime(2026, 8, 21).date()),
            (inv_item_ids.get("ITM-HSA-002"), "入库", 2450, "kg", datetime(2026, 8, 19).date()),
            (inv_item_ids.get("ITM-HSA-003"), "入库", 900, "kg", datetime(2026, 8, 15).date()),
        ]
        for (iid, ttype, qty, unit, tdate) in inv_tx_def:
            if iid is None:
                continue
            exists = db.query(InventoryTransaction).filter(
                InventoryTransaction.item_id == iid,
                InventoryTransaction.transaction_type == ttype,
                InventoryTransaction.transaction_date == tdate,
            ).first()
            if not exists:
                db.add(InventoryTransaction(item_id=iid, transaction_type=ttype, quantity=qty, unit=unit, transaction_date=tdate))
        db.commit()

        # 销售订单 + 订单项
        today = now_cn_naive().date()
        yesterday = today - timedelta(days=1)
        order_def = [
            {"order_no": "SO-20260822-001", "customer_id": cust_map["CUS001"],
             "total_amount": 22200.0, "order_date": yesterday, "delivery_date": today + timedelta(days=2),
             "status": "shipped", "payment_status": "paid"},
            {"order_no": f"SO-{today.strftime('%Y%m%d')}-001", "customer_id": cust_map["CUS002"],
             "total_amount": 15000.0, "order_date": today, "delivery_date": today + timedelta(days=3),
             "status": "pending", "payment_status": "unpaid"},
            {"order_no": f"SO-{today.strftime('%Y%m%d')}-002", "customer_id": cust_map["CUS003"],
             "total_amount": 9000.0, "order_date": today, "delivery_date": today + timedelta(days=1),
             "status": "pending", "payment_status": "paid"},
        ]
        order_ids: dict[str, int] = {}
        for o in order_def:
            exists = db.query(Order).filter(Order.order_no == o["order_no"]).first()
            if not exists:
                no = Order(**o)
                db.add(no)
                db.flush()
                db.refresh(no)
                order_ids[o["order_no"]] = no.id
            else:
                order_ids[o["order_no"]] = exists.id
        db.commit()

        items_def = [
            ("SO-20260822-001", "ITM-HSA-001", "豫花65号高油酸花生仁（一级）", "PRC-2026-001", batch_pb1.batch_code,
             proc_ids["PRC-2026-001"], 1200, "kg", 18.50, 22200.0, "一级"),
            (f"SO-{today.strftime('%Y%m%d')}-001", "ITM-HSA-002", "豫花37号高油花生仁（特级）", "PRC-2026-002", batch_pb2.batch_code,
             proc_ids["PRC-2026-002"], 1000, "kg", 15.00, 15000.0, "特级"),
            (f"SO-{today.strftime('%Y%m%d')}-002", "ITM-HSA-001", "豫花65号高油酸花生仁（一级）", "PRC-2026-001", batch_pb1.batch_code,
             proc_ids["PRC-2026-001"], 600, "kg", 15.00, 9000.0, "一级"),
        ]
        for (ono, icode, iname, bcode, sbcode, pbid, qty, unit, uprice, amt, grade) in items_def:
            if ono not in order_ids:
                continue
            exists = db.query(OrderItem).filter(
                OrderItem.order_id == order_ids[ono],
                OrderItem.item_code == icode,
            ).first()
            if not exists:
                db.add(OrderItem(
                    order_id=order_ids[ono], item_code=icode, item_name=iname, batch_code=bcode,
                    seed_batch_code=sbcode, processing_batch_id=pbid,
                    quantity=qty, unit=unit, unit_price=uprice, amount=amt, product_grade=grade,
                ))
        db.commit()

        # --- 5-b. 物流运单种子（关联已有订单，物流运输 Tab 立即有数据）---
        existing_logistics = db.query(LogisticsTracking).count()
        if existing_logistics == 0 and order_ids:
            now = now_cn_naive()
            logistics_def = [
                {
                    "tracking_no": "SF-20260822-001",
                    "order_id": order_ids.get("SO-20260822-001"),
                    "carrier": "顺丰速运",
                    "vehicle_no": "豫Q·12345",
                    "driver_name": "张师傅",
                    "driver_phone": "13800138001",
                    "status": "delivered",
                    "origin": "河南省驻马店市正阳县花生科技园",
                    "destination": "北京市朝阳区农产品物流园",
                    "departure_time": now - timedelta(days=3),
                    "estimated_arrival_time": now - timedelta(hours=12),
                    "current_location": "北京市朝阳区签收点",
                    "signer": "李签收",
                    "sign_time": now - timedelta(hours=10),
                },
                {
                    "tracking_no": "SF-" + today.strftime("%Y%m%d") + "-001",
                    "order_id": order_ids.get(f"SO-{today.strftime('%Y%m%d')}-001"),
                    "carrier": "京东物流",
                    "vehicle_no": "豫Q·67890",
                    "driver_name": "王师傅",
                    "driver_phone": "13900139002",
                    "status": "transit",
                    "origin": "河南省驻马店市正阳县国家现代农业产业园",
                    "destination": "上海市浦东新区生鲜配送中心",
                    "departure_time": now - timedelta(hours=8),
                    "estimated_arrival_time": now + timedelta(hours=4),
                    "current_location": "G40沪陕高速罗山服务区",
                },
                {
                    "tracking_no": "ZT-" + today.strftime("%Y%m%d") + "-002",
                    "order_id": order_ids.get(f"SO-{today.strftime('%Y%m%d')}-002"),
                    "carrier": "中通快递",
                    "vehicle_no": "豫Q·55555",
                    "driver_name": "刘师傅",
                    "driver_phone": "13700137003",
                    "status": "shipped",
                    "origin": "河南省驻马店市正阳县国家现代农业产业园",
                    "destination": "广州市天河区冷链仓储中心",
                    "departure_time": now - timedelta(hours=2),
                    "estimated_arrival_time": now + timedelta(days=1),
                    "current_location": "G4京港澳高速信阳服务区",
                },
            ]
            for lt in logistics_def:
                if lt["order_id"]:
                    db.add(LogisticsTracking(**lt))
            db.commit()

    # --- 6. 传感器初始数据 ---
    existing_sensors = db.query(Sensor).count()
    if existing_sensors == 0:
        sensors_data = [
            {"device_id": "SENSOR-TEMP-001", "name": "温度传感器-地块A", "type": "temperature", "location": "地块A",
             "plot_code": "PLOT-A", "seed_batch_code": batch_pb1.batch_code if batch_pb1 else None,
             "threshold": 35.0, "status": "offline"},
            {"device_id": "SENSOR-HUMID-001", "name": "湿度传感器-地块A", "type": "humidity", "location": "地块A",
             "plot_code": "PLOT-A", "seed_batch_code": batch_pb1.batch_code if batch_pb1 else None,
             "threshold": 90.0, "status": "offline"},
            {"device_id": "SENSOR-SOIL-001", "name": "土壤8参数-地块A", "type": "soil_multi", "location": "地块A",
             "plot_code": "PLOT-A", "seed_batch_code": batch_pb1.batch_code if batch_pb1 else None,
             "threshold": 100.0, "status": "offline"},
            {"device_id": "SENSOR-PH-001", "name": "pH传感器-地块A", "type": "ph", "location": "地块A",
             "plot_code": "PLOT-A", "seed_batch_code": batch_pb1.batch_code if batch_pb1 else None,
             "threshold": 8.5, "status": "offline"},
            {"device_id": "SENSOR-LIGHT-001", "name": "光照传感器-地块A", "type": "light", "location": "地块A",
             "plot_code": "PLOT-A", "seed_batch_code": batch_pb1.batch_code if batch_pb1 else None,
             "threshold": 120000.0, "status": "offline"},
            {"device_id": "SENSOR-TEMP-002", "name": "温度传感器-地块B", "type": "temperature", "location": "地块B",
             "plot_code": "PLOT-B", "seed_batch_code": batch_pb2.batch_code if batch_pb2 else None,
             "threshold": 35.0, "status": "offline"},
            {"device_id": "SENSOR-HUMID-002", "name": "湿度传感器-地块B", "type": "humidity", "location": "地块B",
             "plot_code": "PLOT-B", "seed_batch_code": batch_pb2.batch_code if batch_pb2 else None,
             "threshold": 90.0, "status": "offline"},
            {"device_id": "SENSOR-SOIL-002", "name": "土壤8参数-地块B", "type": "soil_multi", "location": "地块B",
             "plot_code": "PLOT-B", "seed_batch_code": batch_pb2.batch_code if batch_pb2 else None,
             "threshold": 100.0, "status": "offline"},
        ]

        for sensor_data in sensors_data:
            sensor = Sensor(**sensor_data)
            db.add(sensor)
        db.commit()

        sensors = db.query(Sensor).all()
        import random
        measurements_data = []
        for sensor in sensors[:6]:
            for i in range(8):
                base_value = {
                    "temperature": 25.0,
                    "humidity": 65.0,
                    "soil_moisture": 25.0,
                    "soil_multi": 50.0,
                    "ph": 6.5,
                    "light": 80000.0,
                }.get(sensor.type, 50.0)
                measurements_data.append({
                    "sensor_id": sensor.id,
                    "seed_batch_code": sensor.seed_batch_code,
                    "plot_code": sensor.plot_code,
                    "timestamp": now_cn_naive() - timedelta(hours=i),
                    "item_name": {
                        "soil_moisture": "土壤湿度",
                        "soil_multi": "含水率",
                        "ph": "pH值",
                        "light": "光照强度",
                        "temperature": "温度",
                        "humidity": "湿度",
                    }.get(sensor.type, sensor.type),
                    "value": round(base_value + random.uniform(-5, 5), 2),
                    "unit": {
                        "temperature": "°C",
                        "humidity": "%",
                        "soil_moisture": "%",
                        "soil_multi": "%",
                        "ph": "",
                        "light": "lux",
                    }.get(sensor.type, "unit"),
                    "is_over_limit": False,
                })

        for measurement_data in measurements_data:
            measurement = Measurement(**measurement_data)
            db.add(measurement)
        db.commit()

    return {
        "message": "Seed data initialized successfully (idempotent)",
        "legacy_records_purged": purge_result,
        "batch_code_family": "PB2026-XXX (统一 2026 编码)",
    }


@router.put("/users/me")
async def update_user_profile(
    request_data: UpdateProfileRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    if request_data.username is not None:
        existing_user = db.query(User).filter(
            User.username == request_data.username,
            User.id != current_user.id
        ).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="用户名已被使用")
        current_user.username = request_data.username
    if request_data.phone is not None:
        current_user.phone = request_data.phone
    if request_data.email is not None:
        existing_user = db.query(User).filter(
            User.email == request_data.email,
            User.id != current_user.id
        ).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="邮箱已被使用")
        current_user.email = request_data.email

    db.commit()
    db.refresh(current_user)

    return {
        "status": "success",
        "message": "个人资料更新成功",
        "data": {
            "id": current_user.id,
            "username": current_user.username,
            "email": current_user.email,
            "phone": current_user.phone,
        }
    }


@router.post("/users/me/change-password")
async def change_password(
    request_data: ChangePasswordRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    if not verify_password(request_data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="旧密码不正确")

    if len(request_data.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码长度不能少于6位")

    current_user.hashed_password = get_password_hash(request_data.new_password)
    db.commit()

    return {
        "status": "success",
        "message": "密码修改成功",
    }


@router.get("/users/me/preferences")
async def get_preferences(current_user: User = Depends(get_current_active_user)):
    return {
        "status": "success",
        "preferences": current_user.preferences or {},
    }


@router.put("/users/me/preferences")
async def update_preferences(
    data: dict,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """更新当前用户偏好设置（主题、通知开关等）"""
    current_prefs = current_user.preferences or {}
    # 合并：新值覆盖旧值
    current_prefs.update(data)
    current_user.preferences = current_prefs
    db.commit()
    return {
        "status": "success",
        "message": "偏好设置已保存",
        "preferences": current_prefs,
    }
