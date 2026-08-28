# -*- coding: utf-8 -*-
"""
一次性种子脚本：为项目计划书截图补全各角色职责演示数据
- 种植户：农事活动、收获记录、农药使用
- 质检员：待审报告（is_qualified=NULL）、种子质量检测
- 仓库管理员：库存出入库记录、存储记录
- 销售人员：销售记录
- 管理员：全链路证书、跨角色通知

idempotent：用唯一业务编码去重（IR-2026-* / HV-2026-* / PRC-2026-* 等），
已存在则跳过。
"""
import pymysql
from datetime import datetime, timedelta
import sys

CONN_KW = dict(host='localhost', user='root', password='__REDACTED__',
               database='nongyao', charset='utf8mb4')

conn = pymysql.connect(**CONN_KW)
cur = conn.cursor()

added = 0
skipped = 0


def has_code(table, code_col, code):
    cur.execute(f"SELECT 1 FROM {table} WHERE {code_col}=%s LIMIT 1", (code,))
    return cur.fetchone() is not None


def now():
    return datetime(2026, 8, 28, 14, 0, 0)


# ============================================================
# 质检员（inspector）：补 6 份待审报告（is_qualified=NULL）
# ============================================================
PENDING_INSPECTIONS = [
    # (report_code, seed_batch_code, plot_id, days_ago, report_type,
    #  test_items(JSON), test_results(JSON), inspector, agency, certificate_no, remarks)
    ('IR-2026-005', 'PB2026-001', 1, 1, '农药残留检测',
     '["吡虫啉","百菌清","多菌灵"]', '["0.008mg/kg","未检出","未检出"]',
     '王检验', '驻马店市农检中心', 'ZMD-QC-2026-005', '收获前最后一次残留抽检'),
    ('IR-2026-006', 'PB2026-001', 1, 2, '黄曲霉毒素检测',
     '["AFB1","AFB2","AFG1","AFG2"]', '["1.2μg/kg","0.5μg/kg","未检出","未检出"]',
     '王检验', '河南省农科院质检中心', 'HA-QC-2026-006', '黄曲霉毒素B1低于国标5μg/kg'),
    ('IR-2026-007', 'PB2026-002', 2, 2, '成品质量检验',
     '["含油率","蛋白质","油酸","亚油酸"]', '["48.5%","25.3%","42.1%","31.2%"]',
     '李检验', '河南省农科院质检中心', 'HA-QC-2026-007', '符合一级花生标准'),
    ('IR-2026-008', 'PB2026-002', 2, 3, '重金属检测',
     '["铅","镉","砷","汞"]', '["0.08mg/kg","0.02mg/kg","0.05mg/kg","未检出"]',
     '李检验', '河南省农科院质检中心', 'HA-QC-2026-008', '远低于GB 2762限量'),
    ('IR-2026-009', 'PB2026-001', 1, 3, '土壤检测',
     '["pH","有机质","氮","磷","钾"]', '["6.8","2.5%","120mg/kg","80mg/kg","150mg/kg"]',
     '李检验', '河南省农科院质检中心', 'HA-QC-2026-009', '土壤肥力良好'),
    ('IR-2026-010', 'PB2026-001', 1, 0, '出库前快速检测',
     '["水分","酸价","过氧化值"]', '["6.5%","0.8mgKOH/g","3.2meq/kg"]',
     '王检验', '驻马店市农检中心', 'ZMD-QC-2026-010', '出库前复检合格'),
]
for row in PENDING_INSPECTIONS:
    code, batch, plot_id, days_ago, report_type = row[0], row[1], row[2], row[3], row[4]
    test_items, test_results, inspector, agency, cert, remarks = row[5], row[6], row[7], row[8], row[9], row[10]
    if has_code('inspection_reports', 'report_code', code):
        skipped += 1
        continue
    rdate = now() - timedelta(days=days_ago)
    cur.execute("""
        INSERT INTO inspection_reports
        (report_code, batch_id, seed_batch_code, harvest_code, processing_batch_id,
         plot_id, report_type, report_date, test_items, test_results,
         inspector, inspection_agency, certificate_no, is_qualified, remarks,
         file_path, file_hash, blockchain_hash, ipfs_hash, is_on_chain, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (code, 1, batch, None, None, plot_id, report_type, rdate,
          test_items, test_results, inspector, agency, cert, None, remarks,
          None, None, None, None, 0, now()))
    added += 1
print(f'[质检员] 待审报告：+{added} (跳过已存在 {skipped})')

# ============================================================
# 质检员 + 种植户：种子质量检测 seed_quality_tests
# ============================================================
SQT = [
    # (batch_id, days_ago, test_item, test_value, standard, qualified, method, agency)
    (1, 130, '发芽率', 95.5, 85.0, 1, 'GB/T 3543.4-1995', '河南省种子质量监督检测中心'),
    (1, 130, '净度', 98.2, 98.0, 1, 'GB/T 3543.3-1995', '河南省种子质量监督检测中心'),
    (1, 130, '水分', 12.3, 13.0, 1, 'GB/T 3543.6-1995', '河南省种子质量监督检测中心'),
    (2, 125, '发芽率', 94.0, 85.0, 1, 'GB/T 3543.4-1995', '河南省种子质量监督检测中心'),
    (2, 125, '净度', 97.8, 98.0, 0, 'GB/T 3543.3-1995', '河南省种子质量监督检测中心'),
]
sqt_added = 0
for r in SQT:
    cur.execute("""
        SELECT 1 FROM seed_quality_tests WHERE batch_id=%s AND test_item=%s LIMIT 1
    """, (r[0], r[2]))
    if cur.fetchone():
        continue
    tdate = now() - timedelta(days=r[1])
    cur.execute("""
        INSERT INTO seed_quality_tests
        (batch_id, test_date, test_item, test_value, standard_value, is_qualified,
         test_method, inspector, third_party_certificate, blockchain_hash, ipfs_hash, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], tdate, r[2], r[3], r[4], r[5], r[6], '李检验',
          f'HE-NY-2026-{r[0]:03d}', None, None, tdate))
    sqt_added += 1
