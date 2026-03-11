/**
 * PDF RENDERER
 * Design matches first-month-blueprint site:
 *   - Dark navy background: #0a1628 (hsl 216,78%,11%)
 *   - Orange accent: #ff6b1a (hsl 18,100%,56%)
 *   - Light text: #ddeeff (hsl 210,100%,93%)
 *   - Blueprint grid overlay
 *   - Sharp corners, monospace feel
 *   - Series branding: "The $1K First Month Blueprint"
 */

const http = require('http');

let jsPDF;
try {
  jsPDF = require('jspdf').jsPDF;
} catch(e) {
  console.error('jspdf not found. Run: npm install');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// ── Brand colors (RGB) ─────────────────────────────────────────
const NAVY       = [10,  22,  40];   // #0a1628 -- background
const NAVY_CARD  = [14,  28,  52];   // slightly lighter navy
const ORANGE     = [255, 107, 26];   // #ff6b1a -- primary accent
const ORANGE_DIM = [200,  80, 10];   // darker orange for text
const ICE        = [221, 238, 255];  // #ddeeff -- foreground text
const ICE_DIM    = [140, 165, 195];  // muted foreground
const ICE_FAINT  = [ 30,  50,  80];  // very subtle grid lines

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/render') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Rendering PDF for: ' + data.title);
        const pdfBytes = buildPDF(data);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBytes.byteLength,
        });
        res.end(Buffer.from(pdfBytes));
        console.log('PDF sent: ' + Math.round(pdfBytes.byteLength / 1024) + ' KB');
      } catch (err) {
        console.error('Render error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Render failed: ' + err.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('PDF Renderer listening on port ' + PORT);
});

