const pptxgen = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

const C = JSON.parse(fs.readFileSync(path.join(__dirname, "content.json"), "utf8"));

const SHOTS = path.join(__dirname, "..", "shots");
const OUT = path.join(__dirname, "..", "offseason-2026-whats-new.pptx");

const DARK = "14213D";
const DEEP = "22314F";
const AMBER = "FCA311";
const LIGHT = "FAFAF8";
const INK = "1B2430";
const MUTED = "5C6B7F";

const HEAD = "Bookman Old Style";
const BODY = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Asaf Shai";
pres.title = "Offseason Update 2026";

const shot = (n) => {
  const cropped = path.join(SHOTS, "crop", n);
  return fs.existsSync(cropped) ? cropped : path.join(SHOTS, n);
};
const sizeOf = (file) => {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const shadow = () => ({ type: "outer", color: "0B1220", blur: 14, offset: 4, angle: 90, opacity: 0.28 });

// two placements; each image gets whichever renders it larger
const LEFT = { w: 8.95, h: 5.44, x: 3.85, y: 1.85 };
const ABOVE = { w: 12.1, h: 4.15, x: 0.62, y: 3.15 }; // y/h recomputed per slide
function fit(box, ratio) {
  const w = Math.min(box.w, box.h * ratio);
  return { w, h: w / ratio };
}
function layout(file) {
  const b = fs.readFileSync(file);
  const ratio = b.readUInt32BE(16) / b.readUInt32BE(20);
  const a = fit(LEFT, ratio), c = fit(ABOVE, ratio);
  return a.w * a.h >= c.w * c.h ? { mode: "left", box: LEFT, ...a } : { mode: "above", box: ABOVE, ...c };
}

function contentSlide(feature, sub, step) {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addShape(pres.ShapeType.roundRect, {
    x: 0.6, y: 0.62, w: 0.16, h: 1.02, rectRadius: 0.08, fill: { color: AMBER },
  });
  s.addText(feature, {
    x: 0.95, y: 0.55, w: 9.5, h: 0.72, fontFace: HEAD, fontSize: 40, bold: true,
    color: INK, margin: 0, valign: "middle",
  });
  s.addText(sub, {
    x: 0.95, y: 1.24, w: 10.2, h: 0.46, fontFace: BODY, fontSize: 20, color: MUTED, margin: 0, valign: "middle",
  });
  if (step) {
    s.addShape(pres.ShapeType.roundRect, {
      x: 11.5, y: 0.72, w: 1.25, h: 0.5, rectRadius: 0.25,
      fill: { color: "FFF2D9" }, line: { color: AMBER, width: 1 },
    });
    s.addText(step, {
      x: 11.5, y: 0.72, w: 1.25, h: 0.5, fontFace: BODY, fontSize: 14, bold: true,
      color: "8A5A00", align: "center", valign: "middle", margin: 0,
    });
  }
  return s;
}

function splitSlide(d) {
  const s = contentSlide(d.feature, d.sub, d.step);
  const file = shot(d.image);
  const L = layout(file);

  if (L.mode === "left") {
    s.addText(
      d.bullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < d.bullets.length - 1 } })),
      {
        x: 0.62, y: 2.2, w: 3.0, h: 4.1, fontFace: BODY, fontSize: 16.5, color: INK,
        lineSpacing: 24, paraSpaceAfter: 16, margin: 0, valign: "top",
      }
    );
  } else {
    const n = d.bullets.length;
    const cols = n <= 3 ? n : 2;
    const per = Math.ceil(n / cols);
    const colW = (12.1 - 0.35 * (cols - 1)) / cols;
    for (let i = 0; i < cols; i++) {
      const col = d.bullets.slice(i * per, (i + 1) * per);
      if (!col.length) continue;
      s.addText(
        col.map((b, j) => ({ text: b, options: { bullet: true, breakLine: j < col.length - 1 } })),
        {
          x: 0.68 + i * (colW + 0.35), y: 1.85, w: colW, h: 1.2, fontFace: BODY, fontSize: 16,
          color: INK, lineSpacing: 21, paraSpaceAfter: 6, margin: 0, valign: "top",
        }
      );
    }
  }

  const top = L.mode === "left"
    ? L.box.y + (L.box.h - L.h) / 2
    : (d.bullets.length <= 3 ? 2.62 : 3.15);
  s.addImage({
    path: file,
    x: L.box.x + (L.box.w - L.w) / 2,
    y: top,
    w: L.w, h: L.h, shadow: shadow(),
  });
}

/* ---- title ---- */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.ShapeType.ellipse, { x: 10.4, y: -1.5, w: 5.6, h: 5.6, fill: { color: DEEP } });
  s.addShape(pres.ShapeType.ellipse, {
    x: 11.9, y: 4.6, w: 2.2, h: 2.2, fill: { type: "none" }, line: { color: AMBER, width: 2 },
  });
  s.addText(C.title.kicker, {
    x: 0.9, y: 2.0, w: 9, h: 0.45, fontFace: BODY, fontSize: 15, bold: true, color: AMBER, charSpacing: 3, margin: 0,
  });
  s.addText(`${C.title.line1}\n${C.title.line2}`, {
    x: 0.9, y: 2.5, w: 9.4, h: 2.2, fontFace: HEAD, fontSize: 50, bold: true,
    color: "FFFFFF", lineSpacing: 55, margin: 0,
  });
  s.addText(C.title.sub, {
    x: 0.9, y: 4.95, w: 8.8, h: 0.8, fontFace: BODY, fontSize: 18, color: "C9D4E4", margin: 0,
  });
  s.addNotes("Tour of everything added since last season. Screens show mid-season sample data.");
}

