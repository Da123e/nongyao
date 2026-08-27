import qrcode
from io import BytesIO
from PIL import Image
import base64
from typing import Dict, Any, Optional
from urllib.parse import urlparse
from app.core.config import settings


def _resolve_url_prefix(url_prefix: Optional[str] = None,
                        request_host: Optional[str] = None,
                        request_scheme: Optional[str] = None) -> str:
    """解析二维码对外访问前缀（扫码后手机实际访问的地址）
    优先级：调用方显式传入 > FRONTEND_URL 配置 > Request 反推 > 硬编码兜底。
    注意：二维码指向前端 React 路由（/trace/public），非后端 API。
    """
    # 1) 调用方显式传入
    if url_prefix:
        p = url_prefix.rstrip('/')
        if p.startswith('http://') or p.startswith('https://'):
            return p
    # 2) FRONTEND_URL 配置（指向前端域名，最可靠）
    if settings.FRONTEND_URL:
        p = settings.FRONTEND_URL.rstrip('/')
        if p.startswith('http://') or p.startswith('https://'):
            return p
    # 3) 从 Request 反推（同域部署/反向代理场景兜底）
    if request_host and request_scheme:
        return f"{request_scheme}://{request_host}"
    # 4) 硬编码兜底
    return "http://localhost:5173"


def generate_trace_qrcode(
    batch_id: Any,
    seed_batch_id: str,
    *,
    url_prefix: Optional[str] = None,
    request_host: Optional[str] = None,
    request_scheme: Optional[str] = None,
    mode: str = 'public',  # 'public' → /trace/public  (C 端消费者，无需登录)
                           # 'admin'  → /trace         (管理员侧，需要登录)
) -> Dict[str, Any]:
    """生成二维码
    【P0 修复要点】
    1) 二维码 payload 直接写「可被手机浏览器打开的完整 URL」，
       不再用 JSON 嵌套格式 — 微信/支付宝/手机相机扫完即跳页面；
       前端 TraceQuery.extractBatchCode 也识别 URL 中的 ?batch= 参数，
       形成「生成格式 ↔ 扫码解析格式」的一致闭环。
    2) 消费者公开页走 /trace/public，避免被 ProtectedRoute 踢回登录。
    3) url_prefix 优先用调用方传入（前端传 window.origin 最准，手机可访问）。
    """
    prefix = _resolve_url_prefix(url_prefix, request_host, request_scheme)
    mode_safe = mode if mode in ('public', 'admin') else 'public'
    trace_path = f"/trace{'/public' if mode_safe == 'public' else ''}?batch={seed_batch_id}"
    trace_url = f"{prefix}{trace_path}"

    qr = qrcode.QRCode(
        version=None,  # 自适应，避免 JSON→URL 变长后 fit 溢出
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(trace_url)
    qr.make(fit=True)

    img = qr.make_image(fill_color='black', back_color='white')
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_b64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

    return {
        'qrcode': f"data:image/png;base64,{img_b64}",
        'trace_url': trace_url,
        'seed_batch_id': seed_batch_id,
        'batch_id': batch_id,
        'mode': mode_safe,
        'prefix': prefix,
        # 同时保留一段「无 URL，纯批次号」的文本，给店内扫码枪/管理端扫码做备用
        'batch_only_text': seed_batch_id,
    }


def qrcode_to_data_uri(pil_img) -> str:
    """把任意 PIL 生成的 QR 图统一转 data URI（写入 DB/返回前端用）"""
    buffered = BytesIO()
    pil_img.save(buffered, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode('utf-8')


def decode_qrcode(qr_image_data: str) -> Dict[str, Any]:
    """解析一张二维码图片（data URI 或 base64）。
    - 优先用 pyzbar（若本机装了 zbar 共享库 + pip pyzbar）
    - 回退：PIL + 简单启发（当图片本身是 1-bit / 清晰 QR 时），否则返回空（不阻塞业务流）
    """
    img_bytes: bytes
    if isinstance(qr_image_data, str):
        if qr_image_data.startswith('data:image/'):
            qr_image_data = qr_image_data.split(',', 1)[1]
        try:
            img_bytes = base64.b64decode(qr_image_data)
        except Exception:
            return {}
    else:
        return {}
    try:
        img = Image.open(BytesIO(img_bytes))
    except Exception:
        return {}

    try:
        from pyzbar.pyzbar import decode as pyzbar_decode  # type: ignore
        decoded = pyzbar_decode(img)
        if decoded:
            raw = decoded[0].data.decode('utf-8', errors='ignore')
            return {
                'raw': raw,
                'format': str(decoded[0].type),
            }
    except ImportError:
        # pyzbar 未装（典型 Windows），静默跳过
        pass
    except Exception:
        pass

    return {}
