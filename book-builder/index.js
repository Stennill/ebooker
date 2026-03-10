/**
 * EBOOK BOOK BUILDER SERVICE
 * Runs on Railway -- no timeout limits.
 *
 * Flow:
 *   POST /build  -> receives topic from Cloudflare Worker
 *                -> generates outline
 *                -> writes each chapter one at a time
 *                -> assembles full markdown
 *                -> sends to PDF renderer
 *                -> posts to Gumroad
 *                -> saves to R2
 *
 * Environment variables (set in Railway dashboard):
 *   ANTHROPIC_API_KEY
 *   GUMROAD_ACCESS_TOKEN
 *   RENDERER_URL
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 */

const http = require('http');
const https = require('https');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const PORT = process.env.PORT || 3001;

// ================================================================
// HTTP SERVER
// ================================================================
const server = http.createServer((req, res) => {

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/build') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      // Respond immediately so the Worker doesn't time out waiting
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'Build started' }));

      // Run the full pipeline in the background
      try {
        const topic = JSON.parse(body);
        console.log('=== BUILD STARTED: ' + topic.title + ' ===');
        await buildBook(topic);
        console.log('=== BUILD COMPLETE: ' + topic.title + ' ===');
      } catch (err) {
        console.error('=== BUILD FAILED ===');
        console.error(err.message);
        console.error(err.stack);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Book Builder listening on port ' + PORT);
});

// ================================================================
// MAIN BUILD PIPELINE
// ================================================================
async function buildBook(topic) {
  const log = (msg) => console.log('[' + new Date().toISOString() + '] ' + msg);

  // Step 1: Generate outline
  log('Step 1: Generating outline...');
  const outline = await generateOutline(topic);
  log('Step 1: Outline ready -- ' + outline.chapters.length + ' chapters planned');

  // Step 2: Write each chapter
  log('Step 2: Writing chapters...');
  const chapters = [];
  for (let i = 0; i < outline.chapters.length; i++) {
    const chapterPlan = outline.chapters[i];
    log('  Writing chapter ' + (i + 1) + '/' + outline.chapters.length + ': ' + chapterPlan.title);
    const chapterContent = await writeChapter(topic, outline, chapterPlan, i + 1);
    chapters.push(chapterContent);
    log('  Chapter ' + (i + 1) + ' done -- ' + chapterContent.split(/\s+/).length + ' words');

    // Small delay between chapters to avoid rate limiting
    await sleep(2000);
  }

  // Step 3: Write front matter and back matter
  log('Step 3: Writing front matter...');
  const frontMatter = await writeFrontMatter(topic, outline);

  log('Step 3: Writing conclusion and cheat sheet...');
  const backMatter = await writeBackMatter(topic, outline);

  // Step 4: Assemble full markdown
  log('Step 4: Assembling full book...');
  const rawBook = assembleBook(topic, outline, frontMatter, chapters, backMatter);

  // Step 4b: Sanitize -- strip code fences and fix jsPDF-breaking characters
  log('Step 4b: Sanitizing content...');
  const sanitizedBook = sanitizeContent(rawBook);

  // Step 4c: QC pass -- Claude reviews and fixes the full markdown
  log('Step 4c: Running QC pass...');
  const fullBook = await qualityCheck(sanitizedBook, topic);

  const wordCount = fullBook.split(/\s+/).length;
  const estPages = Math.ceil(wordCount / 220);
  log('Step 4c: QC complete -- ' + wordCount.toLocaleString() + ' words, ~' + estPages + ' pages');

  // Step 5: Generate PDF
  log('Step 5: Generating PDF...');
  const pdfBytes = await generatePDF(topic, fullBook, wordCount, estPages);
  log('Step 5: PDF ready -- ' + Math.round(pdfBytes.byteLength / 1024) + ' KB');

  // Step 6: Save to R2 -- MUST succeed before Gumroad publish
  log('Step 6: Saving to R2...');
  // Attach estPages and chapter titles to topic so manifest has them
  topic.estPages = estPages;
  topic.chapterTitles = outline.chapters.map(c => c.title);

  const r2Key = await saveToR2(pdfBytes, topic);
  log('Step 6: Saved -- ' + r2Key);

  log('=== COMPLETE === PDF saved to R2: ' + r2Key);
  return r2Key;
}

