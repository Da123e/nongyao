# =============================================================================
# ⚠️  WARNING ⚠️  这个文件已经不再是「真正的种子数据来源」！！
# =============================================================================
#
# 旧版本：init_db.py 写的是 SB-2024-001 / PLOT001 / BATCH-001 / INV-2024 这种
#         2024 旧编码，与正式演示使用的 2026 新编码（PB2026-001 / PLOT-A /
#         PRC-2026-001 等）完全不兼容，同时存在会导致：
#
#            ❌ 首页统计翻倍
#            ❌ 溯源页「批次不存在」
#            ❌ 检测报告 / 种植记录 FK 飘到旧批次
#
# 新版本：所有业务种子数据全部统一在 app.auth.seed_data() 里维护
#         （2026 新编码 + IF NOT EXISTS 幂等 + 自动清理旧格式）。
#
# 这个文件只作为「给习惯 `python init_db.py` 老入口的人」的薄壳代理。
# 它内部直接调用了 app.auth.seed_data(db_session)，效果等同：
#      POST http://localhost:8000/api/auth/seed-data
# 同时也等同于 main.py 启动时 lifespan 自动做的那一次初始化。
#
# =============================================================================
#   >>> 如果要改演示数据，请直接去：backend/app/auth.py -> seed_data() <<<
# =============================================================================
import asyncio
import sys
from pathlib import Path

# ---- 补全 import path，允许在项目根目录直接 `py init_db.py` ----
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def main() -> int:
    print("=" * 70)
    print("[init_db] 该文件已升级为统一薄壳，只调用 app.auth.seed_data()")
    print("[init_db] 所有 2024 旧格式 / BATCH- 前缀 / -OLD 脏数据会被自动清理")
    print("[init_db] 演示数据统一使用 2026 新编码（PB2026-XXX）")
    print("=" * 70)

    try:
        from app.core.database import SessionLocal
        from app.auth import seed_data  # noqa: F401  (暴露给直接调用者)
        from app.auth import purge_legacy_format_records
    except Exception as exc:
        print(f"[ERROR] import 失败：{exc}")
        print("请确保已激活 venv，且在 backend 目录下运行： py init_db.py")
        return 1

    # purge 单独跑一次（seed_data 头也会再跑，这里属于双保险，不影响结果）
    session = SessionLocal()
    try:
        deleted = purge_legacy_format_records(session, commit=True)
        deleted_rows = sum(v for v in deleted.values() if isinstance(v, int))
        print(f"[purge] 清理旧格式记录：{deleted_rows} 行  （明细={deleted})")
    finally:
        session.close()

    session = SessionLocal()
    try:
        result = asyncio.run(seed_data(session))
    except Exception as exc:
        session.rollback()
        print(f"[ERROR] seed_data 调用失败：{exc}")
        import traceback
        traceback.print_exc()
        return 2
    finally:
        session.close()

    print(f"[OK] seed_data 完成：{result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
