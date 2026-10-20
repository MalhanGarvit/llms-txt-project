# Deploying to Cloudflare Workers

The site currently runs as **Cloudflare proxy -> Vercel origin**. This replaces the
Vercel origin with a Worker. DNS does not change: the domain is already on
Cloudflare nameservers and `wrangler deploy` attaches the route.

`server.js` and `vercel.json` are left in place so Vercel stays a working rollback.

## What changed, and why

| Before (Vercel) | After (Workers) |
| --- | --- |
| Express + `express.static` | `env.ASSETS` binding serves `public/` |
| `res.sendFile` for `/about`, `/privacy`, `/terms` | `html_handling: auto-trailing-slash` |
| `axios` | `fetch` |
| `xml2js` | `<loc>` scan + `<sitemapindex>` detection |
| `@google/generative-ai` SDK | Gemini REST endpoint via `fetch` |
| **`nodemailer` + Gmail SMTP** | **Resend HTTP API** |

Workers cannot open an SMTP connection, so Gmail SMTP cannot be carried over.
This is the only change that needs action outside the repo.

## One-time setup

### 1. Verify a sending domain in Resend

The From address must be on a domain you control. `llmstxt@gmail.com` can never be
verified, so mail now sends from `files@txtllms.com` with replies routed to the
Gmail address.

1. Sign up at resend.com and add the domain `txtllms.com`.
2. Resend shows DKIM/SPF records. Add them in Cloudflare DNS (same dashboard as
   the site) and set those records to **DNS only**, not proxied.
3. Wait for Resend to show "Verified".

Deliverability improves as a side effect: mail is now DKIM-signed and
DMARC-aligned for your own domain, which sending as gmail.com through a third
party never was.

### 2. Set secrets

```
npx wrangler secret put GOOGLE_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SENDER_EMAIL     # e.g. "txtllms <files@txtllms.com>"
npx wrangler secret put REPLY_TO         # llmstxt@gmail.com
```

### 3. Deploy

```
npx wrangler deploy
```

Then add the custom domain: Cloudflare dashboard -> Workers & Pages -> txtllms ->
Settings -> Domains & Routes -> add `www.txtllms.com`. This takes the hostname off
Vercel and points it at the Worker.

## Local development

```
cp .dev.vars.example .dev.vars   # fill in real keys; the file is gitignored
npm run cf:dev                   # http://localhost:8787
npm run cf:tail                  # stream production logs
```

## Limits worth knowing

- **50 subrequests per request on the free plan.** A deep sitemap index can exceed
  that, so `SUBREQUEST_BUDGET` in `worker/index.js` caps the crawl at 40 fetches
  and leaves headroom for the Gemini and Resend calls. On a paid plan the ceiling
  is 1000 and the constant can be raised.
- **CPU time** is capped per request. The work here is almost entirely waiting on
  network, which does not count against it.
- Cached sitemap fetches use `cacheTtl: 300`, so repeat generations for the same
  domain are cheaper.

## Rolling back

Remove the custom domain from the Worker and re-point `www` at Vercel. `server.js`
and `vercel.json` are unchanged and still deploy as before.
