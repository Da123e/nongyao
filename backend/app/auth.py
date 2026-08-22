import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session, joinedload
from web3 import Web3

logger = logging.getLogger(__name__)
from eth_account import Account
from app.core.database import get_db
from app.core.config import settings
from app.models.auth import User, Role, Permission, UserRole, RolePermission
from app.models.seed import SeedSupplier, SeedBatch
from app.models.inspection import InspectionReport, PesticideResidueTest
from app.models.sensors import Sensor, Measurement


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
    if expires_delta:
        expire = datetime.now() + expires_delta
    else:
        expire = datetime.now() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
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
    }


@router.get("/users")
async def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Only superusers can list users")

    users = db.query(User).all()
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
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Only superusers can create new users")

    username = data.get("username")
    email = data.get("email")
    password = data.get("password")
    role_name = data.get("role", "farmer")
    if not username or not email or not password:
        raise HTTPException(status_code=400, detail="用户名、邮箱和密码为必填项")

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
        email=email,
        hashed_password=hashed_password,
        real_name=data.get("real_name"),
        phone=data.get("phone"),
        organization_type=data.get("organization_type", role.role_type),
        wallet_address=wallet["wallet_address"],
        public_key=wallet["public_key"],
        private_key=wallet["private_key"],
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    db.add(UserRole(user_id=new_user.id, role_id=role.id))
    db.commit()
    return {"message": "User created successfully", "user_id": new_user.id, "role": role_name}


