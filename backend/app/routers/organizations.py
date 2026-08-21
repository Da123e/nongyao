from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from app.core.database import get_db
from app.models.auth import Organization, User
from app.auth import get_current_active_user, require_permission
from datetime import datetime

router = APIRouter()


@router.get("")
async def list_organizations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    organizations = db.query(Organization).filter(Organization.is_active == True).all()
    return {
        "status": "success",
        "data": [
            {
                "id": org.id,
                "org_code": org.org_code,
                "name": org.name,
                "type": org.type,
                "contact_name": org.contact_name,
                "phone": org.phone,
                "address": org.address,
                "public_key": org.public_key,
                "is_active": org.is_active,
                "created_at": org.created_at.isoformat() if org.created_at else None,
            }
            for org in organizations
        ],
        "count": len(organizations),
    }


@router.post("")
async def create_organization(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    name = data.get("name")
    org_code = data.get("org_code")
    org_type = data.get("type", "enterprise")

    if not name or not org_code:
        raise HTTPException(status_code=400, detail="组织名称和组织编码为必填项")

    existing = db.query(Organization).filter(Organization.org_code == org_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="组织编码已存在")

    new_org = Organization(
        org_code=org_code,
        name=name,
        type=org_type,
        contact_name=data.get("contact_name"),
        phone=data.get("phone"),
        address=data.get("address"),
    )
    db.add(new_org)
    db.commit()
    db.refresh(new_org)

    return {
        "status": "success",
        "message": "组织创建成功",
        "data": {
            "id": new_org.id,
            "org_code": new_org.org_code,
            "name": new_org.name,
        },
    }


@router.get("/{org_id}")
async def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")

    return {
        "status": "success",
        "data": {
            "id": org.id,
            "org_code": org.org_code,
            "name": org.name,
            "type": org.type,
            "contact_name": org.contact_name,
            "phone": org.phone,
            "address": org.address,
            "public_key": org.public_key,
            "is_active": org.is_active,
            "created_at": org.created_at.isoformat() if org.created_at else None,
            "updated_at": org.updated_at.isoformat() if org.updated_at else None,
        },
    }


@router.put("/{org_id}")
async def update_organization(
    org_id: int,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")

    if "name" in data:
        org.name = data["name"]
    if "type" in data:
        org.type = data["type"]
    if "contact_name" in data:
        org.contact_name = data["contact_name"]
    if "phone" in data:
        org.phone = data["phone"]
    if "address" in data:
        org.address = data["address"]
    if "is_active" in data:
        org.is_active = data["is_active"]

    org.updated_at = datetime.now()
    db.commit()
    db.refresh(org)

    return {
        "status": "success",
        "message": "组织更新成功",
    }


@router.delete("/{org_id}")
async def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")

    org.is_active = False
    org.updated_at = datetime.now()
    db.commit()

    return {
        "status": "success",
        "message": "组织已删除",
    }