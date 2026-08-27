# -*- coding: utf-8 -*-
"""
============================================================================
 金生链 · 全参数土壤(RS485版本) 传感器采集桥接脚本
 参考 PDF：全参数土壤(RS485版本).pdf（寄存器表 4.3）
============================================================================
 功能：
   1) 通过 USB 转 RS485 CH340 串口读取 Modbus-RTU 寄存器（PDF 4.3 寄存器表）
   2) 解析成 9 项环境参数（土壤温湿度 / pH / NPK / EC / 盐分 / TDS）
   3) POST 到后端 /measurements/data → 入库 → WebSocket 广播 → 首页 6 项实时跳动
   4) 双运行模式：
        · 默认纯硬件：串口无响应则持续报错并定时重试，不写入模拟数据
        · --simulate 纯模拟：无硬件时生成环境参数，测量记录标注 SIMULATED 来源
   5) 启动参数按 COM3 / 9600 / 地址 0x01 默认（和用户设备管理器里 CH340 完全一致），
      用户插上传感器后不用改任何参数直接 python rs485_bridge.py 即可。
============================================================================
 使用：
   # 1. 最简单（插上 CH340 直接跑）
   python rs485_bridge.py

   # 2. 指定参数
   python rs485_bridge.py --com COM3 --baud 9600 --address 1 \
        --device_id SOIL-PLOT-A --plot_code PLOT-A --interval 5

   # 3. 模拟模式（无硬件时生成环境参数，记录标注 SIMULATED）
   python rs485_bridge.py --simulate --device_id SOIL-PLOT-A --plot_code PLOT-A
============================================================================
"""

from __future__ import annotations

import os
import sys
import time
import json
import math
import random
import struct
import logging
import argparse
import traceback
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple

import requests

# ---------- 免安装兼容：受限环境装不上 pyserial / requests 时自动用 serial_compat 兼容层 ----------
try:
    import serial  # noqa: F401
except Exception:
    import serial_compat  # noqa: F401  —— 会在 sys.modules 里注入 serial / requests
    import serial  # type: ignore[no-redef]  # noqa: F401

# ---------- 日志 ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rs485_bridge")

# ---------- Modbus 寄存器表（PDF 4.3 版） ----------
# 地址 读取顺序：0x0000 ~ 0x0008，共 9 个寄存器，一次功能码 0x03 读完
REGISTER_LAYOUT: List[Dict[str, Any]] = [
    {
        "key": "soil_moisture",
        "reg": 0x0000,
        "label": "土壤湿度",
        "unit": "%",
        "decode": lambda v: v / 10.0,
        "range": (0.0, 100.0),
        "home6": True,
    },
    {
        "key": "soil_temperature",
        "reg": 0x0001,
        "label": "土壤温度",
        "unit": "°C",
        "signed": True,
        # PDF: 寄存器内容为 INT16（-200 ~ 800）→ 统一除以 10 得 -20.0 ~ 80.0 °C
        "decode": lambda v: v / 10.0,
        "range": (-20.0, 80.0),
        "home6": True,
    },
    {
        "key": "conductivity",
        "reg": 0x0002,
        "label": "电导率",
        "unit": "μS/cm",
        "decode": lambda v: float(v),
        "range": (0.0, 20000.0),
        "home6": False,
    },
    {
        "key": "ph_value",
        "reg": 0x0003,
        "label": "pH 值",
        "unit": "",
        "decode": lambda v: v / 10.0,  # PDF: 30~100 → 3.0 ~ 10.0
        "range": (3.0, 10.0),
        "home6": True,
    },
    {
        "key": "nitrogen",
        "reg": 0x0004,
        "label": "氮",
        "unit": "mg/kg",
        "decode": lambda v: float(v),
        "range": (0.0, 2000.0),
        "home6": True,
    },
    {
        "key": "phosphorus",
        "reg": 0x0005,
        "label": "磷",
        "unit": "mg/kg",
        "decode": lambda v: float(v),
        "range": (0.0, 2000.0),
        "home6": True,
    },
    {
        "key": "potassium",
        "reg": 0x0006,
        "label": "钾",
        "unit": "mg/kg",
        "decode": lambda v: float(v),
        "range": (0.0, 2000.0),
        "home6": True,
    },
    {
        "key": "salinity",
        "reg": 0x0007,
        "label": "盐分",
        "unit": "mg/kg",
        "decode": lambda v: float(v),
        "range": (0.0, 2000.0),
        "home6": False,
    },
    {
        "key": "tds",
        "reg": 0x0008,
        "label": "TDS",
        "unit": "mg/kg",
        "decode": lambda v: float(v),
        "range": (0.0, 2000.0),
        "home6": False,
    },
]
REG_START = 0x0000
REG_COUNT = 9
READ_FUNC = 0x03
REG_SIGNED_MASK = [bool(layout.get("signed", False)) for layout in REGISTER_LAYOUT]

