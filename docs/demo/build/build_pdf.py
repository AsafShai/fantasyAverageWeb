"""PDF twin of the pptx deck — same content.json, same layout."""
import json
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
C = json.loads((HERE / "content.json").read_text(encoding="utf-8"))

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
OUT = ROOT / "offseason-2026-whats-new.pdf"

IN = 72.0
W, H = 13.333 * IN, 7.5 * IN

DARK = HexColor("#14213D")
DEEP = HexColor("#22314F")
AMBER = HexColor("#FCA311")
LIGHT = HexColor("#FAFAF8")
INK = HexColor("#1B2430")
MUTED = HexColor("#5C6B7F")
CARD_LINE = HexColor("#E4E7EC")
PALE = HexColor("#C9D4E4")
FAINT = HexColor("#8FA3BF")
WHITE = HexColor("#FFFFFF")

HEAD = "Times-Bold"
BODY = "Helvetica"
BODY_B = "Helvetica-Bold"
BODY_I = "Helvetica-Oblique"

c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle("Offseason Update 2026")
c.setAuthor("Asaf Shai")


def y(top):
    return H - top * IN


def text(s, x, top, size, font=BODY, color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x * IN, y(top) - size, s)


def wrap(s, font, size, width_in):
    words, lines, cur = s.split(), [], ""
    limit = width_in * IN
    for w in words:
        trial = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(trial, font, size) <= limit:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def paragraph(s, x, top, width_in, size, font=BODY, color=INK, leading=None):
    leading = leading or size * 1.32
    c.setFont(font, size)
    c.setFillColor(color)
    cy = y(top) - size
    for line in wrap(s, font, size, width_in):
        c.drawString(x * IN, cy, line)
        cy -= leading
    return (y(top) - cy) / IN


def bullets(items, x, top, width_in, size=13.0, gap=0.26):
    cur = top
    for it in items:
        c.setFillColor(AMBER)
        c.circle((x + 0.06) * IN, y(cur) - size * 0.62, 2.7, fill=1, stroke=0)
        used = paragraph(it, x + 0.26, cur, width_in - 0.26, size, BODY, INK, size * 1.4)
        cur += used + gap
    return cur


def src(name):
    cropped = SHOTS / "crop" / name
    return cropped if cropped.exists() else SHOTS / name


LEFT = (8.95, 5.44, 3.85, 1.85)
ABOVE = (12.1, 4.15, 0.62, 3.15)


def _fit(box, ratio):
    w = min(box[0], box[1] * ratio)
    return w, w / ratio


def layout(name):
    iw, ih = ImageReader(str(src(name))).getSize()
    ratio = iw / ih
    a, b = _fit(LEFT, ratio), _fit(ABOVE, ratio)
    return ("left", LEFT, a) if a[0] * a[1] >= b[0] * b[1] else ("above", ABOVE, b)


def image(name, x, top, w_in, h_in):
    img = ImageReader(str(src(name)))
    iw, ih = img.getSize()
    box_ratio, img_ratio = w_in / h_in, iw / ih
    if img_ratio > box_ratio:
        dw, dh = w_in, w_in / img_ratio
    else:
        dh, dw = h_in, h_in * img_ratio
    px, py = (x + (w_in - dw) / 2) * IN, y(top + h_in) + ((h_in - dh) / 2) * IN
    c.saveState()
    c.setFillColor(HexColor("#0B1220"))
    c.setFillAlpha(0.16)
    c.rect(px + 3, py - 4, dw * IN, dh * IN, fill=1, stroke=0)
    c.restoreState()
    c.drawImage(img, px, py, dw * IN, dh * IN, mask="auto")
    c.setStrokeColor(CARD_LINE)
    c.setLineWidth(0.6)
    c.rect(px, py, dw * IN, dh * IN, fill=0, stroke=1)


def page(color):
    c.setFillColor(color)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def header(feature, sub, step=None):
    page(LIGHT)
    c.setFillColor(AMBER)
    c.roundRect(0.6 * IN, y(1.64), 0.16 * IN, 1.02 * IN, 0.08 * IN, fill=1, stroke=0)
    paragraph(feature, 0.95, 0.6, 9.5, 31, HEAD, INK)
    paragraph(sub, 0.95, 1.28, 10.2, 15, BODY, MUTED)
    if step:
        c.setFillColor(HexColor("#FFF2D9"))
        c.setStrokeColor(AMBER)
        c.setLineWidth(0.9)
        c.roundRect(11.5 * IN, y(1.22), 1.25 * IN, 0.5 * IN, 0.25 * IN, fill=1, stroke=1)
        c.setFont(BODY_B, 11)
        c.setFillColor(HexColor("#8A5A00"))
        c.drawCentredString(12.125 * IN, y(1.22) + 0.19 * IN, step)