print(f'[质检员/种植户] 种子质量检测：+{sqt_added}')

# ============================================================
# 种植户：补 8 条农事活动（覆盖全生长周期）
# ============================================================
FA = [
    # (plot_id, batch, type, days_ago, desc)
    (1, 'PB2026-001', '播种', 110, '机械条播，行距40cm，株距15cm，豫花65号高油酸花生'),
    (1, 'PB2026-001', '施肥', 95, '基肥：有机肥500kg/亩 + 高钾复合肥30kg/亩'),
    (1, 'PB2026-001', '除草', 80, '苗期人工除草 + 中耕机械除草'),
    (1, 'PB2026-001', '灌溉', 60, '开花下针期滴灌补水 30mm'),
    (1, 'PB2026-001', '喷药', 45, '吡虫啉1500倍液叶面喷雾，防治蚜虫'),
    (1, 'PB2026-001', '中耕培土', 35, '培土10cm，利于果针入土，提高结荚率'),
    (1, 'PB2026-001', '病虫害巡查', 20, '叶斑病零星发生，未达防治阈值，记录留档'),
    (1, 'PB2026-001', '收获', 5, '机械化分段收获，单产420kg/亩，含水率18%'),
    (2, 'PB2026-002', '播种', 108, '豫花37号高油花生，机械条播'),
    (2, 'PB2026-002', '施肥', 93, '复合肥25kg/亩'),
    (2, 'PB2026-002', '喷药', 40, '百菌清600倍液防治叶斑病'),
    (2, 'PB2026-002', '灌溉', 55, '结荚期补水 28mm'),
    (2, 'PB2026-002', '收获', 8, '机械化收获，单产380kg/亩'),
    (3, 'PB2026-001', '播种', 100, 'C地块试种新品种（豫花37号），观察适应性'),
    (3, 'PB2026-001', '除草', 75, '人工除草'),
    (3, 'PB2026-001', '收获', 12, '试种批次采收，单产210kg/亩'),
]
fa_added = 0
for r in FA:
    cur.execute("""
        SELECT 1 FROM farming_activities
        WHERE plot_id=%s AND activity_type=%s AND activity_date=%s LIMIT 1
    """, (r[0], r[2], (now() - timedelta(days=r[3])).strftime('%Y-%m-%d')))
    if cur.fetchone():
        continue
    cur.execute("""
        INSERT INTO farming_activities
        (plot_id, seed_batch_code, activity_type, activity_date, description,
         worker_id, equipment_id, photos, notes, blockchain_hash, ipfs_hash,
         is_on_chain, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], r[1], r[2], now() - timedelta(days=r[3]), r[4],
          None, None, None, None, None, None, 0,
          now() - timedelta(days=r[3])))
    fa_added += 1
print(f'[种植户] 农事活动：+{fa_added}')

# ============================================================
# 种植户：收获记录 harvest_records
# ============================================================
HV = [
    # (code, batch, plot_id, days_ago, qty_kg, sort_result, quality, inspector)
    ('HV-2026-001', 'PB2026-001', 1, 5, 2100.0, '一级品率82%，饱果率91%', '特级', '王检验'),
    ('HV-2026-002', 'PB2026-002', 2, 8, 1750.0, '一级品率78%，饱果率88%', '一级', '王检验'),
    ('HV-2026-003', 'PB2026-001', 3, 12, 800.0, '试种批次，饱果率85%', '二级', '李检验'),
]
hv_added = 0
for r in HV:
    if has_code('harvest_records', 'harvest_code', r[0]):
        continue
    cur.execute("""
        INSERT INTO harvest_records
        (harvest_code, seed_batch_code, plot_id, harvest_date, harvest_quantity,
         sorting_result, quality_level, inspector, blockchain_hash, ipfs_hash,
         is_on_chain, created_at, updated_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], r[1], r[2], now() - timedelta(days=r[3]), r[4],
          r[5], r[6], r[7], None, None, 0, now(), now()))
    hv_added += 1