# ---------- Modbus CRC16 (查表法，CRC 低字节在前) ----------
CRC_TABLE = [
    0x0000, 0xC0C1, 0xC181, 0x0140, 0xC301, 0x03C0, 0x0280, 0xC241,
    0xC601, 0x06C0, 0x0780, 0xC741, 0x0500, 0xC5C1, 0xC481, 0x0440,
    0xCC01, 0x0CC0, 0x0D80, 0xCD41, 0x0F00, 0xCFC1, 0xCE81, 0x0E40,
    0x0A00, 0xCAC1, 0xCB81, 0x0B40, 0xC901, 0x09C0, 0x0880, 0xC841,
    0xD801, 0x18C0, 0x1980, 0xD941, 0x1B00, 0xDBC1, 0xDA81, 0x1A40,
    0x1E00, 0xDEC1, 0xDF81, 0x1F40, 0xDD01, 0x1DC0, 0x1C80, 0xDC41,
    0x1400, 0xD4C1, 0xD581, 0x1540, 0xD701, 0x17C0, 0x1680, 0xD641,
    0xD201, 0x12C0, 0x1380, 0xD341, 0x1100, 0xD1C1, 0xD081, 0x1040,
    0xF001, 0x30C0, 0x3180, 0xF141, 0x3300, 0xF3C1, 0xF281, 0x3240,
    0x3600, 0xF6C1, 0xF781, 0x3740, 0xF501, 0x35C0, 0x3480, 0xF441,
    0x3C00, 0xFCC1, 0xFD81, 0x3D40, 0xFF01, 0x3FC0, 0x3E80, 0xFE41,
    0xFA01, 0x3AC0, 0x3B80, 0xFB41, 0x3900, 0xF9C1, 0xF881, 0x3840,
    0x2800, 0xE8C1, 0xE981, 0x2940, 0xEB01, 0x2BC0, 0x2A80, 0xEA41,
    0xEE01, 0x2EC0, 0x2F80, 0xEF41, 0x2D00, 0xEDC1, 0xEC81, 0x2C40,
    0xE401, 0x24C0, 0x2580, 0xE541, 0x2700, 0xE7C1, 0xE681, 0x2640,
    0x2200, 0xE2C1, 0xE381, 0x2340, 0xE101, 0x21C0, 0x2080, 0xE041,
    0xA001, 0x60C0, 0x6180, 0xA141, 0x6300, 0xA3C1, 0xA281, 0x6240,
    0x6600, 0xA6C1, 0xA781, 0x6740, 0xA501, 0x65C0, 0x6480, 0xA441,
    0x6C00, 0xACC1, 0xAD81, 0x6D40, 0xAF01, 0x6FC0, 0x6E80, 0xAE41,
    0xAA01, 0x6AC0, 0x6B80, 0xAB41, 0x6900, 0xA9C1, 0xA881, 0x6840,
    0x7800, 0xB8C1, 0xB981, 0x7940, 0xBB01, 0x7BC0, 0x7A80, 0xBA41,
    0xBE01, 0x7EC0, 0x7F80, 0xBF41, 0x7D00, 0xBDC1, 0xBC81, 0x7C40,
    0xB401, 0x74C0, 0x7580, 0xB541, 0x7700, 0xB7C1, 0xB681, 0x7640,
    0x7200, 0xB2C1, 0xB381, 0x7340, 0xB101, 0x71C0, 0x7080, 0xB041,
    0x5000, 0x90C1, 0x9181, 0x5140, 0x9301, 0x53C0, 0x5280, 0x9241,
    0x9601, 0x56C0, 0x5780, 0x9741, 0x5500, 0x95C1, 0x9481, 0x5440,
    0x9C01, 0x5CC0, 0x5D80, 0x9D41, 0x5F00, 0x9FC1, 0x9E81, 0x5E40,
    0x5A00, 0x9AC1, 0x9B81, 0x5B40, 0x9901, 0x59C0, 0x5880, 0x9841,
    0x8801, 0x48C0, 0x4980, 0x8941, 0x4B00, 0x8BC1, 0x8A81, 0x4A40,
    0x4E00, 0x8EC1, 0x8F81, 0x4F40, 0x8D00, 0x8DC1, 0x8C81, 0x4C40,
    0x8401, 0x44C0, 0x4580, 0x8541, 0x4700, 0x87C1, 0x8681, 0x4640,
    0x4200, 0x82C1, 0x8381, 0x4340, 0x8101, 0x41C0, 0x4080, 0x8041,
]

