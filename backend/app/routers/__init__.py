from .seed import router as seed_router
from .planting import router as planting_router
from .pesticide import router as pesticide_router
from .inspection import router as inspection_router
from .processing import router as processing_router
from .inventory import router as inventory_router
from .sales import router as sales_router
from .blockchain import router as blockchain_router
from .sensors import router as sensors_router
from .measurements import router as measurements_router
from .certificates import router as certificates_router
from .organizations import router as organizations_router
from .notifications import router as notifications_router
from .statistics import router as statistics_router
from .operations import router as operations_router

from . import seed
from . import planting
from . import pesticide
from . import inspection
from . import processing
from . import inventory
from . import sales
from . import blockchain
from . import sensors
from . import measurements
from . import certificates
from . import organizations
from . import notifications
from . import statistics
from . import operations

routers = [
    seed_router,
    planting_router,
    pesticide_router,
    inspection_router,
    processing_router,
    inventory_router,
    sales_router,
    blockchain_router,
    sensors_router,
    measurements_router,
    certificates_router,
    organizations_router,
    notifications_router,
    statistics_router,
    operations_router,
]

__all__ = [
    "seed",
    "planting",
    "pesticide",
    "inspection",
    "processing",
    "inventory",
    "sales",
    "blockchain",
    "sensors",
    "measurements",
    "certificates",
    "organizations",
    "notifications",
    "statistics",
    "operations",
]