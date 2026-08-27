"""
统一中国时区时间工具（Asia/Shanghai, UTC+8）。

原因：后端部署在 UTC 时区容器时，datetime.now() 会比北京时间少 8 小时。
统一使用 Asia/Shanghai 作为唯一时间来源；写入 MySQL DATETIME 列时
保存为无 tzinfo 的"北京时间墙钟时间"，避免 aware datetime 写入时被
SQLAlchemy/PyMySQL 做时区转换导致值偏差。
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

# Python 3.9+ zoneinfo；3.8 环境兜底用 pytz 或手动 offset
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - 3.8 兜底
    ZoneInfo = None  # type: ignore[assignment,misc]

# UTC+8 固定偏移（不需要 DST，中国全年无夏令时）
_CN = timezone(timedelta(hours=8)) if ZoneInfo is None else ZoneInfo("Asia/Shanghai")


def now_cn() -> datetime:
    """返回北京时间当前时刻（带 tzinfo=Asia/Shanghai 的 aware datetime）"""
    return datetime.now(tz=_CN)


def now_cn_naive() -> datetime:
    """返回北京时间当前时刻，但 **去掉 tzinfo**。
    这是写入 MySQL DATETIME 列的推荐模式：存的数字字面量就是"北京时间墙钟时间"。
    避免 SQLAlchemy + PyMySQL 在 aware datetime 写入时做时区转换减 8h 导致值错。"""
    return now_cn().replace(tzinfo=None)


def now_cn_default():
    """给 SQLAlchemy Column DateTime(..., default=now_cn_default) 当 callable 用。
    每次调用返回新的 naive 北京时间 datetime，保证每一行独立时间。"""
    return now_cn_naive()


def today_cn_date() -> datetime.date:
    """返回北京时间的今日日期"""
    return now_cn().date()


__all__ = [
    "now_cn",
    "now_cn_naive",
    "now_cn_default",
    "today_cn_date",
    "_CN",
]
