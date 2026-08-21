from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime, date
import pymysql
from passlib.context import CryptContext
from eth_account import Account
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def generate_wallet():
    account = Account.create()
    return {
        "private_key": account.key.hex(),
        "public_key": account.public_key.hex(),
        "wallet_address": account.address,
    }

SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

try:
    parts = settings.DATABASE_URL.split("://")[1].split("@")
    user_pass, host_port_db = parts[0], parts[1]
    db_user, db_pass = user_pass.split(":")
    host_port, db_name = host_port_db.rsplit("/", 1)
    host, port = host_port.split(":") if ":" in host_port else (host_port, "3306")
    conn = pymysql.connect(host=host, user=db_user, password=db_pass, port=int(port))
    cursor = conn.cursor()
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {db_name} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cursor.close()
    conn.close()
    print("✓ 确保数据库存在")
except Exception as e:
    print(f"⚠️ 数据库创建检查失败: {e}")

engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

from app.models.auth import User, Role, Permission, UserRole, RolePermission
from app.models.seed import SeedSupplier, SeedBatch, SeedQualityTest
from app.models.planting import Plot, PlantingRecord, FarmingActivity, EnvironmentalData
from app.models.pesticide import Pesticide, PesticidePurchase, PesticideApplication
from app.models.inspection import InspectionReport, PesticideResidueTest
from app.models.processing import ProcessingBatch, ProcessingRecord
from app.models.inventory import Warehouse, InventoryItem, InventoryTransaction
from app.models.sales import Order, OrderItem, Customer
from app.models.sensors import Sensor, Measurement
from app.models.blockchain import IPFSFile
from app.core.database import Base

Base.metadata.create_all(bind=engine)

db = SessionLocal()