// =================================================================
// PDF BUILDER
// =================================================================
function buildPDF({ title, subtitle, niche, wordCount, estPages, content }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 64, MR = 64, MB = 72;
  const CW = PW - ML - MR;
  let pageNum = 1;

  // ── Helpers ────────────────────────────────────────────────────

  function rgb(c) { return { r: c[0], g: c[1], b: c[2] }; }
  function fill(c) { doc.setFillColor(c[0], c[1], c[2]); }
  function stroke(c) { doc.setDrawColor(c[0], c[1], c[2]); }
  function textColor(c) { doc.setTextColor(c[0], c[1], c[2]); }

  function drawBlueprintGrid(x, y, w, h, opacity) {
    doc.setGState(new doc.GState({ opacity: opacity || 0.07 }));
    stroke(ICE);
    doc.setLineWidth(0.3);
    const step = 28;
    for (let gx = x; gx <= x + w; gx += step) {
      doc.line(gx, y, gx, y + h);
    }
    for (let gy = y; gy <= y + h; gy += step) {
      doc.line(x, gy, x + w, gy);
    }
    doc.setGState(new doc.GState({ opacity: 1 }));
  }

  function navyPage() {
    fill(NAVY);
    doc.rect(0, 0, PW, PH, 'F');
    drawBlueprintGrid(0, 0, PW, PH, 0.025);
  }

  function newPage() {
    doc.addPage();
    pageNum++;
    doc.setFillColor(248, 250, 253);
    doc.rect(0, 0, PW, PH, 'F');
  }

  function drawHeader() {
    // Orange top bar
    fill(ORANGE);
    doc.rect(0, 0, PW, 3, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    textColor(ICE_DIM);
    const shortTitle = title.length > 60 ? title.substring(0, 57) + '...' : title;
    doc.text(shortTitle.toUpperCase(), ML, 30, { charSpace: 0.4 });
    doc.text(String(pageNum), PW - MR, 30, { align: 'right' });
    stroke(ICE_DIM);
    doc.setLineWidth(0.3);
    doc.line(ML, 38, PW - MR, 38);
  }

  function checkOverflow(y, needed) {
    if (y + needed > PH - MB) {
      newPage();
      drawHeader();
      return 58;
    }
    return y;
  }

  // ── COVER PAGE ─────────────────────────────────────────────────
  navyPage();

  // Orange top bar
  fill(ORANGE);
  doc.rect(0, 0, PW, 6, 'F');

  // Left orange accent stripe
  fill(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.15 }));
  doc.rect(0, 0, 4, PH, 'F');
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Series label top left
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.text('THE $1K FIRST MONTH BLUEPRINT', ML, 40, { charSpace: 1.5 });

  // Niche tag
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  textColor(ICE_DIM);
  doc.text('[ ' + niche.toUpperCase() + ' ]', ML, 56, { charSpace: 1 });

  // Horizontal rule
  stroke(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.3 }));
  doc.setLineWidth(0.5);
  doc.line(ML, 66, PW - MR, 66);
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Large decorative $ sign background
  doc.setFontSize(320);
  doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.04 }));
  doc.text('$', PW - 60, PH / 2 + 160, { align: 'right' });
  doc.setGState(new doc.GState({ opacity: 1 }));

  // ── MAIN TITLE: site-style large bold display ──
  // Split "The $1K First Month Blueprint:" prefix from the specific subtitle
  const prefixMatch = title.match(/^(The \$1K First Month Blueprint:?)\s*(.*)$/i);
  const titlePrefix = prefixMatch ? prefixMatch[1] : title;
  const titleSpecific = prefixMatch ? prefixMatch[2] : '';

  const titleY = PH * 0.38;

  // "The" -- small regular weight
  doc.setFontSize(38);
  doc.setFont('helvetica', 'normal');
  textColor(ICE);
  doc.text('The', ML, titleY);

  // "$1K" -- large orange bold
  doc.setFontSize(62);
  doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  const theWidth = doc.getTextWidth('The ');
  doc.setFontSize(38);
  const theW = doc.getTextWidth('The ');
  doc.setFontSize(54);
  doc.text('$1K', ML + theW * 0.92, titleY);

  // "First Month Blueprint" -- large bold white, line 2
  doc.setFontSize(42);
  doc.setFont('helvetica', 'bold');
  textColor(ICE);
  doc.text('First Month Blueprint', ML, titleY + 50);

  // Specific subtitle part -- smaller, ice dim
  if (titleSpecific) {
    const specLines = doc.splitTextToSize(titleSpecific, CW);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    textColor(ICE_DIM);
    doc.text(specLines, ML, titleY + 80);
  }

  // Orange accent bar
  const afterTitle = titleY + 80 + (titleSpecific ? doc.splitTextToSize(titleSpecific, CW).length * 18 + 8 : 8);
  fill(ORANGE);
  doc.rect(ML, afterTitle, 60, 3, 'F');

  // Tagline subtitle
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  textColor(ICE_DIM);
  const subLines = doc.splitTextToSize(subtitle, CW);
  doc.text(subLines, ML, afterTitle + 18);

  // Bottom section
  stroke(ICE_DIM);
  doc.setGState(new doc.GState({ opacity: 0.2 }));
  doc.setLineWidth(0.5);
  doc.line(ML, PH - 80, PW - MR, PH - 80);
  doc.setGState(new doc.GState({ opacity: 1 }));

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  textColor(ICE_DIM);
  doc.text('PDF DIGITAL EDITION', ML, PH - 62, { charSpace: 1.5 });

  // Bottom orange bar
  fill(ORANGE);
  doc.rect(0, PH - 5, PW, 5, 'F');

  // ── TABLE OF CONTENTS ──────────────────────────────────────────
  newPage();
  drawHeader();

  // TOC header
  fill(NAVY);
  doc.rect(ML - 8, 48, CW + 16, 36, 'F');
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  textColor(ICE);
  doc.text('TABLE OF CONTENTS', ML, 72);
  fill(ORANGE);
  doc.rect(ML - 8, 84, CW + 16, 3, 'F');

  const tocHeadings = (content.match(/^# .+$/gm) || []);
  let tocY = 108;
  tocHeadings.forEach((heading, i) => {
    const label = heading.replace(/^# /, '');
    const isWorkbook = label.toLowerCase().includes('workbook');

    if (tocY > PH - 80) { newPage(); drawHeader(); tocY = 58; }

    // Number
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    textColor(isWorkbook ? ICE_DIM : ORANGE);
    doc.text(String(i + 1).padStart(2, '0'), ML, tocY);

    // Label
    doc.setFontSize(9.5);
    doc.setFont('helvetica', isWorkbook ? 'italic' : 'normal');
    textColor(isWorkbook ? ICE_DIM : [30, 40, 60]);
    const tocLabel = label.length > 65 ? label.substring(0, 62) + '...' : label;
    doc.text(tocLabel, ML + 24, tocY);

    // Dot leader line
    stroke(ICE_DIM);
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1, 3], 0);
    const labelWidth = doc.getTextWidth(tocLabel);
    doc.line(ML + 26 + labelWidth, tocY - 3, PW - MR - 2, tocY - 3);
    doc.setLineDashPattern([], 0);
    doc.setGState(new doc.GState({ opacity: 1 }));

    tocY += 24;
  });

  // ── CONTENT PAGES ──────────────────────────────────────────────
  newPage();
  drawHeader();
  let y = 58;

  const lines = content.split('\n');
  let inWorkbook = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) { y += 8; continue; }

    // H1 -- chapter heading -- ALWAYS starts a new page
    if (line.startsWith('# ') && !line.startsWith('## ') && !line.startsWith('### ')) {
      inWorkbook = false;
      // Always start chapter on a fresh page
      newPage();
      drawHeader();
      y = 58;

      // Navy banner sized to fit title
      const ht = doc.splitTextToSize(line.replace(/^# /, ''), CW - 16);
      const bannerH = ht.length * 22 + 24;
      fill(NAVY);
      doc.rect(ML - 8, y - 4, CW + 16, bannerH, 'F');
      fill(ORANGE);
      doc.rect(ML - 8, y - 4, 4, bannerH, 'F');

      doc.setFontSize(17);
      doc.setFont('helvetica', 'bold');
      textColor(ICE);
      doc.text(ht, ML + 4, y + 14);
      y += bannerH + 4;

      stroke(ORANGE);
      doc.setGState(new doc.GState({ opacity: 0.3 }));
      doc.setLineWidth(0.5);
      doc.line(ML, y, PW - MR, y);
      doc.setGState(new doc.GState({ opacity: 1 }));
      y += 14;
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      y = checkOverflow(y, 30);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      textColor(ICE_DIM);
      doc.text(line.replace(/^### /, ''), ML, y + 11);
      y += 22;
      continue;
    }

    // H2 -- sub-sections
    if (line.startsWith('## ')) {
      const label = line.replace(/^## /, '');
      const isWB = label.toLowerCase().startsWith('workbook:');

      if (isWB) {
        // Workbook always starts on its own page
        newPage();
        drawHeader();
        y = 58;
        inWorkbook = true;
        fill(ORANGE);
        doc.setGState(new doc.GState({ opacity: 0.12 }));
        doc.rect(ML - 8, y - 4, CW + 16, 28, 'F');
        doc.setGState(new doc.GState({ opacity: 1 }));
        fill(ORANGE);
        doc.rect(ML - 8, y - 4, 3, 28, 'F');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        textColor(ORANGE_DIM);
      } else {
        inWorkbook = false;
        // Ensure at least 80pt below heading for content -- otherwise new page
        y = checkOverflow(y, 80);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        textColor(NAVY);
      }

      const ht = doc.splitTextToSize(label, CW);
      doc.text(ht, ML, y + 16);
      y += ht.length * 18 + 12;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const qt = line.replace(/^> /, '').replace(/\*\*(.+?)\*\*/g, '$1');
      const qLines = doc.splitTextToSize(qt, CW - 24);
      y = checkOverflow(y, qLines.length * 14 + 24);

      fill(ORANGE);
      doc.setGState(new doc.GState({ opacity: 0.07 }));
      doc.rect(ML, y - 4, CW, qLines.length * 14 + 24, 'F');
      doc.setGState(new doc.GState({ opacity: 1 }));
      fill(ORANGE);
      doc.rect(ML, y - 4, 3, qLines.length * 14 + 24, 'F');

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bolditalic');
      textColor(ORANGE_DIM);
      doc.text(qLines, ML + 14, y + 11);
      y += qLines.length * 14 + 28;
      continue;
    }

    // Bullet list -- also catch lines that are clearly list items without markdown prefix
    const isBullet = line.match(/^[*\-] /) || (inWorkbook && line.match(/^[A-Z][a-z]/) && line.length < 80 && !line.includes('.') === false && line.split(' ').length <= 8);
    if (line.match(/^[*\-] /)) {
      const bt = line.replace(/^[*\-] /, '').replace(/\*\*(.+?)\*\*/g, '$1');
      const bLines = doc.splitTextToSize(bt, CW - 18);
      y = checkOverflow(y, bLines.length * 15 + 6);

      fill(ORANGE);
      doc.rect(ML + 2, y + 4, 4, 4, 'F');

      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      textColor([30, 40, 60]);
      doc.text(bLines, ML + 16, y + 10);
      y += bLines.length * 15 + 6;
      continue;
    }

    // Fill-in exercise line
    if (line.includes('___')) {
      const ft = line.replace(/\*\*(.+?)\*\*/g, '$1');
      const fLines = doc.splitTextToSize(ft, CW - 10);
      y = checkOverflow(y, fLines.length * 15 + 12);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      textColor(ICE_DIM);
      doc.text(fLines, ML + 6, y + 11);
      y += fLines.length * 15 + 12;
      continue;
    }

    // Regular paragraph
    const clean = line.replace(/\*\*(.+?)\*\*/g, '$1');
    const pLines = doc.splitTextToSize(clean, CW);
    for (const pl of pLines) {
      y = checkOverflow(y, 16);
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      textColor([30, 40, 60]);
      doc.text(pl, ML, y);
      y += 16;
    }
    y += 6;
  }

  // ── BACK COVER ─────────────────────────────────────────────────
  newPage();
  navyPage();

  fill(ORANGE);
  doc.rect(0, 0, PW, 6, 'F');
  doc.rect(0, PH - 5, PW, 5, 'F');

  // Decorative large $ sign
  doc.setFontSize(260);
  doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.05 }));
  doc.text('$1K', ML - 10, PH / 2 + 90);
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Back cover content -- vertically centered in top 2/3 of page
  const bcY = PH * 0.28;

  // Series label
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.text('THE $1K FIRST MONTH BLUEPRINT SERIES', ML, bcY, { charSpace: 1.2 });

  stroke(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.3 }));
  doc.setLineWidth(0.5);
  doc.line(ML, bcY + 12, PW - MR, bcY + 12);
  doc.setGState(new doc.GState({ opacity: 1 }));

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  textColor(ICE);
  const backTitleLines = doc.splitTextToSize(title, CW);
  doc.text(backTitleLines, ML, bcY + 30);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  textColor(ICE_DIM);
  const subBack = doc.splitTextToSize(subtitle, CW);
  doc.text(subBack, ML, bcY + 30 + backTitleLines.length * 20 + 14);

  // PDF Digital Edition label -- no page count
  doc.setFontSize(7.5);
  textColor(ICE_DIM);
  doc.text('PDF Digital Edition', ML, PH - 24, { charSpace: 0.5 });

  return doc.output('arraybuffer');
}