print(f'[种植户] 收获记录：+{hv_added}')

# ============================================================
# 仓库管理员：入库/出库交易 inventory_transactions（5 条）+ storage_records（5 条）
# ============================================================
ITEMS = {
    # item_id → (item_name, unit)
    1: ('花生仁 一级 5kg袋装', 'kg'),
    3: ('花生仁 真空袋装 25kg', 'kg'),
    4: ('花生仁 真空袋装 25kg', 'kg'),
    5: ('花生仁 真空袋装 10kg', 'kg'),
}
INV_TX = [
    # (item_id, type, qty, unit, price, days_ago, operator, src_doc_no, remarks)
    (1, '入库', 2100.0, 'kg', 8.5, 5, '仓库管理员李师傅', 'HV-2026-001', 'A地块收获入库'),
    (3, '入库', 3600.0, 'kg', 12.0, 12, '仓库管理员李师傅', 'PRC-2026-001', '加工成品入库'),
    (4, '入库', 2450.0, 'kg', 13.5, 10, '仓库管理员李师傅', 'PRC-2026-002', '加工成品入库'),
    (4, '出库', 500.0, 'kg', 13.5, 2, '仓库管理员李师傅', 'SO-20260826-001', '郑州惠济食品原料发货'),
    (3, '出库', 300.0, 'kg', 12.0, 1, '仓库管理员李师傅', 'SO-20260826-002', '武汉华中农贸发货'),
    (5, '出库', 800.0, 'kg', 13.0, 3, '仓库管理员李师傅', 'SO-20260825-003', '广州天河食品发货'),
]
it_added = 0
for r in INV_TX:
    cur.execute("""
        SELECT 1 FROM inventory_transactions
        WHERE item_id=%s AND transaction_type=%s AND quantity=%s AND transaction_date=%s LIMIT 1
    """, (r[0], r[1], r[2], (now() - timedelta(days=r[5])).strftime('%Y-%m-%d %H:%M:%S')))
    if cur.fetchone():
        continue
    total = r[2] * r[4]
    cur.execute("""
        INSERT INTO inventory_transactions
        (item_id, transaction_type, quantity, unit, unit_price, total_amount,
         transaction_date, operator, source_document, source_document_no, remarks,
         blockchain_hash, ipfs_hash, is_on_chain, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], r[1], r[2], r[3], r[4], total,
          now() - timedelta(days=r[5]), r[6], 'inventory_item', r[7], r[8],
          None, None, 0, now() - timedelta(days=r[5])))
    it_added += 1
print(f'[仓库管理员] 出入库交易：+{it_added}')

STORAGE = [
    # (warehouse_id, seed_batch_code, processing_batch_id, item_code, item_name, location, qty, unit, temp, humidity, days_ago, operator)
    (1, 'PB2026-001', None, 'SEED-001', '豫花65号 花生种', 'A区-03排', 2100.0, 'kg', 18.0, 45.0, 5, '保管员赵师傅'),
    (3, None, 1, 'PRC-2026-001', '豫花65号花生仁 一级 25kg真空装', 'C区-01排', 3600.0, 'kg', 15.0, 50.0, 12, '保管员钱师傅'),
    (3, None, 2, 'PRC-2026-002', '豫花37号花生仁 特级 25kg真空装', 'C区-02排', 2450.0, 'kg', 15.0, 50.0, 10, '保管员钱师傅'),
    (1, 'PB2026-002', None, 'SEED-002', '豫花37号 花生种', 'A区-05排', 1750.0, 'kg', 18.5, 45.0, 8, '保管员赵师傅'),
    (3, None, 3, 'PRC-2026-003', '鲜花生 6级 5kg袋装', 'C区-03排', 765.0, 'kg', 12.0, 60.0, 2, '保管员钱师傅'),
]
st_added = 0
for r in STORAGE:
    cur.execute("""
        SELECT 1 FROM storage_records
        WHERE warehouse_id=%s AND item_code=%s LIMIT 1
    """, (r[0], r[3]))
    if cur.fetchone():
        continue
    cur.execute("""
        INSERT INTO storage_records
        (warehouse_id, batch_code, seed_batch_code, processing_batch_code, item_code,
         item_name, storage_location, quantity, unit, temperature, humidity,
         record_time, operator, blockchain_hash, ipfs_hash, is_on_chain, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], None, r[1], (str(r[2]) if r[2] else None), r[3], r[4], r[5],
          r[6], r[7], r[8], r[9], now() - timedelta(days=r[10]), r[11],
          None, None, 0, now() - timedelta(days=r[10])))
    st_added += 1
