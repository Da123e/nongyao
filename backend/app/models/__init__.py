# 统一模型导出（所有 Base 子类必须在此注册，否则 create_all 不会建表）

# --- 认证 / 权限 / 系统 ---
from app.models.auth import (
    Base,
    User,
    Role,
    Permission,
    UserRole,
    RolePermission,
    Organization,
    Certificate,
    Notification,
)

# --- 种子溯源 ---
from app.models.seed import SeedSupplier, SeedBatch

# --- 种植 / 地块 / 环境 ---
from app.models.planting import (
    Plot,
    PlantingRecord,
    FarmingActivity,
    EnvironmentalData,
    HarvestRecord,
)

# --- 农药 ---
from app.models.pesticide import (
    Pesticide,
    PesticidePurchase,
    PesticideApplication,
    FieldResidueTest,
)

# --- 检测报告 ---
from app.models.inspection import InspectionReport, PesticideResidueTest

# --- 加工 ---
from app.models.processing import ProcessingBatch, ProcessingRecord, ProductQualityTest

# --- 库存 ---
from app.models.inventory import Warehouse, InventoryItem, InventoryTransaction, StorageRecord

# --- 销售 ---
from app.models.sales import Order, OrderItem, Customer, SalesRecord

# --- 区块链 / IPFS ---
from app.models.blockchain import BlockchainRecord, IPFSFile

# --- 传感器 / 测量数据 ---
from app.models.sensors import Sensor, Measurement

__all__ = [
    # Base / metadata
    "Base",
    # auth
    "User",
    "Role",
    "Permission",
    "UserRole",
    "RolePermission",
    "Organization",
    "Certificate",
    "Notification",
    # seed
    "SeedSupplier",
    "SeedBatch",
    # planting
    "Plot",
    "PlantingRecord",
    "FarmingActivity",
    "EnvironmentalData",
    "HarvestRecord",
    # pesticide
    "Pesticide",
    "PesticidePurchase",
    "PesticideApplication",
    "FieldResidueTest",
    # inspection
    "InspectionReport",
    "PesticideResidueTest",
    # processing
    "ProcessingBatch",
    "ProcessingRecord",
    "ProductQualityTest",
    # inventory
    "Warehouse",
    "InventoryItem",
    "InventoryTransaction",
    "StorageRecord",
    # sales
    "Order",
    "OrderItem",
    "Customer",
    "SalesRecord",
    # blockchain
    "BlockchainRecord",
    "IPFSFile",
    # sensors
    "Sensor",
    "Measurement",
]
