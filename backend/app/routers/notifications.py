from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from app.core.database import get_db
from app.auth import get_current_active_user
from app.models.auth import User, Notification
from datetime import datetime
from app.core.timezone import now_cn_naive

router = APIRouter()


@router.get("/notifications")
async def get_notifications(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    notifications = db.query(Notification).filter(
        Notification.user_id == current_user.id
    ).order_by(desc(Notification.created_at)).all()

    unread_count = db.query(func.count(Notification.id)).filter(
        Notification.user_id == current_user.id,
        Notification.read == False
    ).scalar()

    result = []
    now = now_cn_naive()
    for n in notifications:
        if n.created_at:
            delta = now - n.created_at
            minutes_ago = int(delta.total_seconds() / 60)
        else:
            minutes_ago = 0
        if minutes_ago < 60:
            time_str = f"{minutes_ago}分钟前"
        elif minutes_ago < 1440:
            time_str = f"{int(minutes_ago / 60)}小时前"
        else:
            time_str = f"{int(minutes_ago / 1440)}天前"

        result.append({
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "message": n.message,
            "time": time_str,
            "read": n.read,
        })

    return {
        "status": "success",
        "data": result,
        "count": len(result),
        "unread_count": unread_count or 0,
    }


@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()

    if not notification:
        raise HTTPException(status_code=404, detail="通知不存在")

    notification.read = True
    db.commit()
    db.refresh(notification)

    return {
        "status": "success",
        "message": "通知已标记为已读",
        "notification_id": notification_id,
    }


@router.post("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read == False
    ).update({"read": True})
    db.commit()

    return {
        "status": "success",
        "message": "所有通知已标记为已读",
    }
