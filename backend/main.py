from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from app.core.database import engine, Base
from app.core.config import settings
import traceback
import subprocess
import os
import socket
import time
import signal
import json

# ===== 统一时区（中国时区 Asia/Shanghai） =====
# 作为"第一道防线"：让 Python 的 datetime.now() 按北京时间计算，
# 避免部署到 UTC 的 Docker 容器时所有 now() 错 8 小时。
# 另外 Column default 和 routers 中的显式 datetime.now 调用仍会通过 app/core/timezone.py now_cn_naive()
# 做二次保障，双保险不会错。
os.environ.setdefault("TZ", "Asia/Shanghai")
try:
    import time as _time
    if hasattr(_time, "tzset"):
        _time.tzset()
except Exception:  # Windows 没有 tzset，忽略即可（Windows 系统本身就是本地时区）
    pass

ganache_process = None
ipfs_process = None
_is_initialized = False

def check_port(port):
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', port))
        sock.close()
        return result == 0
    except:
        return False

def wait_for_port(port, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        if check_port(port):
            return True
        time.sleep(1)
    return False

def start_ganache():
    global ganache_process, _is_initialized
    if _is_initialized:
        return
    ganache_port = 7545
    
    if check_port(ganache_port):
        print(f"[INFO] 端口 {ganache_port} 已被占用（可能是之前启动的进程），跳过启动Ganache")
        return
    
    ganache_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "node_modules", ".bin", "ganache.cmd")
    if not os.path.exists(ganache_path):
        ganache_path = "ganache"
    
    print(f"[INFO] 启动 Ganache 区块链节点 (端口 {ganache_port})")
    try:
        ganache_process = subprocess.Popen(
            f"{ganache_path} --port {ganache_port}",
            shell=True,
            creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        )
        if wait_for_port(ganache_port, timeout=15):
            print(f"[INFO] Ganache 区块链节点启动成功")
        else:
            print(f"[WARNING] Ganache 启动超时，区块链功能可能不可用")
    except Exception as e:
        print(f"[ERROR] 启动 Ganache 失败: {e}")

def start_ipfs():
    global ipfs_process
    ipfs_api_port = 5001
    
    if check_port(ipfs_api_port):
        print(f"[INFO] 端口 {ipfs_api_port} 已被占用（可能是之前启动的进程），跳过启动IPFS")
        return
    
    ipfs_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ipfs_bin", "kubo", "ipfs.exe")
    if not os.path.exists(ipfs_path):
        print(f"[WARNING] 未找到 IPFS 可执行文件: {ipfs_path}")
        return
    
    print(f"[INFO] 启动 IPFS 节点 (端口 {ipfs_api_port})")
    try:
        ipfs_process = subprocess.Popen(
            f"{ipfs_path} daemon",
            shell=True,
            creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        )
        if wait_for_port(ipfs_api_port, timeout=20):
            print(f"[INFO] IPFS 节点启动成功")
        else:
            print(f"[WARNING] IPFS 启动超时")
    except Exception as e:
        print(f"[ERROR] 启动 IPFS 失败: {e}")

