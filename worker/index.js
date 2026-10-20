/*
 * Cloudflare Worker port of server.js
 *
 * Differences forced by the runtime, all deliberate:
 *   - No SMTP. Workers cannot talk to Gmail on port 465, so mail goes out
 *     through Cloudflare Email Sending (the EMAIL binding), or Resend's HTTP API
 *     if that binding is absent. Either way the From address must be on a
 *     domain we have verified, which a gmail.com address can never be.
 *   - No express/axios/xml2js. Static files are served by the ASSETS binding,
 *     requests use fetch, and sitemaps are read with a <loc> scan rather than a
 *     full XML parse.
 *   - Subrequests are budgeted. A Worker gets 50 outbound fetches per request on
 *     the free plan, and a deep sitemap index will happily blow through that.
 */

const MAX_URLS = 250;
const MAX_DEPTH = 3;
// Leave headroom for the Gemini call and the Resend call.
const SUBREQUEST_BUDGET = 40;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

class Budget {
  constructor(max) { this.left = max; }
  take() {
    if (this.left <= 0) return false;
    this.left -= 1;
    return true;
  }
}

async function fetchText(url, budget, timeoutMs = 10000) {
  if (!budget.take()) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'txtllms.com llms.txt generator (+https://www.txtllms.com)' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function cleanDomain(domain) {
  let d = String(domain || '').trim();
  d = d.replace(/^https?:\/\//i, '');
  d = d.replace(/\/+$/, '');
  return d.split('/')[0];
}

/* ---------- sitemap discovery ---------- */

async function getSitemapUrls(domain, budget) {
  const host = cleanDomain(domain);
  const robots = await fetchText(`https://${host}/robots.txt`, budget, 5000);

  if (robots) {
    const matches = robots.match(/Sitemap:\s*(\S+)/gi);
    if (matches && matches.length) {
      return matches.map((m) => m.replace(/Sitemap:\s*/i, '').trim());
    }
  }

  const candidates = [
    `https://${host}/sitemap.xml`,
    `https://${host}/sitemap_index.xml`,
    `https://${host}/sitemap.php`,
    `https://${host}/sitemap.txt`,
    `https://${host}/wp-sitemap.xml`,
    `https://${host}/blog/sitemap.xml`,
  ];

  const found = [];
  for (const url of candidates) {
    if (budget.left <= 0) break;
    const body = await fetchText(url, budget, 5000);
    if (body) found.push(url);
  }
  return found.length ? found : null;
}

const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function extractLocs(xml) {
  const out = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decodeEntities(m[1].trim()));
  return out;
}

async function processAllSitemaps(sitemapUrl, seen, urls, budget, depth = 0) {
  if (depth > MAX_DEPTH || urls.length >= MAX_URLS || budget.left <= 0) return urls;
  if (seen.has(sitemapUrl)) return urls;
  seen.add(sitemapUrl);

  const xml = await fetchText(sitemapUrl, budget);
  if (!xml) return urls;

  const locs = extractLocs(xml);
  const isIndex = /<sitemapindex[\s>]/i.test(xml);

  if (isIndex) {
    for (const nested of locs) {
      if (urls.length >= MAX_URLS || budget.left <= 0) break;
      if (seen.has(nested)) continue;
      await processAllSitemaps(nested, seen, urls, budget, depth + 1);
    }
    return urls;
  }

  for (const url of locs) {
    if (urls.length >= MAX_URLS) break;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

async function getAllSitemapUrls(domain, budget) {
  const sitemaps = await getSitemapUrls(domain, budget);
  if (!sitemaps || !sitemaps.length) return [];

  const seen = new Set();
  const urls = [];
  for (const sm of sitemaps) {
    if (urls.length >= MAX_URLS || budget.left <= 0) break;
    await processAllSitemaps(sm, seen, urls, budget);
  }
  return urls.slice(0, MAX_URLS);
}

function formatUrlsList(urls, domain) {
  let out = `URL list from ${domain} sitemap:\n\n`;
  if (!urls.length) return out + 'No valid URLs found in the sitemaps.';
  urls.forEach((u, i) => { out += `${i + 1}. ${u}\n`; });
  return out;
}

/* ---------- generation ---------- */

const PROMPT_HEAD =
  'Generate a well-structured markdown document for an LLMs.txt file based on the following website URLs. The output MUST be in proper markdown format.\n\n' +
  'Instructions:\n1. Understand & Validate Data:\n' +
  '  - understand the URL list and extract unique, human-readable pages\n' +
  '  - Avoid non-content pages like `/login`, `/cart`, `/checkout`, `/admin`, `/wp-json`, or any API endpoints.\n' +
  '  - If the URL list is invalid or inaccessible, return an appropriate error message instead of generating fake data.\n\n' +
  '2. Generate Structured Output: \n' +
  '  - The file must begin with an H1 (`#`) containing the website name (either from metadata or inferred from the domain).\n' +
  '  - Follow with a blockquote (`>`) summarizing the site based on the extracted content.\n' +
  '  - Organize URLs into **meaningful sections** using H2 (`##`) headers (e.g., `## Blog`, `## Products`, `## Docs`).\n' +
  '  - Each URL should be formatted as `- [Page Title](URL): and a description`.\n' +
  '  - If page titles are missing, generate concise, relevant ones based on the URL structure.\n\n' +
  '3. Edge Cases & Enhancements: \n' +
  '   - If the site has **no descriptive metadata**, generate a neutral summary instead of guessing.\n' +
  '  - If the list contains external links, place them under an `## External Resources` section.\n' +
  '  - Include an `## Optional` section for less essential pages that can be skipped if needed but try to generate for all the urls provided to you in the input\n\n' +
  'Only generate output when valid data is available. If issues arise, clearly state them in the response.\n\n' +
  'Just give the mardown output nothing else\n\n' +
  'Write a nice 4-5 liner H1 description about the domain\n\n' +
  'Here are the website URLs to organize:\n\n';

function fallbackContent(domain) {
  return `# LLMs.txt for ${domain}

## Permissions
- AI assistants may access and index content from this website for informational purposes.
- Please respect the website's robots.txt directives.

## Usage Guidelines
- Content may be used to provide information to users.
- Do not reproduce large portions of the content verbatim without attribution.

## Attribution
- When citing specific content, please include the domain name and URL.
- Example attribution: "According to ${domain}, ..."

## Restrictions
- Do not use content from this website to train AI models without explicit permission.
- Do not present the website's content as your own original analysis.
`;
}

async function generateWithGemini(domain, formattedUrls, env) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT_HEAD + formattedUrls }] }],
          generationConfig: { temperature: 1.0, maxOutputTokens: 12000, topP: 1, topK: 1 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini returned ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    if (!text.includes('#')) throw new Error('Invalid response format from Gemini');
    return text;
  } catch (err) {
    console.error('Gemini generation failed:', err.message);
    return fallbackContent(domain);
  }
}

