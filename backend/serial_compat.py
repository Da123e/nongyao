# -*- coding: utf-8 -*-
"""
 serial_compat.py —— 只实现 rs485_bridge.py 用到的最小 pyserial 接口。
 这样脚本即使装不上 pyserial（受限环境）也能跑；
 如果系统已有 pyserial，本模块自动被真实 pyserial 覆盖。
 用法：在 rs485_bridge.py 开头
       import serial_compat  # noqa (确保先加入 sys.path)
       import serial
"""

from __future__ import annotations

import os
import sys
import time
import ctypes
import struct
from typing import Optional

# 如果已经能 import 真实 pyserial，啥都不做
try:
    import serial as _real  # noqa: F401
    sys.modules[__name__] = sys.modules.get("serial") or _real
    # 如果真实 serial 是 sys.modules["serial"]，那 import serial_compat 本身啥也不会覆盖
except Exception:  # 真实 pyserial 不存在：造一个极简兼容的
    pass

if "serial" not in sys.modules or not hasattr(sys.modules["serial"], "Serial"):
    # ========== Windows 极简 Serial 实现 ==========
    GENERIC_READ = 0x80000000
    GENERIC_WRITE = 0x40000000
    OPEN_EXISTING = 3
    FILE_ATTRIBUTE_NORMAL = 0x80
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
    MAXDWORD = 0xFFFFFFFF

    DCB_LENGTH = 28

    class _DCB(ctypes.Structure):
        _fields_ = [
            ("DCBlength", ctypes.c_ulong),
            ("BaudRate", ctypes.c_ulong),
            ("fBitFields", ctypes.c_ulong),  # packed bits (Parity/fBinary/fOutxCtsFlow/...)
            ("wReserved", ctypes.c_ushort),
            ("XonLim", ctypes.c_ushort),
            ("XoffLim", ctypes.c_ushort),
            ("ByteSize", ctypes.c_ubyte),
            ("Parity", ctypes.c_ubyte),
            ("StopBits", ctypes.c_ubyte),
            ("XonChar", ctypes.c_char),
            ("XoffChar", ctypes.c_char),
            ("ErrorChar", ctypes.c_char),
            ("EofChar", ctypes.c_char),
            ("EvtChar", ctypes.c_char),
            ("wReserved1", ctypes.c_ushort),
        ]

    class _COMSTAT(ctypes.Structure):
        _fields_ = [
            ("fBitFields", ctypes.c_ulong),
            ("cbInQue", ctypes.c_ulong),
            ("cbOutQue", ctypes.c_ulong),
        ]

    class _COMMTIMEOUTS(ctypes.Structure):
        _fields_ = [
            ("ReadIntervalTimeout", ctypes.c_ulong),
            ("ReadTotalTimeoutMultiplier", ctypes.c_ulong),
            ("ReadTotalTimeoutConstant", ctypes.c_ulong),
            ("WriteTotalTimeoutMultiplier", ctypes.c_ulong),
            ("WriteTotalTimeoutConstant", ctypes.c_ulong),
        ]

    NOPARITY = 0
    ODDPARITY = 1
    EVENPARITY = 2
    ONESTOPBIT = 0

    def _parity_code(p: str) -> int:
        return {"N": NOPARITY, "O": ODDPARITY, "E": EVENPARITY}.get(p.upper(), NOPARITY)

    class Serial:
        def __init__(self, port: str, baudrate: int = 9600, bytesize: int = 8,
                     parity: str = "N", stopbits: int = 1, timeout: Optional[float] = None):
            if os.name != "nt":
                raise OSError("serial_compat 极简版仅 Windows 可用，安装 pyserial 后支持跨平台。")
            if not port.upper().startswith("COM"):
                raise ValueError(f"无效串口名 {port}，serial_compat 仅支持 COMx 形式")
            # Windows \\.\COMxx 形式兼容 COM10+
            winpath = rf"\\.\{port}"
            kernel32 = ctypes.windll.kernel32
            self._handle = kernel32.CreateFileW(
                ctypes.c_wchar_p(winpath),
                GENERIC_READ | GENERIC_WRITE,
                0,  # no sharing
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
            if self._handle == INVALID_HANDLE_VALUE:
                code = ctypes.get_last_error()
                raise OSError(f"打开串口 {port} 失败，WinError={code}（可能被占用或不存在）")

            dcb = _DCB()
            dcb.DCBlength = ctypes.sizeof(_DCB)
            ok = kernel32.GetCommState(self._handle, ctypes.byref(dcb))
            if not ok:
                raise OSError("GetCommState 失败")
            dcb.BaudRate = int(baudrate)
            dcb.ByteSize = int(bytesize)
            dcb.Parity = _parity_code(parity)
            dcb.StopBits = ONESTOPBIT if stopbits == 1 else int(stopbits)
            # 二进制模式 + 禁用流控（1 bit: fBinary=1, fParity=0）
            # fBitFields 位布局：
            #  Bit0 fBinary, Bit1 fParity, Bit2 fOutxCtsFlow, Bit3 fOutxDsrFlow,
            #  Bits4..5 fDtrControl, Bit6 fDsrSensitivity, Bit7 fTXContinueOnXoff,
            #  Bit8 fOutX, Bit9 fInX, Bit10 fErrorChar, Bit11 fNull,
            #  Bits12..13 fRtsControl, Bit14 fAbortOnError
            fBinary = 1
            fParity = 1 if parity.upper() != "N" else 0
            fOutxCtsFlow = 0
            fOutxDsrFlow = 0
            fDtrControl = 1  # enable
            fDsrSensitivity = 0
            fTXContinueOnXoff = 1
            fOutX = 0
            fInX = 0
            fErrorChar = 0
            fNull = 0
            fRtsControl = 1  # enable
            fAbortOnError = 0
            bits = (
                (fBinary & 1) | ((fParity & 1) << 1) | ((fOutxCtsFlow & 1) << 2)
                | ((fOutxDsrFlow & 1) << 3) | ((fDtrControl & 3) << 4)
                | ((fDsrSensitivity & 1) << 6) | ((fTXContinueOnXoff & 1) << 7)
                | ((fOutX & 1) << 8) | ((fInX & 1) << 9) | ((fErrorChar & 1) << 10)
                | ((fNull & 1) << 11) | ((fRtsControl & 3) << 12)
                | ((fAbortOnError & 1) << 14)
            )
            dcb.fBitFields = bits
            ok = kernel32.SetCommState(self._handle, ctypes.byref(dcb))
            if not ok:
                raise OSError("SetCommState 失败（可能波特率/字节大小不支持）")

            to = _COMMTIMEOUTS()
            if timeout is None:
                # 阻塞读
                to.ReadIntervalTimeout = 0
                to.ReadTotalTimeoutMultiplier = 0
                to.ReadTotalTimeoutConstant = 0
            else:
                const_ms = int(max(1, round(timeout * 1000)))
                to.ReadIntervalTimeout = MAXDWORD  # 要求读 exactly N bytes
                to.ReadTotalTimeoutMultiplier = 0
                to.ReadTotalTimeoutConstant = const_ms
            to.WriteTotalTimeoutMultiplier = 0
            to.WriteTotalTimeoutConstant = 500
            kernel32.SetCommTimeouts(self._handle, ctypes.byref(to))
            kernel32.SetupComm(self._handle, 4096, 4096)
            self._kernel32 = kernel32
            self.timeout = timeout

        def _purge(self, flags: int):
            self._kernel32.PurgeComm(self._handle, flags)

        def reset_input_buffer(self):
            self._purge(0x000F & ~0x0004)  # PURGE_RXCLEAR 0x0008
            # PURGE_RXABORT | PURGE_RXCLEAR = 2 + 8 = 10 (0xA)
            self._purge(0x000A)

        def reset_output_buffer(self):
            self._purge(0x0005)  # PURGE_TXABORT(1) | PURGE_TXCLEAR(4)

        def write(self, data: bytes) -> int:
            buf = ctypes.create_string_buffer(data)
            n = ctypes.c_ulong(0)
            ok = self._kernel32.WriteFile(
                self._handle, buf, len(data), ctypes.byref(n), None
            )
            if not ok:
                raise OSError(f"WriteFile 失败, WinError={ctypes.get_last_error()}")
            return n.value

        def read(self, size: int) -> bytes:
            buf = ctypes.create_string_buffer(max(1, size))
            got = ctypes.c_ulong(0)
            ok = self._kernel32.ReadFile(
                self._handle, buf, size, ctypes.byref(got), None
            )
            if not ok:
                raise OSError(f"ReadFile 失败, WinError={ctypes.get_last_error()}")
            return bytes(buf.raw[:got.value])

        def close(self):
            if getattr(self, "_handle", None):
                try:
                    self._kernel32.CloseHandle(self._handle)
                except Exception:
                    pass
                self._handle = None

        def __del__(self):
            try:
                self.close()
            except Exception:
                pass

        @property
        def is_open(self) -> bool:
            return bool(getattr(self, "_handle", None))

        def flush(self):
            self._kernel32.FlushFileBuffers(self._handle)

    class _SerialModule:
        Serial = Serial
        NOPARITY = NOPARITY
        ODDPARITY = ODDPARITY
        EVENPARITY = EVENPARITY
        ONESTOPBIT = ONESTOPBIT

    sys.modules["serial"] = _SerialModule()  # type: ignore[assignment]


# requests 也兼容：真没有的话用 urllib（标准库自带）
import importlib  # noqa: E402
try:
    import requests as _req  # noqa: F401
except Exception:
    import urllib.request
    import urllib.parse
    import json as _json
    import ssl

    class _Response:
        def __init__(self, status_code: int, content: bytes, url: str):
            self.status_code = status_code
            self._content = content
            self.url = url
            self.text = content.decode("utf-8", errors="replace")

        def json(self) -> any:
            try:
                return _json.loads(self._content or b"null")
            except Exception:
                return None

        def raise_for_status(self):
            if self.status_code >= 400:
                raise Exception(f"HTTP {self.status_code}: {self.text[:200]}")

    class _RequestsCompat:
        def _make_req(self, method, url, params=None, json=None, headers=None, timeout=None):
            if params:
                sep = "&" if "?" in url else "?"
                url = url + sep + urllib.parse.urlencode(params)
            data = None
            hdrs = dict(headers or {})
            if json is not None:
                data = _json.dumps(json).encode("utf-8")
                hdrs.setdefault("Content-Type", "application/json")
            req = urllib.request.Request(url, data=data, headers=hdrs, method=method.upper())
            ctx = ssl._create_unverified_context() if url.startswith("https://") else None
            kwargs = {"timeout": timeout} if timeout else {}
            if ctx:
                kwargs["context"] = ctx
            try:
                with urllib.request.urlopen(req, **kwargs) as resp:
                    body = resp.read()
                    return _Response(resp.status, body, resp.geturl())
            except urllib.error.HTTPError as e:
                return _Response(e.code, e.read() or b"", url)

        def get(self, url, **kw):
            return self._make_req("GET", url, **kw)

        def post(self, url, **kw):
            return self._make_req("POST", url, **kw)

        def put(self, url, **kw):
            return self._make_req("PUT", url, **kw)

        def delete(self, url, **kw):
            return self._make_req("DELETE", url, **kw)

    sys.modules["requests"] = _RequestsCompat()  # type: ignore[assignment]
