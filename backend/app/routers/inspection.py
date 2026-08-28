from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from datetime import datetime
from app.core.timezone import now_cn_naive
import hashlib
import io
import base64
import qrcode
import os
import platform
import logging
import re

from app.core.database import get_db
from app.core.config import settings
from app.core.qrcode_generator import generate_trace_qrcode
from app.models.inspection import InspectionReport, PesticideResidueTest
from app.models.seed import SeedBatch, SeedSupplier
from app.models.processing import ProcessingBatch
from app.models.planting import Plot
from app.auth import get_current_active_user, require_permission
from app.models.auth import User
from app.schemas import InspectionReportCreate

logger = logging.getLogger(__name__)

router = APIRouter()

# CJK 字体候选路径（按优先级排列）
_CJK_FONT_CANDIDATES = {
    "Windows": [
        "C:/Windows/Fonts/simsun.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/msyhbd.ttc",
    ],
    "Linux": [
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/local/share/fonts/wqy-zenhei.ttc",
    ],
    "Darwin": [
        "/System/Library/Fonts/PingFang.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ],
}


def get_cjk_font_path() -> str | None:
    """跨平台查找可用的 CJK 字体路径，找不到返回 None。"""
    # 项目自带字体目录（最高优先级）
    project_font_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "fonts")
    if os.path.isdir(project_font_dir):
        for f in os.listdir(project_font_dir):
            if f.lower().endswith((".ttc", ".ttf", ".otf")):
                return os.path.join(project_font_dir, f)

    system_name = platform.system()
    candidates = _CJK_FONT_CANDIDATES.get(system_name, [])
    for path in candidates:
        if os.path.isfile(path):
            return path

    # 遍历 Linux 字体目录作为兜底
    if system_name == "Linux":
        font_dirs = ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts")]
        cjk_keywords = ["wqy", "noto", "cjk", "droid", "source-han"]
        for d in font_dirs:
            if not os.path.isdir(d):
                continue
            for root, _, files in os.walk(d):
                for f in files:
                    if f.lower().endswith((".ttc", ".ttf", ".otf")):
                        if any(kw in f.lower() for kw in cjk_keywords):
                            return os.path.join(root, f)

    logger.warning("未找到 CJK 字体，PDF 中的中文可能无法正常显示")
    return None


def generate_hash(data):
    return hashlib.sha256(str(data).encode()).hexdigest()