def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc = (crc >> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF]
    return crc & 0xFFFF

def build_rtu_request(slave_addr: int, func: int, reg_start: int, reg_count: int) -> bytes:
    """构 Modbus RTU 0x03 读寄存器请求帧（CRC 低字节在前）。"""
    payload = struct.pack(">BBHH", slave_addr, func, reg_start, reg_count)
    crc = crc16_modbus(payload)
    return payload + struct.pack("<H", crc)  # little-endian = 低字节先

def parse_rtu_response(resp: bytes, slave_addr: int, func: int, reg_count: int,
                       signed_mask: Optional[List[bool]] = None) -> Optional[List[int]]:
    """
    解析 RTU 响应帧，返回长度 reg_count 的整数列表。
    signed_mask[i] = True 时该寄存器按有符号 INT16 还原（用于负温度等）。
    校验失败 / 长度失败 / CRC 失败返回 None。
    期望长度：地址(1) + 功能(1) + 字节数(1) + 2*reg_count + CRC(2) = 5 + 2*reg_count
    """
    expected = 5 + 2 * reg_count
    if len(resp) != expected:
        log.warning("响应长度不匹配：期望 %d，实际 %d (hex=%s)",
                    expected, len(resp), resp.hex())
        return None
    if resp[0] != slave_addr:
        log.warning("响应从机地址不匹配：0x%02X vs 期望 0x%02X", resp[0], slave_addr)
        return None
    if resp[1] & 0x7F != func:
        # 异常帧：功能码最高位 = 1，后面跟异常码 1 字节 + CRC 2
        if resp[1] & 0x80 and len(resp) >= 5:
            log.error("Modbus 异常帧：异常码 0x%02X", resp[2])
        return None
    byte_count = resp[2]
    if byte_count != 2 * reg_count:
        log.warning("响应字节数不匹配：%d vs 期望 %d", byte_count, 2 * reg_count)
        return None
    # 独立校验 CRC（整帧除了最后 2 字节计算 CRC，要和最后 2 字节（小端）相等）
    calc = crc16_modbus(resp[:-2])
    recv = struct.unpack("<H", resp[-2:])[0]
    if calc != recv:
        log.warning("响应 CRC 校验失败：计算 0x%04X，收到 0x%04X (hex=%s)",
                    calc, recv, resp.hex())
        return None
    regs: List[int] = []
    for i in range(reg_count):
        off = 3 + 2 * i
        if signed_mask and i < len(signed_mask) and signed_mask[i]:
            (val,) = struct.unpack(">h", resp[off:off + 2])
        else:
            (val,) = struct.unpack(">H", resp[off:off + 2])
        regs.append(val)
    return regs


