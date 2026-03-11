/**
 * PDF RENDERER — jsPDF edition (fixed layout)
 * Brand: Navy #0a1628 | Orange #ff6b1a | Ice #ddeeff
 */

const http = require('http');

let jsPDF;
try { jsPDF = require('jspdf').jsPDF; }
catch(e) { console.error('jspdf not found. Run: npm install'); process.exit(1); }

const PORT = process.env.PORT || 3000;

const NAVY       = [10,  22,  40];
const ORANGE     = [255, 107, 26];
const ORANGE_DIM = [200,  80, 10];
const ICE        = [221, 238, 255];
const ICE_DIM    = [140, 165, 195];

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }
  if (req.method === 'POST' && req.url === '/render') {
    let body = '';
    req.on('data', c => { body += c.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Rendering PDF for: ' + data.title);
        const pdfBytes = buildPDF(data);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfBytes.byteLength });
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
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log('Renderer listening on port ' + PORT));

function buildPDF(data) {
  const { title, subtitle, niche, content, wordCount } = data;
  const estPages = data.estPages || Math.ceil((wordCount || 5000) / 220);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const PW = 612, PH = 792, ML = 64, MR = 64, CW = PW - ML - MR;

  const fill   = c => doc.setFillColor(...c);
  const stroke = c => doc.setDrawColor(...c);
  const textColor = c => doc.setTextColor(...c);
  const navyPage = () => { fill(NAVY); doc.rect(0, 0, PW, PH, 'F'); };

  // Page overflow guard — returns new y if needed
  const BOTTOM = PH - 60;
  function checkOverflow(y, needed) {
    if (y + needed > BOTTOM) { newPage(); drawHeader(); return 58; }
    return y;
  }

  let pageNum = 0;
  function newPage() {
    if (pageNum > 0) doc.addPage();
    pageNum++;
    // Light background for content pages
    fill([245, 247, 250]);
    doc.rect(0, 0, PW, PH, 'F');
    fill([255, 255, 255]);
    doc.rect(ML - 16, 0, CW + 32, PH, 'F');
  }

  function drawHeader() {
    // Orange top rule
    fill(ORANGE);
    doc.rect(0, 0, PW, 3, 'F');
    // Header text
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    textColor(ICE_DIM);
    const shortTitle = title.length > 65 ? title.substring(0, 62) + '...' : title;
    doc.text(shortTitle.toUpperCase(), ML, 18, { charSpace: 0.4 });
    doc.text(String(pageNum), PW - MR, 18, { align: 'right' });
    // Thin rule under header
    stroke(ICE_DIM);
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.setLineWidth(0.3);
    doc.line(ML, 24, PW - MR, 24);
    doc.setGState(new doc.GState({ opacity: 1 }));
  }

  // ── COVER ──────────────────────────────────────────────────────
  navyPage();
  pageNum = 1;

  // Grid overlay
  stroke([140, 165, 195]);
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setLineWidth(0.3);
  for (let x = 0; x <= PW; x += 28) { doc.line(x, 0, x, PH); }
  for (let y = 0; y <= PH; y += 28) { doc.line(0, y, PW, y); }
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Top + bottom orange bars
  fill(ORANGE); doc.rect(0, 0, PW, 6, 'F');
  fill(ORANGE); doc.rect(0, PH - 5, PW, 5, 'F');
  fill(ORANGE); doc.rect(0, 0, 4, PH, 'F');

  // Series label
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.text('THE $1K FIRST MONTH BLUEPRINT SERIES', ML, 40, { charSpace: 1.2 });
  stroke(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.3 }));
  doc.setLineWidth(0.5);
  doc.line(ML, 48, PW - MR, 48);
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Watermark $
  doc.setFontSize(320); doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.04 }));
  doc.text('$', PW - 40, PH / 2 + 160, { align: 'right' });
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Title block — split "The $1K First Month Blueprint:" from specific part
  const prefixMatch = title.match(/^(The \$1K First Month Blueprint:?)\s*(.*)$/i);
  const specificTitle = prefixMatch ? prefixMatch[2].trim() : title;
  const titleY = PH * 0.38;

  // "The" small
  doc.setFontSize(32); doc.setFont('helvetica', 'normal');
  textColor(ICE);
  doc.text('The', ML, titleY);

  // "$1K" orange large
  doc.setFontSize(54); doc.setFont('helvetica', 'bold');
  textColor(ORANGE);
  doc.setFontSize(32);
  const theW = doc.getTextWidth('The ');
  doc.setFontSize(54);
  doc.text('$1K', ML + theW, titleY);

  // "First Month Blueprint" bold white
  doc.setFontSize(38); doc.setFont('helvetica', 'bold');
  textColor(ICE);
  doc.text('First Month Blueprint', ML, titleY + 46);

  // Specific topic line
  if (specificTitle) {
    doc.setFontSize(14); doc.setFont('helvetica', 'normal');
    textColor(ICE_DIM);
    const specLines = doc.splitTextToSize(specificTitle, CW);
    doc.text(specLines, ML, titleY + 78);
  }

  // Orange accent bar
  const accentY = titleY + 78 + (specificTitle ? doc.splitTextToSize(specificTitle, CW).length * 18 + 8 : 8);
  fill(ORANGE); doc.rect(ML, accentY, 60, 3, 'F');

  // Subtitle
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  textColor(ICE_DIM);
  const subLines = doc.splitTextToSize(subtitle, CW);
  doc.text(subLines, ML, accentY + 18);

  // Footer
  stroke(ICE_DIM);
  doc.setGState(new doc.GState({ opacity: 0.2 }));
  doc.line(ML, PH - 80, PW - MR, PH - 80);
  doc.setGState(new doc.GState({ opacity: 1 }));
  doc.setFontSize(7.5); textColor(ICE_DIM);
  doc.text('PDF DIGITAL EDITION', ML, PH - 62, { charSpace: 1.5 });

  // ── TABLE OF CONTENTS ──────────────────────────────────────────
  newPage(); drawHeader();

  fill(NAVY); doc.rect(ML - 8, 40, CW + 16, 36, 'F');
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); textColor(ICE);
  doc.text('TABLE OF CONTENTS', ML, 64);
  fill(ORANGE); doc.rect(ML - 8, 76, CW + 16, 3, 'F');

  const tocHeadings = (content.match(/^# .+$/gm) || []);
  let tocY = 100;
  tocHeadings.forEach((heading, i) => {
    if (tocY > BOTTOM) { newPage(); drawHeader(); tocY = 58; }
    const label = heading.replace(/^# /, '');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); textColor(ORANGE);
    doc.text(String(i + 1).padStart(2, '0'), ML, tocY);
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); textColor([30, 40, 60]);
    const tocLabel = label.length > 65 ? label.substring(0, 62) + '...' : label;
    doc.text(tocLabel, ML + 24, tocY);
    stroke(ICE_DIM);
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.setLineWidth(0.3); doc.setLineDashPattern([1, 3], 0);
    const lw = doc.getTextWidth(tocLabel);
    doc.line(ML + 26 + lw, tocY - 3, PW - MR - 2, tocY - 3);
    doc.setLineDashPattern([], 0);
    doc.setGState(new doc.GState({ opacity: 1 }));
    tocY += 24;
  });

  // ── CONTENT ────────────────────────────────────────────────────
  newPage(); drawHeader();
  let y = 58;
  let inWorkbook = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) { y += 8; continue; }

    // H1 — always new page, font set BEFORE splitTextToSize
    if (line.startsWith('# ') && !line.startsWith('## ') && !line.startsWith('### ')) {
      inWorkbook = false;
      newPage(); drawHeader(); y = 58;

      doc.setFontSize(14); doc.setFont('helvetica', 'bold');
      const chTitle = line.replace(/^# /, '');
      const ht = doc.splitTextToSize(chTitle, CW - 20);
      const bannerH = ht.length * 20 + 22;
      fill(NAVY); doc.rect(ML - 8, y - 4, CW + 16, bannerH, 'F');
      fill(ORANGE); doc.rect(ML - 8, y - 4, 4, bannerH, 'F');
      textColor(ICE);
      doc.text(ht, ML + 8, y + 13);
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
      doc.setFontSize(10); doc.setFont('helvetica', 'italic'); textColor(ICE_DIM);
      doc.text(line.replace(/^### /, ''), ML, y + 11);
      y += 22; continue;
    }

    // H2
    if (line.startsWith('## ')) {
      const label = line.replace(/^## /, '');
      const isWB = label.toLowerCase().startsWith('workbook:');
      if (isWB) {
        // Workbook always on its own page
        newPage(); drawHeader(); y = 58;
        inWorkbook = true;
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        const wbHt = doc.splitTextToSize(label, CW - 10);
        const wbH = wbHt.length * 18 + 20;
        fill(ORANGE);
        doc.setGState(new doc.GState({ opacity: 0.1 }));
        doc.rect(ML - 8, y - 4, CW + 16, wbH, 'F');
        doc.setGState(new doc.GState({ opacity: 1 }));
        fill(ORANGE); doc.rect(ML - 8, y - 4, 3, wbH, 'F');
        textColor(ORANGE_DIM);
        doc.text(wbHt, ML + 6, y + 13);
        y += wbH + 6;
      } else {
        inWorkbook = false;
        // Require 80pt below heading — otherwise new page
        y = checkOverflow(y, 80);
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); textColor(NAVY);
        const ht = doc.splitTextToSize(label, CW);
        doc.text(ht, ML, y + 16);
        y += ht.length * 18 + 12;
      }
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const qt = line.replace(/^> /, '').replace(/\*\*(.+?)\*\*/g, '$1');
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      const qLines = doc.splitTextToSize(qt, CW - 24);
      y = checkOverflow(y, qLines.length * 14 + 24);
      fill(ORANGE);
      doc.setGState(new doc.GState({ opacity: 0.07 }));
      doc.rect(ML, y - 4, CW, qLines.length * 14 + 24, 'F');
      doc.setGState(new doc.GState({ opacity: 1 }));
      fill(ORANGE); doc.rect(ML, y - 4, 3, qLines.length * 14 + 24, 'F');
      doc.setFont('helvetica', 'bolditalic'); textColor(ORANGE_DIM);
      doc.text(qLines, ML + 14, y + 11);
      y += qLines.length * 14 + 28; continue;
    }

    // Bullet
    if (line.match(/^[*\-] /)) {
      const bt = line.replace(/^[*\-] /, '').replace(/\*\*(.+?)\*\*/g, '$1');
      doc.setFontSize(10.5); doc.setFont('helvetica', 'normal');
      const bLines = doc.splitTextToSize(bt, CW - 18);
      y = checkOverflow(y, bLines.length * 15 + 6);
      fill(ORANGE); doc.rect(ML + 2, y + 4, 5, 5, 'F');
      textColor([30, 40, 60]);
      doc.text(bLines, ML + 16, y + 11);
      y += bLines.length * 15 + 6; continue;
    }

    // Exercise / fill-in line
    if (line.includes('___')) {
      const ft = line.replace(/\*\*(.+?)\*\*/g, '$1');
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      const fLines = doc.splitTextToSize(ft, CW - 10);
      y = checkOverflow(y, fLines.length * 15 + 12);
      doc.setFont('helvetica', 'italic'); textColor(ICE_DIM);
      doc.text(fLines, ML + 6, y + 11);
      y += fLines.length * 15 + 12; continue;
    }

    // Regular paragraph
    const clean = line.replace(/\*\*(.+?)\*\*/g, '$1');
    doc.setFontSize(10.5); doc.setFont('helvetica', 'normal');
    const pLines = doc.splitTextToSize(clean, CW);
    for (const pl of pLines) {
      y = checkOverflow(y, 16);
      textColor([30, 40, 60]);
      doc.text(pl, ML, y);
      y += 16;
    }
    y += 6;
  }

  // ── BACK COVER ─────────────────────────────────────────────────
  newPage(); navyPage();

  // Grid
  stroke([140, 165, 195]);
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setLineWidth(0.3);
  for (let x = 0; x <= PW; x += 28) { doc.line(x, 0, x, PH); }
  for (let y2 = 0; y2 <= PH; y2 += 28) { doc.line(0, y2, PW, y2); }
  doc.setGState(new doc.GState({ opacity: 1 }));

  fill(ORANGE); doc.rect(0, 0, PW, 6, 'F');
  fill(ORANGE); doc.rect(0, PH - 5, PW, 5, 'F');

  // Watermark
  doc.setFontSize(200); doc.setFont('helvetica', 'bold'); textColor(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.05 }));
  doc.text('$1K', ML - 10, PH / 2 + 70);
  doc.setGState(new doc.GState({ opacity: 1 }));

  const bcY = PH * 0.28;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); textColor(ORANGE);
  doc.text('THE $1K FIRST MONTH BLUEPRINT SERIES', ML, bcY, { charSpace: 1.2 });
  stroke(ORANGE);
  doc.setGState(new doc.GState({ opacity: 0.3 }));
  doc.setLineWidth(0.5);
  doc.line(ML, bcY + 12, PW - MR, bcY + 12);
  doc.setGState(new doc.GState({ opacity: 1 }));

  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); textColor(ICE);
  const backTitleLines = doc.splitTextToSize(title, CW);
  doc.text(backTitleLines, ML, bcY + 30);

  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); textColor(ICE_DIM);
  const subBack = doc.splitTextToSize(subtitle, CW);
  doc.text(subBack, ML, bcY + 30 + backTitleLines.length * 20 + 14);

  doc.setFontSize(7.5); textColor(ICE_DIM);
  doc.text('PDF Digital Edition', ML, PH - 24, { charSpace: 0.5 });

  return doc.output('arraybuffer');
}