@router.post("/seed-data")
async def seed_data(db: Session = Depends(get_db)):
    """幂等初始化角色、权限和管理员账号。可安全重复调用。"""

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
            "pesticide:query", "pesticide:record",
            "trace:query",
            "sensors:manage", "sensors:query", "sensors:submit",
        ],
        "inspector": [
            "seed:query",
            "inspection:quality", "inspection:query",
            "trace:query",
            "sensors:query",
        ],
        "warehouse_manager": [
            "seed:query",
            "inventory:manage", "inventory:query",
            "trace:query",
        ],
        "salesperson": [
            "seed:query",
            "sales:manage", "sales:query",
            "trace:query",
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

    # --- 4. 演示用户账号（首次部署种子数据，正式部署后请立即修改密码）---
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

    # --- 5. 检测报告初始数据 ---
    inspector_user = db.query(User).filter(User.username == "inspector").first()
    if inspector_user:
        existing_reports = db.query(InspectionReport).count()
        if existing_reports == 0:
            seed_batch = db.query(SeedBatch).first()
            
            reports_data = [
                {
                    "report_code": "IR-2024-001",
                    "seed_batch_code": seed_batch.batch_code if seed_batch else "BATCH-001",
                    "report_type": "种子质量检验",
                    "test_items": '["发芽率", "纯度", "水分含量", "病虫害检测"]',
                    "test_results": '["95.5%", "98.2%", "12.3%", "合格"]',
                    "inspector": "王检验",
                    "inspection_agency": "山东省农科院质检中心",
                    "certificate_no": "SD-QC-2024-001",
                    "is_qualified": True,
                    "remarks": "检验合格",
                },
                {
                    "report_code": "IR-2024-002",
                    "seed_batch_code": seed_batch.batch_code if seed_batch else "BATCH-001",
                    "report_type": "农药残留检测",
                    "test_items": '["吡虫啉", "百菌清", "多菌灵"]',
                    "test_results": '["0.01mg/kg", "未检出", "未检出"]',
                    "inspector": "王检验",
                    "inspection_agency": "临沂市农检中心",
                    "certificate_no": "LY-QC-2024-002",
                    "is_qualified": True,
                    "remarks": "农药残留符合国家标准",
                },
                {
                    "report_code": "IR-2024-003",
                    "seed_batch_code": seed_batch.batch_code if seed_batch else "BATCH-002",
                    "report_type": "土壤检测",
                    "test_items": '["pH值", "有机质含量", "氮含量", "磷含量", "钾含量"]',
                    "test_results": '["6.8", "2.5%", "120mg/kg", "80mg/kg", "150mg/kg"]',
                    "inspector": "李检验",
                    "inspection_agency": "山东省农科院质检中心",
                    "certificate_no": "SD-QC-2024-003",
                    "is_qualified": True,
                    "remarks": "土壤肥力良好",
                },
                {
                    "report_code": "IR-2024-004",
                    "seed_batch_code": seed_batch.batch_code if seed_batch else "BATCH-002",
                    "report_type": "成品质量检验",
                    "test_items": '["含油率", "蛋白质含量", "油酸含量", "亚油酸含量"]',
                    "test_results": '["48.5%", "25.3%", "42.1%", "31.2%"]',
                    "inspector": "王检验",
                    "inspection_agency": "山东省农科院质检中心",
                    "certificate_no": "SD-QC-2024-004",
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

    # --- 6. 传感器初始数据 ---
    existing_sensors = db.query(Sensor).count()
    if existing_sensors == 0:
        sensors_data = [
            {"device_id": "SENSOR-TEMP-001", "name": "温度传感器-地块A", "type": "temperature", "location": "地块A", "plot_code": "PLOT-A", "threshold": 35.0, "status": "online"},
            {"device_id": "SENSOR-HUMID-001", "name": "湿度传感器-地块A", "type": "humidity", "location": "地块A", "plot_code": "PLOT-A", "threshold": 90.0, "status": "online"},
            {"device_id": "SENSOR-SOIL-001", "name": "土壤湿度传感器-地块A", "type": "soil_moisture", "location": "地块A", "plot_code": "PLOT-A", "threshold": 10.0, "status": "online"},
            {"device_id": "SENSOR-PH-001", "name": "pH传感器-地块A", "type": "ph", "location": "地块A", "plot_code": "PLOT-A", "threshold": 8.5, "status": "online"},
            {"device_id": "SENSOR-LIGHT-001", "name": "光照传感器-地块A", "type": "light", "location": "地块A", "plot_code": "PLOT-A", "threshold": 120000.0, "status": "online"},
            {"device_id": "SENSOR-TEMP-002", "name": "温度传感器-地块B", "type": "temperature", "location": "地块B", "plot_code": "PLOT-B", "threshold": 35.0, "status": "online"},
            {"device_id": "SENSOR-HUMID-002", "name": "湿度传感器-地块B", "type": "humidity", "location": "地块B", "plot_code": "PLOT-B", "threshold": 90.0, "status": "online"},
            {"device_id": "SENSOR-SOIL-002", "name": "土壤湿度传感器-地块B", "type": "soil_moisture", "location": "地块B", "plot_code": "PLOT-B", "threshold": 10.0, "status": "offline"},
        ]

        for sensor_data in sensors_data:
            sensor = Sensor(**sensor_data)
            db.add(sensor)
        db.commit()

        sensors = db.query(Sensor).all()
        import random
        measurements_data = []
        for sensor in sensors[:6]:
            for i in range(5):
                base_value = {
                    "temperature": 25.0,
                    "humidity": 65.0,
                    "soil_moisture": 25.0,
                    "ph": 6.5,
                    "light": 80000.0,
                }.get(sensor.type, 50.0)
                measurements_data.append({
                    "sensor_id": sensor.id,
                    "timestamp": datetime.now() - timedelta(hours=i),
                    "item_name": sensor.type,
                    "value": round(base_value + random.uniform(-5, 5), 2),
                    "unit": {
                        "temperature": "°C",
                        "humidity": "%",
                        "soil_moisture": "%",
                        "ph": "",
                        "light": "lux",
                    }.get(sensor.type, "unit"),
                    "is_over_limit": False,
                })

        for measurement_data in measurements_data:
            measurement = Measurement(**measurement_data)
            db.add(measurement)
        db.commit()

    return {"message": "Seed data initialized successfully (idempotent)"}


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
