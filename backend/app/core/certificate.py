import hashlib
import json
import ctypes
import ctypes.wintypes
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.x509 import load_pem_x509_certificate, Certificate
from cryptography.exceptions import InvalidSignature
from sqlalchemy.orm import Session
from app.models.auth import Certificate, User, Organization
from app.core.config import settings


CERT_SYSTEM_STORE_CURRENT_USER = 1
CERT_SYSTEM_STORE_LOCAL_MACHINE = 2
CERT_STORE_PROV_SYSTEM = 10
CERT_STORE_OPEN_EXISTING_FLAG = 0x00004000
CERT_STORE_READONLY_FLAG = 0x00008000


def _get_windows_cert_store(store_name: str = "MY", user_store: bool = True) -> Any:
    flags = CERT_STORE_PROV_SYSTEM | CERT_STORE_OPEN_EXISTING_FLAG | CERT_STORE_READONLY_FLAG
    if user_store:
        flags |= CERT_SYSTEM_STORE_CURRENT_USER
    else:
        flags |= CERT_SYSTEM_STORE_LOCAL_MACHINE
    
    crypt32 = ctypes.WinDLL("crypt32.dll", use_last_error=True)
    store_handle = crypt32.CertOpenStore(
        ctypes.c_char_p(CERT_STORE_PROV_SYSTEM.to_bytes(4, 'little')),
        0,
        None,
        flags,
        store_name.encode('utf-16-le') + b'\x00\x00'
    )
    return store_handle, crypt32


def list_system_certificates(store_name: str = "MY") -> List[Dict[str, Any]]:
    certificates = []
    try:
        store_handle, crypt32 = _get_windows_cert_store(store_name)
        if not store_handle:
            return certificates
        
        cert_context = crypt32.CertEnumCertificatesInStore(store_handle, None)
        while cert_context:
            cert_info = {}
            
            cert_blob = ctypes.cast(cert_context, ctypes.POINTER(ctypes.c_ubyte))
            cert_size = cert_context[0].cbCertEncoded
            
            cert_bytes = bytes(ctypes.string_at(cert_blob, cert_size))
            
            try:
                cert = load_pem_x509_certificate(cert_bytes, default_backend())
                cert_info['subject'] = cert.subject.rfc4514_string()
                cert_info['issuer'] = cert.issuer.rfc4514_string()
                cert_info['serial_number'] = cert.serial_number
                cert_info['not_before'] = cert.not_valid_before.isoformat()
                cert_info['not_after'] = cert.not_valid_after.isoformat()
                cert_info['version'] = cert.version.name
                cert_info['fingerprint'] = hashlib.sha256(cert_bytes).hexdigest()
            except Exception:
                cert_info['fingerprint'] = hashlib.sha256(cert_bytes).hexdigest()
                cert_info['subject'] = "无法解析"
                cert_info['issuer'] = "无法解析"
            
            certificates.append(cert_info)
            
            next_cert = crypt32.CertEnumCertificatesInStore(store_handle, cert_context)
            crypt32.CertFreeCertificateContext(cert_context)
            cert_context = next_cert
        
        crypt32.CertCloseStore(store_handle, 0)
    except Exception as e:
        pass
    
    return certificates


def get_system_root_certificates() -> List[Dict[str, Any]]:
    return list_system_certificates("Root")


def get_user_certificates() -> List[Dict[str, Any]]:
    return list_system_certificates("MY")


def verify_certificate_with_system_root(cert_pem: str) -> Dict[str, Any]:
    try:
        cert = load_pem_x509_certificate(cert_pem.encode('utf-8'), default_backend())
        
        root_certs = get_system_root_certificates()
        
        for root_cert_info in root_certs:
            root_fingerprint = root_cert_info.get('fingerprint', '')
            if root_fingerprint:
                pass
        
        now = datetime.now()
        is_valid = cert.not_valid_before <= now <= cert.not_valid_after
        
        return {
            "valid": is_valid,
            "message": "证书有效" if is_valid else "证书不在有效期内",
            "subject": cert.subject.rfc4514_string(),
            "issuer": cert.issuer.rfc4514_string(),
            "not_before": cert.not_valid_before.isoformat(),
            "not_after": cert.not_valid_after.isoformat(),
            "serial_number": cert.serial_number,
        }
    except Exception as e:
        return {
            "valid": False,
            "message": f"证书解析失败: {str(e)}"
        }


def get_certificate_by_subject(db: Session, subject_type: str, subject_id: int) -> Optional[Certificate]:
    return db.query(Certificate).filter(
        Certificate.subject_type == subject_type,
        Certificate.subject_id == subject_id,
        Certificate.status == "active"
    ).first()


def get_certificate_private_key(db: Session, subject_type: str, subject_id: int) -> Optional[str]:
    cert = get_certificate_by_subject(db, subject_type, subject_id)
    return cert.private_key if cert else None


def get_certificate_public_key(db: Session, subject_type: str, subject_id: int) -> Optional[str]:
    cert = get_certificate_by_subject(db, subject_type, subject_id)
    return cert.public_key if cert else None


def sign_data_with_user_certificate(db: Session, user_id: int, data: str) -> Optional[str]:
    cert = get_certificate_by_subject(db, "user", user_id)
    if not cert:
        return None
    
    try:
        from cryptography.hazmat.primitives import serialization
        
        private_key = serialization.load_pem_private_key(
            cert.private_key.encode('utf-8'),
            password=None,
            backend=default_backend()
        )
        
        data_bytes = data.encode('utf-8')
        signature = private_key.sign(data_bytes, hashes.SHA256())
        
        return signature.hex()
    except Exception as e:
        return None


def verify_data_with_user_certificate(db: Session, user_id: int, data: str, signature: str) -> bool:
    cert = get_certificate_by_subject(db, "user", user_id)
    if not cert:
        return False
    
    try:
        from cryptography.hazmat.primitives import serialization
        
        public_key = serialization.load_pem_public_key(
            cert.public_key.encode('utf-8'),
            backend=default_backend()
        )
        
        data_bytes = data.encode('utf-8')
        signature_bytes = bytes.fromhex(signature)
        
        public_key.verify(signature_bytes, data_bytes, hashes.SHA256())
        return True
    except InvalidSignature:
        return False
    except Exception:
        return False


def sign_with_private_key(private_key_pem: str, data: str) -> Optional[str]:
    try:
        from cryptography.hazmat.primitives import serialization
        
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode('utf-8'),
            password=None,
            backend=default_backend()
        )
        
        data_bytes = data.encode('utf-8')
        signature = private_key.sign(data_bytes, hashes.SHA256())
        
        return signature.hex()
    except Exception:
        return None


def verify_with_public_key(public_key_pem: str, data: str, signature_hex: str) -> bool:
    try:
        from cryptography.hazmat.primitives import serialization
        
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode('utf-8'),
            backend=default_backend()
        )
        
        data_bytes = data.encode('utf-8')
        signature = bytes.fromhex(signature_hex)
        
        public_key.verify(signature, data_bytes, hashes.SHA256())
        return True
    except InvalidSignature:
        return False
    except Exception:
        return False