# ---------------- title ----------------
t = C["title"]
page(DARK)
c.setFillColor(DEEP)
c.circle(13.2 * IN, y(1.3), 2.8 * IN, fill=1, stroke=0)
c.setStrokeColor(AMBER)
c.setLineWidth(2.2)
c.circle(13.0 * IN, y(5.7), 1.1 * IN, fill=0, stroke=1)
text(t["kicker"], 0.9, 2.05, 11, BODY_B, AMBER)
paragraph(t["line1"], 0.9, 2.55, 10, 38, HEAD, WHITE)
paragraph(t["line2"], 0.9, 3.25, 10, 38, HEAD, WHITE)
paragraph(t["sub"], 0.9, 5.0, 8.8, 13.5, BODY, PALE)
c.showPage()

# ---------------- agenda ----------------
a = C["agenda"]
page(LIGHT)
paragraph(a["title"], 0.6, 0.72, 8, 30, HEAD, INK)
text(a["sub"], 0.6, 1.62, 12, BODY, MUTED)

cw, ch, x0, y0, gx, gy = 2.32, 1.6, 0.6, 2.55, 0.16, 0.24
for i, (head, sub) in enumerate(a["items"]):
    cx = x0 + (i % 5) * (cw + gx)
    cy = y0 + (i // 5) * (ch + gy)
    c.setFillColor(WHITE)
    c.setStrokeColor(CARD_LINE)
    c.setLineWidth(0.8)
    c.roundRect(cx * IN, y(cy + ch), cw * IN, ch * IN, 0.08 * IN, fill=1, stroke=1)
    c.setFillColor(AMBER)
    c.circle((cx + 0.36) * IN, y(cy + 0.38), 0.16 * IN, fill=1, stroke=0)
    c.setFont(BODY_B, 9)
    c.setFillColor(DARK)
    c.drawCentredString((cx + 0.36) * IN, y(cy + 0.38) - 3.2, str(i + 1))
    paragraph(head, cx + 0.2, cy + 0.7, cw - 0.36, 11.5, BODY_B, INK)
    paragraph(sub, cx + 0.2, cy + 1.12, cw - 0.36, 9, BODY, MUTED)
c.showPage()

# ---------------- feature slides ----------------
for d in C["slides"]:
    header(d["feature"], d["sub"], d.get("step"))
    mode, box, (dw, dh) = layout(d["image"])
    if mode == "left":
        bullets(d["bullets"], 0.62, 2.25, 3.0, 12.5)
    else:
        n = len(d["bullets"])
        cols = n if n <= 3 else 2
        per = -(-n // cols)
        col_w = (12.1 - 0.35 * (cols - 1)) / cols
        for i in range(cols):
            col = d["bullets"][i * per:(i + 1) * per]
            if col:
                bullets(col, 0.68 + i * (col_w + 0.35), 1.92, col_w, 12.5, gap=0.16)
    top = (box[3] + (box[1] - dh) / 2) if mode == "left" else (2.62 if len(d["bullets"]) <= 3 else 3.15)
    image(d["image"], box[2] + (box[0] - dw) / 2, top, dw, dh)
    c.showPage()

# ---------------- minigames ----------------
for m in (C["minigames1"], C["minigames2"]):
    header(m["feature"], m["sub"], m.get("step"))
    image(m["images"][0], 0.62, 2.05, 6.05, 3.78)
    image(m["images"][1], 6.75, 2.05, 6.05, 3.78)
    text(m["labels"][0], 0.62, 6.0, 11, BODY_B, INK)
    text(m["labels"][1], 6.75, 6.0, 11, BODY_B, INK)
    text(m["footer"], 0.62, 6.47, 10, BODY_I, MUTED)
    c.showPage()

# ---------------- mobile ----------------
m = C["mobile"]
header(m["feature"], m["sub"])
bullets(m["bullets"], 0.62, 2.4, 4.5, 13.0)
image(m["images"][0], 6.05, 1.8, 2.55, 5.52)
image(m["images"][1], 9.05, 1.8, 2.55, 5.52)
c.showPage()

# ---------------- closing ----------------
cl = C["closing"]
page(DARK)
c.setFillColor(DEEP)
c.circle(0.6 * IN, y(6.1), 2.7 * IN, fill=1, stroke=0)
c.setStrokeColor(AMBER)
c.setLineWidth(2.2)
c.circle(12.25 * IN, y(1.55), 0.85 * IN, fill=0, stroke=1)
paragraph(cl["title"], 1.1, 2.25, 9, 36, HEAD, WHITE)
text(cl["url"], 1.1, 3.5, 19, BODY_B, AMBER)
link_w = pdfmetrics.stringWidth(cl["url"], BODY_B, 19)
c.linkURL("https://" + cl["url"], (1.1 * IN, y(3.5) - 24, 1.1 * IN + link_w, y(3.5) - 2), relative=0)
if cl.get("sub"):
    paragraph(cl["sub"], 1.1, 4.25, 9.4, 12, BODY, PALE)
if cl.get("note"):
    paragraph(cl["note"], 1.1, 5.65, 10.4, 10, BODY_I, FAINT)
c.showPage()

c.save()
print("wrote", OUT)
