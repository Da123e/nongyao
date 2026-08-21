from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from app.core.database import get_db
from app.core.certificate import (
    get_system_root_certificates,
    get_user_certificates,
    verify_certificate_with_system_root,
    sign_data_with_user_certificate,
    verify_data_with_user_certificate,
    get_certificate_by_subject,
    sign_with_private_key,
    verify_with_public_key,
)
from app.models.auth import Certificate, User, Organization
from app.auth import get_current_active_user, require_permission

router = APIRouter()


@router.get("/system/root")
async def get_system_root_certs():
    certificates = get_system_root_certificates()
    return {
        "status": "success",
        "data": certificates,
        "count": len(certificates),
        "message": "已加载Windows系统根证书库"
    }


@router.get("/system/user")
async def get_system_user_certs():
    certificates = get_user_certificates()
    return {
        "status": "success",
        "data": certificates,
        "count": len(certificates),
        "message": "已加载当前用户证书库"
    }


@router.post("/system/verify")
async def verify_cert_with_system(cert_data: Dict[str, Any]):
    cert_pem = cert_data.get("certificate")
    if not cert_pem:
        raise HTTPException(status_code=400, detail="缺少证书内容")
    
    result = verify_certificate_with_system_root(cert_pem)
    if not result["valid"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.get("/my")
async def get_my_certificate(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    cert = get_certificate_by_subject(db, "user", current_user.id)

    if not cert:
        return {"status": "success", "data": None, "message": "尚未颁发证书"}

    return {
        "status": "success",
        "data": {
            "certificate_id": cert.certificate_id,
            "certificate_type": cert.certificate_type,
            "subject_type": cert.subject_type,
            "subject_id": cert.subject_id,
            "issuer": cert.issuer,
            "serial_number": cert.serial_number,
            "status": cert.status,
            "valid_from": cert.valid_from.isoformat(),
            "valid_until": cert.valid_until.isoformat(),
            "public_key": cert.public_key
        }
    }


@router.post("/sign")
async def sign_with_my_certificate(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    data_str = str(data)
    signature = sign_data_with_user_certificate(db, current_user.id, data_str)

    if not signature:
        if current_user.private_key:
            signature = sign_with_private_key(current_user.private_key, data_str)
    
    if not signature:
        raise HTTPException(status_code=400, detail="签名失败：用户未颁发证书或证书无效")

    return {
        "status": "success",
        "signature": signature,
        "signed_data": data_str,
        "user_id": current_user.id
    }


@router.post("/verify-sign")
async def verify_signature(
    user_id: int,
    data: Dict[str, Any],
    signature: str,
    db: Session = Depends(get_db)
):
    data_str = str(data)
    is_valid = verify_data_with_user_certificate(db, user_id, data_str, signature)

    if not is_valid:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.public_key:
            is_valid = verify_with_public_key(user.public_key, data_str, signature)

    return {
        "status": "success",
        "is_valid": is_valid,
        "user_id": user_id
    }