def deploy_contract_if_needed():
    from web3 import Web3
    
    print(f"[INFO] 检查智能合约部署状态...")
    try:
        w3 = Web3(Web3.HTTPProvider(settings.GANACHE_URL))
        
        if not w3.is_connected():
            print(f"[WARNING] 无法连接到区块链节点，跳过合约部署")
            return
        
        contract_address_file = os.path.join(os.path.dirname(__file__), "contracts", "contract_address.txt")
        contract_abi_file = os.path.join(os.path.dirname(__file__), "contracts", "PeanutTrace.json")
        
        if not os.path.exists(contract_abi_file):
            print(f"[WARNING] 合约ABI文件不存在: {contract_abi_file}")
            return
        
        with open(contract_abi_file, "r") as f:
            contract_data = json.load(f)
        
        abi = contract_data["abi"]
        bytecode = contract_data.get("bytecode", "")
        
        if not bytecode:
            print(f"[WARNING] 合约字节码为空")
            return
        
        existing_address = None
        if os.path.exists(contract_address_file):
            with open(contract_address_file, "r") as f:
                existing_address = f.read().strip()
        
        if existing_address:
            try:
                contract = w3.eth.contract(address=existing_address, abi=abi)
                contract.functions.recordCount().call()
                print(f"[INFO] 智能合约已部署在地址: {existing_address}")
                return
            except Exception as e:
                print(f"[WARNING] 现有合约地址无效或合约未部署: {e}")
                print(f"[INFO] 重新部署智能合约...")
        
        print(f"[INFO] 正在部署智能合约...")
        contract = w3.eth.contract(abi=abi, bytecode=bytecode)
        deploy_tx_hash = contract.constructor().transact({
            "from": w3.eth.accounts[0],
            "gas": 6000000
        })
        
        print(f"[INFO] 部署交易哈希: {deploy_tx_hash.hex()}")
        tx_receipt = w3.eth.wait_for_transaction_receipt(deploy_tx_hash)
        contract_address = tx_receipt.contractAddress
        
        with open(contract_address_file, "w") as f:
            f.write(contract_address)
        
        print(f"[INFO] 智能合约部署成功！地址: {contract_address}")
        
    except Exception as e:
        print(f"[ERROR] 合约部署失败: {e}")

def cleanup_processes(signum=None, frame=None):
    global ganache_process, ipfs_process
    print("\n[INFO] 正在停止所有服务...")
    if ganache_process:
        try:
            print("[INFO] 停止 Ganache")
            if os.name == 'nt':
                subprocess.run(f"taskkill /F /PID {ganache_process.pid} /T", shell=True, capture_output=True)
            else:
                ganache_process.send_signal(signal.SIGTERM)
        except Exception as e:
            print(f"[ERROR] 停止 Ganache 失败: {e}")
    if ipfs_process:
        try:
            print("[INFO] 停止 IPFS")
            if os.name == 'nt':
                subprocess.run(f"taskkill /F /PID {ipfs_process.pid} /T", shell=True, capture_output=True)
            else:
                ipfs_process.send_signal(signal.SIGTERM)
        except Exception as e:
            print(f"[ERROR] 停止 IPFS 失败: {e}")

start_ganache()
start_ipfs()
time.sleep(2)
deploy_contract_if_needed()
_is_initialized = True

from app import auth, routers, ws

signal.signal(signal.SIGINT, cleanup_processes)
signal.signal(signal.SIGTERM, cleanup_processes)

Base.metadata.create_all(bind=engine)

def migrate_environmental_data_columns():
    """自动补齐 environmental_data 表的新列（若不存在）。同时兼容 MySQL(INFORMATION_SCHEMA) 和 SQLite(PRAGMA table_info)。"""
    from sqlalchemy import text
    from app.core.database import SessionLocal, SQLALCHEMY_DATABASE_URL
    is_sqlite = str(SQLALCHEMY_DATABASE_URL).startswith("sqlite")
    columns = {
        'soil_temperature': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'土壤温度(soil_multi专用，区分空气温度temperature)\'',
        'illumination': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'光照强度(lux)\'',
        'wind_speed': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'风速(m/s)\'',
        'conductivity': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'电导率(us/cm)\'',
        'nitrogen': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'氮(mg/kg)\'',
        'phosphorus': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'磷(mg/kg)\'',
        'potassium': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'钾(mg/kg)\'',
        'salinity': 'FLOAT NULL' if is_sqlite else 'FLOAT NULL COMMENT \'盐分(mg/kg)\'',
        'data_source': 'VARCHAR(50) NULL' if is_sqlite else 'VARCHAR(50) NULL COMMENT \'数据来源：sensor=硬件上传/manual=农残手动录入\'',
    }
    db = SessionLocal()
    try:
        if is_sqlite:
            rows = db.execute(text("PRAGMA table_info(environmental_data)")).fetchall()
            # PRAGMA 结果：(cid, name, type, notnull, dflt_value, pk)，列名取第 2 位 name
            existing = {r[1] for r in rows}
        else:
            rows = db.execute(text(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='environmental_data'"
            )).fetchall()
            existing = {r[0] for r in rows}
        for col, ddl in columns.items():
            if col not in existing:
                db.execute(text(f"ALTER TABLE environmental_data ADD COLUMN {col} {ddl}"))
                print(f"[INFO] 数据库迁移：environmental_data 新增列 {col}")
        db.commit()
    except Exception as e:
        print(f"[WARNING] 数据库迁移 environmental_data 列失败（可忽略）: {e}")
        db.rollback()
    finally:
        db.close()


