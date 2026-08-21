from web3 import Web3
import json
import hashlib
import time
from datetime import datetime
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
from typing import Optional, Dict, Any, Tuple
from app.core.config import settings

GANACHE_URL = settings.GANACHE_URL
CONTRACT_ABI_FILE = "contracts/PeanutTrace.json"
CONTRACT_ADDRESS_FILE = "contracts/contract_address.txt"

w3 = Web3(Web3.HTTPProvider(GANACHE_URL))

DEFAULT_ACCOUNT = w3.eth.accounts[0] if w3.is_connected() else "0x0000000000000000000000000000000000000000"
DEFAULT_PRIVATE_KEY = settings.GANACHE_PRIVATE_KEY


def is_connected() -> bool:
    try:
        return w3.is_connected()
    except:
        return False


def has_contract() -> bool:
    try:
        with open(CONTRACT_ADDRESS_FILE, "r") as f:
            addr = f.read().strip()
        return addr and len(addr) > 0
    except:
        return False


def generate_ecdsa_key_pair() -> Tuple[str, str]:
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode('utf-8')

    return private_pem, public_pem


def sign_data(data: str, private_key_pem: str) -> str:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode('utf-8'),
        password=None,
        backend=default_backend()
    )

    data_bytes = data.encode('utf-8')
    signature = private_key.sign(data_bytes, ec.ECDSA(hashes.SHA256()))

    return signature.hex()


def verify_signature(data: str, signature_hex: str, public_key_pem: str) -> bool:
    public_key = serialization.load_pem_public_key(
        public_key_pem.encode('utf-8'),
        backend=default_backend()
    )

    data_bytes = data.encode('utf-8')
    signature = bytes.fromhex(signature_hex)

    try:
        public_key.verify(signature, data_bytes, ec.ECDSA(hashes.SHA256()))
        return True
    except:
        return False


def calculate_hash(data: Dict[str, Any]) -> str:
    def convert_datetime(o):
        if isinstance(o, datetime):
            return o.isoformat()
        raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")
    
    data_str = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(',', ':'), default=convert_datetime)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()


def generate_new_batch_id(prefix: str = "SB") -> str:
    timestamp = time.strftime("%Y%m%d")
    try:
        count = w3.eth.get_transaction_count(DEFAULT_ACCOUNT)
    except:
        count = int(time.time() * 1000) % 100000
    return f"{prefix}{timestamp}{str(count).zfill(5)}"


def get_contract():
    try:
        with open(CONTRACT_ADDRESS_FILE, "r") as f:
            contract_address = f.read().strip()
        if not contract_address:
            raise Exception("合约地址文件为空")
    except Exception as e:
        raise Exception(f"无法读取合约地址: {e}")

    try:
        with open(CONTRACT_ABI_FILE, "r") as f:
            contract_data = json.load(f)
        abi = contract_data["abi"]
    except Exception as e:
        raise Exception(f"无法读取合约ABI: {e}")

    return w3.eth.contract(address=contract_address, abi=abi)


def add_record_to_blockchain(
    record_type: str,
    batch_id: str,
    seed_batch_id: str,
    data_hash: str,
    ipfs_hash: Optional[str] = None,
    uploader_type: str = "admin",
    signature: Optional[str] = None
) -> Dict[str, Any]:
    if not settings.BLOCKCHAIN_ENABLED:
        return {
            'success': False,
            'error': '区块链功能未启用',
            'message': '请在配置文件中启用区块链功能',
            'on_chain': False
        }

    if not is_connected():
        return {
            'success': False,
            'error': '无法连接到Ganache区块链节点',
            'message': '请确保Ganache区块链节点已启动',
            'on_chain': False
        }

    if not has_contract():
        return {
            'success': False,
            'error': '智能合约未部署',
            'message': '请先运行 deploy_contract.py 部署智能合约',
            'on_chain': False
        }

    try:
        contract = get_contract()

        tx_hash = contract.functions.addRecord(
            record_type,
            batch_id,
            seed_batch_id,
            data_hash,
            ipfs_hash or "",
            uploader_type,
            bytes.fromhex(signature) if signature else b""
        ).transact({'from': DEFAULT_ACCOUNT})

        tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        record_count = contract.functions.recordCount().call()

        return {
            'success': True,
            'block_hash': tx_receipt['blockHash'].hex(),
            'block_number': tx_receipt['blockNumber'],
            'transaction_hash': tx_hash.hex(),
            'record_index': record_count,
            'data_hash': data_hash,
            'ipfs_hash': ipfs_hash,
            'on_chain': True,
            'network': 'Ganache Ethereum Testnet'
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'上链失败: {str(e)}',
            'message': '区块链操作失败，请检查节点连接',
            'on_chain': False
        }


