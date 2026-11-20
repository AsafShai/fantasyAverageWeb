"""Word extraction from PDF pages with pdfium, matching pdfplumber's
``page.extract_words()`` (default settings) on the NBA injury report.

pdfplumber parses the PDF in pure Python (pdfminer), which costs ~0.3 CPU-s per
injury report; pdfium does the same in C in a fraction of that. This module
rebuilds the char boxes pdfminer would produce from pdfium's char data, then
groups them into words with pdfplumber's algorithm, so the parser downstream
sees the same words (text, x0, top) and produces the same records.

Char geometry, in pdfminer's coordinates (page rotation applied, y up):
- x0 is the char origin (pdfminer's box starts at the origin for upright text).
- the box spans [origin_y + descent*size, origin_y + descent*size + size],
  where descent is the font's /Descent / 1000; pdfplumber's ``top`` is
  page_height - that upper edge.
- x1 is only used to decide where words break; pdfium's loose box right edge
  is origin + advance, widened to the glyph's ink when the glyph overhangs.
"""

import ctypes
from dataclasses import dataclass

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

# pdfplumber's WordExtractor defaults.
X_TOLERANCE = 3
Y_TOLERANCE = 3
LIGATURES = {
    "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬁ": "fi", "ﬂ": "fl", "ﬆ": "st", "ﬅ": "st",
}

# pdfminer takes the metrics of fonts named like a standard-14 font from its
# built-in AFM table, ignoring the PDF's own descriptor; pdfium uses its own
# substitute font's metrics for these. Descents from pdfminer.fontmetrics
# (Symbol and ZapfDingbats have none there, so pdfminer uses 0).
_AFM_DESCENT = {
    **dict.fromkeys(["Courier", "Courier-Bold", "Courier-BoldOblique", "Courier-Oblique",
                     "CourierNew", "CourierNew,Italic", "CourierNew,Bold",
                     "CourierNew,BoldItalic"], -194.0),
    **dict.fromkeys(["Helvetica", "Helvetica-Bold", "Helvetica-BoldOblique",
                     "Helvetica-Oblique", "Arial", "Arial,Italic", "Arial,Bold",
                     "Arial,BoldItalic"], -207.0),
    **dict.fromkeys(["Times-Bold", "Times-BoldItalic", "Times-Italic", "Times-Roman",
                     "TimesNewRoman", "TimesNewRoman,Italic", "TimesNewRoman,Bold",
                     "TimesNewRoman,BoldItalic"], -217.0),
    "Symbol": 0.0,
    "ZapfDingbats": 0.0,
}

# pdfium reports a hyphen it takes for an end-of-line hyphenation as 0x02.
_PDFIUM_HYPHEN = "\x02"


@dataclass(slots=True)
class _Char:
    text: str
    x0: float
    x1: float
    top: float


def _font_descent(font, cache: dict) -> float:
    """The font's descent per 1000 units of font size, as pdfminer reads it."""
    key = ctypes.cast(font, ctypes.c_void_p).value
    descent = cache.get(key)
    if descent is None:
        buf = ctypes.create_string_buffer(256)
        pdfium_c.FPDFFont_GetBaseFontName(font, buf, len(buf))
        descent = _AFM_DESCENT.get(buf.value.decode("latin-1"))
        if descent is None:
            out = ctypes.c_float()
            pdfium_c.FPDFFont_GetDescent(font, ctypes.c_float(1000.0), out)
            descent = -abs(out.value)  # pdfminer forces /Descent negative
        cache[key] = descent
    return descent


def _page_chars(page: pdfium.PdfPage) -> list[_Char]:
    """The page's chars in content-stream order, pdfium's inserted spaces and
    line breaks left out, with pdfminer/pdfplumber geometry."""
    rotation = page.get_rotation()
    mx0, my0, mx1, my1 = page.get_mediabox()
    page_height = page.get_height()

    # pdfminer's page transform (PDFPageInterpreter.process_page): rotated
    # pages are laid out upright, with the mediabox origin at (0, 0).
    if rotation == 90:
        def to_page(x, y): return y - my0, mx1 - x
    elif rotation == 180:
        def to_page(x, y): return mx1 - x, my1 - y
    elif rotation == 270:
        def to_page(x, y): return my1 - y, x - mx0
    else:
        def to_page(x, y): return x - mx0, y - my0

    textpage = page.get_textpage()
    try:
        tp = textpage.raw
        ox, oy = ctypes.c_double(), ctypes.c_double()
        left, right = ctypes.c_float(), ctypes.c_float()
        bottom, top = ctypes.c_float(), ctypes.c_float()
        rect = pdfium_c.FS_RECTF()
        fonts: dict = {}
        chars: list[_Char] = []
        for i in range(pdfium_c.FPDFText_CountChars(tp)):
            if pdfium_c.FPDFText_IsGenerated(tp, i):
                continue
            text = chr(pdfium_c.FPDFText_GetUnicode(tp, i))
            if text == _PDFIUM_HYPHEN:
                text = "-"
            pdfium_c.FPDFText_GetCharOrigin(tp, i, ox, oy)
            pdfium_c.FPDFText_GetLooseCharBox(tp, i, rect)
            size = abs(pdfium_c.FPDFText_GetFontSize(tp, i))
            font = pdfium_c.FPDFTextObj_GetFont(pdfium_c.FPDFText_GetTextObject(tp, i))
            descent = _font_descent(font, fonts)

            x0, y = to_page(ox.value, oy.value)
            xa, _ = to_page(rect.left, rect.bottom)
            xb, _ = to_page(rect.right, rect.top)
            y1 = y + (descent * 0.001 * size + size)
            chars.append(_Char(text, x0, max(xa, xb), page_height - y1))
        return chars
    finally:
        textpage.close()


def _cluster_lines(chars: list[_Char]) -> list[list[_Char]]:
    """pdfplumber's cluster_objects(chars, top, Y_TOLERANCE): chain sorted
    distinct tops into lines, keep stream order within a line."""
    tops = sorted({c.top for c in chars})
    line_of: dict[float, int] = {}
    line = 0
    for i, t in enumerate(tops):
        if i and t > tops[i - 1] + Y_TOLERANCE:
            line += 1
        line_of[t] = line
    lines: list[list[_Char]] = [[] for _ in range(line + 1)] if tops else []
    for c in chars:
        lines[line_of[c.top]].append(c)
    return lines


def _make_word(chars: list[_Char]) -> dict:
    return {
        "text": "".join(LIGATURES.get(c.text, c.text) for c in chars),
        "x0": min(c.x0 for c in chars),
        "top": min(c.top for c in chars),
    }


def extract_words(page: pdfium.PdfPage) -> list[dict]:
    """Words of the page as pdfplumber's ``page.extract_words()`` returns them
    (only text, x0 and top), in the same order."""
    words: list[dict] = []
    for line in _cluster_lines(_page_chars(page)):
        line.sort(key=lambda c: c.x0)
        current: list[_Char] = []
        for c in line:
            if c.text.isspace():
                if current:
                    words.append(_make_word(current))
                current = []
                continue
            if current:
                prev = current[-1]
                if (c.x0 < prev.x0 or c.x0 > prev.x1 + X_TOLERANCE
                        or abs(c.top - prev.top) > Y_TOLERANCE):
                    words.append(_make_word(current))
                    current = []
            current.append(c)
        if current:
            words.append(_make_word(current))
    return words