def migrate_measurements_columns():
    """自动补齐 measurements 表的新列（传感器历史记录关联地块/批次的反查列）。MySQL / SQLite 双兼容。"""
    from sqlalchemy import text
    from app.core.database import SessionLocal, SQLALCHEMY_DATABASE_URL
    is_sqlite = str(SQLALCHEMY_DATABASE_URL).startswith("sqlite")
    columns = {
        'plot_code': 'VARCHAR(50) NULL' if is_sqlite else 'VARCHAR(50) NULL COMMENT \'上传时刻绑定的地块编码，sensor 切换地块后历史记录仍可溯源\'',
        'source_hint': 'VARCHAR(32) NULL' if is_sqlite else 'VARCHAR(32) NULL COMMENT \'数据来源标记：SIMULATED/MANUAL_HARDWARE/HARDWARE_RS485，用于前端区分模拟/硬件\'',
    }
    db = SessionLocal()
    try:
        if is_sqlite:
            rows = db.execute(text("PRAGMA table_info(measurements)")).fetchall()
            existing = {r[1] for r in rows}
        else:
            rows = db.execute(text(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='measurements'"
            )).fetchall()
            existing = {r[0] for r in rows}
        for col, ddl in columns.items():
            if col not in existing:
                db.execute(text(f"ALTER TABLE measurements ADD COLUMN {col} {ddl}"))
                print(f"[INFO] 数据库迁移：measurements 新增列 {col}")
        db.commit()
    except Exception as e:
        print(f"[WARNING] 数据库迁移 measurements 列失败（可忽略）: {e}")
        db.rollback()
    finally:
        db.close()


def migrate_blockchain_records_columns():
    """
    blockchain_records 增加 seed_batch_code 语义化批次列。
    溯源接口（/seed/batches/{code}/full-chain）要同时按 seed_batch_id（历史字段）
    和 seed_batch_code（推荐字段）匹配，此函数保证该列在旧数据库里也能补上。
    MySQL / SQLite 双兼容。
    """
    from sqlalchemy import text
    from app.core.database import SessionLocal, SQLALCHEMY_DATABASE_URL
    is_sqlite = str(SQLALCHEMY_DATABASE_URL).startswith("sqlite")
    columns = {
        'seed_batch_code': 'VARCHAR(100) NULL' if is_sqlite else 'VARCHAR(100) NULL COMMENT \'语义化批次编码(PB2026-001)，溯源直接反查\'',
    }
    db = SessionLocal()
    try:
        if is_sqlite:
            rows = db.execute(text("PRAGMA table_info(blockchain_records)")).fetchall()
            existing = {r[1] for r in rows}
        else:
            rows = db.execute(text(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='blockchain_records'"
            )).fetchall()
            existing = {r[0] for r in rows}
        for col, ddl in columns.items():
            if col not in existing:
                db.execute(text(f"ALTER TABLE blockchain_records ADD COLUMN {col} {ddl}"))
                db.execute(text(f"ALTER TABLE blockchain_records ADD INDEX idx_blockchain_records_{col} ({col})"))
                print(f"[INFO] 数据库迁移：blockchain_records 新增列 {col}")
        # 历史记录回填：旧记录只有 seed_batch_id（=语义化批次字符串），同步到 seed_batch_code
        try:
            upd = db.execute(text(
                "UPDATE blockchain_records SET seed_batch_code = seed_batch_id "
                "WHERE seed_batch_code IS NULL AND seed_batch_id IS NOT NULL"
            ))
            if getattr(upd, "rowcount", 0) or True:
                print(f"[INFO] 数据库迁移：blockchain_records 回填 seed_batch_code")
            db.commit()
        except Exception as e:
            print(f"[WARNING] 回填 blockchain_records.seed_batch_code 失败（可忽略）: {e}")
            db.rollback()
    except Exception as e:
        print(f"[WARNING] 数据库迁移 blockchain_records 列失败（可忽略）: {e}")
        db.rollback()
    finally:
        db.close()


