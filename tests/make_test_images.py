#!/usr/bin/env python3
"""生成 OCR 测试用单据图片（需要 Pillow，可用 Codex 自带 Python 运行）。"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
os.makedirs(OUT, exist_ok=True)

FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
]


def load_font(size):
    for f in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make_image(name, lines):
    w, h = 1000, 60 + 54 * len(lines)
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    font = load_font(38)
    y = 30
    for ln in lines:
        d.text((40, y), ln, fill="black", font=font)
        y += 54
    img.save(os.path.join(OUT, name))
    print("saved", name)


make_image(
    "unload.png",
    [
        "XX市计量站 卸车磅单",
        "车号：冀J0B318",
        "装车日期：2026-08-12",
        "毛重：41.22吨  皮重：10.00吨",
        "净重：31.22吨",
        "收货单位：宜章西东站",
    ],
)
make_image(
    "waybill.png",
    [
        "货物运输运单",
        "托运人：浙江禾兴",
        "车号：冀J0B318",
        "装车日期：2026-08-12",
        "起运地：正安  到达地：宜章西东站",
    ],
)
make_image(
    "load.png",
    [
        "装车磅单",
        "发货单位：正安气站",
        "车号：冀J0B318",
        "装车日期：2026-08-12",
        "净重：31.22吨",
    ],
)