// ================================================================
// STEP 1 -- GENERATE OUTLINE
// Plans all chapters before writing begins
// ================================================================
async function generateOutline(topic) {
  const chapterCount = topic.chapter_count || 13;

  const raw = await callClaude(
    `Create a detailed chapter-by-chapter outline for this ebook.

TITLE: ${topic.title}
SUBTITLE: ${topic.subtitle}
FOR: ${topic.target_audience}
PROBLEM SOLVED: ${topic.core_problem}
TRANSFORMATION: ${topic.transformation}
CHAPTERS: ${chapterCount} chapters (this is the target -- stay within 1 of this number)
WORDS PER CHAPTER: ${topic.words_per_chapter || 2000}

IMPORTANT: The "chapters" array must contain ${chapterCount} objects (between 13 and 16).
Each chapter should build logically on the previous one, taking the reader 
from their current problem to the full transformation by the final chapter.

Return ONLY raw JSON, no markdown:
{
  "chapters": [
    {
      "number": 1,
      "title": "Specific descriptive chapter title",
      "goal": "What the reader will understand or be able to do after this chapter",
      "key_points": ["point 1", "point 2", "point 3", "point 4"],
      "subsections": ["Subsection 1 title", "Subsection 2 title", "Subsection 3 title"]
    }
  ]
}

Remember: ${chapterCount} chapter objects in the array.`,
    'Return only raw JSON. No markdown fences. No explanation. The chapters array must have exactly the requested number of entries.',
    4000
  );

  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ================================================================
// STEP 2 -- WRITE EACH CHAPTER
// ================================================================
async function writeChapter(topic, outline, chapterPlan, chapterNum) {
  const totalChapters = outline.chapters.length;
  const wordsTarget = topic.words_per_chapter || 2000;

  const raw = await callClaude(
    `You are writing Chapter ${chapterNum} of ${totalChapters} for the ebook "${topic.title}".

BOOK CONTEXT:
- For: ${topic.target_audience}
- Overall transformation: ${topic.transformation}
- This chapter's goal: ${chapterPlan.goal}

CHAPTER ${chapterNum}: ${chapterPlan.title}

Key points to cover:
${chapterPlan.key_points.map((p, i) => (i + 1) + '. ' + p).join('\n')}

Subsections to include:
${chapterPlan.subsections.map((s, i) => '## ' + s).join('\n')}

Write the COMPLETE chapter with ${wordsTarget}+ words. Structure:

# Chapter ${chapterNum}: ${chapterPlan.title}

## ${chapterPlan.subsections[0]}
(write this section fully -- 600+ words)

## ${chapterPlan.subsections[1]}
(write this section fully -- 600+ words)

## ${chapterPlan.subsections[2] || 'Putting It Into Practice'}
(write this section fully -- 500+ words)

## Workbook: Chapter ${chapterNum} Exercises
**Reflect:** [Specific reflection question about this chapter's content]
**Reflect:** [Another specific reflection question]
**Reflect:** [A third reflection question]
**Exercise:** [Specific actionable exercise prompt] _______________
**Exercise:** [Another actionable exercise prompt] _______________

> **Key Takeaway:** [One powerful sentence summarizing the single most important idea from this chapter]

WRITING STYLE:
- Write like a knowledgeable trusted friend, not a textbook
- Use **bold** for key terms and important concepts
- Use bullet lists for steps and tips
- Use > blockquote for callout boxes and insights
- Be specific and practical -- no filler or fluff
- Fill-in exercise lines must end with _______________`,
    'You are a professional ebook author. Write complete thorough chapter content. Never truncate. Write every word.',
    3500
  );

  return raw.trim();
}

// ================================================================
// STEP 3 -- FRONT MATTER
// ================================================================
async function writeFrontMatter(topic, outline) {
  const chapterList = outline.chapters
    .map((c, i) => (i + 1) + '. ' + c.title)
    .join('\n');

  const raw = await callClaude(
    `Write the opening sections for this ebook.

TITLE: ${topic.title}
SUBTITLE: ${topic.subtitle}
FOR: ${topic.target_audience}
PROBLEM: ${topic.core_problem}
TRANSFORMATION: ${topic.transformation}

CHAPTERS IN THIS BOOK:
${chapterList}

Write these three sections in full:

# ${topic.title}
### ${topic.subtitle}

# About This Guide
(200 words: who this is for, what they will learn, how to use this book, what makes it different)

# Introduction: [Write a compelling title that hooks the reader]
(500+ words: open with the reader's pain point in vivid detail, why this problem matters, 
what changes when they solve it, a brief story or scenario they will recognize, 
preview of what is coming, why this guide delivers what others don't)`,
    'You are a professional ebook author. Write compelling opening content.',
    2000
  );

  return raw.trim();
}

// ================================================================
// STEP 3b -- BACK MATTER
// ================================================================
async function writeBackMatter(topic, outline) {
  const chapterSummaries = outline.chapters
    .map((c, i) => 'Chapter ' + (i + 1) + ' (' + c.title + '): ' + c.goal)
    .join('\n');

  const raw = await callClaude(
    `Write the closing sections for this ebook.

TITLE: ${topic.title}
FOR: ${topic.target_audience}
TRANSFORMATION DELIVERED: ${topic.transformation}

WHAT EACH CHAPTER COVERED:
${chapterSummaries}

Write these two sections in full:

# Conclusion: Your Next Steps
(400+ words: celebrate the reader's journey, recap the 3 most important shifts, 
give 5 specific immediate action steps they can take today, 
inspiring close that reinforces the transformation, 
encourage them to revisit the workbook exercises)

# Quick Reference Cheat Sheet
(One bullet point per chapter -- the single most important takeaway from each chapter, 
written as an actionable reminder. ${outline.chapters.length} bullets total.)`,
    'You are a professional ebook author. Write a powerful conclusion.',
    2000
  );

  return raw.trim();
}

// ================================================================
// STEP 4 -- ASSEMBLE FULL BOOK
// ================================================================
function assembleBook(topic, outline, frontMatter, chapters, backMatter) {
  const parts = [
    frontMatter,
    ...chapters,
    backMatter,
  ];

  return parts.join('\n\n');
}

// ================================================================
// STEP 5 -- GENERATE PDF
// ================================================================
async function generatePDF(topic, content, wordCount, estPages) {
  const rendererUrl = process.env.RENDERER_URL;
  if (!rendererUrl) throw new Error('RENDERER_URL not set');

  const payload = JSON.stringify({
    title: topic.title,
    subtitle: topic.subtitle,
    niche: topic.niche,
    price: topic.price,
    wordCount,
    estPages,
    content,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(rendererUrl + '/render');
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const chunks = [];
    const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('Renderer failed: ' + res.statusCode + ' ' + Buffer.concat(chunks).toString()));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ================================================================
// STEP 6 -- SAVE TO R2
// Uses @aws-sdk/client-s3 for reliable uploads
// ================================================================
async function saveToR2(pdfBytes, topic) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || 'ebook-broker-storage';

  if (!accountId || !accessKeyId || !secretKey) {
    throw new Error('R2 credentials not set -- cannot save PDF');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://' + accountId + '.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretKey,
    },
  });

  const date = new Date().toISOString().split('T')[0];
  const slug = topic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const key = 'ebooks/' + date + '/' + slug + '.pdf';

  const bodyBuffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bodyBuffer,
    ContentType: 'application/pdf',
    Metadata: {
      title: topic.title,
      niche: topic.niche,
      price: String(topic.price),
    },
  }));

  // Update manifest.json -- the site reads this to show real book data
  await updateManifest(client, bucket, topic, key, topic.estPages || 80);

  return key;
}

