"""批次编码归一化：把任意溯源编码统一解析为种子批次编码（PB-xxx）。

【为什么需要】
二维码 payload 中的 ?batch= 参数在不同生成场景下可能写入三类编码：
  1. 种子批次编码  PB2026-xxx   （SeedBatch.batch_code，溯源查询的"主键"）
  2. 加工批次编码  PRC-2026-xxx （ProcessingBatch.batch_code）
     - sales.py 添加订单商品：只填加工批次、未填种子批次时写入
  3. 库存商品编码  ITM-xxx / INV-xxx （InventoryItem.item_code）
     - inventory.py 手工建库存：种子/加工批次均为空时的兜底

而溯源查询接口（_build_trace_data / inspection.trace / inspection.pdf）
只按种子批次编码查询，查不到直接 404 —— 消费者扫到 2/3 类码时会白屏。

本模块在查询入口做一层归一化：任意编码 → 种子批次编码，
保证「二维码生成格式 ↔ 扫码解析」全场景闭环。
"""
from sqlalchemy.orm import Session


def resolve_seed_batch_code(code: str, db: Session) -> str:
    """把 PB/PRC/ITM/INV 等任意溯源编码解析为种子批次编码。

    解析链：种子批次 → 加工批次 → 库存编码（含其指向的加工批次）。
    都匹配不上时原样返回，由调用方按 404 处理（不吞错）。
    """
    code = (code or "").strip()
    if not code:
        return code

    from app.models.seed import SeedBatch
    from app.models.processing import ProcessingBatch
    from app.models.inventory import InventoryItem

    # 1) 本身就是种子批次编码
    if db.query(SeedBatch.id).filter(SeedBatch.batch_code == code).first():
        return code

    # 2) 加工批次编码 → 种子批次编码
    pb = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == code).first()
    if pb and pb.seed_batch_code:
        if db.query(SeedBatch.id).filter(SeedBatch.batch_code == pb.seed_batch_code).first():
            return pb.seed_batch_code

    # 3) 库存商品编码 → 种子批次编码（或经加工批次间接解析）
    inv = db.query(InventoryItem).filter(InventoryItem.item_code == code).first()
    if inv:
        if inv.seed_batch_code and db.query(SeedBatch.id).filter(
                SeedBatch.batch_code == inv.seed_batch_code).first():
            return inv.seed_batch_code
        if inv.batch_code and inv.batch_code != code:
            pb2 = db.query(ProcessingBatch).filter(
                ProcessingBatch.batch_code == inv.batch_code).first()
            if pb2 and pb2.seed_batch_code and db.query(SeedBatch.id).filter(
                    SeedBatch.batch_code == pb2.seed_batch_code).first():
                return pb2.seed_batch_code

    # 4) 无法归一化：原样返回，调用方 404
    return code
