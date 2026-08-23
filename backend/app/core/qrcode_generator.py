import qrcode
from io import BytesIO
from PIL import Image
import base64
import json
from typing import Dict, Any
from app.core.config import settings

def generate_trace_qrcode(batch_id: str, seed_batch_id: str, url_prefix: str = None) -> str:
    if url_prefix is None:
        url_prefix = settings.FRONTEND_URL
    qr_data = {
        'batch_id': batch_id,
        'seed_batch_id': seed_batch_id,
        'trace_url': f"{url_prefix}/trace?batch={seed_batch_id}"
    }

    qr_str = json.dumps(qr_data, sort_keys=True)

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )

    qr.add_data(qr_str)
    qr.make(fit=True)

    img = qr.make_image(fill_color='black', back_color='white')

    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')

    return f"data:image/png;base64,{img_str}"

def decode_qrcode(qr_image_data: str) -> Dict[str, Any]:
    """Decode a QR code image (base64 or data URI) and return the parsed JSON content."""
    if qr_image_data.startswith('data:image/'):
        qr_image_data = qr_image_data.split(',')[1]

    img_bytes = base64.b64decode(qr_image_data)
    img = Image.open(BytesIO(img_bytes))

    try:
        from pyzbar.pyzbar import decode as pyzbar_decode
        decoded = pyzbar_decode(img)
        if decoded:
            qr_str = decoded[0].data.decode('utf-8')
            return json.loads(qr_str)
    except ImportError:
        pass
    except Exception:
        pass

    return {}