@router.post("/reports")
async def create_report(
    data: InspectionReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inspection:quality", current_user, db)

    if db.query(InspectionReport).filter(InspectionReport.report_code == data.report_code).first():
        raise HTTPException(status_code=400, detail="报告编码已存在")

    batch_id = None
    if data.batch_code:
        batch = db.query(SeedBatch).filter(SeedBatch.batch_code == data.batch_code).first()
        if batch:
            batch_id = batch.id

    processing_batch_id = None
    if data.processing_batch_code:
        processing_batch = db.query(ProcessingBatch).filter(ProcessingBatch.batch_code == data.processing_batch_code).first()
        if processing_batch:
            processing_batch_id = processing_batch.id

    plot_id = None
    if data.plot_code:
        plot = db.query(Plot).filter(Plot.plot_code == data.plot_code).first()
        if plot:
            plot_id = plot.id

    report = InspectionReport(
        report_code=data.report_code,
        batch_id=batch_id,
        seed_batch_code=data.batch_code,
        processing_batch_id=processing_batch_id,
        plot_id=plot_id,
        report_type=data.report_type,
        inspector=data.inspector,
        inspection_agency=data.inspection_agency,
        certificate_no=data.certificate_no,
        is_qualified=data.is_qualified,
        remarks=data.remarks,
        file_hash=generate_hash(f"{data.report_code}{now_cn_naive()}"),
        blockchain_hash=generate_hash(f"{data.report_code}{data.report_type}{now_cn_naive()}"),
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    # 推送检测报告通知给检测员和管理员（不合格时为 warning）
    try:
        from app.utils.notifications_helper import notify_inspection_report
        notify_inspection_report(
            db,
            report_code=report.report_code,
            report_type=report.report_type,
            is_qualified=report.is_qualified,
        )
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("notify_inspection_report failed: %s", e)

    return {"status": "success", "data": report}


@router.get("/reports")
async def get_reports(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    report_type: str = None,
    batch_code: str = None,
    is_qualified: bool = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inspection:query", current_user, db)
    
    query = db.query(InspectionReport)
    if report_type:
        query = query.filter(InspectionReport.report_type == report_type)
    if batch_code:
        batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
        if batch:
            query = query.filter(
                (InspectionReport.batch_id == batch.id) | 
                (InspectionReport.seed_batch_code == batch_code)
            )
        else:
            query = query.filter(InspectionReport.seed_batch_code == batch_code)
    if is_qualified is not None:
        query = query.filter(InspectionReport.is_qualified == is_qualified)
    
    total = query.count()
    reports = query.offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "status": "success",
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": reports,
    }


@router.get("/reports/{report_code}")
async def get_report(
    report_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inspection:query", current_user, db)
    
    report = db.query(InspectionReport).filter(InspectionReport.report_code == report_code).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    
    residue_tests = db.query(PesticideResidueTest).filter(PesticideResidueTest.report_id == report.id).all()
    
    return {
        "status": "success",
        "data": {
            "report": report,
            "residue_tests": residue_tests,
        },
    }


@router.post("/residue-tests")
async def create_residue_test(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inspection:quality", current_user, db)

    report_code = data.get("report_code")
    test_item = data.get("test_item")
    limit_value = data.get("limit_value")
    measured_value = data.get("measured_value")
    if not report_code or not test_item or limit_value is None or measured_value is None:
        raise HTTPException(status_code=400, detail="报告编码、检测项目、限量值和实测值为必填项")

    report = db.query(InspectionReport).filter(InspectionReport.report_code == report_code).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")

    is_over_limit = measured_value > limit_value

    test = PesticideResidueTest(
        report_id=report.id,
        test_item=test_item,
        limit_value=limit_value,
        measured_value=measured_value,
        unit=data.get("unit", "mg/kg"),
        is_over_limit=is_over_limit,
        test_method=data.get("test_method"),
    )
    db.add(test)

    # 若超标，同步将报告置为不合格 — 与检测项写入同一次事务，保证一致性
    if is_over_limit:
        report.is_qualified = False

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("残留检测项入库失败 report=%s: %s", report_code, e, exc_info=True)
        raise HTTPException(status_code=500, detail="残留检测项入库失败")
    db.refresh(test)

    return {"status": "success", "data": test}


@router.get("/residue-tests")
async def get_residue_tests(
    report_code: str = None,
    is_over_limit: bool = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("inspection:query", current_user, db)
    
    query = db.query(PesticideResidueTest)
    if report_code:
        report = db.query(InspectionReport).filter(InspectionReport.report_code == report_code).first()
        if report:
            query = query.filter(PesticideResidueTest.report_id == report.id)
    if is_over_limit is not None:
        query = query.filter(PesticideResidueTest.is_over_limit == is_over_limit)
    
    tests = query.all()
    return {"status": "success", "count": len(tests), "data": tests}


@router.get("/trace/{batch_code}")
async def trace_by_batch(
    batch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)
    
    batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    
    from app.models.planting import PlantingRecord, FarmingActivity, EnvironmentalData
    from app.models.pesticide import PesticideApplication
    from app.models.processing import ProcessingBatch
    from app.models.inspection import InspectionReport, PesticideResidueTest
    
    planting_records = db.query(PlantingRecord).filter(PlantingRecord.batch_id == batch.id).all()
    plot_ids = [pr.plot_id for pr in planting_records]
    
    farming_activities = db.query(FarmingActivity).filter(FarmingActivity.plot_id.in_(plot_ids)).all()
    pesticide_applications = db.query(PesticideApplication).filter(PesticideApplication.plot_id.in_(plot_ids)).all()
    processing_batches = db.query(ProcessingBatch).filter(ProcessingBatch.seed_batch_id == batch.id).all()
    
    all_report_ids = []
    for pb in processing_batches:
        reports = db.query(InspectionReport).filter(InspectionReport.processing_batch_id == pb.id).all()
        all_report_ids.extend([r.id for r in reports])
    
    residue_tests = []
    for rid in all_report_ids:
        tests = db.query(PesticideResidueTest).filter(PesticideResidueTest.report_id == rid).all()
        residue_tests.extend(tests)
    
    return {
        "status": "success",
        "data": {
            "seed_batch": batch,
            "planting_records": planting_records,
            "farming_activities": farming_activities,
            "pesticide_applications": pesticide_applications,
            "processing_batches": processing_batches,
            "residue_tests": residue_tests,
        },
    }


@router.get("/trace/{batch_code}/pdf")
async def export_trace_pdf(
    batch_code: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await require_permission("trace:query", current_user, db)

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    cjk_font_path = get_cjk_font_path()
    cjk_font_name = 'Helvetica'  # 默认回退（不支持中文）
    if cjk_font_path:
        try:
            pdfmetrics.registerFont(TTFont('CJKFont', cjk_font_path))
            pdfmetrics.registerFontFamily('CJKFont', normal='CJKFont', bold='CJKFont', italic='CJKFont', boldItalic='CJKFont')
            cjk_font_name = 'CJKFont'
        except Exception as e:
            logger.warning(f"注册 CJK 字体失败: {e}")

    from app.models.seed import SeedBatch, SeedSupplier
    from app.models.planting import PlantingRecord, Plot, FarmingActivity, EnvironmentalData
    from app.models.pesticide import PesticideApplication, Pesticide
    from app.models.inspection import InspectionReport, PesticideResidueTest
    from app.models.processing import ProcessingBatch, ProcessingRecord
    from app.models.inventory import InventoryItem
    from app.models.sales import OrderItem, Order
    from app.models.blockchain import BlockchainRecord

    # 状态中文映射，避免 PDF 中出现英文裸值
    STATUS_LABELS = {
        # 种子批次
        'stocked': '库存中', 'sold': '已销售', 'used': '已使用', 'returned': '已退回',
        # 加工
        'completed': '已完成', 'in_progress': '进行中', 'pending': '待加工', 'cancelled': '已取消',
        # 库存
        'in_stock': '在库', 'out_of_stock': '缺货', 'reserved': '已预留', 'damaged': '已损坏',
        # 订单
        'pending': '待处理', 'processing': '处理中', 'shipped': '已发货', 'completed': '已完成',
    }
    def fmt_status(status: str | None, default='-') -> str:
        return STATUS_LABELS.get(status, status or default)

    seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not seed_batch:
        raise HTTPException(status_code=404, detail="批次不存在")

    supplier = db.query(SeedSupplier).filter(SeedSupplier.id == seed_batch.supplier_id).first()
    planting_records = db.query(PlantingRecord).filter(PlantingRecord.batch_id == seed_batch.id).all()
    plot_ids = [r.plot_id for r in planting_records]
    processing_batches = db.query(ProcessingBatch).filter(ProcessingBatch.seed_batch_id == seed_batch.id).all()
    # 过滤掉 seed 脚本中可能产生的纯数字/无意义测试批次，只保留有规范批次号的记录
    processing_batches = [pb for pb in processing_batches if pb.batch_code and re.match(r'^[A-Z]{2,}-\d{4}-', pb.batch_code)]
    processing_batch_ids = [pb.id for pb in processing_batches]
    processing_batch_codes = [pb.batch_code for pb in processing_batches]

    # 区块链存证摘要（按批次反查）
    blockchain_records = db.query(BlockchainRecord).filter(
        (BlockchainRecord.seed_batch_code == batch_code) |
        (BlockchainRecord.batch_id == batch_code) |
        (BlockchainRecord.seed_batch_id == str(seed_batch.id))
    ).order_by(BlockchainRecord.uploaded_at.desc()).all()
    on_chain_count = sum(1 for r in blockchain_records if r.is_on_chain)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=50, leftMargin=50, topMargin=50, bottomMargin=30)
    styles = getSampleStyleSheet()

    elements = []

    title_style = ParagraphStyle(
        'Title',
        parent=styles['Heading1'],
        fontName=cjk_font_name,
        fontSize=20,
        alignment=1,
        spaceAfter=10,
        textColor=colors.darkgreen,
    )

    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['Normal'],
        fontName=cjk_font_name,
        fontSize=12,
        alignment=1,
        spaceAfter=20,
        textColor=colors.gray,
    )

    sub_title_style = ParagraphStyle(
        'SubTitle',
        parent=styles['Heading2'],
        fontName=cjk_font_name,
        fontSize=14,
        spaceAfter=10,
        textColor=colors.darkgreen,
    )

    normal_style = ParagraphStyle(
        'Normal',
        parent=styles['Normal'],
        fontName=cjk_font_name,
        fontSize=10,
        leading=16,
    )

    small_style = ParagraphStyle(
        'Small',
        parent=styles['Normal'],
        fontName=cjk_font_name,
        fontSize=9,
        leading=14,
        textColor=colors.gray,
    )

    # ===== 报告头部 =====
    elements.append(Paragraph("金生链 · 花生全产业链溯源平台", title_style))
    elements.append(Paragraph("质量追溯报告", subtitle_style))

    header_data = [
        ["批次编号", batch_code, "报告生成时间", now_cn_naive().strftime("%Y-%m-%d %H:%M:%S")],
        ["品种名称", seed_batch.variety_name or "-", "状态", fmt_status(seed_batch.status)],
    ]
    header_table = Table(header_data, colWidths=[90, 180, 90, 120])
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0fdf4')),
        ('BACKGROUND', (2, 0), (2, -1), colors.HexColor('#f0fdf4')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 20))

    # ===== 区块链存证摘要 =====
    if blockchain_records:
        elements.append(Paragraph("区块链存证摘要", sub_title_style))
        chain_summary = [
            ["已存证环节数", str(len(blockchain_records))],
            ["已上链记录数", str(on_chain_count)],
            ["最近存证时间", (blockchain_records[0].uploaded_at.strftime("%Y-%m-%d %H:%M:%S") if blockchain_records[0].uploaded_at else "-")],
            ["最近数据哈希", (blockchain_records[0].data_hash[:16] + "..." if blockchain_records[0].data_hash else "-")],
        ]
        chain_table = Table(chain_summary, colWidths=[120, 300])
        chain_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0fdf4')),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ]))
        elements.append(chain_table)
        elements.append(Spacer(1, 16))

    # ===== 一、种子溯源信息 =====
    elements.append(Paragraph("一、种子溯源信息", sub_title_style))
    seed_data = [
        ["批次编号", seed_batch.batch_code],
        ["品种名称", seed_batch.variety_name or "-"],
        ["繁育基地", seed_batch.breeding_base or "-"],
        ["供货企业", supplier.name if supplier else "-"],
        ["生产日期", seed_batch.production_date.strftime("%Y-%m-%d") if seed_batch.production_date else "-"],
        ["净含量", f"{seed_batch.net_weight} kg" if seed_batch.net_weight is not None else "-"],
        ["发芽率", f"{seed_batch.germination_rate}%" if seed_batch.germination_rate is not None else "-"],
        ["纯度", f"{seed_batch.purity}%" if seed_batch.purity is not None else "-"],
        ["状态", fmt_status(seed_batch.status)],
    ]
    seed_table = Table(seed_data, colWidths=[120, 300])
    seed_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f0fdf4')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
    ]))
    elements.append(seed_table)
    elements.append(Spacer(1, 20))

    # ===== 二、种植管理信息 =====
    if planting_records:
        elements.append(Paragraph("二、种植管理信息", sub_title_style))

        for record in planting_records:
            plot = db.query(Plot).filter(Plot.id == record.plot_id).first()
            activities = db.query(FarmingActivity).filter(
                FarmingActivity.plot_id == record.plot_id,
                FarmingActivity.seed_batch_code == batch_code,
            ).all() if record.plot_id else []
            env_data = db.query(EnvironmentalData).filter(
                EnvironmentalData.plot_id == record.plot_id,
                EnvironmentalData.seed_batch_code == batch_code,
            ).order_by(EnvironmentalData.record_time.desc()).limit(5).all() if record.plot_id else []

            plot_info = [
                ["地块编码", plot.plot_code if plot else "-", "地块名称", plot.name if plot else "-"],
                ["位置", plot.location if plot else "-", "种植户", record.farmer or "-"],
                ["种植日期", record.planting_date.strftime("%Y-%m-%d") if record.planting_date else "-", "预计采收", record.expected_harvest_date.strftime("%Y-%m-%d") if record.expected_harvest_date else "-"],
            ]
            plot_table = Table(plot_info, colWidths=[90, 150, 90, 150])
            plot_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f0fdf4')),
                ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ]))
            elements.append(plot_table)
            elements.append(Spacer(1, 8))

            if activities:
                elements.append(Paragraph("农事活动记录", normal_style))
                for activity in activities:
                    elements.append(Paragraph(
                        f"• {activity.activity_date.strftime('%Y-%m-%d') if activity.activity_date else '-'}：{activity.activity_type} - {activity.description or '-'}",
                        small_style
                    ))
                elements.append(Spacer(1, 6))

            if env_data:
                elements.append(Paragraph("最近环境监测数据", normal_style))
                env_headers = ["时间", "空气温(°C)", "空气湿(%)", "土壤温(°C)", "土壤湿(%)", "pH"]
                env_rows = [env_headers]
                for e in env_data:
                    env_rows.append([
                        e.record_time.strftime("%m-%d %H:%M") if e.record_time else "-",
                        f"{e.temperature:.1f}" if e.temperature is not None else "-",
                        f"{e.humidity:.1f}" if e.humidity is not None else "-",
                        f"{e.soil_temperature:.1f}" if e.soil_temperature is not None else "-",
                        f"{e.soil_moisture:.1f}" if e.soil_moisture is not None else "-",
                        f"{e.ph_value:.1f}" if e.ph_value is not None else "-",
                    ])
                env_table = Table(env_rows, colWidths=[80, 60, 60, 60, 60, 50])
                env_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0fdf4')),
                    ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
                    ('FONTSIZE', (0, 0), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
                ]))
                elements.append(env_table)

            elements.append(Spacer(1, 14))

    # ===== 三、农药使用记录 =====
    pesticide_applications = db.query(PesticideApplication).filter(
        PesticideApplication.seed_batch_code == batch_code
    ).all() if planting_records else []
    if not pesticide_applications and plot_ids:
        pesticide_applications = db.query(PesticideApplication).filter(
            PesticideApplication.plot_id.in_(plot_ids)
        ).all()

    if pesticide_applications:
        elements.append(Paragraph("三、农药使用记录", sub_title_style))
        app_data = [["农药名称", "品牌", "登记证号", "施用日期", "施用量", "单位", "施药人", "合规性"]]
        for app in pesticide_applications:
            pesticide = db.query(Pesticide).filter(Pesticide.id == app.pesticide_id).first()
            app_data.append([
                pesticide.name if pesticide else "-",
                pesticide.brand if pesticide else "-",
                pesticide.registration_no if pesticide else "-",
                app.application_date.strftime("%Y-%m-%d") if app.application_date else "-",
                str(app.dosage) if app.dosage is not None else "-",
                app.unit or "-",
                app.applicator or "-",
                "合规" if app.is_compliant else "不合规",
            ])
        app_table = Table(app_data, colWidths=[80, 70, 80, 65, 45, 35, 55, 45])
        app_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eff6ff')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ]))
        elements.append(app_table)
        elements.append(Spacer(1, 20))

    # ===== 四、检测报告 =====
    inspections = db.query(InspectionReport).filter(
        (InspectionReport.batch_id == seed_batch.id) |
        (InspectionReport.seed_batch_code == batch_code) |
        (InspectionReport.processing_batch_id.in_(processing_batch_ids) if processing_batch_ids else False)
    ).all()
    if inspections:
        elements.append(Paragraph("四、检测报告", sub_title_style))

        for insp in inspections:
            elements.append(Paragraph(f"报告编号：{insp.report_code}", normal_style))
            # 检测结果：True=合格，False=不合格，None/NULL=待审核
            if insp.is_qualified is True:
                result_label = "合格"
            elif insp.is_qualified is False:
                result_label = "不合格"
            else:
                result_label = "待审核"
            insp_info = [
                ["检测类型", insp.report_type or "-", "检测机构", insp.inspection_agency or "-"],
                ["检测日期", insp.report_date.strftime("%Y-%m-%d") if insp.report_date else "-", "检测员", insp.inspector or "-"],
                ["检测结果", result_label, "", ""],
            ]
            insp_table = Table(insp_info, colWidths=[90, 150, 90, 150])
            insp_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#faf5ff')),
                ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ]))
            elements.append(insp_table)

            residues = db.query(PesticideResidueTest).filter(PesticideResidueTest.report_id == insp.id).all()
            if residues:
                elements.append(Paragraph("农药残留检测结果", small_style))
                res_data = [["检测项目", "限量值", "实测值", "单位", "判定"]]
                for r in residues:
                    res_data.append([
                        r.test_item or "-",
                        str(r.limit_value) if r.limit_value is not None else "-",
                        str(r.measured_value) if r.measured_value is not None else "-",
                        r.unit or "-",
                        "超标" if r.is_over_limit else "合格",
                    ])
                res_table = Table(res_data, colWidths=[120, 80, 80, 60, 80])
                res_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#faf5ff')),
                    ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
                ]))
                elements.append(res_table)
            elements.append(Spacer(1, 14))

    # ===== 五、加工生产信息 =====
    if processing_batches:
        elements.append(Paragraph("五、加工生产信息", sub_title_style))

        for pb in processing_batches:
            records = db.query(ProcessingRecord).filter(ProcessingRecord.batch_id == pb.id).all()

            pb_info = [
                ["加工批次", pb.batch_code, "产品名称", pb.product_name or "-"],
                ["产品等级", pb.product_grade or "-", "加工日期", pb.processing_date.strftime("%Y-%m-%d") if pb.processing_date else "-"],
                ["状态", fmt_status(pb.status), "", ""],
            ]
            pb_table = Table(pb_info, colWidths=[90, 150, 90, 150])
            pb_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fff7ed')),
                ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ]))
            elements.append(pb_table)

            if records:
                elements.append(Paragraph("加工工序", normal_style))
                for pr in sorted(records, key=lambda x: x.process_order or 0):
                    elements.append(Paragraph(
                        f"• 第{pr.process_order}序：{pr.process_name}（操作人：{pr.operator or '-'}，时间：{pr.start_time.strftime('%Y-%m-%d %H:%M') if pr.start_time else '-'} ~ {pr.end_time.strftime('%Y-%m-%d %H:%M') if pr.end_time else '-'}）",
                        small_style
                    ))
            elements.append(Spacer(1, 14))

    # ===== 六、仓储物流信息 =====
    inventory_items = db.query(InventoryItem).filter(
        (InventoryItem.batch_code.in_(processing_batch_codes) |
        (InventoryItem.seed_batch_code == seed_batch.batch_code)) &
        (~InventoryItem.item_code.like('INV-PRO-%'))
    ).all()
    if inventory_items:
        elements.append(Paragraph("六、仓储物流信息", sub_title_style))

        inv_data = [["商品编码", "商品名称", "数量", "单位", "状态"]]
        for item in inventory_items:
            inv_data.append([
                item.item_code or "-",
                item.item_name or "-",
                str(item.quantity) if item.quantity is not None else "-",
                item.unit or "-",
                fmt_status(item.status),
            ])
        inv_table = Table(inv_data, colWidths=[100, 140, 70, 60, 80])
        inv_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#ecfeff')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ]))
        elements.append(inv_table)
        elements.append(Spacer(1, 20))

    # ===== 七、终端销售信息 =====
    # 关联订单：过滤掉二维码测试订单，避免出现在正式 PDF 报告中
    qr_test_order_ids = [o.id for o in db.query(Order).filter(Order.order_no.like('SO-QRTEST-%')).all()]
    order_items = db.query(OrderItem).filter(
        (OrderItem.batch_code.in_(processing_batch_codes) |
        (OrderItem.seed_batch_code == batch_code)) &
        (~OrderItem.order_id.in_(qr_test_order_ids))
    ).all()
    if order_items:
        elements.append(Paragraph("七、终端销售信息", sub_title_style))

        sales_data = [["订单编号", "商品名称", "数量", "单位", "单价(¥)", "订单日期", "状态"]]
        for oi in order_items:
            order = db.query(Order).filter(Order.id == oi.order_id).first()
            sales_data.append([
                order.order_no if order else "-",
                oi.item_name or "-",
                str(oi.quantity) if oi.quantity is not None else "-",
                oi.unit or "-",
                f"{oi.unit_price:.2f}" if oi.unit_price is not None else "-",
                order.order_date.strftime("%Y-%m-%d") if order and order.order_date else "-",
                fmt_status(order.status),
            ])
        sales_table = Table(sales_data, colWidths=[90, 110, 45, 45, 60, 80, 60])
        sales_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#fdf2f8')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ]))
        elements.append(sales_table)
        elements.append(Spacer(1, 20))

    # ===== 底部：生成信息与二维码 =====
    elements.append(Spacer(1, 20))
    elements.append(Paragraph("本报告由金生链溯源平台自动生成，数据来源于区块链存证与企业上报信息，仅供溯源参考。", small_style))

    forwarded_scheme = request.headers.get("X-Forwarded-Proto") or request.url.scheme
    forwarded_host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
    qr_result = generate_trace_qrcode(
        batch_code,
        batch_code,
        request_host=forwarded_host,
        request_scheme=forwarded_scheme,
        mode='public',
    )
    qr_data_uri = qr_result.get('qrcode', '')
    qr_b64 = qr_data_uri.split(',', 1)[1] if ',' in qr_data_uri else ''
    qr_buffer = io.BytesIO(base64.b64decode(qr_b64)) if qr_b64 else io.BytesIO()
    qr_buffer.seek(0)

    qr_image = Image(qr_buffer, width=80, height=80)
    qr_para = Paragraph("扫描二维码查询完整溯源信息", normal_style)
    qr_sub = Paragraph("金生链 · 花生全产业链溯源平台", small_style)
    qr_table = Table(
        [[qr_image, qr_para], ['', qr_sub]],
        colWidths=[100, 250]
    )
    elements.append(Spacer(1, 10))
    elements.append(qr_table)

    doc.build(elements)
    buffer.seek(0)

    filename = f"{batch_code}_质量追溯报告.pdf"
    from urllib.parse import quote
    encoded_filename = quote(filename)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type='application/pdf',
        headers={'Content-Disposition': f'attachment; filename="{encoded_filename}"; filename*=UTF-8\'\'{encoded_filename}'}
    )