try:
    print("正在初始化数据库...")

    if not db.query(Role).filter(Role.name == "admin").first():
        admin_role = Role(name="admin", description="系统管理员", role_type="admin")
        db.add(admin_role)
        farmer_role = Role(name="farmer", description="种植户", role_type="enterprise")
        db.add(farmer_role)
        inspector_role = Role(name="inspector", description="质检员", role_type="enterprise")
        db.add(inspector_role)
        warehouse_role = Role(name="warehouse_manager", description="仓库管理员", role_type="enterprise")
        db.add(warehouse_role)
        sales_role = Role(name="salesperson", description="销售人员", role_type="enterprise")
        db.add(sales_role)
        db.commit()
        print("✓ 创建角色数据")

    permissions = [
        {"name": "种子管理", "code": "seed:manage", "module": "seed"},
        {"name": "种子查询", "code": "seed:query", "module": "seed"},
        {"name": "种植管理", "code": "planting:manage", "module": "planting"},
        {"name": "种植查询", "code": "planting:query", "module": "planting"},
        {"name": "农药管理", "code": "pesticide:manage", "module": "pesticide"},
        {"name": "农药查询", "code": "pesticide:query", "module": "pesticide"},
        {"name": "农药记录", "code": "pesticide:record", "module": "pesticide"},
        {"name": "质量检测", "code": "inspection:quality", "module": "inspection"},
        {"name": "检测查询", "code": "inspection:query", "module": "inspection"},
        {"name": "加工管理", "code": "processing:manage", "module": "processing"},
        {"name": "加工查询", "code": "processing:query", "module": "processing"},
        {"name": "库存管理", "code": "inventory:manage", "module": "inventory"},
        {"name": "库存查询", "code": "inventory:query", "module": "inventory"},
        {"name": "销售管理", "code": "sales:manage", "module": "sales"},
        {"name": "销售查询", "code": "sales:query", "module": "sales"},
        {"name": "溯源查询", "code": "trace:query", "module": "blockchain"},
        {"name": "系统管理", "code": "system:manage", "module": "system"},
        {"name": "传感器管理", "code": "sensors:manage", "module": "sensors"},
        {"name": "传感器查询", "code": "sensors:query", "module": "sensors"},
    ]

    for p in permissions:
        if not db.query(Permission).filter(Permission.code == p["code"]).first():
            permission = Permission(name=p["name"], code=p["code"], description=p["name"], module=p["module"])
            db.add(permission)
    db.commit()
    print("✓ 创建权限列表")

    admin_role = db.query(Role).filter(Role.name == "admin").first()
    all_permissions = db.query(Permission).all()
    for perm in all_permissions:
        if not db.query(RolePermission).filter(RolePermission.role_id == admin_role.id, RolePermission.permission_id == perm.id).first():
            rp = RolePermission(role_id=admin_role.id, permission_id=perm.id)
            db.add(rp)
    db.commit()
    print("✓ 分配管理员权限")

    farmer_role = db.query(Role).filter(Role.name == "farmer").first()
    farmer_perms = [p for p in all_permissions if p.code in ["seed:manage", "seed:query", "planting:manage", "planting:query", "pesticide:query", "pesticide:record", "trace:query", "sensors:manage", "sensors:query"]]
    for perm in farmer_perms:
        if not db.query(RolePermission).filter(RolePermission.role_id == farmer_role.id, RolePermission.permission_id == perm.id).first():
            rp = RolePermission(role_id=farmer_role.id, permission_id=perm.id)
            db.add(rp)
    db.commit()
    print("✓ 分配种植户权限")

    inspector_role = db.query(Role).filter(Role.name == "inspector").first()
    inspector_perms = [p for p in all_permissions if p.code in ["seed:query", "planting:query", "pesticide:query", "inspection:quality", "inspection:query", "trace:query", "sensors:query"]]
    for perm in inspector_perms:
        if not db.query(RolePermission).filter(RolePermission.role_id == inspector_role.id, RolePermission.permission_id == perm.id).first():
            rp = RolePermission(role_id=inspector_role.id, permission_id=perm.id)
            db.add(rp)
    db.commit()
    print("✓ 分配质检员权限")

    warehouse_role = db.query(Role).filter(Role.name == "warehouse_manager").first()
    warehouse_perms = [p for p in all_permissions if p.code in ["inventory:manage", "inventory:query", "trace:query", "sensors:query"]]
    for perm in warehouse_perms:
        if not db.query(RolePermission).filter(RolePermission.role_id == warehouse_role.id, RolePermission.permission_id == perm.id).first():
            rp = RolePermission(role_id=warehouse_role.id, permission_id=perm.id)
            db.add(rp)
    db.commit()
    print("✓ 分配仓库管理员权限")

    sales_role = db.query(Role).filter(Role.name == "salesperson").first()
    sales_perms = [p for p in all_permissions if p.code in ["sales:manage", "sales:query", "trace:query"]]
    for perm in sales_perms:
        if not db.query(RolePermission).filter(RolePermission.role_id == sales_role.id, RolePermission.permission_id == perm.id).first():
            rp = RolePermission(role_id=sales_role.id, permission_id=perm.id)
            db.add(rp)
    db.commit()
    print("✓ 分配销售人员权限")

    # 演示账号：以下为首次部署时生成的演示用户密码（bcrypt 哈希后写入）。
    # 正式环境/参赛部署后请在登录页立即修改，或通过环境变量 INITIAL_ADMIN_PASSWORD 覆盖。
    if not db.query(User).filter(User.username == "admin").first():
        hashed_password = pwd_context.hash("admin123")
        admin_wallet = generate_wallet()
        admin_user = User(
            username="admin",
            email="admin@example.com",
            hashed_password=hashed_password,
            real_name="管理员",
            phone="13800138000",
            is_active=True,
            is_superuser=True,
            organization_type="admin",
            wallet_address=admin_wallet["wallet_address"],
            public_key=admin_wallet["public_key"],
            private_key=admin_wallet["private_key"],
        )
        db.add(admin_user)
        db.commit()
        print("✓ 创建管理员账号")
        
        admin_user = db.query(User).filter(User.username == "admin").first()
        ur = UserRole(user_id=admin_user.id, role_id=admin_role.id)
        db.add(ur)
        db.commit()

    farmer_role = db.query(Role).filter(Role.name == "farmer").first()
    inspector_role = db.query(Role).filter(Role.name == "inspector").first()
    warehouse_role = db.query(Role).filter(Role.name == "warehouse_manager").first()
    sales_role = db.query(Role).filter(Role.name == "salesperson").first()

    test_users = [
        {
            "username": "farmer",
            "email": "farmer@example.com",
            "password": "farmer123",
            "real_name": "种植户",
            "phone": "13800138001",
            "organization_type": "enterprise",
            "role": farmer_role,
        },
        {
            "username": "inspector",
            "email": "inspector@example.com",
            "password": "inspector123",
            "real_name": "质检员",
            "phone": "13800138002",
            "organization_type": "enterprise",
            "role": inspector_role,
        },
        {
            "username": "warehouse",
            "email": "warehouse@example.com",
            "password": "warehouse123",
            "real_name": "仓库管理员",
            "phone": "13800138003",
            "organization_type": "enterprise",
            "role": warehouse_role,
        },
        {
            "username": "sales",
            "email": "sales@example.com",
            "password": "sales123",
            "real_name": "销售人员",
            "phone": "13800138004",
            "organization_type": "enterprise",
            "role": sales_role,
        },
    ]

    for user_data in test_users:
        if not db.query(User).filter(User.username == user_data["username"]).first():
            hashed_password = pwd_context.hash(user_data["password"])
            user = User(
                username=user_data["username"],
                email=user_data["email"],
                hashed_password=hashed_password,
                real_name=user_data["real_name"],
                phone=user_data["phone"],
                is_active=True,
                is_superuser=False,
                organization_type=user_data["organization_type"],
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            
            ur = UserRole(user_id=user.id, role_id=user_data["role"].id)
            db.add(ur)
            db.commit()
            print(f"✓ 创建{user_data['real_name']}账号")

    warehouses = [
        {"warehouse_code": "WH001", "name": "主仓库", "location": "山东省临沂市", "type": "普通仓库", "capacity": 100000, "manager": "赵师傅"},
        {"warehouse_code": "WH002", "name": "农药库", "location": "山东省临沂市", "type": "化学品仓库", "capacity": 5000, "manager": "孙师傅"},
        {"warehouse_code": "WH003", "name": "成品库", "location": "山东省临沂市", "type": "成品仓库", "capacity": 50000, "manager": "钱师傅"},
    ]
    for w in warehouses:
        if not db.query(Warehouse).filter(Warehouse.warehouse_code == w["warehouse_code"]).first():
            warehouse = Warehouse(**w, is_active=True)
            db.add(warehouse)
    db.commit()
    print("✓ 创建仓库数据")

    suppliers = [
        {"supplier_code": "SUP001", "name": "山东金胜种业有限公司", "contact_name": "王经理", "phone": "13900139000", "address": "山东省临沂市兰山区", "credit_rating": "A级"},
        {"supplier_code": "SUP002", "name": "河南农科院种业公司", "contact_name": "李主任", "phone": "13800138001", "address": "河南省郑州市金水区", "credit_rating": "A级"},
        {"supplier_code": "SUP003", "name": "江苏徐淮地区农科所", "contact_name": "张所长", "phone": "13700137000", "address": "江苏省徐州市铜山区", "credit_rating": "B级"},
    ]
    for s in suppliers:
        if not db.query(SeedSupplier).filter(SeedSupplier.supplier_code == s["supplier_code"]).first():
            supplier = SeedSupplier(**s, is_active=True)
            db.add(supplier)
    db.commit()
    print("✓ 创建供应商数据")

    seed_batches = [
        {"batch_code": "SB-2024-001", "variety_name": "花育25号", "breeding_base": "山东省花生研究所", "production_date": date(2024, 3, 15), "net_weight": 5000, "germination_rate": 96.5, "purity": 99.2, "moisture_content": 8.5, "storage_location": "A仓库-01区", "keeper": "赵师傅", "purchase_contract_no": "HT-2024-SB-001", "status": "已入库", "supplier_id": 1},
        {"batch_code": "SB-2024-002", "variety_name": "豫花9327", "breeding_base": "河南省农科院", "production_date": date(2024, 3, 20), "net_weight": 3000, "germination_rate": 95.8, "purity": 98.9, "moisture_content": 8.2, "storage_location": "A仓库-02区", "keeper": "赵师傅", "purchase_contract_no": "HT-2024-SB-002", "status": "已使用", "supplier_id": 2},
        {"batch_code": "SB-2024-003", "variety_name": "隆平花生1号", "breeding_base": "湖南隆平高科", "production_date": date(2024, 4, 1), "net_weight": 4000, "germination_rate": 97.2, "purity": 99.5, "moisture_content": 8.0, "storage_location": "B仓库-01区", "keeper": "钱师傅", "purchase_contract_no": "HT-2024-SB-003", "status": "已入库", "supplier_id": 1},
        {"batch_code": "SB-2024-004", "variety_name": "花育30号", "breeding_base": "山东省花生研究所", "production_date": date(2024, 4, 10), "net_weight": 2500, "germination_rate": 96.0, "purity": 99.0, "moisture_content": 8.3, "storage_location": "待检区", "keeper": "孙师傅", "purchase_contract_no": "HT-2024-SB-004", "status": "检验中", "supplier_id": 1},
        {"batch_code": "SB-2024-005", "variety_name": "苏花8号", "breeding_base": "江苏农科院", "production_date": date(2024, 4, 15), "net_weight": 3500, "germination_rate": 95.5, "purity": 98.8, "moisture_content": 8.4, "storage_location": "B仓库-02区", "keeper": "钱师傅", "purchase_contract_no": "HT-2024-SB-005", "status": "已入库", "supplier_id": 3},
    ]
    for sb in seed_batches:
        if not db.query(SeedBatch).filter(SeedBatch.batch_code == sb["batch_code"]).first():
            batch = SeedBatch(**sb)
            db.add(batch)
    db.commit()
    print("✓ 创建种子批次数据")

    quality_tests = [
        {"batch_id": 1, "test_date": date(2024, 3, 18), "test_item": "发芽率", "test_value": 96.5, "standard_value": 90.0, "is_qualified": True, "test_method": "恒温发芽法", "inspector": "张工"},
        {"batch_id": 1, "test_date": date(2024, 3, 18), "test_item": "纯度", "test_value": 99.2, "standard_value": 98.0, "is_qualified": True, "test_method": "田间种植鉴定", "inspector": "张工"},
        {"batch_id": 1, "test_date": date(2024, 3, 18), "test_item": "水分含量", "test_value": 8.5, "standard_value": 10.0, "is_qualified": True, "test_method": "烘干法", "inspector": "张工"},
        {"batch_id": 2, "test_date": date(2024, 3, 22), "test_item": "发芽率", "test_value": 95.8, "standard_value": 90.0, "is_qualified": True, "test_method": "恒温发芽法", "inspector": "李工"},
        {"batch_id": 2, "test_date": date(2024, 3, 22), "test_item": "纯度", "test_value": 98.9, "standard_value": 98.0, "is_qualified": True, "test_method": "田间种植鉴定", "inspector": "李工"},
        {"batch_id": 3, "test_date": date(2024, 4, 3), "test_item": "发芽率", "test_value": 97.2, "standard_value": 90.0, "is_qualified": True, "test_method": "恒温发芽法", "inspector": "王工"},
        {"batch_id": 3, "test_date": date(2024, 4, 3), "test_item": "纯度", "test_value": 99.5, "standard_value": 98.0, "is_qualified": True, "test_method": "田间种植鉴定", "inspector": "王工"},
        {"batch_id": 4, "test_date": date(2024, 4, 12), "test_item": "发芽率", "test_value": 96.0, "standard_value": 90.0, "is_qualified": True, "test_method": "恒温发芽法", "inspector": "赵工"},
        {"batch_id": 5, "test_date": date(2024, 4, 18), "test_item": "发芽率", "test_value": 95.5, "standard_value": 90.0, "is_qualified": True, "test_method": "恒温发芽法", "inspector": "孙工"},
        {"batch_id": 5, "test_date": date(2024, 4, 18), "test_item": "水分含量", "test_value": 8.4, "standard_value": 10.0, "is_qualified": True, "test_method": "烘干法", "inspector": "孙工"},
    ]
    for qt in quality_tests:
        if not db.query(SeedQualityTest).filter(SeedQualityTest.batch_id == qt["batch_id"], SeedQualityTest.test_item == qt["test_item"]).first():
            test = SeedQualityTest(**qt)
            db.add(test)
    db.commit()
    print("✓ 创建质量检测记录")

    plots = [
        {"plot_code": "PLOT001", "name": "一号种植区", "location": "山东省临沂市河东区", "area": 50.0, "soil_type": "壤土", "irrigation_source": "沂河水源", "owner": "孙大哥", "base_name": "金胜种植基地", "status": "planted"},
        {"plot_code": "PLOT002", "name": "二号种植区", "location": "山东省临沂市兰山区", "area": 30.0, "soil_type": "砂壤土", "irrigation_source": "地下水", "owner": "李大哥", "base_name": "金胜种植基地", "status": "planted"},
        {"plot_code": "PLOT003", "name": "三号种植区", "location": "山东省日照市莒县", "area": 40.0, "soil_type": "壤土", "irrigation_source": "沭河水源", "owner": "张大哥", "base_name": "日照种植基地", "status": "planted"},
        {"plot_code": "PLOT004", "name": "四号种植区", "location": "山东省潍坊市昌乐县", "area": 60.0, "soil_type": "砂质土", "irrigation_source": "水库水", "owner": "王大哥", "base_name": "潍坊种植基地", "status": "available"},
        {"plot_code": "PLOT005", "name": "五号种植区", "location": "山东省泰安市宁阳县", "area": 35.0, "soil_type": "壤土", "irrigation_source": "汶河水", "owner": "刘大哥", "base_name": "泰安种植基地", "status": "planted"},
    ]
    for p in plots:
        if not db.query(Plot).filter(Plot.plot_code == p["plot_code"]).first():
            plot = Plot(**p)
            db.add(plot)
    db.commit()
    print("✓ 创建种植地块数据")

    planting_records = [
        {"plot_id": 1, "batch_id": 1, "seed_batch_code": "SB-2024-001", "planting_date": date(2024, 5, 1), "expected_harvest_date": date(2024, 9, 15), "planting_density": 16000, "quantity_planted": 500, "farmer": "孙大哥", "status": "growing"},
        {"plot_id": 2, "batch_id": 2, "seed_batch_code": "SB-2024-002", "planting_date": date(2024, 5, 5), "expected_harvest_date": date(2024, 9, 20), "planting_density": 15000, "quantity_planted": 300, "farmer": "李大哥", "status": "growing"},
        {"plot_id": 3, "batch_id": 3, "seed_batch_code": "SB-2024-003", "planting_date": date(2024, 5, 3), "expected_harvest_date": date(2024, 9, 18), "planting_density": 17000, "quantity_planted": 400, "farmer": "张大哥", "status": "growing"},
        {"plot_id": 5, "batch_id": 5, "seed_batch_code": "SB-2024-005", "planting_date": date(2024, 5, 10), "expected_harvest_date": date(2024, 9, 25), "planting_density": 16500, "quantity_planted": 350, "farmer": "刘大哥", "status": "growing"},
    ]
    for pr in planting_records:
        if not db.query(PlantingRecord).filter(PlantingRecord.plot_id == pr["plot_id"], PlantingRecord.batch_id == pr["batch_id"]).first():
            record = PlantingRecord(**pr)
            db.add(record)
    db.commit()
    print("✓ 创建种植记录数据")

    pesticides = [
        {"pesticide_code": "PES001", "name": "吡虫啉", "brand": "拜耳", "registration_no": "PD20120001", "active_ingredient": "吡虫啉", "dosage_form": "可湿性粉剂", "concentration": "10%", "toxicity_level": "低毒", "safety_interval": 7, "usage_instructions": "稀释1500-2000倍喷雾", "storage_requirements": "阴凉干燥处保存"},
        {"pesticide_code": "PES002", "name": "多菌灵", "brand": "江苏利民", "registration_no": "PD20080003", "active_ingredient": "多菌灵", "dosage_form": "可湿性粉剂", "concentration": "50%", "toxicity_level": "低毒", "safety_interval": 14, "usage_instructions": "稀释500-800倍喷雾", "storage_requirements": "避光保存"},
        {"pesticide_code": "PES003", "name": "高效氯氰菊酯", "brand": "金胜牌", "registration_no": "PD20180001", "active_ingredient": "高效氯氰菊酯", "dosage_form": "乳油", "concentration": "10%", "toxicity_level": "中等毒", "safety_interval": 7, "usage_instructions": "稀释1000-1500倍喷雾", "storage_requirements": "阴凉干燥处保存"},
        {"pesticide_code": "PES004", "name": "百菌清", "brand": "巴斯夫", "registration_no": "PD20050001", "active_ingredient": "百菌清", "dosage_form": "悬浮剂", "concentration": "40%", "toxicity_level": "低毒", "safety_interval": 7, "usage_instructions": "稀释600-800倍喷雾", "storage_requirements": "阴凉通风处保存"},
        {"pesticide_code": "PES005", "name": "噻虫嗪", "brand": "先正达", "registration_no": "PD20100001", "active_ingredient": "噻虫嗪", "dosage_form": "水分散粒剂", "concentration": "25%", "toxicity_level": "低毒", "safety_interval": 14, "usage_instructions": "稀释2000-3000倍喷雾", "storage_requirements": "干燥通风处保存"},
        {"pesticide_code": "PES006", "name": "敌敌畏", "brand": "红太阳", "registration_no": "PD20040001", "active_ingredient": "敌敌畏", "dosage_form": "乳油", "concentration": "80%", "toxicity_level": "高毒", "safety_interval": 7, "usage_instructions": "稀释800-1000倍喷雾", "storage_requirements": "阴凉干燥处保存"},
    ]
    for pest in pesticides:
        if not db.query(Pesticide).filter(Pesticide.pesticide_code == pest["pesticide_code"]).first():
            pesticide = Pesticide(**pest, is_active=True)
            db.add(pesticide)
    db.commit()
    print("✓ 创建农药数据")

    pesticide_purchases = [
        {"pesticide_id": 1, "supplier_name": "拜耳中国", "quantity": 100, "unit": "kg", "unit_price": 85.0, "total_amount": 8500.0, "purchase_date": date(2024, 3, 1), "storage_location": "农药库-A区"},
        {"pesticide_id": 2, "supplier_name": "江苏利民", "quantity": 150, "unit": "kg", "unit_price": 35.0, "total_amount": 5250.0, "purchase_date": date(2024, 3, 15), "storage_location": "农药库-A区"},
        {"pesticide_id": 3, "supplier_name": "金胜化工", "quantity": 80, "unit": "kg", "unit_price": 60.0, "total_amount": 4800.0, "purchase_date": date(2024, 4, 1), "storage_location": "农药库-B区"},
        {"pesticide_id": 4, "supplier_name": "巴斯夫", "quantity": 60, "unit": "kg", "unit_price": 90.0, "total_amount": 5400.0, "purchase_date": date(2024, 4, 10), "storage_location": "农药库-B区"},
        {"pesticide_id": 5, "supplier_name": "先正达", "quantity": 40, "unit": "kg", "unit_price": 120.0, "total_amount": 4800.0, "purchase_date": date(2024, 5, 1), "storage_location": "农药库-C区"},
    ]
    for pp in pesticide_purchases:
        if not db.query(PesticidePurchase).filter(PesticidePurchase.pesticide_id == pp["pesticide_id"], PesticidePurchase.purchase_date == pp["purchase_date"]).first():
            purchase = PesticidePurchase(**pp)
            db.add(purchase)
    db.commit()
    print("✓ 创建农药采购数据")

    pesticide_applications = [
        {"plot_id": 1, "pesticide_id": 1, "seed_batch_code": "SB-2024-001", "application_date": date(2024, 6, 15), "dosage": 0.15, "unit": "kg/亩", "applicator": "孙大哥", "safety_interval_end": date(2024, 6, 22), "is_compliant": True},
        {"plot_id": 1, "pesticide_id": 2, "seed_batch_code": "SB-2024-001", "application_date": date(2024, 6, 25), "dosage": 0.3, "unit": "kg/亩", "applicator": "孙大哥", "safety_interval_end": date(2024, 7, 16), "is_compliant": True},
        {"plot_id": 2, "pesticide_id": 1, "seed_batch_code": "SB-2024-002", "application_date": date(2024, 6, 18), "dosage": 0.12, "unit": "kg/亩", "applicator": "李大哥", "safety_interval_end": date(2024, 6, 25), "is_compliant": True},
        {"plot_id": 3, "pesticide_id": 3, "seed_batch_code": "SB-2024-003", "application_date": date(2024, 6, 20), "dosage": 0.08, "unit": "kg/亩", "applicator": "张大哥", "safety_interval_end": date(2024, 6, 27), "is_compliant": True},
        {"plot_id": 1, "pesticide_id": 4, "seed_batch_code": "SB-2024-001", "application_date": date(2024, 7, 1), "dosage": 0.2, "unit": "kg/亩", "applicator": "孙大哥", "safety_interval_end": date(2024, 7, 8), "is_compliant": True},
    ]
    for pa in pesticide_applications:
        if not db.query(PesticideApplication).filter(PesticideApplication.plot_id == pa["plot_id"], PesticideApplication.application_date == pa["application_date"]).first():
            application = PesticideApplication(**pa)
            db.add(application)
    db.commit()
    print("✓ 创建农药使用数据")

    processing_batches = [
        {"batch_code": "PB-2024-001", "seed_batch_id": 1, "seed_batch_code": "SB-2024-001", "raw_material_quantity": 5000, "raw_material_unit": "kg", "processing_date": date(2024, 7, 1), "product_name": "花生仁（一级）", "product_grade": "一级", "output_quantity": 3500, "output_unit": "kg", "status": "completed"},
        {"batch_code": "PB-2024-002", "seed_batch_id": 2, "seed_batch_code": "SB-2024-002", "raw_material_quantity": 3000, "raw_material_unit": "kg", "processing_date": date(2024, 7, 3), "product_name": "花生仁（二级）", "product_grade": "二级", "output_quantity": 2100, "output_unit": "kg", "status": "completed"},
        {"batch_code": "PB-2024-003", "seed_batch_id": 3, "seed_batch_code": "SB-2024-003", "raw_material_quantity": 4000, "raw_material_unit": "kg", "processing_date": date(2024, 7, 5), "product_name": "花生油", "product_grade": "一级", "output_quantity": 1600, "output_unit": "kg", "status": "processing"},
        {"batch_code": "PB-2024-004", "seed_batch_id": 5, "seed_batch_code": "SB-2024-005", "raw_material_quantity": 3500, "raw_material_unit": "kg", "processing_date": date(2024, 7, 8), "product_name": "花生仁（一级）", "product_grade": "一级", "output_quantity": 2450, "output_unit": "kg", "status": "pending"},
    ]
    for pb in processing_batches:
        if not db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == pb["batch_code"]).first():
            batch = ProcessingBatch(**pb)
            db.add(batch)
    db.commit()
    print("✓ 创建加工批次数据")

    inspection_reports = [
        {"report_code": "IR-2024-001", "batch_id": 1, "seed_batch_code": "SB-2024-001", "report_type": "种子质量检验", "report_date": date(2024, 3, 22), "inspector": "王检验", "inspection_agency": "山东省农科院质检中心", "is_qualified": True},
        {"report_code": "IR-2024-002", "plot_id": 1, "report_type": "土壤检测", "report_date": date(2024, 4, 20), "inspector": "李检验", "inspection_agency": "临沂市农检中心", "is_qualified": True},
        {"report_code": "IR-2024-003", "plot_id": 1, "seed_batch_code": "SB-2024-001", "report_type": "农药残留检测", "report_date": date(2024, 7, 5), "inspector": "张检验", "inspection_agency": "山东省农科院质检中心", "is_qualified": True},
        {"report_code": "IR-2024-004", "processing_batch_id": 1, "seed_batch_code": "SB-2024-001", "report_type": "成品质量检验", "report_date": date(2024, 7, 2), "inspector": "王检验", "inspection_agency": "山东省农科院质检中心", "is_qualified": True},
        {"report_code": "IR-2024-005", "batch_id": 3, "seed_batch_code": "SB-2024-003", "report_type": "种子质量检验", "report_date": date(2024, 4, 5), "inspector": "李检验", "inspection_agency": "临沂市农检中心", "is_qualified": True},
    ]
    for ir in inspection_reports:
        if not db.query(InspectionReport).filter(InspectionReport.report_code == ir["report_code"]).first():
            report = InspectionReport(**ir)
            db.add(report)
    db.commit()
    print("✓ 创建检测报告数据")

    residue_tests = [
        {"report_id": 3, "test_item": "吡虫啉", "limit_value": 0.5, "measured_value": 0.08, "unit": "mg/kg", "is_over_limit": False},
        {"report_id": 3, "test_item": "多菌灵", "limit_value": 0.3, "measured_value": 0.05, "unit": "mg/kg", "is_over_limit": False},
        {"report_id": 3, "test_item": "百菌清", "limit_value": 1.0, "measured_value": 0.12, "unit": "mg/kg", "is_over_limit": False},
        {"report_id": 4, "test_item": "黄曲霉毒素B1", "limit_value": 20, "measured_value": 5, "unit": "μg/kg", "is_over_limit": False},
        {"report_id": 4, "test_item": "重金属铅", "limit_value": 0.2, "measured_value": 0.05, "unit": "mg/kg", "is_over_limit": False},
    ]
    for rt in residue_tests:
        if not db.query(PesticideResidueTest).filter(PesticideResidueTest.report_id == rt["report_id"], PesticideResidueTest.test_item == rt["test_item"]).first():
            test = PesticideResidueTest(**rt)
            db.add(test)
    db.commit()
    print("✓ 创建农药残留检测数据")

    processing_records = [
        {"batch_id": 1, "seed_batch_code": "SB-2024-001", "process_name": "清洗", "process_order": 1, "start_time": datetime(2024, 7, 1, 8, 0, 0), "end_time": datetime(2024, 7, 1, 10, 0, 0), "parameters": "水温25度，清洗时间30分钟", "operator": "王师傅"},
        {"batch_id": 1, "seed_batch_code": "SB-2024-001", "process_name": "脱壳", "process_order": 2, "start_time": datetime(2024, 7, 1, 10, 30, 0), "end_time": datetime(2024, 7, 1, 13, 0, 0), "parameters": "转速1200rpm", "operator": "李师傅"},
        {"batch_id": 1, "seed_batch_code": "SB-2024-001", "process_name": "筛选", "process_order": 3, "start_time": datetime(2024, 7, 1, 13, 30, 0), "end_time": datetime(2024, 7, 1, 15, 30, 0), "parameters": "筛网孔径8mm", "operator": "张师傅"},
        {"batch_id": 1, "seed_batch_code": "SB-2024-001", "process_name": "包装", "process_order": 4, "start_time": datetime(2024, 7, 1, 16, 0, 0), "end_time": datetime(2024, 7, 1, 18, 0, 0), "parameters": "真空包装，每袋5kg", "operator": "刘师傅"},
        {"batch_id": 2, "seed_batch_code": "SB-2024-002", "process_name": "清洗", "process_order": 1, "start_time": datetime(2024, 7, 3, 8, 0, 0), "end_time": datetime(2024, 7, 3, 10, 0, 0), "parameters": "水温25度，清洗时间30分钟", "operator": "王师傅"},
        {"batch_id": 2, "seed_batch_code": "SB-2024-002", "process_name": "脱壳", "process_order": 2, "start_time": datetime(2024, 7, 3, 10, 30, 0), "end_time": datetime(2024, 7, 3, 12, 30, 0), "parameters": "转速1200rpm", "operator": "李师傅"},
        {"batch_id": 2, "seed_batch_code": "SB-2024-002", "process_name": "筛选", "process_order": 3, "start_time": datetime(2024, 7, 3, 13, 0, 0), "end_time": datetime(2024, 7, 3, 14, 30, 0), "parameters": "筛网孔径6mm", "operator": "张师傅"},
        {"batch_id": 2, "seed_batch_code": "SB-2024-002", "process_name": "包装", "process_order": 4, "start_time": datetime(2024, 7, 3, 15, 0, 0), "end_time": datetime(2024, 7, 3, 16, 30, 0), "parameters": "真空包装，每袋5kg", "operator": "刘师傅"},
        {"batch_id": 3, "seed_batch_code": "SB-2024-003", "process_name": "筛选", "process_order": 1, "start_time": datetime(2024, 7, 5, 8, 0, 0), "end_time": datetime(2024, 7, 5, 10, 0, 0), "parameters": "筛网孔径10mm", "operator": "张师傅"},
        {"batch_id": 3, "seed_batch_code": "SB-2024-003", "process_name": "压榨", "process_order": 2, "start_time": datetime(2024, 7, 5, 10, 30, 0), "end_time": datetime(2024, 7, 5, 16, 0, 0), "parameters": "温度120度，压力20MPa", "operator": "王师傅"},
    ]
    for pr in processing_records:
        if not db.query(ProcessingRecord).filter(ProcessingRecord.batch_id == pr["batch_id"], ProcessingRecord.process_order == pr["process_order"]).first():
            record = ProcessingRecord(**pr)
            db.add(record)
    db.commit()
    print("✓ 创建工序记录数据")

    inventory_items = [
        {"warehouse_id": 3, "item_code": "IT-001", "item_name": "花生仁（一级）", "batch_code": "PB-2024-001", "seed_batch_code": "SB-2024-001", "processing_batch_id": 1, "quantity": 800, "unit": "kg", "min_stock": 200, "storage_location": "成品库-A区", "status": "in_stock"},
        {"warehouse_id": 3, "item_code": "IT-002", "item_name": "花生仁（二级）", "batch_code": "PB-2024-002", "seed_batch_code": "SB-2024-002", "processing_batch_id": 2, "quantity": 500, "unit": "kg", "min_stock": 150, "storage_location": "成品库-B区", "status": "in_stock"},
        {"warehouse_id": 3, "item_code": "IT-003", "item_name": "花生油", "batch_code": "PB-2024-003", "seed_batch_code": "SB-2024-003", "processing_batch_id": 3, "quantity": 50, "unit": "kg", "min_stock": 100, "storage_location": "成品库-C区", "status": "in_stock"},
        {"warehouse_id": 1, "item_code": "IT-004", "item_name": "花育25号种子", "batch_code": "SB-2024-001", "seed_batch_code": "SB-2024-001", "quantity": 0, "unit": "kg", "min_stock": 500, "storage_location": "A仓库-01区", "status": "in_stock"},
        {"warehouse_id": 1, "item_code": "IT-005", "item_name": "隆平花生1号种子", "batch_code": "SB-2024-003", "seed_batch_code": "SB-2024-003", "quantity": 4000, "unit": "kg", "min_stock": 500, "storage_location": "B仓库-01区", "status": "in_stock"},
        {"warehouse_id": 2, "item_code": "IT-006", "item_name": "吡虫啉", "batch_code": "PC-2024-001", "quantity": 15, "unit": "kg", "min_stock": 20, "storage_location": "农药库-A区", "status": "in_stock"},
        {"warehouse_id": 2, "item_code": "IT-007", "item_name": "多菌灵", "batch_code": "PC-2024-002", "quantity": 80, "unit": "kg", "min_stock": 30, "storage_location": "农药库-A区", "status": "in_stock"},
        {"warehouse_id": 2, "item_code": "IT-008", "item_name": "高效氯氰菊酯", "batch_code": "PC-2024-003", "quantity": 45, "unit": "kg", "min_stock": 25, "storage_location": "农药库-B区", "status": "in_stock"},
    ]
    for ii in inventory_items:
        if not db.query(InventoryItem).filter(InventoryItem.item_code == ii["item_code"]).first():
            item = InventoryItem(**ii)
            db.add(item)
    db.commit()
    print("✓ 创建库存数据")

    inventory_transactions = [
        {"item_id": 1, "transaction_type": "入库", "quantity": 3500, "unit": "kg", "transaction_date": date(2024, 7, 1)},
        {"item_id": 1, "transaction_type": "出库", "quantity": 1200, "unit": "kg", "transaction_date": date(2024, 7, 2)},
        {"item_id": 1, "transaction_type": "出库", "quantity": 1500, "unit": "kg", "transaction_date": date(2024, 7, 6)},
        {"item_id": 2, "transaction_type": "入库", "quantity": 2100, "unit": "kg", "transaction_date": date(2024, 7, 3)},
        {"item_id": 2, "transaction_type": "出库", "quantity": 1600, "unit": "kg", "transaction_date": date(2024, 7, 4)},
        {"item_id": 3, "transaction_type": "入库", "quantity": 800, "unit": "kg", "transaction_date": date(2024, 7, 5)},
        {"item_id": 3, "transaction_type": "出库", "quantity": 750, "unit": "kg", "transaction_date": date(2024, 7, 6)},
        {"item_id": 6, "transaction_type": "出库", "quantity": 85, "unit": "kg", "transaction_date": date(2024, 6, 15)},
    ]
    for it in inventory_transactions:
        if not db.query(InventoryTransaction).filter(InventoryTransaction.item_id == it["item_id"], InventoryTransaction.transaction_date == it["transaction_date"]).first():
            transaction = InventoryTransaction(**it)
            db.add(transaction)
    db.commit()
    print("✓ 创建出入库记录数据")

    customers = [
        {"customer_code": "CUS001", "name": "青岛福临门食品有限公司", "contact_name": "周经理", "phone": "13500135000", "address": "山东省青岛市黄岛区", "credit_limit": 100000},
        {"customer_code": "CUS002", "name": "济南银座超市", "contact_name": "吴经理", "phone": "13600136000", "address": "山东省济南市历下区", "credit_limit": 50000},
        {"customer_code": "CUS003", "name": "潍坊农贸市场", "contact_name": "郑老板", "phone": "13700137001", "address": "山东省潍坊市奎文区", "credit_limit": 30000},
        {"customer_code": "CUS004", "name": "北京华联综合超市", "contact_name": "冯经理", "phone": "13800138001", "address": "北京市朝阳区", "credit_limit": 200000},
        {"customer_code": "CUS005", "name": "上海联华超市", "contact_name": "陈经理", "phone": "13900139001", "address": "上海市浦东新区", "credit_limit": 150000},
    ]
    for c in customers:
        if not db.query(Customer).filter(Customer.customer_code == c["customer_code"]).first():
            customer = Customer(**c, is_active=True)
            db.add(customer)
    db.commit()
    print("✓ 创建客户数据")

    orders = [
        {"order_no": "SO-2024-001", "customer_id": 1, "total_amount": 22200.0, "order_date": date(2024, 7, 2), "delivery_date": date(2024, 7, 4), "status": "completed", "payment_status": "paid"},
        {"order_no": "SO-2024-002", "customer_id": 2, "total_amount": 15000.0, "order_date": date(2024, 7, 3), "delivery_date": date(2024, 7, 5), "status": "shipped", "payment_status": "paid"},
        {"order_no": "SO-2024-003", "customer_id": 3, "total_amount": 9000.0, "order_date": date(2024, 7, 4), "delivery_date": date(2024, 7, 7), "status": "pending", "payment_status": "unpaid"},
        {"order_no": "SO-2024-004", "customer_id": 4, "total_amount": 37000.0, "order_date": date(2024, 7, 6), "delivery_date": date(2024, 7, 10), "status": "pending", "payment_status": "unpaid"},
        {"order_no": "SO-2024-005", "customer_id": 1, "total_amount": 27750.0, "order_date": date(2024, 7, 7), "delivery_date": date(2024, 7, 11), "status": "pending", "payment_status": "unpaid"},
    ]
    for so in orders:
        if not db.query(Order).filter(Order.order_no == so["order_no"]).first():
            order = Order(**so)
            db.add(order)
    db.commit()
    print("✓ 创建销售订单数据")

    order_items = [
        {"order_id": 1, "item_code": "IT-001", "item_name": "花生仁（一级）", "batch_code": "PB-2024-001", "seed_batch_code": "SB-2024-001", "processing_batch_id": 1, "quantity": 1200, "unit": "kg", "unit_price": 18.5, "amount": 22200.0, "product_grade": "一级"},
        {"order_id": 2, "item_code": "IT-002", "item_name": "花生仁（二级）", "batch_code": "PB-2024-002", "seed_batch_code": "SB-2024-002", "processing_batch_id": 2, "quantity": 1000, "unit": "kg", "unit_price": 15.0, "amount": 15000.0, "product_grade": "二级"},
        {"order_id": 3, "item_code": "IT-002", "item_name": "花生仁（二级）", "batch_code": "PB-2024-002", "seed_batch_code": "SB-2024-002", "processing_batch_id": 2, "quantity": 600, "unit": "kg", "unit_price": 15.0, "amount": 9000.0, "product_grade": "二级"},
        {"order_id": 4, "item_code": "IT-001", "item_name": "花生仁（一级）", "batch_code": "PB-2024-001", "seed_batch_code": "SB-2024-001", "processing_batch_id": 1, "quantity": 1000, "unit": "kg", "unit_price": 18.5, "amount": 18500.0, "product_grade": "一级"},
        {"order_id": 4, "item_code": "IT-003", "item_name": "花生油", "batch_code": "PB-2024-003", "seed_batch_code": "SB-2024-003", "processing_batch_id": 3, "quantity": 400, "unit": "kg", "unit_price": 45.0, "amount": 18000.0, "product_grade": "一级"},
        {"order_id": 5, "item_code": "IT-001", "item_name": "花生仁（一级）", "batch_code": "PB-2024-001", "seed_batch_code": "SB-2024-001", "processing_batch_id": 1, "quantity": 1500, "unit": "kg", "unit_price": 18.5, "amount": 27750.0, "product_grade": "一级"},
    ]
    for oi in order_items:
        if not db.query(OrderItem).filter(OrderItem.order_id == oi["order_id"], OrderItem.item_code == oi["item_code"]).first():
            item = OrderItem(**oi)
            db.add(item)
    db.commit()
    print("✓ 创建订单明细数据")

    farming_activities = [
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "activity_type": "播种", "activity_date": date(2024, 5, 1), "description": "人工点播，行距42cm，株距16cm"},
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "activity_type": "施肥", "activity_date": date(2024, 5, 15), "description": "施用复合肥，每亩30kg"},
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "activity_type": "灌溉", "activity_date": date(2024, 6, 20), "description": "滴灌补水，灌溉量25mm"},
        {"plot_id": 2, "seed_batch_code": "SB-2024-002", "activity_type": "播种", "activity_date": date(2024, 5, 5), "description": "机械播种，行距40cm，株距15cm"},
        {"plot_id": 2, "seed_batch_code": "SB-2024-002", "activity_type": "施肥", "activity_date": date(2024, 5, 18), "description": "施用有机肥，每亩40kg"},
        {"plot_id": 3, "seed_batch_code": "SB-2024-003", "activity_type": "播种", "activity_date": date(2024, 5, 3), "description": "人工点播，行距45cm，株距17cm"},
        {"plot_id": 3, "seed_batch_code": "SB-2024-003", "activity_type": "灌溉", "activity_date": date(2024, 6, 18), "description": "喷灌补水，灌溉量30mm"},
    ]
    for fa in farming_activities:
        if not db.query(FarmingActivity).filter(FarmingActivity.plot_id == fa["plot_id"], FarmingActivity.activity_date == fa["activity_date"]).first():
            activity = FarmingActivity(**fa)
            db.add(activity)
    db.commit()
    print("✓ 创建农事活动数据")

    environmental_data = [
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "record_time": datetime(2024, 7, 8, 12, 0, 0), "temperature": 33.0, "humidity": 62, "soil_moisture": 30, "ph_value": 7.0},
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "record_time": datetime(2024, 7, 7, 12, 0, 0), "temperature": 32.5, "humidity": 64, "soil_moisture": 31, "ph_value": 7.0},
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "record_time": datetime(2024, 7, 6, 12, 0, 0), "temperature": 31.8, "humidity": 66, "soil_moisture": 32, "ph_value": 7.0},
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "record_time": datetime(2024, 7, 5, 12, 0, 0), "temperature": 33.2, "humidity": 60, "soil_moisture": 29, "ph_value": 7.1},
        {"plot_id": 1, "seed_batch_code": "SB-2024-001", "record_time": datetime(2024, 7, 4, 12, 0, 0), "temperature": 30.5, "humidity": 68, "soil_moisture": 33, "ph_value": 7.0},
        {"plot_id": 2, "seed_batch_code": "SB-2024-002", "record_time": datetime(2024, 7, 8, 12, 0, 0), "temperature": 32.8, "humidity": 65, "soil_moisture": 28, "ph_value": 6.8},
        {"plot_id": 2, "seed_batch_code": "SB-2024-002", "record_time": datetime(2024, 7, 7, 12, 0, 0), "temperature": 32.0, "humidity": 67, "soil_moisture": 29, "ph_value": 6.8},
        {"plot_id": 3, "seed_batch_code": "SB-2024-003", "record_time": datetime(2024, 7, 8, 12, 0, 0), "temperature": 33.5, "humidity": 60, "soil_moisture": 27, "ph_value": 7.2},
        {"plot_id": 3, "seed_batch_code": "SB-2024-003", "record_time": datetime(2024, 7, 7, 12, 0, 0), "temperature": 34.0, "humidity": 58, "soil_moisture": 26, "ph_value": 7.2},
    ]
    for ed in environmental_data:
        if not db.query(EnvironmentalData).filter(EnvironmentalData.plot_id == ed["plot_id"], EnvironmentalData.record_time == ed["record_time"]).first():
            data = EnvironmentalData(**ed)
            db.add(data)
    db.commit()
    print("✓ 创建环境监测数据")

    sensors_data = [
        {"device_id": "TEMP-SENSOR-001", "name": "温度传感器-1号区", "type": "temperature", "location": "山东省临沂市河东区", "plot_code": "PLOT001", "seed_batch_code": "SB-2024-001", "threshold": 35},
        {"device_id": "HUMI-SENSOR-001", "name": "湿度传感器-1号区", "type": "humidity", "location": "山东省临沂市河东区", "plot_code": "PLOT001", "seed_batch_code": "SB-2024-001", "threshold": 85},
        {"device_id": "SOIL-SENSOR-001", "name": "土壤湿度传感器-1号区", "type": "soil_moisture", "location": "山东省临沂市河东区", "plot_code": "PLOT001", "seed_batch_code": "SB-2024-001", "threshold": 90},
        {"device_id": "TEMP-SENSOR-002", "name": "温度传感器-2号区", "type": "temperature", "location": "山东省临沂市兰山区", "plot_code": "PLOT002", "seed_batch_code": "SB-2024-002", "threshold": 35},
        {"device_id": "HUMI-SENSOR-002", "name": "湿度传感器-2号区", "type": "humidity", "location": "山东省临沂市兰山区", "plot_code": "PLOT002", "seed_batch_code": "SB-2024-002", "threshold": 85},
        {"device_id": "PH-SENSOR-001", "name": "pH传感器-3号区", "type": "ph", "location": "山东省日照市莒县", "plot_code": "PLOT003", "seed_batch_code": "SB-2024-003", "threshold": 8.5},
        {"device_id": "TEMP-SENSOR-003", "name": "温度传感器-3号区", "type": "temperature", "location": "山东省日照市莒县", "plot_code": "PLOT003", "seed_batch_code": "SB-2024-003", "threshold": 35},
        {"device_id": "PEST-SENSOR-001", "name": "农药残留传感器-1号区", "type": "pesticide", "location": "山东省临沂市河东区", "plot_code": "PLOT001", "seed_batch_code": "SB-2024-001", "threshold": 0.05},
        {"device_id": "CO2-SENSOR-001", "name": "CO2传感器-5号区", "type": "co2", "location": "山东省泰安市宁阳县", "plot_code": "PLOT005", "seed_batch_code": "SB-2024-005", "threshold": 5000},
        {"device_id": "LIGHT-SENSOR-001", "name": "光照传感器-1号区", "type": "light", "location": "山东省临沂市河东区", "plot_code": "PLOT001", "seed_batch_code": "SB-2024-001", "threshold": 100000},
    ]
    for sd in sensors_data:
        if not db.query(Sensor).filter(Sensor.device_id == sd["device_id"]).first():
            sensor = Sensor(**sd)
            db.add(sensor)
    db.commit()
    print("✓ 创建传感器数据")

    from datetime import datetime, timedelta

    measurements_data = []
    now = datetime.now()

    temp_sensor_1 = db.query(Sensor).filter(Sensor.device_id == "TEMP-SENSOR-001").first()
    humi_sensor_1 = db.query(Sensor).filter(Sensor.device_id == "HUMI-SENSOR-001").first()
    soil_sensor_1 = db.query(Sensor).filter(Sensor.device_id == "SOIL-SENSOR-001").first()
    temp_sensor_2 = db.query(Sensor).filter(Sensor.device_id == "TEMP-SENSOR-002").first()
    humi_sensor_2 = db.query(Sensor).filter(Sensor.device_id == "HUMI-SENSOR-002").first()
    ph_sensor_1 = db.query(Sensor).filter(Sensor.device_id == "PH-SENSOR-001").first()
    temp_sensor_3 = db.query(Sensor).filter(Sensor.device_id == "TEMP-SENSOR-003").first()
    pest_sensor_1 = db.query(Sensor).filter(Sensor.device_id == "PEST-SENSOR-001").first()

    if temp_sensor_1:
        for i in range(20):
            measurements_data.append({
                "sensor_id": temp_sensor_1.id,
                "seed_batch_code": "SB-2024-001",
                "timestamp": now - timedelta(minutes=i * 5),
                "item_name": "温度",
                "value": round(28 + (i % 10) * 0.5 + (i % 5) * 0.3, 2),
                "unit": "℃",
                "is_over_limit": False,
            })

    if humi_sensor_1:
        for i in range(20):
            measurements_data.append({
                "sensor_id": humi_sensor_1.id,
                "seed_batch_code": "SB-2024-001",
                "timestamp": now - timedelta(minutes=i * 5),
                "item_name": "湿度",
                "value": round(55 + (i % 8) * 2 + (i % 4) * 1.5, 1),
                "unit": "%RH",
                "is_over_limit": False,
            })

    if soil_sensor_1:
        for i in range(20):
            measurements_data.append({
                "sensor_id": soil_sensor_1.id,
                "seed_batch_code": "SB-2024-001",
                "timestamp": now - timedelta(minutes=i * 5),
                "item_name": "土壤湿度",
                "value": round(28 + (i % 6) * 1.5 + (i % 3) * 0.8, 1),
                "unit": "%",
                "is_over_limit": False,
            })

    if temp_sensor_2:
        for i in range(15):
            measurements_data.append({
                "sensor_id": temp_sensor_2.id,
                "seed_batch_code": "SB-2024-002",
                "timestamp": now - timedelta(minutes=i * 6),
                "item_name": "温度",
                "value": round(30 + (i % 8) * 0.6 + (i % 4) * 0.4, 2),
                "unit": "℃",
                "is_over_limit": False,
            })

    if humi_sensor_2:
        for i in range(15):
            measurements_data.append({
                "sensor_id": humi_sensor_2.id,
                "seed_batch_code": "SB-2024-002",
                "timestamp": now - timedelta(minutes=i * 6),
                "item_name": "湿度",
                "value": round(58 + (i % 7) * 2.5 + (i % 3) * 1, 1),
                "unit": "%RH",
                "is_over_limit": False,
            })

    if ph_sensor_1:
        for i in range(12):
            measurements_data.append({
                "sensor_id": ph_sensor_1.id,
                "seed_batch_code": "SB-2024-003",
                "timestamp": now - timedelta(minutes=i * 8),
                "item_name": "pH值",
                "value": round(6.5 + (i % 6) * 0.15 + (i % 3) * 0.1, 2),
                "unit": "",
                "is_over_limit": False,
            })

    if temp_sensor_3:
        for i in range(12):
            measurements_data.append({
                "sensor_id": temp_sensor_3.id,
                "seed_batch_code": "SB-2024-003",
                "timestamp": now - timedelta(minutes=i * 8),
                "item_name": "温度",
                "value": round(29 + (i % 9) * 0.4 + (i % 5) * 0.3, 2),
                "unit": "℃",
                "is_over_limit": False,
            })

    if pest_sensor_1:
        for i in range(8):
            measurements_data.append({
                "sensor_id": pest_sensor_1.id,
                "seed_batch_code": "SB-2024-001",
                "timestamp": now - timedelta(hours=i * 2),
                "item_name": "农药残留",
                "value": round(0.015 + (i % 4) * 0.005 + (i % 2) * 0.003, 3),
                "unit": "mg/kg",
                "is_over_limit": False,
            })

    for md in measurements_data:
        if not db.query(Measurement).filter(
            Measurement.sensor_id == md["sensor_id"],
            Measurement.timestamp == md["timestamp"],
            Measurement.item_name == md["item_name"]
        ).first():
            measurement = Measurement(**md)
            db.add(measurement)
    db.commit()
    print("✓ 创建测量数据")

    print("\n✅ 数据库初始化完成！")
    print("📊 数据统计：")
    print(f"   - 用户：{db.query(User).count()} 人")
    print(f"   - 角色：{db.query(Role).count()} 个")
    print(f"   - 仓库：{db.query(Warehouse).count()} 个")
    print(f"   - 供应商：{db.query(SeedSupplier).count()} 家")
    print(f"   - 种子批次：{db.query(SeedBatch).count()} 个")
    print(f"   - 种植地块：{db.query(Plot).count()} 块")
    print(f"   - 农药：{db.query(Pesticide).count()} 种")
    print(f"   - 检测报告：{db.query(InspectionReport).count()} 份")
    print(f"   - 加工批次：{db.query(ProcessingBatch).count()} 个")
    print(f"   - 库存：{db.query(InventoryItem).count()} 项")
    print(f"   - 订单：{db.query(Order).count()} 笔")
    print(f"   - 传感器：{db.query(Sensor).count()} 个")
    print(f"   - 测量数据：{db.query(Measurement).count()} 条")
    print(f"\n✓ 初始化完成，请通过种子数据接口创建管理员账号")

except Exception as e:
    db.rollback()
    print(f"\n❌ 初始化失败: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
