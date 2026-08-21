from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any, Tuple
import logging
from app.core.database import get_db
from app.core.blockchain import (
    add_record_to_blockchain, get_blockchain_data, verify_chain_integrity,
    generate_new_batch_id, calculate_hash, sign_data, verify_signature,
    generate_ecdsa_key_pair, is_connected
)
from app.core.certificate import (
    sign_data_with_user_certificate, get_certificate_by_subject,
    get_certificate_private_key
)
from app.core.ipfs import add_file_to_ipfs, get_file_from_ipfs, verify_file_integrity, add_json_data, get_ipfs_status, pin_file
from app.core.qrcode_generator import generate_trace_qrcode
from app.models.blockchain import BlockchainRecord, IPFSFile
from app.models.auth import User, Role
from app.auth import get_current_active_user, require_permission
from datetime import datetime
import json

router = APIRouter()


def get_data_signature(db: Session, user_id: int, data_hash: str) -> Optional[str]:
    cert_signature = sign_data_with_user_certificate(db, user_id, data_hash)
    if cert_signature:
        return cert_signature

    user = db.query(User).filter(User.id == user_id).first()
    if user and user.private_key:
        try:
            return sign_data(data_hash, user.private_key)
        except:
            pass

    return None


async def parse_request_data(request: Request, file: Optional[UploadFile] = None) -> Tuple[Dict[str, Any], Optional[bytes], Optional[str]]:
    """根据请求内容类型解析数据，支持JSON和multipart/form-data两种方式。
    返回 (data, file_content, filename) 三元组。
    """
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        data = {}
        for key, value in form.items():
            if isinstance(value, str):
                if value.lower() in ("true", "false"):
                    data[key] = value.lower() == "true"
                else:
                    try:
                        data[key] = json.loads(value)
                    except (json.JSONDecodeError, TypeError):
                        data[key] = value
        file_content = None
        filename = None
        if file is not None:
            file_content = await file.read()
            filename = file.filename
        return data, file_content, filename
    else:
        data = await request.json()
        return data, None, None


@router.get("/connection/status")
async def check_blockchain_connection():
    connected = is_connected()
    ipfs_status = get_ipfs_status()
    return {
        "blockchain": {
            "connected": connected,
            "network": "Ganache Ethereum Testnet"
        },
        "ipfs": ipfs_status
    }


@router.get("/ipfs/status")
async def check_ipfs_status():
    return get_ipfs_status()


@router.post("/ipfs/pin")
async def pin_ipfs_file(
    request: Request,
    current_user: User = Depends(get_current_active_user),
):
    data = await request.json()
    ipfs_hash = data.get("ipfs_hash")
    
    if not ipfs_hash:
        raise HTTPException(status_code=400, detail="缺少IPFS哈希值")
    
    result = pin_file(ipfs_hash)
    return result