print(f'[仓库管理员] 存储记录：+{st_added}')

# ============================================================
# 销售人员：销售记录 sales_records（5 条）
# ============================================================
SR = [
    # (order_id, batch, prb, store, days_ago, qty, unit, amount)
    (1, 'PB2026-001', 'PRC-2026-001', '郑州惠济食品原料有限公司', 8, 500.0, 'kg', 6500.0),
    (2, 'PB2026-002', 'PRC-2026-002', '武汉华中农贸批发市场', 6, 300.0, 'kg', 4500.0),
    (3, 'PB2026-001', 'PRC-2026-001', '广州天河食品采购中心', 5, 800.0, 'kg', 9600.0),
    (5, 'PB2026-001', 'PRC-2026-001', '郑州惠济食品原料有限公司', 2, 200.0, 'kg', 2400.0),
    (10, 'PB2026-002', 'PRC-2026-002', '武汉华中农贸批发市场', 1, 150.0, 'kg', 2100.0),
]
sr_added = 0
for r in SR:
    cur.execute("""
        SELECT 1 FROM sales_records
        WHERE order_id=%s AND sale_quantity=%s LIMIT 1
    """, (r[0], r[5]))
    if cur.fetchone():
        continue
    cur.execute("""
        INSERT INTO sales_records
        (order_id, seed_batch_code, processing_batch_code, store_name, sale_date,
         sale_quantity, sale_unit, sale_amount, blockchain_hash, ipfs_hash,
         is_on_chain, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], r[1], r[2], r[3], now() - timedelta(days=r[4]),
          r[5], r[6], r[7], None, None, 0, now() - timedelta(days=r[4])))
    sr_added += 1
print(f'[销售人员] 销售记录：+{sr_added}')

# ============================================================
# 全链路证书 certificates
# ============================================================
CERTS = [
    ('CERT-2026-001', '绿色食品认证', 'batch', 1,
     '中国绿色食品发展中心', 'GF410828210001', None, None,
     'valid', '2026-03-15', '2029-03-14', '豫花65号高油酸花生绿色食品认证'),
    ('CERT-2026-002', '有机产品认证', 'batch', 2,
     '北京中绿华夏有机食品认证中心', 'OTRDC-2026-002', None, None,
     'valid', '2026-05-20', '2028-05-19', '豫花37号高油花生有机产品认证'),
    ('CERT-2026-003', 'GAP良好农业规范认证', 'organization', 2,
     '中国质量认证中心', 'CQC-GAP-2026-003', None, None,
     'valid', '2026-01-10', '2029-01-09', '金生链花生种植专业合作社GAP认证'),
    ('CERT-2026-004', '地理标志保护产品', 'organization', 2,
     '国家知识产权局', 'GI-41-2026-004', None, None,
     'valid', '2026-06-01', '2031-05-31', '正阳花生地理标志保护产品专用标志使用'),
]
cert_added = 0
for r in CERTS:
    if has_code('certificates', 'certificate_id', r[0]):
        continue
    cur.execute("""
        INSERT INTO certificates
        (certificate_id, certificate_type, subject_type, subject_id, issuer,
         serial_number, public_key, private_key, certificate_data, status,
         valid_from, valid_until, revoked_at, reason, created_at, updated_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (r[0], r[1], r[2], r[3], r[4], r[5],
          '04' + 'ab'*32, '', r[11], r[8], r[9], r[10],
          None, None, now(), now()))
    cert_added += 1
print(f'[全链路] 证书：+{cert_added}')

# ============================================================
# 角色通知 notifications（每角色几条）
# ============================================================
NOTIF = [
    # (user_id, role_name, type, title, content, priority, days_ago, is_read)
    (2, 'farmer', 'warning', 'A地块土壤湿度偏低', '传感器监测：PLOT-A 土壤湿度降至38%，建议及时灌溉', 'medium', 0, 0),
    (2, 'farmer', 'info', '未来三天有雨', '气象预报：8月30-9月1日有连续降雨，请做好排水准备', 'low', 1, 0),
    (2, 'farmer', 'success', 'A地块已达收获标准', '饱果率91%，建议安排机械化收获', 'high', 5, 0),
    (3, 'inspector', 'warning', '新检测任务：PB2026-001 黄曲霉毒素', '请尽快完成A地块收获批次的黄曲霉毒素检测', 'high', 1, 0),
    (3, 'inspector', 'info', 'PB2026-002 出库检测已完成', '请审核出库前快速检测报告 IR-2026-010', 'medium', 0, 0),
    (3, 'inspector', 'warning', '证书 30 天内到期提醒', 'OTRDC-2026-002 有机认证 2026-09-20 到期', 'low', 2, 0),
    (4, 'warehouse_manager', 'warning', '花生仁一级 库存偏低', '当前库存2100kg，低于安全库存线2500kg，建议补货', 'high', 1, 0),
    (4, 'warehouse_manager', 'success', '加工成品即将到货', 'PRC-2026-001 3600kg 已发出，预计今天入库', 'medium', 0, 0),
    (4, 'warehouse_manager', 'info', '广州天河订单待发货', 'SO-20260825-003 800kg，需安排出库', 'medium', 0, 0),
    (5, 'salesperson', 'success', '新订单已创建', 'SO-20260828-001 15000元 客户：武汉华中农贸', 'high', 0, 0),
    (5, 'salesperson', 'success', '广州天河订单已收款', 'SO-20260825-003 9600元已到账', 'low', 0, 0),
    (5, 'salesperson', 'info', '物流签收确认', 'SF150052480539 顺丰已签收，请通知客户', 'low', 1, 0),
]
nf_added = 0
for r in NOTIF:
    user_id, role_name, ntype, title, content, priority, days_ago, is_read = r
    cur.execute("""
        SELECT 1 FROM notifications
        WHERE user_id=%s AND title=%s LIMIT 1
    """, (user_id, title))
    if cur.fetchone():
        continue
    cur.execute("""
        INSERT INTO notifications
        (user_id, type, title, message, `read`, created_at)
        VALUES (%s,%s,%s,%s,%s,%s)
    """, (user_id, ntype, title, content, is_read, now() - timedelta(days=days_ago)))
    nf_added += 1
print(f'[全角色] 通知：+{nf_added}')

conn.commit()
print(f'\n=== 完成：新增 {added + sqt_added + fa_added + hv_added + it_added + st_added + sr_added + cert_added + nf_added} 条 ===')
conn.close()