// ================================================================
// UPDATE MANIFEST
// manifest.json structure:
// {
//   allBooks: [...],          -- every book ever built, grouped by niche on site
//   currentBundle: [...],     -- the 3 most recent books (active bundle)
//   bundleArchive: [          -- previous complete bundles
//     { id, niche, books: [...], bundledAt }
//   ]
// }
// ================================================================
async function updateManifest(client, bucket, topic, pdfKey, estPages) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');

  // Read existing manifest
  let manifest = { allBooks: [], currentBundle: [], bundleArchive: [] };
  try {
    const existing = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: 'manifest.json',
    }));
    const chunks = [];
    for await (const chunk of existing.Body) chunks.push(chunk);
    manifest = JSON.parse(Buffer.concat(chunks).toString());
    // Ensure all keys exist
    manifest.allBooks = manifest.allBooks || [];
    manifest.currentBundle = manifest.currentBundle || [];
    manifest.bundleArchive = manifest.bundleArchive || [];
  } catch (e) {
    // No manifest yet -- start fresh
  }

  // Build the new book entry
  const slug = topic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const newBook = {
    id: 'BP-' + String(manifest.allBooks.length + 1).padStart(3, '0'),
    slug: slug,
    title: topic.title,
    subtitle: topic.subtitle,
    niche: topic.niche,
    price: topic.price || 14.99,
    pages: estPages,
    chapters: topic.chapterTitles || [],
    pdfKey: pdfKey,
    publishedAt: new Date().toISOString(),
  };

  // Add to allBooks
  manifest.allBooks.push(newBook);

  // Add to currentBundle
  manifest.currentBundle.push(newBook);

  // When currentBundle hits 3 books -- seal it as a bundle and start fresh
  if (manifest.currentBundle.length >= 3) {
    const bundleNiche = manifest.currentBundle[0].niche;
    manifest.bundleArchive.push({
      id: 'BUNDLE-' + String(manifest.bundleArchive.length + 1).padStart(3, '0'),
      niche: bundleNiche,
      price: 49,
      books: manifest.currentBundle.slice(0, 3),
      bundledAt: new Date().toISOString(),
    });
    // Reset currentBundle for the next set
    manifest.currentBundle = manifest.currentBundle.slice(3);
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: 'manifest.json',
    Body: Buffer.from(JSON.stringify(manifest, null, 2)),
    ContentType: 'application/json',
    ACL: 'public-read',
  }));

  console.log('Manifest updated -- ' + manifest.allBooks.length + ' total books, ' + manifest.bundleArchive.length + ' bundles archived');
}

