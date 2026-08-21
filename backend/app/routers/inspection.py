from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from datetime import datetime
import hashlib
import io
import qrcode
import os
import platform
import logging

from app.core.database import get_db
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
        file_hash=generate_hash(f"{data.report_code}{datetime.now()}"),
        blockchain_hash=generate_hash(f"{data.report_code}{data.report_type}{datetime.now()}"),
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
        logging.getLogger(__name__).warning(f"notify_inspection_report failed: {e}")

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
    db.commit()
    db.refresh(test)

    if is_over_limit:
        report.is_qualified = False
        db.commit()

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
    
    seed_batch = db.query(SeedBatch).filter(SeedBatch.batch_code == batch_code).first()
    if not seed_batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    
    supplier = db.query(SeedSupplier).filter(SeedSupplier.id == seed_batch.supplier_id).first()
    planting_records = db.query(PlantingRecord).filter(PlantingRecord.batch_id == seed_batch.id).all()
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    styles = getSampleStyleSheet()
    
    elements = []
    
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Heading1'],
        fontName=cjk_font_name,
        fontSize=18,
        alignment=1,
        spaceAfter=20,
        textColor=colors.darkblue,
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
    
    elements.append(Paragraph("金生链 · 花生全产业链溯源平台", title_style))
    elements.append(Paragraph("质量追溯报告", title_style))
    elements.append(Spacer(1, 20))
    
    elements.append(Paragraph("一、种子溯源信息", sub_title_style))
    seed_data = [
        ["批次编号", seed_batch.batch_code],
        ["品种名称", seed_batch.variety_name],
        ["繁育基地", seed_batch.breeding_base],
        ["供货企业", supplier.name if supplier else ""],
        ["生产日期", seed_batch.production_date.strftime("%Y-%m-%d") if seed_batch.production_date else ""],
        ["净含量", f"{seed_batch.net_weight} kg"],
        ["发芽率", f"{seed_batch.germination_rate}%"],
        ["纯度", f"{seed_batch.purity}%"],
        ["状态", seed_batch.status],
    ]
    
    seed_table = Table(seed_data, colWidths=[120, 300])
    seed_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgreen),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.gray),
    ]))
    elements.append(seed_table)
    elements.append(Spacer(1, 20))
    
    if planting_records:
        elements.append(Paragraph("二、种植信息", sub_title_style))
        
        for record in planting_records:
            plot = db.query(Plot).filter(Plot.id == record.plot_id).first()
            activities = db.query(FarmingActivity).filter(FarmingActivity.plot_id == record.plot_id).all()
            applications = db.query(PesticideApplication).filter(PesticideApplication.plot_id == record.plot_id).all()
            
            elements.append(Paragraph(f"地块：{plot.plot_code} - {plot.name}", normal_style))
            elements.append(Paragraph(f"位置：{plot.location}", normal_style))
            elements.append(Paragraph(f"种植日期：{record.planting_date.strftime('%Y-%m-%d') if record.planting_date else ''}", normal_style))
            elements.append(Paragraph(f"种植户：{record.farmer}", normal_style))
            
            if activities:
                elements.append(Paragraph("农事活动记录：", normal_style))
                for activity in activities:
                    elements.append(Paragraph(f"- {activity.activity_date.strftime('%Y-%m-%d') if activity.activity_date else ''}：{activity.activity_type} - {activity.description}", normal_style))
            
            if applications:
                elements.append(Paragraph("农药使用记录：", normal_style))
                for app in applications:
                    pesticide = db.query(Pesticide).filter(Pesticide.id == app.pesticide_id).first()
                    elements.append(Paragraph(f"- {app.application_date.strftime('%Y-%m-%d') if app.application_date else ''}：{pesticide.name if pesticide else ''} - 用量：{app.dosage} {app.unit}", normal_style))
            
            elements.append(Spacer(1, 15))
    
    processing_batches = db.query(ProcessingBatch).filter(ProcessingBatch.seed_batch_id == seed_batch.id).all()
    if processing_batches:
        elements.append(Paragraph("三、加工信息", sub_title_style))
        
        for pb in processing_batches:
            records = db.query(ProcessingRecord).filter(ProcessingRecord.batch_id == pb.id).all()
            
            elements.append(Paragraph(f"加工批次：{pb.batch_code}", normal_style))
            elements.append(Paragraph(f"产品名称：{pb.product_name}", normal_style))
            elements.append(Paragraph(f"产品等级：{pb.product_grade}", normal_style))
            elements.append(Paragraph(f"加工日期：{pb.processing_date.strftime('%Y-%m-%d') if pb.processing_date else ''}", normal_style))
            
            if records:
                elements.append(Paragraph("加工工序：", normal_style))
                for pr in records:
                    elements.append(Paragraph(f"- {pr.process_name} ({pr.process_order}序)", normal_style))
            
            elements.append(Spacer(1, 15))
    
    inspections = db.query(InspectionReport).filter(InspectionReport.batch_id == seed_batch.id).all()
    if inspections:
        elements.append(Paragraph("四、检测报告", sub_title_style))
        
        for insp in inspections:
            elements.append(Paragraph(f"报告编号：{insp.report_code}", normal_style))
            elements.append(Paragraph(f"检测类型：{insp.report_type}", normal_style))
            elements.append(Paragraph(f"检测机构：{insp.inspection_agency}", normal_style))
            elements.append(Paragraph(f"检测结果：{'合格' if insp.is_qualified else '不合格'}", normal_style))
            elements.append(Spacer(1, 10))
    
    processing_batch_codes = [pb.batch_code for pb in processing_batches]
    
    inventory_items = db.query(InventoryItem).filter(
        InventoryItem.batch_code.in_(processing_batch_codes) |
        (InventoryItem.seed_batch_code == seed_batch.batch_code)
    ).all()
    if inventory_items:
        elements.append(Paragraph("五、库存信息", sub_title_style))
        
        inv_data = [["商品编码", "商品名称", "数量", "单位", "状态"]]
        for item in inventory_items:
            inv_data.append([
                item.item_code,
                item.item_name,
                str(item.quantity),
                item.unit,
                item.status,
            ])
        
        inv_table = Table(inv_data, colWidths=[100, 120, 80, 60, 80])
        inv_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightblue),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 1, colors.gray),
        ]))
        elements.append(inv_table)
        elements.append(Spacer(1, 20))
    
    order_items = db.query(OrderItem).filter(
        OrderItem.batch_code.in_(processing_batch_codes) |
        (OrderItem.seed_batch_code == batch_code)
    ).all()
    if order_items:
        elements.append(Paragraph("六、销售信息", sub_title_style))
        
        sales_data = [["订单编号", "商品名称", "数量", "单位", "单价", "订单日期", "状态"]]
        for oi in order_items:
            order = db.query(Order).filter(Order.id == oi.order_id).first()
            sales_data.append([
                order.order_no if order else "",
                oi.item_name,
                str(oi.quantity),
                oi.unit,
                str(oi.unit_price),
                order.order_date.strftime("%Y-%m-%d") if order and order.order_date else "",
                order.status if order else "",
            ])
        
        sales_table = Table(sales_data, colWidths=[100, 100, 60, 60, 60, 100, 60])
        sales_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightpink),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), cjk_font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, colors.gray),
        ]))
        elements.append(sales_table)
        elements.append(Spacer(1, 20))
    
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(f"生成日期：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", normal_style))
    
    qr_content = f"https://peanut-chain.com/trace/{batch_code}"
    qr_img = qrcode.make(qr_content)
    qr_buffer = io.BytesIO()
    qr_img.save(qr_buffer, format='PNG')
    qr_buffer.seek(0)
    
    qr_image = Image(qr_buffer, width=80, height=80)
    qr_table = Table([[qr_image, Paragraph("扫码查询完整溯源信息", normal_style)]], colWidths=[100, 250])
    elements.append(qr_table)
    
    doc.build(elements)
    buffer.seek(0)
    
    return FileResponse(
        buffer,
        media_type='application/pdf',
        filename=f'{batch_code}_质量追溯报告.pdf',
    )