@router.post("/batch-id/generate")
async def generate_new_batch_id_endpoint(
    prefix: str = "PB",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("seed:manage", current_user, db)
    batch_id = generate_new_batch_id(prefix)
    return {"batch_id": batch_id}


@router.post("/seed/register")
async def register_seed_batch(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("seed:manage", current_user, db)

    seed_batch_code = data.get("batch_code")
    if not seed_batch_code:
        seed_batch_code = generate_new_batch_id("SB")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "seed_registration"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id=seed_batch_code,
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id=seed_batch_code,
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

        # 种子批次成功上链后通知管理员
        try:
            from app.utils.notifications_helper import notify_seed_batch_registered
            notify_seed_batch_registered(
                db,
                batch_code=seed_batch_code,
                variety_name=data.get("variety_name"),
                uploader=current_user.real_name or current_user.username,
            )
            db.commit()
        except Exception as e:
            logging.getLogger(__name__).warning(f"notify_seed_batch_registered failed: {e}")

    return {
        "message": "种子批次已成功上链",
        "batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/planting/record")
async def record_planting_data(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("planting:manage", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "planting_record"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "种植记录已成功上链",
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/pesticide/application")
async def record_pesticide_application(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("pesticide:record", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "pesticide_application"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "农药施用记录已成功上链",
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/residue/test")
async def record_residue_test(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("inspection:quality", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    is_over_limit = data.get("is_over_limit", False)
    if is_over_limit:
        data["alert"] = "农残超标预警"

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "residue_test"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "农残检测记录已成功上链",
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
        "alert": data.get("alert"),
    }


@router.post("/harvest/record")
async def record_harvest(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("planting:manage", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    harvest_code = data.get("harvest_code") or generate_new_batch_id("HV")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "harvest_record"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id=harvest_code,
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id=harvest_code,
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "采收记录已成功上链",
        "harvest_code": harvest_code,
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/processing/batch")
async def record_processing_batch(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("processing:manage", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    processing_batch_code = data.get("batch_code") or generate_new_batch_id("PC")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "processing_batch"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id=processing_batch_code,
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id=processing_batch_code,
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "加工批次已成功上链",
        "processing_batch_code": processing_batch_code,
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/product/test")
async def record_product_test(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("inspection:quality", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "product_test"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "产品检测记录已成功上链",
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/storage/record")
async def record_storage(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("inventory:manage", current_user, db)

    seed_batch_code = data.get("seed_batch_code")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "storage_record"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "仓储记录已成功上链",
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/logistics/record")
async def record_logistics(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("sales:manage", current_user, db)

    seed_batch_code = data.get("seed_batch_code")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "logistics_record"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "物流记录已成功上链",
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/sales/record")
async def record_sales(
    request: Request,
    file: UploadFile = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data, file_content, filename = await parse_request_data(request, file)
    await require_permission("sales:manage", current_user, db)

    seed_batch_code = data.get("seed_batch_code")
    if not seed_batch_code:
        raise HTTPException(status_code=400, detail="缺少种子批次号")

    ipfs_hash = None
    if file_content:
        ipfs_result = add_file_to_ipfs(file_content, filename or "file.bin")
        if ipfs_result.get('success'):
            ipfs_hash = ipfs_result.get('ipfs_hash')

    data_hash = calculate_hash(data)
    record_type = "sales_record"

    signature = get_data_signature(db, current_user.id, data_hash)

    result = add_record_to_blockchain(
        record_type=record_type,
        batch_id="",
        seed_batch_id=seed_batch_code,
        data_hash=data_hash,
        ipfs_hash=ipfs_hash,
        uploader_type=current_user.organization_type or "user",
        signature=signature
    )

    if result.get('success', False):
        blockchain_record = BlockchainRecord(
            batch_id="",
            seed_batch_id=seed_batch_code,
            data_type=record_type,
            data_hash=data_hash,
            ipfs_hash=ipfs_hash,
            blockchain_hash=result.get('block_hash'),
            transaction_hash=result.get('transaction_hash'),
            block_number=result.get('block_number'),
            is_on_chain=True,
            uploaded_by=current_user.id,
            uploaded_at=datetime.now()
        )
        db.add(blockchain_record)
        db.commit()

    return {
        "message": "销售记录已成功上链",
        "seed_batch_id": seed_batch_code,
        "block_hash": result.get('block_hash'),
        "block_number": result.get('block_number'),
        "transaction_hash": result.get('transaction_hash'),
        "data_hash": data_hash,
        "ipfs_hash": ipfs_hash,
    }


@router.post("/qrcode/generate")
async def generate_qrcode_endpoint(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    data = await request.json()
    batch_id = data.get("batch_id")
    seed_batch_id = data.get("seed_batch_id")

    if not batch_id or not seed_batch_id:
        raise HTTPException(status_code=400, detail="缺少批次号参数")

    qrcode_data = generate_trace_qrcode(batch_id, seed_batch_id)

    return {
        "batch_id": batch_id,
        "seed_batch_id": seed_batch_id,
        "qrcode": qrcode_data,
        "trace_url": f"http://localhost:8000/api/blockchain/consumer/trace/{seed_batch_id}"
    }


@router.get("/trace/{seed_batch_code}")
async def get_trace_chain(
    seed_batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)

    blockchain_data = get_blockchain_data(seed_batch_code)

    if not blockchain_data.get('success', True):
        return {
            'success': False,
            'error': blockchain_data.get('error', '区块链查询失败'),
            'seed_batch_code': seed_batch_code,
            'message': '区块链节点未连接或功能未启用',
            'chain': [],
            'network': blockchain_data.get('network', 'None')
        }

    return blockchain_data


@router.get("/verify/{seed_batch_code}")
async def verify_batch_integrity(
    seed_batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)

    result = verify_chain_integrity(seed_batch_code)

    if not result.get('success', True):
        return {
            'success': False,
            'error': result.get('error', '区块链查询失败'),
            'seed_batch_code': seed_batch_code,
            'message': '区块链节点未连接或功能未启用，无法进行链上验证',
            'is_chain_valid': False,
            'total_blocks': 0,
            'details': [],
            'file_integrity': [],
            'network': result.get('network', 'None')
        }

    records = result.get('details', [])
    file_integrity = []

    for record in records:
        ipfs_hash = record.get('ipfs_hash')
        if ipfs_hash:
            try:
                file_content = get_file_from_ipfs(ipfs_hash)
                file_integrity.append({
                    "ipfs_hash": ipfs_hash,
                    "is_intact": file_content is not None,
                    "file_size": len(file_content) if file_content else 0,
                })
            except Exception as e:
                file_integrity.append({
                    "ipfs_hash": ipfs_hash,
                    "is_intact": False,
                    "error": str(e),
                })

    result["file_integrity"] = file_integrity

    return result


@router.get("/consumer/trace/{seed_batch_code}")
async def consumer_trace_query(
    seed_batch_code: str,
    db: Session = Depends(get_db),
):
    blockchain_data = get_blockchain_data(seed_batch_code)

    if not blockchain_data.get('success', True):
        return {
            'success': False,
            'error': blockchain_data.get('error', '区块链查询失败'),
            'seed_batch_code': seed_batch_code,
            'message': '区块链节点未连接或功能未启用',
            'chain_length': 0,
            'is_chain_valid': False,
            'trace_data': [],
        }

    records = blockchain_data.get('chain', [])
    public_chain_data = []

    for record in records:
        block_type = record.get("type")

        public_data = {
            "stage": _get_stage_name(block_type),
            "type": block_type,
            "timestamp": record.get("timestamp"),
        }

        public_chain_data.append(public_data)

    return {
        "success": True,
        "seed_batch_code": seed_batch_code,
        "chain_length": len(public_chain_data),
        "is_chain_valid": blockchain_data.get('is_chain_valid', True),
        "trace_data": public_chain_data,
    }





@router.post("/key/generate")
async def generate_key_pair_endpoint(
    current_user: User = Depends(get_current_active_user),
):
    private_key, public_key = generate_ecdsa_key_pair()
    return {
        "private_key": private_key,
        "public_key": public_key,
    }


@router.post("/signature/verify")
async def verify_signature_endpoint(
    request: Request,
):
    data = await request.json()
    data_str = data.get("data")
    signature = data.get("signature")
    public_key = data.get("public_key")

    if not data_str or not signature or not public_key:
        raise HTTPException(status_code=400, detail="缺少验证参数")

    is_valid = verify_signature(data_str, signature, public_key)

    return {
        "is_valid": is_valid,
    }


@router.get("/ipfs/file/{ipfs_hash}")
async def download_ipfs_file(
    ipfs_hash: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)

    file_content = get_file_from_ipfs(ipfs_hash)
    if file_content is None:
        raise HTTPException(status_code=404, detail="文件不存在")

    from fastapi.responses import FileResponse
    from starlette.background import BackgroundTask
    import tempfile
    import os

    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
        f.write(file_content)
        temp_path = f.name

    return FileResponse(
        temp_path,
        media_type="application/octet-stream",
        filename=f"{ipfs_hash}.bin",
        background=BackgroundTask(os.unlink, temp_path),
    )


def _get_stage_name(block_type: str) -> str:
    stage_map = {
        "seed_registration": "种子源头入库",
        "planting_record": "田间种植",
        "pesticide_application": "农药施用",
        "residue_test": "农残检测",
        "harvest_record": "采收",
        "processing_batch": "深加工",
        "product_test": "成品检测",
        "storage_record": "仓储",
        "logistics_record": "物流",
        "sales_record": "终端销售",
    }
    return stage_map.get(block_type, block_type)
