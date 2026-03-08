/**
 * PDF RENDERER
 * Node.js service -- deploy this to Railway.app
 * The Cloudflare Worker calls this to turn ebook content into a real PDF.
 *
 * Endpoints:
 *   GET  /health  -- health check, returns {"status":"ok"}
 *   POST /render  -- accepts JSON, returns PDF binary
 */

const http = require('http');

// Load jsPDF for Node.js
let jsPDF;
try {
  jsPDF = require('jspdf').jsPDF;
} catch(e) {
  console.error('jspdf not found. Run: npm install');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

  // Health check -- used by the Worker to wake this service
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // PDF render endpoint
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
// Takes the ebook content and produces a formatted PDF.
// =================================================================
function buildPDF({ title, subtitle, niche, price, wordCount, estPages, content }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth();   // 612pt
  const PH = doc.internal.pageSize.getHeight();  // 792pt
  const ML = 72, MR = 72, MB = 72;
  const CW = PW - ML - MR;                       // content width
  let pageNum = 1;

  // ── Helpers ──────────────────────────────────────────────────

  function newPage() {
    doc.addPage();
    pageNum++;
    doc.setFillColor(250, 248, 244);
    doc.rect(0, 0, PW, PH, 'F');
  }

  function drawHeader() {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 165, 145);
    // Truncate long titles so they don't overflow
    const shortTitle = title.length > 55 ? title.substring(0, 52) + '...' : title;
    doc.text(shortTitle.toUpperCase(), ML, 34, { charSpace: 0.5 });
    doc.text(String(pageNum), PW - MR, 34, { align: 'right' });
    doc.setDrawColor(220, 210, 195);
    doc.setLineWidth(0.5);
    doc.line(ML, 42, PW - MR, 42);
  }

  function checkOverflow(y, needed) {
    if (y + needed > PH - MB) {
      newPage();
      drawHeader();
      return 62;
    }
    return y;
  }

  // ── COVER PAGE ───────────────────────────────────────────────
  doc.setFillColor(12, 12, 20);
  doc.rect(0, 0, PW, PH, 'F');

  // Top gold accent bar
  doc.setFillColor(232, 184, 75);
  doc.rect(0, 0, PW, 5, 'F');

  // Decorative background circles
  doc.setFillColor(232, 184, 75);
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.circle(90, 240, 240, 'F');
  doc.setGState(new doc.GState({ opacity: 1 }));

  doc.setFillColor(45, 212, 191);
  doc.setGState(new doc.GState({ opacity: 0.05 }));
  doc.circle(PW - 70, PH - 90, 190, 'F');
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Niche label
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(45, 212, 191);
  doc.text(niche.toUpperCase(), ML, 62, { charSpace: 2 });

  // Title
  doc.setTextColor(250, 248, 244);
  doc.setFontSize(30);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(title, CW);
  const titleY = PH / 2 - (titleLines.length * 36) / 2;
  doc.text(titleLines, ML, titleY);

  // Gold divider line
  const afterTitle = titleY + titleLines.length * 36 + 10;
  doc.setDrawColor(232, 184, 75);
  doc.setLineWidth(1.5);
  doc.line(ML, afterTitle, ML + 110, afterTitle);

  // Subtitle
  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(185, 165, 115);
  const subLines = doc.splitTextToSize(subtitle, CW);
  doc.text(subLines, ML, afterTitle + 22);

  // Bottom label
  doc.setFontSize(8);
  doc.setTextColor(95, 88, 72);
  doc.text('PDF DIGITAL EDITION', ML, PH - 58, { charSpace: 1 });

  // Bottom rule
  doc.setDrawColor(35, 33, 52);
  doc.setLineWidth(0.5);
  doc.line(ML, PH - 70, PW - MR, PH - 70);

  // ── TABLE OF CONTENTS PAGE ───────────────────────────────────
  newPage();

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(12, 12, 20);
  doc.text('Table of Contents', ML, 82);

  doc.setDrawColor(232, 184, 75);
  doc.setLineWidth(2);
  doc.line(ML, 95, ML + 160, 95);

  // Pull chapter headings from content for TOC
  const tocHeadings = (content.match(/^# .+$/gm) || []);
  let tocY = 125;
  tocHeadings.forEach((heading, i) => {
    const label = heading.replace(/^# /, '');
    const isWorkbook = label.toLowerCase().includes('workbook');

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(isWorkbook ? 26 : 200, isWorkbook ? 190 : 65, isWorkbook ? 165 : 10);
    doc.text(String(i + 1).padStart(2, '0'), ML, tocY);

    doc.setFont('helvetica', isWorkbook ? 'italic' : 'normal');
    doc.setTextColor(20, 18, 32);
    // Truncate long TOC entries
    const tocLabel = label.length > 62 ? label.substring(0, 59) + '...' : label;
    doc.text(tocLabel, ML + 28, tocY);

    tocY += 26;
    if (tocY > PH - 80) {
      newPage();
      tocY = 60;
    }
  });

  // ── CONTENT PAGES ────────────────────────────────────────────
  newPage();
  drawHeader();
  let y = 62;

  const lines = content.split('\n');
  let inWorkbook = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Blank line
    if (!line) {
      y += 7;
      continue;
    }

    // H1 -- chapter heading, always starts a new page
    if (line.startsWith('# ') && !line.startsWith('## ') && !line.startsWith('### ')) {
      if (inWorkbook) inWorkbook = false;
      if (y > 110) {
        newPage();
        drawHeader();
        y = 62;
      }
      // Accent bar
      doc.setFillColor(232, 184, 75);
      doc.rect(ML, y, 3, 28, 'F');
      // Chapter title
      doc.setFontSize(19);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(12, 12, 20);
      const ht = doc.splitTextToSize(line.replace(/^# /, ''), CW - 12);
      doc.text(ht, ML + 10, y + 20);
      y += ht.length * 23 + 18;
      // Rule under heading
      doc.setDrawColor(230, 218, 202);
      doc.setLineWidth(0.5);
      doc.line(ML, y, PW - MR, y);
      y += 14;
      continue;
    }

    // H3 -- used for subtitle on title page (italic, smaller)
    if (line.startsWith('### ')) {
      y = checkOverflow(y, 22);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(145, 125, 95);
      doc.text(line.replace(/^### /, ''), ML, y + 11);
      y += 22;
      continue;
    }

    // H2 -- sub-sections, workbook headers
    if (line.startsWith('## ')) {
      const label = line.replace(/^## /, '');
      const isWB = label.toLowerCase().startsWith('workbook:');

      y = checkOverflow(y, 30);

      if (isWB) {
        inWorkbook = true;
        // Teal background strip for workbook sections
        doc.setFillColor(45, 212, 191);
        doc.setGState(new doc.GState({ opacity: 0.09 }));
        doc.rect(ML - 8, y - 4, CW + 16, 24, 'F');
        doc.setGState(new doc.GState({ opacity: 1 }));
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20, 155, 130);
      } else {
        inWorkbook = false;
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(200, 65, 10);
      }

      const ht = doc.splitTextToSize(label, CW);
      doc.text(ht, ML, y + 14);
      y += ht.length * 18 + 10;
      continue;
    }

    // Blockquote -- callout / key takeaway
    if (line.startsWith('> ')) {
      const qt = line.replace(/^> /, '').replace(/\*\*(.+?)\*\*/g, '$1');
      const qLines = doc.splitTextToSize(qt, CW - 24);
      y = checkOverflow(y, qLines.length * 14 + 22);

      // Gold background
      doc.setFillColor(232, 184, 75);
      doc.setGState(new doc.GState({ opacity: 0.08 }));
      doc.rect(ML, y - 3, CW, qLines.length * 14 + 22, 'F');
      doc.setGState(new doc.GState({ opacity: 1 }));
      // Gold left border
      doc.setFillColor(232, 184, 75);
      doc.rect(ML, y - 3, 3, qLines.length * 14 + 22, 'F');

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bolditalic');
      doc.setTextColor(155, 118, 20);
      doc.text(qLines, ML + 14, y + 11);
      y += qLines.length * 14 + 26;
      continue;
    }

    // Bullet list
    if (line.match(/^[*-] /)) {
      const bt = line.replace(/^[*-] /, '').replace(/\*\*(.+?)\*\*/g, '$1');
      const bLines = doc.splitTextToSize(bt, CW - 20);
      y = checkOverflow(y, bLines.length * 14 + 6);

      doc.setFillColor(232, 184, 75);
      doc.circle(ML + 5, y + 7, 2.2, 'F');
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(38, 35, 52);
      doc.text(bLines, ML + 16, y + 10);
      y += bLines.length * 14 + 6;
      continue;
    }

    // Fill-in exercise line
    if (line.includes('___')) {
      const ft = line.replace(/\*\*(.+?)\*\*/g, '$1');
      const fLines = doc.splitTextToSize(ft, CW - 10);
      y = checkOverflow(y, fLines.length * 14 + 10);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(85, 78, 105);
      doc.text(fLines, ML + 6, y + 11);
      y += fLines.length * 14 + 10;
      continue;
    }

    // Regular paragraph
    const clean = line.replace(/\*\*(.+?)\*\*/g, '$1');
    const pLines = doc.splitTextToSize(clean, CW);
    for (const pl of pLines) {
      y = checkOverflow(y, 16);
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(38, 35, 50);
      doc.text(pl, ML, y);
      y += 16;
    }
    y += 6; // paragraph spacing
  }

  // ── BACK COVER ───────────────────────────────────────────────
  newPage();
  doc.setFillColor(12, 12, 20);
  doc.rect(0, 0, PW, PH, 'F');

  // Bottom gold bar
  doc.setFillColor(232, 184, 75);
  doc.rect(0, PH - 5, PW, 5, 'F');

  // Decorative circle
  doc.setFillColor(45, 212, 191);
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.circle(PW - 90, 150, 210, 'F');
  doc.setGState(new doc.GState({ opacity: 1 }));

  doc.setTextColor(250, 248, 244);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('Thank you for reading.', ML, PH / 2 - 14);

  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(145, 132, 108);
  const backTitleLines = doc.splitTextToSize(title, CW);
  doc.text(backTitleLines, ML, PH / 2 + 10);

  doc.setFontSize(8.5);
  doc.setTextColor(75, 70, 58);
  doc.text('PDF Digital Edition   ' + estPages + ' pages', ML, PH - 36);

  return doc.output('arraybuffer');
}