/* ---- agenda ---- */
{
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText(C.agenda.title, {
    x: 0.6, y: 0.7, w: 8, h: 0.9, fontFace: HEAD, fontSize: 40, bold: true, color: INK, margin: 0,
  });
  s.addText(C.agenda.sub, {
    x: 0.6, y: 1.6, w: 8, h: 0.45, fontFace: BODY, fontSize: 16, color: MUTED, margin: 0,
  });

  const cols = 5, cw = 2.32, ch = 1.6, x0 = 0.6, y0 = 2.55, gx = 0.16, gy = 0.24;
  C.agenda.items.forEach((it, i) => {
    const cx = x0 + (i % cols) * (cw + gx);
    const cy = y0 + Math.floor(i / cols) * (ch + gy);
    s.addShape(pres.ShapeType.roundRect, {
      x: cx, y: cy, w: cw, h: ch, rectRadius: 0.08,
      fill: { color: "FFFFFF" }, line: { color: "E4E7EC", width: 1 }, shadow: shadow(),
    });
    s.addShape(pres.ShapeType.ellipse, { x: cx + 0.2, y: cy + 0.22, w: 0.32, h: 0.32, fill: { color: AMBER } });
    s.addText(String(i + 1), {
      x: cx + 0.2, y: cy + 0.22, w: 0.32, h: 0.32, fontFace: BODY, fontSize: 11.5, bold: true,
      color: DARK, align: "center", valign: "middle", margin: 0,
    });
    s.addText(it[0], {
      x: cx + 0.2, y: cy + 0.66, w: cw - 0.36, h: 0.4, fontFace: BODY, fontSize: 13.5, bold: true,
      color: INK, margin: 0, valign: "middle",
    });
    s.addText(it[1], {
      x: cx + 0.2, y: cy + 1.06, w: cw - 0.36, h: 0.48, fontFace: BODY, fontSize: 11, color: MUTED, margin: 0,
    });
  });
}

/* ---- feature slides ---- */
C.slides.forEach(splitSlide);

/* ---- minigames ---- */
[C.minigames1, C.minigames2].forEach((m) => {
  const s = contentSlide(m.feature, m.sub, m.step);
  s.addImage({ path: shot(m.images[0]), x: 0.62, y: 2.05, w: 6.05, h: 3.78, shadow: shadow() });
  s.addImage({ path: shot(m.images[1]), x: 6.75, y: 2.05, w: 6.05, h: 3.78, shadow: shadow() });
  s.addText(m.labels[0], {
    x: 0.62, y: 5.95, w: 6.05, h: 0.4, fontFace: BODY, fontSize: 14.5, bold: true, color: INK, margin: 0,
  });
  s.addText(m.labels[1], {
    x: 6.75, y: 5.95, w: 6.05, h: 0.4, fontFace: BODY, fontSize: 14.5, bold: true, color: INK, margin: 0,
  });
  s.addText(m.footer, {
    x: 0.62, y: 6.42, w: 12.4, h: 0.45, fontFace: BODY, fontSize: 13, italic: true, color: MUTED, margin: 0,
  });
});

/* ---- mobile ---- */
{
  const m = C.mobile;
  const s = contentSlide(m.feature, m.sub, m.step);
  s.addText(
    m.bullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < m.bullets.length - 1 } })),
    { x: 0.62, y: 2.35, w: 4.5, h: 3.2, fontFace: BODY, fontSize: 17, color: INK, lineSpacing: 25, paraSpaceAfter: 16, margin: 0 }
  );
  s.addImage({ path: shot(m.images[0]), x: 6.05, y: 1.8, w: 2.55, h: 5.52, shadow: shadow() });
  s.addImage({ path: shot(m.images[1]), x: 9.05, y: 1.8, w: 2.55, h: 5.52, shadow: shadow() });
}

/* ---- closing ---- */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.ShapeType.ellipse, { x: -1.6, y: 3.4, w: 5.4, h: 5.4, fill: { color: DEEP } });
  s.addShape(pres.ShapeType.ellipse, {
    x: 11.4, y: 0.7, w: 1.7, h: 1.7, fill: { type: "none" }, line: { color: AMBER, width: 2 },
  });
  s.addText(C.closing.title, {
    x: 1.1, y: 2.2, w: 9, h: 1.2, fontFace: HEAD, fontSize: 48, bold: true, color: "FFFFFF", margin: 0,
  });
  s.addText(C.closing.url, {
    x: 1.1, y: 3.45, w: 9.5, h: 0.65, fontFace: BODY, fontSize: 24, bold: true, color: AMBER, margin: 0,
    hyperlink: { url: `https://${C.closing.url}`, tooltip: C.closing.url },
  });
  if (C.closing.sub) {
    s.addText(C.closing.sub, {
      x: 1.1, y: 4.2, w: 9.4, h: 0.55, fontFace: BODY, fontSize: 16, color: "C9D4E4", margin: 0,
    });
  }
  if (C.closing.note) {
    s.addText(C.closing.note, {
      x: 1.1, y: 5.6, w: 10.4, h: 0.8, fontFace: BODY, fontSize: 13, italic: true, color: "8FA3BF", margin: 0,
    });
  }
}

pres.writeFile({ fileName: OUT }).then(() => console.log("wrote " + OUT));
