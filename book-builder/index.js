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
  const fullBook = assembleBook(topic, outline, frontMatter, chapters, backMatter);
  const wordCount = fullBook.split(/\s+/).length;
  const estPages = Math.ceil(wordCount / 220);
  log('Step 4: Book assembled -- ' + wordCount.toLocaleString() + ' words, ~' + estPages + ' pages');

  // Step 5: Generate PDF
  log('Step 5: Generating PDF...');
  const pdfBytes = await generatePDF(topic, fullBook, wordCount, estPages);
  log('Step 5: PDF ready -- ' + Math.round(pdfBytes.byteLength / 1024) + ' KB');

  // Step 6: Save to R2 (non-fatal -- pipeline continues even if this fails)
  log('Step 6: Saving to R2...');
  try {
    const r2Key = await saveToR2(pdfBytes, topic, wordCount, estPages);
    log('Step 6: Saved -- ' + r2Key);
  } catch (r2Err) {
    log('Step 6: R2 save failed (non-fatal) -- ' + r2Err.message);
  }

  // Step 7: Post to Gumroad
  log('Step 7: Publishing to Gumroad...');
  const gumroadUrl = await publishToGumroad(topic, pdfBytes);
  log('Step 7: LIVE -- ' + gumroadUrl);

  log('=== COMPLETE === ' + gumroadUrl);
  return gumroadUrl;
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
CHAPTERS: ${chapterCount}
WORDS PER CHAPTER: ${topic.words_per_chapter || 1500}

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
}`,
    'Return only raw JSON. No markdown fences. No explanation.',
    3000
  );

  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ================================================================
// STEP 2 -- WRITE EACH CHAPTER
// ================================================================
async function writeChapter(topic, outline, chapterPlan, chapterNum) {
  const totalChapters = outline.chapters.length;
  const wordsTarget = topic.words_per_chapter || 1500;

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
(write this section fully -- 400+ words)

## ${chapterPlan.subsections[1]}
(write this section fully -- 400+ words)

## ${chapterPlan.subsections[2] || 'Putting It Into Practice'}
(write this section fully -- 300+ words)

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
    2000
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
// Uses Cloudflare R2 S3-compatible API
// ================================================================
async function saveToR2(pdfBytes, topic, wordCount, estPages) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || 'ebook-broker-storage';

  if (!accountId || !accessKeyId || !secretKey) {
    console.log('R2 credentials not set -- skipping R2 save');
    return 'skipped';
  }

  const date = new Date().toISOString().split('T')[0];
  const slug = topic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const key = 'ebooks/' + date + '/' + slug + '.pdf';

  // Use fetch with AWS Signature v4 for R2
  const endpoint = 'https://' + accountId + '.r2.cloudflarestorage.com/' + bucket + '/' + key;

  const { createHmac, createHash } = require('crypto');

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

  const contentHash = createHash('sha256').update(pdfBytes).digest('hex');

  const headers = {
    'Content-Type': 'application/pdf',
    'x-amz-date': amzDate,
    'x-amz-content-sha256': contentHash,
    'Host': accountId + '.r2.cloudflarestorage.com',
  };

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = [
    'content-type:application/pdf',
    'host:' + accountId + '.r2.cloudflarestorage.com',
    'x-amz-content-sha256:' + contentHash,
    'x-amz-date:' + amzDate,
  ].join('\n') + '\n';

  const canonicalRequest = [
    'PUT',
    '/' + bucket + '/' + key,
    '',
    canonicalHeaders,
    signedHeaders,
    contentHash,
  ].join('\n');

  const credentialScope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = ['aws4_request', 's3', 'auto', dateStamp].reduce(
    (key, data) => createHmac('sha256', key).update(data).digest(),
    'AWS4' + secretKey
  );

  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization },
    body: pdfBytes,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('R2 save failed: ' + err);
  }

  return key;
}

// ================================================================
// STEP 7 -- PUBLISH TO GUMROAD
// ================================================================
async function publishToGumroad(topic, pdfBytes) {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token) throw new Error('GUMROAD_ACCESS_TOKEN not set');

  const filename = topic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';

  // 7a. Create product
  const createForm = new FormData();
  createForm.append('access_token', token);
  createForm.append('name', topic.gumroad_name || topic.title);
  createForm.append('description', topic.gumroad_description || topic.subtitle);
  createForm.append('price', String(Math.round(topic.price * 100)));
  createForm.append('currency', 'usd');
  createForm.append('published', 'false');
  if (topic.gumroad_tags) {
    topic.gumroad_tags.forEach(tag => createForm.append('tags[]', tag));
  }

  const createRes = await fetch('https://api.gumroad.com/v2/products', {
    method: 'POST',
    body: createForm,
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

  // 7b. Upload PDF
  const uploadForm = new FormData();
  uploadForm.append('access_token', token);
  uploadForm.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);

  const uploadRes = await fetch('https://api.gumroad.com/v2/products/' + productId + '/product_files', {
    method: 'POST',
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
  const publishForm = new FormData();
  publishForm.append('access_token', token);
  publishForm.append('published', 'true');

  const publishRes = await fetch('https://api.gumroad.com/v2/products/' + productId, {
    method: 'PUT',
    body: publishForm,
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
