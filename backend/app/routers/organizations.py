from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Dict, Any, Optional
import logging
import csv
import io
from app.core.database import get_db
from app.models.auth import Organization, User
from app.auth import get_current_active_user, require_permission
from datetime import datetime
from app.core.timezone import now_cn_naive

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("")
async def list_organizations(
    keyword: str = Query(None, description="按名称或编码模糊搜索"),
    type: str = Query(None, description="按组织类型过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("system:manage", current_user, db)

    query = db.query(Organization).filter(Organization.is_active == True)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(Organization.name.like(like), Organization.org_code.like(like)))
    if type:
        query = query.filter(Organization.type == type)

    total = query.count()
    organizations = query.order_by(Organization.created_at.desc())\
        .offset((page - 1) * page_size)\
        .limit(page_size)\
        .all()

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
        "total": total,
        "page": page,
        "page_size": page_size,
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
    try:
        db.commit()
        db.refresh(new_org)
    except Exception as e:
        db.rollback()
        logger.exception("创建组织失败 org_code=%s: %s", org_code, e)
        raise HTTPException(status_code=500, detail="创建组织失败")

    return {
        "status": "success",
        "message": "组织创建成功",
        "data": {
            "id": new_org.id,
            "org_code": new_org.org_code,
            "name": new_org.name,
        },
    }


@router.get("/export")
async def export_organizations(
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """导出机构列表为 CSV 文件"""
    await require_permission("system:manage", current_user, db)
    query = db.query(Organization)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            Organization.name.like(like),
            Organization.org_code.like(like),
            Organization.contact_name.like(like),
            Organization.phone.like(like),
        ))
    orgs = query.order_by(Organization.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["机构编码", "机构名称", "类型", "联系人", "电话", "地址", "创建时间"])
    type_map = {"supplier": "供应商", "customer": "客户", "partner": "合作伙伴", "internal": "内部"}
    for o in orgs:
        writer.writerow([
            o.org_code or "",
            o.name or "",
            type_map.get(o.type, o.type or ""),
            o.contact_name or "",
            o.phone or "",
            o.address or "",
            o.created_at.strftime("%Y-%m-%d %H:%M:%S") if o.created_at else "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=organizations_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@router.post("/import")
async def import_organizations(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """从 CSV 文件导入机构列表"""
    await require_permission("system:manage", current_user, db)
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="请上传 CSV 文件")

    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    type_rev = {"供应商": "supplier", "客户": "customer", "合作伙伴": "partner", "内部": "internal"}
    imported = 0
    skipped = 0
    errors = []

    for row in reader:
        try:
            code = row.get("机构编码", "").strip()
            name = row.get("机构名称", "").strip()
            if not code or not name:
                skipped += 1
                continue
            existing = db.query(Organization).filter(Organization.org_code == code).first()
            if existing:
                skipped += 1
                continue
            org = Organization(
                org_code=code,
                name=name,
                type=type_rev.get(row.get("类型", "").strip(), "partner"),
                contact_name=row.get("联系人", "").strip() or None,
                phone=row.get("电话", "").strip() or None,
                address=row.get("地址", "").strip() or None,
            )
            db.add(org)
            imported += 1
        except Exception as e:
            errors.append(f"行 {imported + skipped + len(errors) + 1}: {str(e)}")
            skipped += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("导入机构失败")
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")

    return {
        "status": "success",
        "message": f"导入完成：成功 {imported} 条，跳过 {skipped} 条",
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
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

    org.updated_at = now_cn_naive()
    try:
        db.commit()
        db.refresh(org)
    except Exception as e:
        db.rollback()
        logger.exception("更新组织失败 org_id=%s: %s", org_id, e)
        raise HTTPException(status_code=500, detail="组织更新失败")

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
    org.updated_at = now_cn_naive()
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("删除组织失败 org_id=%s: %s", org_id, e)
        raise HTTPException(status_code=500, detail="组织删除失败")

    return {
        "status": "success",
        "message": "组织已删除",
    }