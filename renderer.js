/**
 * PDF RENDERER — Puppeteer/HTML edition
 */

const http = require('http');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.error('puppeteer not found. Run: npm install');
  process.exit(1);
}

let marked;
try {
  marked = require('marked').marked;
} catch (e) {
  console.error('marked not found. Run: npm install');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.substring(0, n - 3) + '...' : str;
}

function buildTOC(content) {
  const headings = (content || '').match(/^# .+$/gm) || [];
  return headings.map((h, i) => {
    const label = h.replace(/^# /, '');
    return `<li class="toc-item">
      <span class="toc-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="toc-label">${escHtml(label)}</span>
    </li>`;
  }).join('\n');
}

function processContent(html) {
  html = html.replace(/<\/h1>/g, '</h1><div class="chapter-rule"></div>');
  html = html.replace(/<h2>(Workbook:.*?)<\/h2>/gi, '<h2 class="workbook">$1</h2>');
  html = html.replace(/<p>(<em>.*?___.*?<\/em>)<\/p>/g, '<div class="exercise">$1</div>');
  return html;
}

function buildHTML(data) {
  const { title, subtitle, niche, content } = data;

  const prefixMatch = title.match(/^(The \$1K First Month Blueprint:?)\s*(.*)$/i);
  const specificTitle = prefixMatch ? prefixMatch[2] : title;

  const bodyHTML = marked(content || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @page { size: letter; margin: 0; }

  body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: #1e2840;
    background: white;
  }

  /* ── COVER ── */
  .cover {
    width: 8.5in;
    height: 11in;
    background: #0a1628;
    display: flex;
    flex-direction: column;
    position: relative;
    page-break-after: always;
    overflow: hidden;
  }
  .cover-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(140,165,195,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(140,165,195,0.06) 1px, transparent 1px);
    background-size: 28px 28px;
  }
  .cover-top-bar { position: absolute; top: 0; left: 0; right: 0; height: 6px; background: #ff6b1a; }
  .cover-bottom-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 5px; background: #ff6b1a; }
  .cover-left-bar { position: absolute; top: 0; left: 0; bottom: 0; width: 4px; background: #ff6b1a; }
  .cover-watermark {
    position: absolute; bottom: -40px; right: -20px;
    font-size: 320pt; font-weight: 900; color: #ff6b1a; opacity: 0.04; line-height: 1;
  }
  .cover-content {
    position: relative; z-index: 2;
    padding: 56px 64px 48px;
    display: flex; flex-direction: column; height: 100%;
  }
  .cover-series-label {
    font-size: 7.5pt; font-weight: 700; color: #ff6b1a;
    letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 8px;
  }
  .cover-series-rule { width: 100%; height: 1px; background: rgba(255,107,26,0.3); }
  .cover-title-block { margin-top: auto; margin-bottom: auto; padding-top: 20px; }
  .cover-the { font-size: 36pt; font-weight: 400; color: #ddeeff; line-height: 1.1; display: block; }
  .cover-brand { font-size: 52pt; font-weight: 900; line-height: 1.0; display: block; margin-bottom: 6px; }
  .cover-brand .dollar { color: #ff6b1a; }
  .cover-brand .rest { color: #ddeeff; }
  .cover-specific { font-size: 15pt; font-weight: 400; color: #8ca5c3; line-height: 1.4; margin-top: 8px; }
  .cover-accent-bar { width: 60px; height: 3px; background: #ff6b1a; margin: 20px 0 16px; }
  .cover-subtitle { font-size: 11pt; color: #8ca5c3; line-height: 1.5; max-width: 5.5in; }
  .cover-footer { border-top: 1px solid rgba(140,165,195,0.15); padding-top: 14px; margin-top: auto; }
  .cover-footer-label { font-size: 7.5pt; color: #8ca5c3; letter-spacing: 0.12em; text-transform: uppercase; }
  .cover-niche { font-size: 7pt; color: rgba(140,165,195,0.6); letter-spacing: 0.1em; margin-top: 4px; text-transform: uppercase; }

  /* ── PAGE HEADER ── */
  .content-header {
    border-top: 3px solid #ff6b1a;
    padding: 7px 64px 6px;
    display: flex; justify-content: space-between; align-items: center;
    background: white;
  }
  .content-header-title { font-size: 7pt; color: #8ca5c3; letter-spacing: 0.08em; text-transform: uppercase; }

  /* ── TOC ── */
  .toc-page { page-break-after: always; }
  .toc-header-block { background: #0a1628; margin: 0 64px; padding: 16px 16px 14px; }
  .toc-title { font-size: 13pt; font-weight: 700; color: #ddeeff; letter-spacing: 0.05em; }
  .toc-rule { height: 3px; background: #ff6b1a; margin: 0 64px 20px; }
  .toc-list { padding: 0 64px; list-style: none; }
  .toc-item {
    display: flex; align-items: baseline;
    padding: 9px 0; border-bottom: 1px solid rgba(140,165,195,0.12); gap: 12px;
  }
  .toc-num { font-size: 8pt; font-weight: 700; color: #ff6b1a; min-width: 24px; flex-shrink: 0; }
  .toc-label { font-size: 9.5pt; color: #1e2840; flex: 1; line-height: 1.4; }

  /* ── CHAPTER HEADING ── */
  h1 {
    background: #0a1628; color: #ddeeff;
    font-size: 13pt; font-weight: 700;
    padding: 14px 20px 14px 20px;
    margin: 0; border-left: 4px solid #ff6b1a;
    line-height: 1.35;
    page-break-before: always;
    page-break-after: avoid;
  }
  .chapter-rule { height: 1px; background: rgba(255,107,26,0.25); margin-bottom: 18px; }

  /* ── BODY CONTENT ── */
  .content-body { padding: 0 64px 48px; }

  h2 {
    font-size: 12pt; font-weight: 700; color: #0a1628;
    margin: 22px 0 10px;
    page-break-after: avoid;
  }
  h2.workbook {
    background: rgba(255,107,26,0.07);
    border-left: 3px solid #ff6b1a;
    color: #c8500a; font-size: 11pt;
    padding: 10px 14px; margin: 0 0 12px;
    page-break-before: always;
    page-break-after: avoid;
  }
  h3 { font-size: 10.5pt; font-style: italic; color: #8ca5c3; margin: 16px 0 8px; page-break-after: avoid; }

  p { margin: 0 0 12px; color: #1e2840; line-height: 1.65; }

  ul { list-style: none; margin: 0 0 14px; padding: 0; }
  ul li { padding: 4px 0 4px 22px; position: relative; color: #1e2840; line-height: 1.55; }
  ul li::before {
    content: ''; position: absolute; left: 3px; top: 10px;
    width: 7px; height: 7px; background: #ff6b1a;
  }
  ol { margin: 0 0 14px; padding-left: 24px; color: #1e2840; }
  ol li { padding: 3px 0; line-height: 1.55; }

  blockquote {
    background: rgba(255,107,26,0.06);
    border-left: 3px solid #ff6b1a;
    padding: 10px 16px; margin: 0 0 14px;
    color: #c8500a; font-style: italic; font-size: 10pt;
    page-break-inside: avoid;
  }

  .exercise {
    background: rgba(140,165,195,0.08);
    border-left: 3px solid #8ca5c3;
    padding: 10px 14px; margin: 0 0 10px;
    color: #4a5a7a; font-style: italic; font-size: 10pt;
  }

  strong { font-weight: 700; }
  em { font-style: italic; }

  /* ── BACK COVER ── */
  .back-cover {
    width: 8.5in; height: 11in;
    background: #0a1628;
    position: relative; overflow: hidden;
    page-break-before: always;
  }
  .back-cover-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(140,165,195,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(140,165,195,0.06) 1px, transparent 1px);
    background-size: 28px 28px;
  }
  .back-cover-watermark {
    position: absolute; bottom: -60px; right: -30px;
    font-size: 260pt; font-weight: 900; color: #ff6b1a; opacity: 0.04; line-height: 1;
  }
  .back-cover-content { position: relative; z-index: 2; padding: 0 64px; margin-top: 38%; }
  .back-cover-series { font-size: 8pt; font-weight: 700; color: #ff6b1a; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 12px; }
  .back-cover-rule { height: 1px; background: rgba(255,107,26,0.3); margin-bottom: 20px; }
  .back-cover-title { font-size: 15pt; font-weight: 700; color: #ddeeff; line-height: 1.4; margin-bottom: 16px; }
  .back-cover-subtitle { font-size: 10pt; color: #8ca5c3; line-height: 1.6; max-width: 5.2in; }
  .back-cover-footer {
    position: absolute; bottom: 24px; left: 64px; right: 64px;
    border-top: 1px solid rgba(140,165,195,0.15);
    padding-top: 12px; font-size: 7.5pt; color: #8ca5c3; letter-spacing: 0.1em;
  }
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-grid"></div>
  <div class="cover-top-bar"></div>
  <div class="cover-bottom-bar"></div>
  <div class="cover-left-bar"></div>
  <div class="cover-watermark">$</div>
  <div class="cover-content">
    <div>
      <div class="cover-series-label">The $1K First Month Blueprint Series</div>
      <div class="cover-series-rule"></div>
    </div>
    <div class="cover-title-block">
      <span class="cover-the">The</span>
      <span class="cover-brand"><span class="dollar">$1K</span><span class="rest"> First Month Blueprint</span></span>
      ${specificTitle ? `<div class="cover-specific">${escHtml(specificTitle)}</div>` : ''}
      <div class="cover-accent-bar"></div>
      <div class="cover-subtitle">${escHtml(subtitle)}</div>
    </div>
    <div class="cover-footer">
      <div class="cover-footer-label">PDF Digital Edition</div>
      <div class="cover-niche">${escHtml(niche)}</div>
    </div>
  </div>
</div>

<!-- TABLE OF CONTENTS -->
<div class="toc-page">
  <div class="content-header">
    <span class="content-header-title">The $1K First Month Blueprint</span>
  </div>
  <div class="toc-header-block"><div class="toc-title">TABLE OF CONTENTS</div></div>
  <div class="toc-rule"></div>
  <ul class="toc-list">${buildTOC(content)}</ul>
</div>

<!-- CONTENT -->
<div>
  <div class="content-header">
    <span class="content-header-title">${escHtml(truncate(title, 60))}</span>
  </div>
  <div class="content-body">
    ${processContent(bodyHTML)}
  </div>
</div>

<!-- BACK COVER -->
<div class="back-cover">
  <div class="back-cover-grid"></div>
  <div class="back-cover-watermark">$1K</div>
  <div class="back-cover-content">
    <div class="back-cover-series">The $1K First Month Blueprint Series</div>
    <div class="back-cover-rule"></div>
    <div class="back-cover-title">${escHtml(title)}</div>
    <div class="back-cover-subtitle">${escHtml(subtitle)}</div>
  </div>
  <div class="back-cover-footer">PDF Digital Edition</div>
</div>

</body>
</html>`;
}

async function renderPDF(data) {
  const html = buildHTML(data);
  const { execSync } = require('child_process');

  // Find chromium -- Nix installs to store, not /usr/bin
  let executablePath;
  const candidates = [
    '/run/current-system/sw/bin/chromium',
    '/nix/var/nix/profiles/default/bin/chromium',
  ];
  try {
    // Try find in PATH first
    const found = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome-stable 2>/dev/null || find /nix -name "chromium" -type f 2>/dev/null | head -1', { encoding: 'utf8' }).trim().split('\n')[0];
    executablePath = found || candidates[0];
  } catch (e) {
    executablePath = candidates[0];
  }
  console.log('Using Chromium at:', executablePath);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', renderer: 'puppeteer', time: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/render') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        console.log('Rendering PDF for: ' + data.title);
        const pdfBuffer = await renderPDF(data);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBuffer.length,
        });
        res.end(pdfBuffer);
        console.log('PDF sent: ' + Math.round(pdfBuffer.length / 1024) + ' KB');
      } catch (err) {
        console.error('Render error:', err.message);
        console.error(err.stack);
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
  console.log('Renderer (Puppeteer) listening on port ' + PORT);
  // Log chromium location at startup for debugging
  const { execSync } = require('child_process');
  try {
    const loc = execSync('find /nix /usr /opt -name "chromium" -type f 2>/dev/null | head -5', { encoding: 'utf8' });
    console.log('Chromium candidates found:\n' + loc);
  } catch(e) {
    console.log('Could not locate chromium:', e.message);
  }
});