/* ---------- email ---------- */

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// mail.txtllms.com, not the apex: the apex carries a GoDaddy SPF record ending
// in -all, and a second sender there would either need that record rewritten or
// fail it outright. A subdomain gets its own SPF and DKIM and touches nothing.
const SENDER = { name: 'txtllms', email: 'files@mail.txtllms.com' };
const REPLY_TO = 'llmstxt@gmail.com';

// attachments: [{ filename, type, content }] with content as a plain string.
// Each transport encodes it the way it wants.
async function sendMail(env, { to, subject, text, html, attachments = [] }) {
  // Cloudflare's own Email Sending, when the binding is configured.
  if (env.EMAIL) {
    const msg = {
      from: SENDER,
      to,
      replyTo: env.REPLY_TO || REPLY_TO,
      subject,
      text,
    };
    if (html) msg.html = html;
    if (attachments.length) {
      msg.attachments = attachments.map((a) => ({
        filename: a.filename,
        type: a.type,
        content: a.content,
        disposition: 'attachment',
      }));
    }
    return env.EMAIL.send(msg);
  }

  if (!env.RESEND_API_KEY) {
    throw new Error('No email transport configured: bind EMAIL or set RESEND_API_KEY');
  }
  const body = {
    from: env.SENDER_EMAIL || `${SENDER.name} <${SENDER.email}>`,
    to: [to],
    subject,
    text,
    reply_to: env.REPLY_TO || REPLY_TO,
  };
  if (html) body.html = html;
  if (attachments.length) {
    body.attachments = attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content) }));
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/* ---------- handlers ---------- */

