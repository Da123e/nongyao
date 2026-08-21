import hashlib
import os
import requests
from typing import Optional, Dict, Any
import json
from app.core.config import settings

IPFS_API_URL = settings.IPFS_API_URL
IPFS_GATEWAY = settings.IPFS_GATEWAY


def calculate_file_hash(file_content: bytes) -> str:
    return hashlib.sha256(file_content).hexdigest()


def add_file_to_ipfs(file_content: bytes, filename: str = "data.bin") -> Dict[str, Any]:
    if not settings.IPFS_ENABLED:
        raise Exception("IPFS功能未启用")

    files = {'file': (filename, file_content)}
    response = requests.post(f"{IPFS_API_URL}/add", files=files, timeout=60)

    if response.status_code != 200:
        raise Exception(f"IPFS上传失败，状态码: {response.status_code}, 响应: {response.text}")

    result = response.json()
    cid = result.get('Hash', '')

    if not cid:
        raise Exception("IPFS上传失败：未返回CID")

    return {
        'success': True,
        'ipfs_hash': cid,
        'file_hash': calculate_file_hash(file_content),
        'size': len(file_content),
        'gateway_url': f"{IPFS_GATEWAY}/ipfs/{cid}",
        'storage_type': 'ipfs'
    }


def get_file_from_ipfs(ipfs_hash: str) -> Optional[bytes]:
    if not settings.IPFS_ENABLED:
        raise Exception("IPFS功能未启用")

    response = requests.post(f"{IPFS_API_URL}/cat?arg={ipfs_hash}", timeout=60)

    if response.status_code != 200:
        raise Exception(f"IPFS读取失败，状态码: {response.status_code}, 响应: {response.text}")

    return response.content


def verify_file_integrity(ipfs_hash: str, expected_hash: str) -> Dict[str, Any]:
    file_content = get_file_from_ipfs(ipfs_hash)

    if file_content is None:
        return {
            'success': False,
            'error': '文件未找到',
            'is_valid': False
        }

    actual_hash = calculate_file_hash(file_content)

    return {
        'success': True,
        'is_valid': actual_hash == expected_hash,
        'expected_hash': expected_hash,
        'actual_hash': actual_hash,
        'file_size': len(file_content)
    }


def add_json_data(data: Dict[str, Any]) -> Dict[str, Any]:
    json_str = json.dumps(data, sort_keys=True, ensure_ascii=False)
    json_bytes = json_str.encode('utf-8')

    return add_file_to_ipfs(json_bytes, "data.json")


def get_json_data(ipfs_hash: str) -> Optional[Dict[str, Any]]:
    file_content = get_file_from_ipfs(ipfs_hash)

    if file_content is None:
        return None

    try:
        return json.loads(file_content.decode('utf-8'))
    except:
        return None


def pin_file(ipfs_hash: str) -> Dict[str, Any]:
    if not settings.IPFS_ENABLED:
        raise Exception("IPFS未启用")

    response = requests.post(f"{IPFS_API_URL}/pin/add?arg={ipfs_hash}", timeout=30)

    if response.status_code != 200:
        raise Exception(f"IPFS pin失败: {response.text}")

    result = response.json()
    return {
        'success': True,
        'pinned': True,
        'ipfs_hash': ipfs_hash,
        'result': result
    }


def get_ipfs_status() -> Dict[str, Any]:
    if not settings.IPFS_ENABLED:
        return {'enabled': False, 'connected': False, 'error': 'IPFS未启用'}

    try:
        response = requests.post(f"{IPFS_API_URL}/id", timeout=10)

        if response.status_code == 200:
            result = response.json()
            return {
                'enabled': True,
                'connected': True,
                'peer_id': result.get('ID', ''),
                'agent_version': result.get('AgentVersion', ''),
                'protocol_version': result.get('ProtocolVersion', '')
            }
        else:
            return {'enabled': True, 'connected': False, 'error': response.text}
    except Exception as e:
        return {'enabled': True, 'connected': False, 'error': str(e)}
