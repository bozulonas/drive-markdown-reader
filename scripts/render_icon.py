"""Render the Drive Markdown Reader icon at Google's required PNG sizes."""
from pathlib import Path

from PIL import Image, ImageDraw

OUTPUT = Path(__file__).parent.parent / "assets"
SCALE = 4


def px(value):
    return round(value * SCALE)


image = Image.new("RGBA", (px(256), px(256)), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

teal = "#0f766e"
mint = "#99f6e4"
paper = "#ffffff"
fold = "#ccfbf1"

draw.rounded_rectangle((0, 0, px(256), px(256)), radius=px(56), fill=teal)
draw.polygon([(px(70), px(43)), (px(145), px(43)), (px(187), px(85)), (px(187), px(213)), (px(70), px(213))], fill=paper)
draw.polygon([(px(145), px(43)), (px(145), px(85)), (px(187), px(85))], fill=fold)
draw.line([(px(145), px(43)), (px(145), px(85)), (px(187), px(85))], fill=teal, width=px(11), joint="curve")

line = dict(fill=teal, width=px(12))
draw.line([(px(92), px(111)), (px(109), px(111)), (px(109), px(148))], **line)
draw.line([(px(90), px(129)), (px(128), px(129))], **line)
draw.line([(px(136), px(111)), (px(167), px(111))], **line)
draw.line([(px(136), px(129)), (px(160), px(129))], **line)
draw.line([(px(136), px(148)), (px(167), px(148))], **line)
draw.line([(px(91), px(181)), (px(165), px(181))], fill=mint, width=px(11))

for size in (256, 128, 64, 32, 16):
    output = image.resize((size, size), Image.Resampling.LANCZOS)
    output.save(OUTPUT / f"drive-markdown-reader-{size}.png", optimize=True)