def get_blockchain_data(seed_batch_id: str) -> Dict[str, Any]:
    if not settings.BLOCKCHAIN_ENABLED:
        return {
            'success': False,
            'error': '区块链功能未启用',
            'seed_batch_id': seed_batch_id,
            'record_count': 0,
            'is_chain_valid': False,
            'network': 'None',
            'chain': []
        }

    if not is_connected():
        return {
            'success': False,
            'error': '无法连接到Ganache区块链节点',
            'seed_batch_id': seed_batch_id,
            'record_count': 0,
            'is_chain_valid': False,
            'network': 'None',
            'chain': []
        }

    if not has_contract():
        return {
            'success': False,
            'error': '智能合约未部署',
            'seed_batch_id': seed_batch_id,
            'record_count': 0,
            'is_chain_valid': False,
            'network': 'None',
            'chain': []
        }

    try:
        contract = get_contract()

        batch_info = contract.functions.getBatchInfo(seed_batch_id).call()
        blocks = contract.functions.getBatchBlocks(seed_batch_id).call()

        records = []
        for block_idx in blocks:
            record = contract.functions.getRecord(block_idx).call()
            records.append({
                'block_index': record[0],
                'timestamp': record[1],
                'type': record[2],
                'batch_id': record[3],
                'seed_batch_id': record[4],
                'data_hash': record[5],
                'ipfs_hash': record[6],
                'uploader': record[7],
                'uploader_type': record[8],
                'signature': record[9].hex() if record[9] else None
            })

        return {
            'success': True,
            'seed_batch_id': seed_batch_id,
            'record_count': batch_info[1],
            'is_chain_valid': True,
            'network': 'Ganache Ethereum Testnet',
            'chain': records
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'区块链查询失败: {str(e)}',
            'seed_batch_id': seed_batch_id,
            'record_count': 0,
            'is_chain_valid': False,
            'network': 'Ganache Ethereum Testnet',
            'chain': []
        }


def verify_chain_integrity(seed_batch_id: str) -> Dict[str, Any]:
    data = get_blockchain_data(seed_batch_id)

    if not data.get('success', False):
        return {
            'success': False,
            'error': data.get('error', '区块链查询失败'),
            'seed_batch_id': seed_batch_id,
            'total_blocks': 0,
            'is_chain_valid': False,
            'details': [],
            'network': data.get('network', 'None')
        }

    records = data.get('chain', [])
    results = []

    for i, record in enumerate(records):
        issues = []

        if i > 0:
            prev_record = records[i - 1]
            if prev_record['block_index'] >= record['block_index']:
                issues.append("区块索引倒序或重复")
            if prev_record['timestamp'] > record['timestamp']:
                issues.append("时间戳倒序")

        results.append({
            'block_index': record['block_index'],
            'type': record['type'],
            'timestamp': record['timestamp'],
            'ipfs_hash': record.get('ipfs_hash', ''),
            'data_hash': record.get('data_hash', ''),
            'is_valid': len(issues) == 0,
            'issues': issues
        })

    return {
        'success': True,
        'seed_batch_id': seed_batch_id,
        'total_blocks': len(records),
        'is_chain_valid': all(r['is_valid'] for r in results),
        'details': results,
        'network': data.get('network', 'Ganache Ethereum Testnet')
    }