// ================================================================
// STEP 7 -- PUBLISH TO GUMROAD
// Uses Bearer token in Authorization header
// ================================================================
async function publishToGumroad(topic, pdfBytes) {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token) throw new Error('GUMROAD_ACCESS_TOKEN not set');

  const filename = topic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';
  const auth = { 'Authorization': 'Bearer ' + token };

  // 7a. Create product -- use JSON body for initial creation
  const createRes = await fetch('https://api.gumroad.com/v2/products', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: topic.gumroad_name || topic.title,
      description: topic.gumroad_description || topic.subtitle,
      price: Math.round(topic.price * 100),
      currency: 'usd',
      published: false,
    }),
  });

  const createText = await createRes.text();
  let createData;
  try {
    createData = JSON.parse(createText);
  } catch (e) {
    throw new Error('Gumroad create failed -- raw response: ' + createText);
  }

  if (!createData.success) {
    throw new Error('Gumroad create failed: ' + JSON.stringify(createData));
  }

  const productId = createData.product.id;
  console.log('Gumroad product created: ' + productId);

  // 7b. Upload PDF -- must use multipart form for file upload
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);

  const uploadRes = await fetch('https://api.gumroad.com/v2/products/' + productId + '/product_files', {
    method: 'POST',
    headers: auth,
    body: uploadForm,
  });

  const uploadText = await uploadRes.text();
  let uploadData;
  try {
    uploadData = JSON.parse(uploadText);
  } catch (e) {
    throw new Error('Gumroad upload failed -- raw response: ' + uploadText);
  }

  if (!uploadData.success) {
    throw new Error('Gumroad upload failed: ' + JSON.stringify(uploadData));
  }

  console.log('PDF uploaded to Gumroad.');

  // 7c. Publish
  const publishRes = await fetch('https://api.gumroad.com/v2/products/' + productId, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ published: true }),
  });

  const publishText = await publishRes.text();
  let publishData;
  try {
    publishData = JSON.parse(publishText);
  } catch (e) {
    throw new Error('Gumroad publish failed -- raw response: ' + publishText);
  }

  if (!publishData.success) {
    throw new Error('Gumroad publish failed: ' + JSON.stringify(publishData));
  }

  return publishData.product.short_url;
}