async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await request.json();
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(await request.text()));
  }
  try { return await request.json(); } catch { return {}; }
}

async function handleGenerate(request, env) {
  const { email, domain } = await readJson(request);
  if (!email || !domain) {
    return json({ error: 'Email and domain are required' }, 400);
  }

  const budget = new Budget(SUBREQUEST_BUDGET);
  const urls = await getAllSitemapUrls(domain, budget);

  const markdown = urls.length
    ? await generateWithGemini(domain, formatUrlsList(urls, domain), env)
    : fallbackContent(domain);

  await sendMail(env, {
    to: email,
    subject: `Your LLMs.txt file for ${domain}`,
    text: `Hello,

We've generated an LLMs.txt file for your website ${domain}, which is attached to this email.

To implement this file, simply place it in your website's root directory. If you're a marketer and would like free assistance in adding it to your site, please reply to this email and our team will gladly help at no cost.

Congratulations on taking a significant step towards improving your ranking on AI engines like ChatGPT and Claude!

Best regards,
Garvit`,
    attachments: [{ filename: 'llms.txt', type: 'text/plain', content: markdown }],
  });

  return json({ success: true, message: 'LLMs.txt generated and sent successfully' });
}

async function handleSubscribe(request, env) {
  const { email } = await readJson(request);
  if (!email) return json({ error: 'Email is required' }, 400);

  await sendMail(env, {
    to: email,
    subject: 'Welcome to the LLMs.txt Newsletter',
    text: `Hello,

Thank you for subscribing to the LLMs.txt newsletter!

You're now part of a forward-thinking community that's shaping how AI interacts with web content. We'll keep you informed about:

• Latest AI content protection strategies
• Updates to the LLMs.txt standard
• Expert tips for optimizing your website for AI systems
• Success stories from websites implementing LLMs.txt

If you have any questions, simply reply to this email.

Best regards,
Garvit`,
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <header style="background: linear-gradient(135deg, #6C63FF, #5A52E0); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0;">Welcome to the LLMs.txt Newsletter</h1>
  </header>
  <div style="padding: 20px; border: 1px solid #e1e1e1; border-top: none; border-radius: 0 0 8px 8px; background-color: white;">
    <p>Hello,</p>
    <p>Thank you for subscribing to the LLMs.txt newsletter!</p>
    <p>You're now part of a forward-thinking community that's shaping how AI interacts with web content. We'll keep you informed about:</p>
    <ul>
      <li>Latest AI content protection strategies</li>
      <li>Updates to the LLMs.txt standard</li>
      <li>Expert tips for optimizing your website for AI systems</li>
      <li>Success stories from websites implementing LLMs.txt</li>
    </ul>
    <p>If you have any questions, simply reply to this email.</p>
    <p>Best regards,<br>Garvit</p>
  </div>
</div>`,
  });

  return json({ success: true, message: 'Subscription successful' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/generate') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      try {
        return await handleGenerate(request, env);
      } catch (err) {
        console.error('Error generating LLMs.txt:', err);
        return json({ error: 'Failed to generate LLMs.txt file', details: err.message }, 500);
      }
    }

    if (url.pathname === '/api/subscribe') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      try {
        return await handleSubscribe(request, env);
      } catch (err) {
        console.error('Error processing newsletter subscription:', err);
        return json({ error: 'Failed to process subscription', details: err.message }, 500);
      }
    }

    // Everything else is a static file. html_handling in wrangler.jsonc maps
    // /about to about.html, which is what the Express routes used to do.
    return env.ASSETS.fetch(request);
  },
};