# ---------- 后端通信 ----------
def resolve_token(api: str, token_arg: Optional[str]) -> str:
    """优先参数 token，其次前端 localStorage 缓存文件，最后用 admin/admin123 登录拿一个。"""
    if token_arg:
        return token_arg
    # 前端 localStorage token 路径（浏览器不会直接写文件，但我们约定一个共享 token 位置方便脚本）
    shared = Path(__file__).parent.parent / "frontend" / ".shared-token"
    if shared.exists():
        t = shared.read_text(encoding="utf-8").strip()
        if t:
            return t
    try:
        r = requests.post(
            f"{api.rstrip('/')}/api/auth/token",
            json={"username": "admin", "password": "admin123"},
            timeout=5,
        )
        r.raise_for_status()
        body = r.json()
        t = body.get("access_token") or body.get("token") or (
            body.get("data", {}) if isinstance(body.get("data"), dict) else {}
        ).get("access_token")
        if t:
            try:
                shared.parent.mkdir(parents=True, exist_ok=True)
                shared.write_text(t, encoding="utf-8")
            except Exception:
                pass
            return t
    except Exception as e:
        log.error("自动登录拿 token 失败：%s", e)
    return ""


def ensure_sensor_registered(api: str, token: str, device_id: str, plot_code: str) -> None:
    """如果传感器 device_id 未在后端注册 → 注册一个土壤 multi 传感器，绑定 plot_code。"""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        get = requests.get(
            f"{api.rstrip('/')}/api/sensors/",
            params={"limit": 1000},
            headers=headers,
            timeout=5,
        )
        get.raise_for_status()
        j = get.json()
        existing_list = j if isinstance(j, list) else (
            (j.get("data") if isinstance(j.get("data"), list) else []) or j.get("sensors") or []
        )
        for s in existing_list:
            if isinstance(s, dict) and s.get("device_id") == device_id:
                log.info("✅ 传感器已注册：%s (id=%s)", device_id, s.get("id"))
                return
    except Exception as e:
        log.warning("查询传感器列表失败，跳过注册检查（继续 POST 采集，若后端报 404 再报错）：%s", e)
        return

    sensor_type = "soil_multi"  # 对应 SENSOR_TYPES.soil_multi：默认 10 项
    default_items = [
        {"name": item["label"], "unit": item["unit"], "item_type": "soil"}
        for item in REGISTER_LAYOUT
    ]
    try:
        body = {
            "device_id": device_id,
            "name": f"全参数土壤(RS485) {plot_code or ''}".strip(),
            "type": sensor_type,
            "plot_code": plot_code or None,
            "location": plot_code or "A 区",
            "status": "online",
            "default_items": default_items,
        }
        resp = requests.post(
            f"{api.rstrip('/')}/api/sensors/",
            json=body,
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        s = resp.json()
        sid = s.get("id") or (isinstance(s.get("data"), dict) and s["data"].get("id"))
        log.info("🆕 自动注册传感器成功：%s id=%s", device_id, sid)
    except Exception as e:
        log.warning("自动注册传感器失败（若已有可能是幂等保护，忽略）：%s", e)


def post_measurements(api: str, token: str, device_id: str,
                      plot_code: Optional[str], seed_batch_code: Optional[str],
                      items: List[Dict[str, Any]], source_hint: Optional[str] = None) -> bool:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    payload: Dict[str, Any] = {
        "device_id": device_id,
        "items": items,
    }
    # 整包级 source_hint：传入优先；否则从 items 里取第一个非空值
    if source_hint:
        payload["source_hint"] = source_hint
    else:
        for it in items:
            if isinstance(it, dict) and it.get("source_hint"):
                payload["source_hint"] = it["source_hint"]
                break
    if plot_code:
        payload["plot_code"] = plot_code
    if seed_batch_code:
        payload["seed_batch_code"] = seed_batch_code
    try:
        r = requests.post(
            f"{api.rstrip('/')}/api/measurements/data",
            json=payload,
            headers=headers,
            timeout=8,
        )
        if r.status_code == 401 or r.status_code == 403:
            log.error("POST 鉴权失败：%s，请检查 token 或重新登录后端", r.status_code)
            return False
        if r.status_code >= 400:
            log.warning("POST 数据失败 %d：%s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:
        log.warning("POST 数据网络异常：%s", e)
        return False


# ---------- 采集层：串口 / 模拟 ----------
class ModbusReader:
    def __init__(self, com: str, baud: int, address: int, timeout: float = 0.4):
        import serial
        self.ser = serial.Serial(
            port=com,
            baudrate=baud,
            bytesize=8,
            parity="N",
            stopbits=1,
            timeout=timeout,
        )
        self.address = address
        log.info("🔌 打开串口 %s @ %d baud, 从机地址=%d", com, baud, address)

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass

    def read_once(self) -> Optional[List[int]]:
        req = build_rtu_request(self.address, READ_FUNC, REG_START, REG_COUNT)
        try:
            self.ser.reset_input_buffer()
            self.ser.write(req)
            # 先读期望长度（固定帧），不够的话超时就补等
            expected = 5 + 2 * REG_COUNT
            chunk = self.ser.read(expected)
            if len(chunk) < expected:
                rest = self.ser.read(expected - len(chunk))
                chunk = chunk + rest
            if len(chunk) == 0:
                log.debug("串口无响应（超时 %s）", self.ser.timeout)
                return None
            return parse_rtu_response(chunk, self.address, READ_FUNC, REG_COUNT,
                                       signed_mask=REG_SIGNED_MASK)
        except Exception as e:
            log.warning("串口读取异常：%s", e)
            return None


# ---------- 模拟模式（无硬件时生成环境参数） ----------
class SimulatedReader:
    """生成 9 项寄存器的环境参数（无硬件时用于功能演示）。"""

    def __init__(self):
        self.t0 = time.time()
        # 种子初始值（对应 PDF 合理区间中段）
        self.baseline = {
            "soil_moisture":    (65.0, 8.0),   # μ ± σ
            "soil_temperature": (24.0, 2.5),
            "conductivity":     (420.0, 80.0),
            "ph_value":         (6.6, 0.25),
            "nitrogen":         (175.0, 30.0),
            "phosphorus":       (92.0, 18.0),
            "potassium":        (245.0, 40.0),
            "salinity":         (320.0, 60.0),
            "tds":              (450.0, 90.0),
        }

    def _encode(self, layout: Dict[str, Any], val: float) -> int:
        """逆 PDF 公式，把浮点值编码回 INT16/UINT16"""
        if layout["key"] in ("soil_moisture", "ph_value", "soil_temperature"):
            v = int(round(val * 10))
        else:
            v = int(round(val))
        # 有符号字段：夹到 INT16 范围；无符号字段：夹到 UINT16 范围
        if layout.get("signed"):
            v = max(-32768, min(32767, v))
            # 转成与 struct.pack(">h") 一致的补码表示，但 SimulatedReader 直接返回"逻辑整数"
        else:
            v = max(0, min(65535, v))
        return v

    def read_once(self) -> Optional[List[int]]:
        now = time.time()
        t = (now - self.t0)
        regs: List[int] = []
        for layout in REGISTER_LAYOUT:
            mu, sigma = self.baseline[layout["key"]]
            # 用多个正余弦叠加，加上极小随机抖动，看起来像昼夜节律
            drift = (
                math.sin(t / 97.0) * 0.6
                + math.sin(t / 43.0 + layout["reg"]) * 0.3
                + math.sin(t / 19.0 + layout["reg"] * 0.7) * 0.15
            )
            jitter = random.gauss(0, 0.15)
            value = mu + drift * sigma + jitter * sigma
            value = max(layout["range"][0], min(layout["range"][1], value))
            regs.append(self._encode(layout, value))
        return regs


# ---------- 解析寄存器 → items ----------
def regs_to_items(regs: List[int]) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    items: List[Dict[str, Any]] = []
    values: Dict[str, float] = {}
    for layout, reg in zip(REGISTER_LAYOUT, regs):
        raw_value = layout["decode"](reg)
        lo, hi = layout["range"]
        if raw_value < lo or raw_value > hi:
            log.warning("参数 %s 解码 %.2f 超出 PDF 范围 [%.1f, %.1f]，丢弃该单项",
                        layout["label"], raw_value, lo, hi)
            continue
        items.append({
            "name": layout["label"],
            "value": round(raw_value, 3),
            "unit": layout["unit"],
        })
        values[layout["key"]] = raw_value
    return items, values


# ---------- 主循环 ----------
def run(args: argparse.Namespace) -> None:
    # 1) 拿 token + 注册传感器
    api = args.api.rstrip("/")
    token = resolve_token(api, args.token)
    if not token:
        log.error("❌ 无可用 token。请先登录后端，或用 --token xxx 传入。")
        sys.exit(2)
    log.info("🔐 后端 %s 已获取 token (%d chars)", api, len(token))

    ensure_sensor_registered(api, token, args.device_id, args.plot_code)

    # 2) 构造采集器：两种纯模式，绝不"自动降级到模拟"以免混淆数据来源
    #    · 默认：纯硬件。串口打不开 / 帧无响应就按"硬件错误"打印并每 30s 提示一次，保持纯硬件模式
    #    · --simulate：纯模拟。完全不读串口，只生成环境参数
    reader: Optional[ModbusReader] = None
    sim = SimulatedReader()
    mode: str = "hardware"
    last_hw_fail_log = 0.0

    def open_hw() -> Optional[ModbusReader]:
        try:
            return ModbusReader(args.com, args.baud, args.address)
        except Exception as e:
            log.warning("打开串口失败（%s @ %d）：%s", args.com, args.baud, e)
            return None

    if args.simulate:
        mode = "simulate"
        log.info("🎲 运行模式：纯模拟（请去传感器页面「开始模拟」按钮也能触发同样行为；接上硬件就去掉 --simulate）。")
    else:
        # 纯硬件：失败 100 次也是硬件模式，不会写入一条模拟数据
        reader = open_hw()
        if not reader:
            # 串口打不开（线没插 / COM 号错 / 被其他程序占用）：明确提示，但继续重试
            log.error("❌ 无法打开串口 %s（可能原因：① 端口被其他程序占用；② COM 号不对；③ USB-RS485 线没插牢）。"
                      "脚本将每 30s 重新尝试打开串口，不会写入任何模拟数据。", args.com)
        mode = "hardware"
        print(f"\n{'*'*66}\n * 注意：当前为【纯硬件模式】——硬件没响应时会持续打印错误，不会写入模拟数据。\n"
              f" * 需要环境数据时，请在传感器页面点「开始模拟」，或运行脚本加 --simulate。\n{'*'*66}\n")

    # 3) 循环
    cycle = 0
    try:
        while True:
            cycle += 1
            items: Optional[List[Dict[str, Any]]] = None
            values: Dict[str, float] = {}

            if mode == "simulate":
                regs = sim.read_once()
                if regs:
                    items, values = regs_to_items(regs)
            else:
                # 硬件模式：串口打不开就每 30s 尝试重新打开一次；打开了就每次 read_once
                if not reader:
                    if time.time() - last_hw_fail_log >= 30:
                        last_hw_fail_log = time.time()
                        log.info("🔌 尝试重新打开串口 %s @ %d ……", args.com, args.baud)
                        reader = open_hw()
                if reader:
                    regs = reader.read_once()
                    if regs is None:
                        if time.time() - last_hw_fail_log >= 15:
                            last_hw_fail_log = time.time()
                            log.error("⏱️  串口无响应（传感器未接 / 485 A+ B- 接反 / 波特率不对 / 设备地址不对）。"
                                      "脚本保持硬件模式，不会写入模拟数据。请检查 COM=%s BAUD=%s ADDR=0x%02X",
                                      args.com, args.baud, args.address)
                    else:
                        items, values = regs_to_items(regs)
                        last_hw_fail_log = 0.0

            # 首屏打印一份直观 6 项
            tag = "🎲模拟" if mode == "simulate" else "📡硬件"
            if cycle == 1 or cycle % 30 == 0:
                parts = []
                for layout in REGISTER_LAYOUT:
                    if not layout["home6"]:
                        continue
                    v = values.get(layout["key"])
                    if v is None:
                        continue
                    parts.append(f"{layout['label']}={v:.1f}{layout['unit']}")
                log.info("🌱 %s 采集：%s  items=%d", tag, "  ".join(parts), len(items))

            # 关键区分：硬件/模拟写到 Measurement 的 description 和 source_hint 字段里，前端也能看来源
            extra = {}
            if mode == "simulate":
                extra["source_hint"] = "SIMULATED"
                extra["description"] = "⚠️ 模拟数据（来源标注 SIMULATED，非硬件实测）"
            else:
                extra["source_hint"] = "HARDWARE_RS485"
                extra["description"] = f"COM={args.com} BAUD={args.baud} ADDR=0x{args.address:02X}"
            # 如果后端 payload schema 支持 description / source_hint 扩展字段就一起带；不支持就只 items 入库也没问题
            post_items = [dict(it, **extra) for it in items]
            post_measurements(api, token, args.device_id, args.plot_code,
                              args.seed_batch_code, post_items,
                              source_hint=extra["source_hint"])
            time.sleep(args.interval)
    finally:
        if reader:
            reader.close()


def main() -> None:
    p = argparse.ArgumentParser(
        description="金生链 · 全参数土壤(RS485) 采集桥接脚本",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    # 串口 / Modbus 参数
    p.add_argument("--com", default=os.environ.get("RS485_COM", "COM3"),
                   help="串口（默认 COM3，与用户设备管理器里 CH340 一致）")
    p.add_argument("--baud", type=int, default=int(os.environ.get("RS485_BAUD", "9600")),
                   help="波特率 1200/2400/4800/9600/19200，默认 9600")
    p.add_argument("--address", type=int, default=int(os.environ.get("RS485_ADDR", "1")),
                   help="Modbus 从机地址（默认 1）")
    # 业务参数
    p.add_argument("--device_id", default=os.environ.get("SENSOR_ID", "SOIL-PLOT-A"),
                   help="传感器 device_id（要和后端注册的一致，脚本启动会自动帮你注册一次）")
    p.add_argument("--plot_code", default=os.environ.get("PLOT_CODE", "PLOT-A"),
                   help="绑定地块编码，空则按传感器表默认地块反查批次")
    p.add_argument("--seed_batch_code", default=os.environ.get("SEED_BATCH", ""),
                   help="（可选）强制绑定批次编码，不填按种植记录反查")
    p.add_argument("--interval", type=float, default=5.0,
                   help="采集间隔秒数（默认 5s）")
    # 后端 / 鉴权
    p.add_argument("--api", default=os.environ.get("BACKEND_API", "http://127.0.0.1:8000"),
                   help="后端 API 地址")
    p.add_argument("--token", default=os.environ.get("API_TOKEN"),
                   help="Bearer token。默认先从前端共享 token 读，再 admin/admin123 自动登录")
    # 模式
    p.add_argument("--simulate", action="store_true",
                   help="纯模拟模式：不读串口，生成环境参数用于功能演示。"
                        "要停止模拟：重新运行脚本去掉 --simulate，或去传感器页点「停止模拟」。")
    p.add_argument("--auto-fallback", action="store_true",
                   help=argparse.SUPPRESS)  # 保留参数兼容旧命令，但行为 = 纯硬件（不再自动降级模拟）

    args = p.parse_args()
    mode_label = ("纯模拟 SIMULATE（写入的测量记录标注来源，可区分真假）"
                  if args.simulate else
                  "纯硬件 HARDWARE（硬件无响应直接报错，不会写入任何模拟数据，100% 可区分）")
    # 打印启动 banner
    banner = f"\n{'=' * 68}\n 金生链 · 全参数土壤 RS485 采集桥接\n  COM={args.com}  BAUD={args.baud}  ADDR=0x{args.address:02X}\n" \
             f"  device_id={args.device_id}  plot={args.plot_code or '按 Sensor 默认'}\n" \
             f"  模式：{mode_label}\n{'=' * 68}\n"
    print(banner)
    try:
        run(args)
    except KeyboardInterrupt:
        log.info("用户中断，安全退出。")


if __name__ == "__main__":
    main()