migrate_environmental_data_columns()
migrate_measurements_columns()
migrate_blockchain_records_columns()

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    from app.auth import seed_data
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        await seed_data(db)
        print("[INFO] 初始化数据成功")
    except Exception as e:
        print(f"[WARNING] 初始化数据失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()
    yield
    cleanup_processes()

app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, redirect_slashes=False, lifespan=lifespan)

# CORS 来源：FRONTEND_URL 配置 + 常见本地开发地址
# DEBUG=True 时额外放行局域网 IP，便于同一 WiFi 下的手机扫码调试
cors_origins = {
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
}
if settings.FRONTEND_URL:
    cors_origins.add(settings.FRONTEND_URL.rstrip('/'))

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(cors_origins),
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+" if settings.DEBUG else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(routers.seed.router, prefix="/api/seed", tags=["种子溯源"])
app.include_router(routers.planting.router, prefix="/api/planting", tags=["种植管理"])
app.include_router(routers.pesticide.router, prefix="/api/pesticide", tags=["农药管理"])
app.include_router(routers.inspection.router, prefix="/api/inspection", tags=["检测报告"])
app.include_router(routers.processing.router, prefix="/api/processing", tags=["加工管理"])
app.include_router(routers.inventory.router, prefix="/api/inventory", tags=["库存管理"])
app.include_router(routers.sales.router, prefix="/api/sales", tags=["销售管理"])
app.include_router(routers.blockchain.router, prefix="/api/blockchain", tags=["区块链存证"])
app.include_router(routers.sensors.router, prefix="/api/sensors", tags=["传感器"])
app.include_router(routers.measurements.router, prefix="/api/measurements", tags=["测量数据"])
app.include_router(routers.certificates.router, prefix="/api/certificates", tags=["证书管理"])
app.include_router(routers.organizations.router, prefix="/api/organizations", tags=["组织管理"])
app.include_router(routers.notifications.router, prefix="/api", tags=["通知"])
app.include_router(routers.statistics.router, prefix="/api", tags=["统计"])
app.include_router(routers.operations.router, prefix="/api", tags=["操作日志"])

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_detail = traceback.format_exc()
    print(f"ERROR: {error_detail}")
    if settings.DEBUG:
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc), "traceback": error_detail},
        )
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试"},
    )


@app.get("/")
async def root():
    return {"message": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/health")
async def health_check():
    # 真实探测：执行一次 SELECT 1 验证数据库连接；失败则明确返回 unhealthy 503
    from app.core.database import SessionLocal
    from sqlalchemy import text
    db_ok = False
    db_msg = "unreachable"
    try:
        with SessionLocal() as sess:
            sess.execute(text("SELECT 1")).fetchone()
            db_ok = True
            db_msg = "ok"
    except Exception as e:  # noqa: BLE001
        db_msg = f"error: {type(e).__name__}"
    overall = "healthy" if db_ok else "unhealthy"
    from fastapi import status as http_status
    if db_ok:
        return {"status": overall, "database": db_msg}
    return JSONResponse(
        status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": overall, "database": db_msg},
    )


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if token:
        try:
            from jose import jwt
            from app.core.config import settings
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            username = payload.get("sub")
            if username:
                print(f"[INFO] WebSocket authenticated user: {username}")
            else:
                await websocket.close(code=1008)
                return
        except Exception as e:
            print(f"[WARNING] WebSocket token validation failed: {e}")
            await websocket.close(code=1008)
            return
    else:
        await websocket.close(code=1008)
        return
    
    await ws.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        await ws.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