// ================================================================
// SANITIZE -- Strip problematic content before PDF rendering
// Fixes jsPDF encoding bugs caused by code blocks and special chars
// ================================================================
function sanitizeContent(markdown) {
  let text = markdown;

  // Remove triple-backtick code blocks -- convert to plain bullet list
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, function(match, code) {
    const lines = code.trim().split('\n').filter(function(l) { return l.trim(); });
    return lines.map(function(l) { return '- ' + l.trim().replace(/[^\x20-\x7E]/g, ''); }).join('\n') + '\n';
  });

  // Remove inline backticks -- keep the text inside
  text = text.replace(/`([^`]+)`/g, '$1');

  // Strip any remaining backtick characters
  text = text.replace(/`/g, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Normalize unicode quotes and dashes to ASCII
  text = text.replace(/\u2018|\u2019/g, "'");
  text = text.replace(/\u201C|\u201D/g, '"');
  text = text.replace(/\u2013|\u2014/g, '-');
  text = text.replace(/\u2026/g, '...');
  text = text.replace(/\u00A0/g, ' ');

  // Strip non-printable characters jsPDF cannot handle
  text = text.replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, '');

  // Clean up excessive blank lines
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text;
}


// ================================================================
// QC PASS -- Only runs if garbled content is actually detected
// Saves ~15 minutes per book by skipping clean content
// ================================================================
function hasGarbledContent(text) {
  // Check for known jsPDF encoding corruption patterns
  const garblePatterns = [
    /[%&]{3,}/,           // %&& or &&& patterns
    /&[0-9]&[0-9]/,       // &0&1 style
    /&[A-Za-z]&[A-Za-z]/, // &L&o style
    /```/,                 // leftover code fences the sanitizer missed
  ];
  return garblePatterns.some(p => p.test(text));
}

async function qualityCheck(markdown, topic) {
  // Skip QC entirely if content looks clean -- saves ~15 minutes
  if (!hasGarbledContent(markdown)) {
    console.log('Step 4c: Content looks clean -- skipping QC pass');
    return markdown;
  }

  console.log('Step 4c: Garbled content detected -- running targeted QC...');

  // Only QC the chapters that actually have problems
  const chapterSplits = markdown.split(/(?=^# )/m);
  const fixedChunks = [];
  let fixedCount = 0;

  for (const chunk of chapterSplits) {
    if (!chunk.trim()) continue;
    if (hasGarbledContent(chunk)) {
      const fixed = await qcChunk(chunk, topic);
      fixedChunks.push(fixed);
      fixedCount++;
      await sleep(500);
    } else {
      fixedChunks.push(chunk);
    }
  }

  console.log('Step 4c: Fixed ' + fixedCount + ' chapter(s)');
  return fixedChunks.join('\n\n');
}

async function qcChunk(chunk, topic) {
  const prompt = 'You are a quality control editor for the ebook: "' + topic.title + '"\n\n' +
    'Fix ONLY these specific issues in the markdown content below:\n' +
    '1. Garbled text with symbols like %&&, &0&1, &L&o -- rewrite those sections properly\n' +
    '2. Code blocks with backticks -- convert to plain bullet lists\n' +
    '3. Incomplete sentences that cut off mid-thought -- complete them\n\n' +
    'RULES:\n' +
    '- Preserve all markdown headings (# ## ###), blockquotes (>), **bold**, bullets (-)\n' +
    '- Preserve fill-in lines (_____)\n' +
    '- Do NOT add new content, do NOT remove workbook sections\n' +
    '- Return ONLY the corrected markdown, nothing else\n\n' +
    'CONTENT:\n' + chunk;

  const fixed = await callClaude(
    prompt,
    'Return only corrected markdown. No explanations.',
    4000
  );
  return fixed.trim();
}


// ================================================================
// UTILITIES
// ================================================================
async function callClaude(userMsg, systemMsg, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens || 2000,
    system: systemMsg || 'You are an expert ebook author.',
    messages: [{ role: 'user', content: userMsg }],
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const chunks = [];
    const req = https.request(options, (res) => {
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.error) throw new Error('Claude API: ' + data.error.message);
          resolve(data.content.map(b => b.text || '').join(''));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
