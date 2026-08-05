/* ShaadiPath-style Wedding Invitation Builder — server with Razorpay integration
 * Routes:
 *   GET  /                        -> template gallery
 *   GET  /builder?template=id     -> mobile-first wizard
 *   GET  /demo/:template          -> template demo with dummy data
 *   POST /api/upload-music        -> upload a music file directly, returns its URL
 *   POST /api/lead                -> capture a phone number before purchase (follow-up)
 *   POST /api/preview             -> save draft, returns preview token
 *   GET  /preview/:token          -> render selected template with draft data
 *   POST /api/create-order        -> create Razorpay order via SDK
 *   POST /api/verify-payment      -> HMAC verify signature + publish invite
 *   GET  /invite/:id              -> final published invitation
 *   GET  /admin                   -> leads/drafts/purchases dashboard (Google login required)
 */
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { put, list, del } = require('@vercel/blob');
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');
const { OAuth2Client } = require('google-auth-library');
const { render } = require('./lib/render');

const app = express();
// Vercel terminates TLS at its edge and forwards to this function over plain
// HTTP, so req.protocol reports 'http' unless told to trust X-Forwarded-Proto
// — without this, the Google OAuth redirect_uri is generated as http://,
// which won't match the https:// URI registered in Google Cloud Console.
app.set('trust proxy', true);
app.use(express.json({ limit: '10mb' }));

/* ---- media handling: photos/music go to Vercel Blob, not local disk.
 * Serverless functions run in isolated, ephemeral containers — a file written
 * to local disk (even /tmp) by one invocation is invisible to the next, so
 * uploads would randomly 404 depending on which container served the read.
 * Blob storage is external and shared across every invocation. ---- */
async function saveMedia(id, data) {
  const out = { photoUrls: [], musicUrl: null };
  const putDataUrl = async (dataUrl, name) => {
    const mimeMatch = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(dataUrl || '');
    const contentType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const b64 = dataUrl.split(',')[1];
    const blob = await put(`media/${id}/${name}`, Buffer.from(b64, 'base64'), {
      access: 'public', contentType, addRandomSuffix: false
    });
    return blob.url;
  };
  if (data && data.photos) {
    for (const k of Object.keys(data.photos)) {
      const p = data.photos[k];
      if (p && typeof p === 'string' && p.startsWith('data:image')) {
        const ext = ((/^data:image\/([a-z0-9.+-]+);/i.exec(p) || [])[1] || 'jpg').replace('jpeg', 'jpg');
        out.photoUrls.push(await putDataUrl(p, `photo${k}.${ext}`));
      } else if (p && typeof p === 'string' && /^https?:\/\//.test(p)) {
        out.photoUrls.push(p); // already uploaded
      }
    }
    data.photos = {}; // don't keep base64 in JSON records
  }
  if (data && typeof data.musicFile === 'string' && data.musicFile) {
    if (data.musicFile.startsWith('data:audio')) {
      const ext = ((/^data:audio\/([a-z0-9.+-]+);/i.exec(data.musicFile) || [])[1] || 'mp3').replace('mpeg', 'mp3');
      out.musicUrl = await putDataUrl(data.musicFile, `music.${ext}`);
    } else if (/^(https?:\/\/|\/)/.test(data.musicFile)) {
      // already-hosted URL — either a Blob URL from /api/upload-music (absolute)
      // or a library track under /assets/sounds/library/ (relative)
      out.musicUrl = data.musicFile;
    }
    data.musicFile = null;
  }
  return out;
}

const PORT = process.env.PORT || 3000;
const RZP_KEY = process.env.RAZORPAY_KEY_ID;
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!RZP_KEY || !RZP_SECRET) {
  console.error('ERROR: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env file');
  process.exit(1);
}

const rzp = new Razorpay({ key_id: RZP_KEY, key_secret: RZP_SECRET });

/* ---- admin auth: Google Sign-In, restricted to an explicit email allowlist ----
 * Unset Google credentials disable /admin gracefully rather than crashing the
 * whole site — this feature can be configured after the rest is already live. */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET; // must be stable across instances — see note below
const oauthClient = (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) : null;

function requestOrigin(req) { return `${req.protocol}://${req.get('host')}`; }

/* ---- Telegram alerts: leads, previews, purchases. Best-effort — a failed
 * send never blocks the actual request, and it's a no-op if unconfigured. ---- */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function sendTelegramAlert(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (error) {
    console.error('Telegram alert failed:', error.message);
  }
}
// logs to the console as before, and also pushes a Telegram alert for
// genuine server-side failures (Blob/Razorpay/OAuth issues) — not used for
// routine 400s like bad input, only real bugs worth waking up for
async function alertError(label, error) {
  console.error(`${label}:`, error);
  await sendTelegramAlert(`🚨 <b>Error: ${escHtml(label)}</b>\n${escHtml(error?.message || String(error))}`);
}

// Lightweight signed session cookie (HMAC, like the Razorpay signature check
// below) instead of a session store — Vercel functions share no memory across
// invocations, so an in-memory session table would randomly log people out.
function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifySession(token) {
  if (!token || !SESSION_SECRET) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const found = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}
function requireAdmin(req, res, next) {
  const session = verifySession(getCookie(req, 'admin_session'));
  if (!session || !ADMIN_EMAILS.includes(session.email)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
    return res.redirect('/admin/login');
  }
  req.adminEmail = session.email;
  next();
}

const PRICES = { basic: 89900, cinematic: 149900 }; // paise
const TEMPLATE_META = {
  basic: {
    name: 'Royal Heritage',
    desc: 'Envelope opening · scratch-card save-the-date · maroon & gold classic',
    price: '₹899',
    features: ['Envelope Opening', 'Scratch-Card Reveal', 'Events & RSVP', 'Photo Gallery']
  },
  cinematic: {
    name: 'Midnight Cinema',
    desc: 'Dark luxury · pinned horizontal event scroll · glowing gold',
    price: '₹1,499',
    popular: true,
    features: ['Cinematic Reveal', 'Pinned Scroll Story', 'Glowing Gold FX', 'Events & RSVP', 'Photo Gallery', 'Dark Premium Theme']
  }
};

/* ---- Server-side field validation ----
 * The builder's maxlength/pattern attributes are a UX nicety only — a direct
 * API call bypasses them completely, so genuine limits have to live here too.
 * Kept a bit more generous than the client-side maxlength values to avoid
 * rejecting anything the UI itself would have allowed through. */
const phoneLooksValid = v => {
  if (!v) return true; // optional field
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
};
function validateInviteData(data) {
  if (!data || typeof data !== 'object') return 'Invalid data';
  const tooLong = (val, max, label) =>
    (typeof val === 'string' && val.length > max) ? `${label} is too long (max ${max} characters)` : null;

  const simpleLimits = {
    groom: 60, bride: 60, venueName: 100, city: 60, hashtag: 50, groomFamily: 50, brideFamily: 50,
    howWeMet: 100, perfectMorning: 100, description: 1000, customHashtag: 50, rsvpMessage: 300
  };
  for (const [key, max] of Object.entries(simpleLimits)) {
    const err = tooLong(data[key], max, key);
    if (err) return err;
  }

  if (!phoneLooksValid(data.whatsapp)) return 'WhatsApp number looks invalid';
  if (!phoneLooksValid(data.rsvpWhatsapp)) return 'RSVP WhatsApp number looks invalid';

  for (const side of ['groomParents', 'brideParents']) {
    if (!data[side]) continue;
    const err = tooLong(data[side].father, 60, `${side}.father`) || tooLong(data[side].mother, 60, `${side}.mother`);
    if (err) return err;
  }

  if (data.events) {
    for (const [key, ev] of Object.entries(data.events)) {
      if (!ev) continue;
      const err = tooLong(ev.name, 60, `${key}.name`) || tooLong(ev.venue, 100, `${key}.venue`) || tooLong(ev.desc, 200, `${key}.desc`);
      if (err) return err;
    }
  }
  if (Array.isArray(data.customEvents)) {
    if (data.customEvents.length > 10) return 'Too many custom events';
    for (const ev of data.customEvents) {
      const err = tooLong(ev?.name, 60, 'customEvent.name') || tooLong(ev?.venue, 100, 'customEvent.venue') || tooLong(ev?.desc, 200, 'customEvent.desc');
      if (err) return err;
    }
  }
  if (data.infoCards) {
    for (const key of ['address', 'parking', 'stayInfo']) {
      const err = tooLong(data.infoCards[key]?.value, 500, `infoCards.${key}`);
      if (err) return err;
    }
    const err = tooLong(data.infoCards.registry?.value, 300, 'infoCards.registry');
    if (err) return err;
  }
  return null;
}

/* in-memory drafts + orders — short-lived by design (drafts GC after 2h, orders
 * live only between create-order and verify-payment), but still not immune to
 * the cross-instance issue above. Low-traffic risk for now; move to a real
 * store (Vercel KV/Postgres) if that ever becomes a problem in practice. */
const drafts = new Map();
const orders = new Map();

const musicUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4.5 * 1024 * 1024 } });

app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/templates', (req, res) => {
  res.json(Object.entries(TEMPLATE_META).map(([id, m]) => ({ id, ...m, amount: PRICES[id] })));
});

/* demo with untouched dummy data */
app.get('/demo/:template', (req, res) => {
  try { res.send(render(req.params.template, {})); }
  catch (e) { res.status(404).send('Template not found'); }
});

/* upload a music file directly — kept out of the main JSON payload so it isn't
 * sharing Vercel's ~4.5MB request-body cap with photos and everything else */
app.post('/api/upload-music', (req, res) => {
  musicUpload.single('music')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large — max 4.5MB' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.mimetype.startsWith('audio/')) return res.status(400).json({ error: 'Must be an audio file' });
    try {
      const blob = await put(`music/${nanoid(10)}-${req.file.originalname}`, req.file.buffer, {
        access: 'public', contentType: req.file.mimetype
      });
      res.json({ url: blob.url });
    } catch (e) {
      await alertError('Music upload failed', e);
      res.status(502).json({ error: 'Upload failed — try again' });
    }
  });
});

/* capture a phone number before purchase, so a stalled/abandoned draft can
 * still be followed up on — fired from the builder's WhatsApp field on blur */
app.post('/api/lead', async (req, res) => {
  try {
    const { phone, groom, bride, template } = req.body || {};
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10) return res.status(400).json({ error: 'Invalid phone number' });
    const id = nanoid(10);
    await put(`leads/${id}.json`, JSON.stringify({
      id, phone: cleanPhone, groom: groom || '', bride: bride || '', template: template || '', ts: Date.now()
    }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    await sendTelegramAlert(
      `📞 <b>New Lead</b>\n` +
      `Couple: ${escHtml(groom) || '—'} &amp; ${escHtml(bride) || '—'}\n` +
      `Phone: <a href="https://wa.me/${cleanPhone}">${cleanPhone}</a>\n` +
      `Template: ${escHtml(TEMPLATE_META[template]?.name || template || '—')}`
    );
    res.json({ success: true });
  } catch (error) {
    await alertError('Lead capture failed', error);
    res.status(500).json({ error: 'Could not save' });
  }
});

/* ---- Admin: Google Sign-In + dashboard (leads, drafts, purchases) ---- */

app.get('/admin/login', (req, res) => {
  if (!oauthClient) return res.status(503).send('Admin login isn\'t configured yet — set GOOGLE_CLIENT_ID/SECRET.');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Admin Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body{font-family:system-ui,sans-serif;background:#faf6ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{text-align:center;background:#fff;padding:44px 36px;border-radius:16px;box-shadow:0 8px 32px rgba(74,15,31,.12)}
    h1{color:#6d1a2e;font-size:20px;margin:0 0 24px}
    a{display:inline-flex;align-items:center;gap:10px;background:#6d1a2e;color:#f6ecd8;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:600}
    a:hover{background:#4a0f1f}</style></head>
    <body><div class="box"><h1>Wedding Site Admin</h1><a href="/admin/auth/start">Sign in with Google →</a></div></body></html>`);
});

app.get('/admin/auth/start', (req, res) => {
  if (!oauthClient) return res.status(503).send('Admin login isn\'t configured yet.');
  const url = oauthClient.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    redirect_uri: `${requestOrigin(req)}/admin/auth/callback`,
    prompt: 'select_account'
  });
  res.redirect(url);
});

app.get('/admin/auth/callback', async (req, res) => {
  if (!oauthClient) return res.status(503).send('Admin login isn\'t configured yet.');
  try {
    const { code } = req.query;
    const redirect_uri = `${requestOrigin(req)}/admin/auth/callback`;
    const { tokens } = await oauthClient.getToken({ code, redirect_uri });
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = (payload.email || '').toLowerCase();
    if (!payload.email_verified || !ADMIN_EMAILS.includes(email)) {
      return res.status(403).send('Access denied — this Google account is not authorized for admin access.');
    }
    if (!SESSION_SECRET) return res.status(503).send('Admin login isn\'t fully configured yet — missing SESSION_SECRET.');
    const session = signSession({ email, exp: Date.now() + 7 * 24 * 3600 * 1000 });
    res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(session)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`);
    res.redirect('/admin');
  } catch (error) {
    await alertError('Admin OAuth callback failed', error);
    res.status(500).send('Login failed — try again.');
  }
});

app.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
  // served from views/, not public/ — public/ is statically served and would
  // otherwise let anyone fetch the dashboard shell (not the data) unauthenticated
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/api/admin/data', requireAdmin, async (req, res) => {
  try {
    const [leadsList, invitesList] = await Promise.all([
      list({ prefix: 'leads/' }),
      list({ prefix: 'invites/' })
    ]);
    const fetchAll = blobs => Promise.all(blobs.map(b => fetch(b.url).then(r => r.json()).catch(() => null)));
    const [leads, invites] = await Promise.all([fetchAll(leadsList.blobs), fetchAll(invitesList.blobs)]);
    const draftsArr = [...drafts.entries()].map(([token, d]) => ({
      token, template: d.template, groom: d.data?.groom || '', bride: d.data?.bride || '',
      phone: d.data?.whatsapp || '', ts: d.ts
    }));
    res.json({
      leads: leads.filter(Boolean).sort((a, b) => b.ts - a.ts),
      invites: invites.filter(Boolean).sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)),
      drafts: draftsArr.sort((a, b) => b.ts - a.ts)
    });
  } catch (error) {
    await alertError('Admin data load failed', error);
    res.status(500).json({ error: 'Failed to load admin data' });
  }
});

async function deleteBlobByPrefix(prefix) {
  const { blobs } = await list({ prefix, limit: 1 });
  if (blobs.length) await del(blobs[0].url);
  return blobs.length > 0;
}

app.delete('/api/admin/lead/:id', requireAdmin, async (req, res) => {
  try {
    const found = await deleteBlobByPrefix(`leads/${req.params.id}.json`);
    res.json({ success: true, found });
  } catch (error) {
    await alertError('Admin lead delete failed', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.delete('/api/admin/invite/:id', requireAdmin, async (req, res) => {
  try {
    const found = await deleteBlobByPrefix(`invites/${req.params.id}.json`);
    res.json({ success: true, found });
  } catch (error) {
    await alertError('Admin invite delete failed', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.delete('/api/admin/draft/:token', requireAdmin, (req, res) => {
  res.json({ success: true, found: drafts.delete(req.params.token) });
});

const PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 minutes

/* save draft -> preview token */
app.post('/api/preview', async (req, res) => {
  try {
    const { template, data } = req.body || {};
    if (!TEMPLATE_META[template]) return res.status(400).json({ error: 'invalid template' });
    const validationError = validateInviteData(data);
    if (validationError) return res.status(400).json({ error: validationError });
    const token = nanoid(12);
    const media = await saveMedia('draft-' + token, data);
    drafts.set(token, { template, data, media, ts: Date.now() });
    // GC old drafts (>2h)
    for (const [k, v] of drafts) if (Date.now() - v.ts > PREVIEW_TTL_MS) drafts.delete(k);
    await sendTelegramAlert(
      `👀 <b>Preview Generated</b>\n` +
      `Couple: ${escHtml(data?.groom) || '—'} &amp; ${escHtml(data?.bride) || '—'}\n` +
      `Template: ${escHtml(TEMPLATE_META[template]?.name || template)}`
    );
    res.json({ token });
  } catch (error) {
    await alertError('Preview save failed', error);
    res.status(502).json({ error: 'Could not save preview', detail: error.message });
  }
});

function formatRemaining(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60000)); // never show 0m — floor at 1
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Wraps the rendered template with a notice at the top and bottom of the page
// making clear this is an unpurchased draft, not a live invite — inserted
// server-side (not baked into the templates) so it only ever shows up here,
// never on a paid /invite/:id page.
function withPreviewNotice(html, template, remainingText) {
  const notice = `
    <div style="position:relative;z-index:1000;background:#1a1006;color:#f6ecd8;font-family:system-ui,-apple-system,sans-serif;padding:12px 16px;text-align:center;font-size:13.5px;line-height:1.6;border-bottom:2px solid #c9a24b">
      ⏳ <strong>This is a PREVIEW</strong> — temporary and not visible to your guests. Valid for <strong>${escHtml(remainingText)}</strong>.
      <a href="/builder.html?template=${escHtml(template)}" style="color:#e8d7a8;font-weight:700;text-decoration:underline;margin-left:6px;white-space:nowrap">Purchase now to make it permanent →</a>
    </div>`;
  return html
    .replace(/<body([^>]*)>/i, `<body$1>${notice}`)
    .replace(/<\/body>/i, `${notice}</body>`);
}

function expiredPreviewPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview Expired — Shubh Vivah</title>
    <style>body{font-family:system-ui,-apple-system,sans-serif;background:#faf6ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
    .box{max-width:420px}
    h1{color:#6d1a2e;font-size:22px;margin:0 0 12px}
    p{color:#7a6650;font-size:16px;line-height:1.6;margin:0 0 26px}
    a{display:inline-block;background:#6d1a2e;color:#f6ecd8;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600}</style>
    </head><body><div class="box">
    <h1>⏳ This Page Has Expired</h1>
    <p>This page is expired as it was only a temporary trial preview — it was never purchased, so it wasn't saved permanently. Create a new invitation to preview again, or purchase one to get a permanent, shareable link.</p>
    <a href="/">Start a New Invitation</a>
    </div></body></html>`;
}

app.get('/preview/:token', (req, res) => {
  const d = drafts.get(req.params.token);
  if (!d) return res.status(404).send(expiredPreviewPage());
  const remaining = PREVIEW_TTL_MS - (Date.now() - d.ts);
  if (remaining <= 0) { drafts.delete(req.params.token); return res.status(404).send(expiredPreviewPage()); }
  const html = render(d.template, d.data, { photoUrls: d.media?.photoUrls || [], musicUrl: d.media?.musicUrl || null });
  res.send(withPreviewNotice(html, d.template, formatRemaining(remaining)));
});

/* ---- Razorpay Payment Integration ---- */

/**
 * POST /api/create-order
 * Creates a Razorpay order via SDK
 * Body: { template, data, customer }
 * Returns: { orderId, amount, currency, keyId }
 */
app.post('/api/create-order', async (req, res) => {
  try {
    const { template, data, customer } = req.body || {};
    if (!TEMPLATE_META[template]) {
      return res.status(400).json({ error: 'Invalid template' });
    }
    const validationError = validateInviteData(data);
    if (validationError) return res.status(400).json({ error: validationError });

    const amount = PRICES[template]; // already in paise
    if (amount < 100) {
      return res.status(400).json({ error: 'Amount must be at least 100 paise' });
    }

    const internalId = nanoid(10);
    const orderParams = {
      amount,
      currency: 'INR',
      receipt: internalId,
      notes: { template, customer_name: customer?.name || 'Guest' }
    };

    // Create order via Razorpay SDK
    const order = await rzp.orders.create(orderParams);

    if (!order || !order.id) {
      return res.status(502).json({ error: 'Failed to create Razorpay order' });
    }

    // Save media (photos/music) now; store URLs with the order
    const media = await saveMedia(internalId, data);

    // Store order details in memory for verification
    orders.set(internalId, {
      template,
      data,
      media,
      customer,
      amount,
      paid: false,
      razorpayOrderId: order.id,
      ts: Date.now()
    });

    res.json({
      success: true,
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: RZP_KEY,
      internalId
    });
  } catch (error) {
    await alertError('Order creation failed', error);
    res.status(502).json({ error: 'Failed to create order', detail: error.message });
  }
});

/**
 * POST /api/verify-payment
 * Verifies Razorpay payment signature and publishes invitation
 * Body: { internalId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Returns: { inviteId, url } on success
 */
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { internalId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    // Validate required fields
    if (!internalId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required payment fields' });
    }

    // Retrieve stored order
    const orderRec = orders.get(internalId);
    if (!orderRec) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Already published
    if (orderRec.paid) {
      return res.json({ inviteId: orderRec.inviteId, url: `/invite/${orderRec.inviteId}` });
    }

    // Verify order ID matches
    if (razorpay_order_id !== orderRec.razorpayOrderId) {
      return res.status(400).json({ error: 'Order ID mismatch' });
    }

    // ===== CRITICAL: Server-side HMAC-SHA256 signature verification =====
    // This is the only place where KEY_SECRET is used (never goes to frontend)
    const generatedSignature = crypto
      .createHmac('sha256', RZP_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      console.warn(`Signature mismatch for order ${razorpay_order_id}`);
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // Signature valid — mark as paid and publish
    orderRec.paid = true;
    orderRec.razorpayPaymentId = razorpay_payment_id;
    const inviteId = await publishInvitation(orderRec);
    orderRec.inviteId = inviteId;

    await sendTelegramAlert(
      `🎉 <b>New Purchase!</b>\n` +
      `Couple: ${escHtml(orderRec.data?.groom) || '—'} &amp; ${escHtml(orderRec.data?.bride) || '—'}\n` +
      `Template: ${escHtml(TEMPLATE_META[orderRec.template]?.name || orderRec.template)}\n` +
      `Amount: ₹${(orderRec.amount / 100).toLocaleString('en-IN')}\n` +
      `Invite: ${requestOrigin(req)}/invite/${inviteId}\n` +
      `Payment ID: ${escHtml(razorpay_payment_id)}`
    );

    res.json({
      success: true,
      inviteId,
      url: `/invite/${inviteId}`
    });
  } catch (error) {
    await alertError('Payment verification failed', error);
    res.status(500).json({ error: 'Verification failed', detail: error.message });
  }
});

/**
 * Helper: Publish invitation as a permanent Blob record
 */
async function publishInvitation(rec) {
  const id = nanoid(8);
  const record = {
    id,
    template: rec.template,
    data: rec.data,
    media: rec.media || { photoUrls: [], musicUrl: null },
    customer: rec.customer || null,
    amount: rec.amount,
    razorpayOrderId: rec.razorpayOrderId,
    razorpayPaymentId: rec.razorpayPaymentId,
    paidAt: new Date().toISOString()
  };
  await put(`invites/${id}.json`, JSON.stringify(record), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false
  });
  return id;
}

/* final invitation */
app.get('/invite/:id', async (req, res) => {
  const id = req.params.id.replace(/[^A-Za-z0-9_-]/g, '');
  try {
    const { blobs } = await list({ prefix: `invites/${id}.json`, limit: 1 });
    if (!blobs.length) return res.status(404).send('Invitation not found');
    const rec = await fetch(blobs[0].url).then(r => r.json());
    res.send(render(rec.template, rec.data, { photoUrls: rec.media?.photoUrls || [], musicUrl: rec.media?.musicUrl || null }));
  } catch (error) {
    await alertError('Invite load failed', error);
    res.status(500).send('Something went wrong loading this invitation.');
  }
});

// Safety net for anything that throws without being caught above (e.g. a bug
// in a route that skipped its own try/catch) — must be registered last.
app.use((err, req, res, next) => {
  alertError(`Unhandled error on ${req.method} ${req.path}`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Vercel's @vercel/node runtime imports this file and calls the exported
// app directly as the request handler — it must not bind a port itself.
// Only listen when run directly (local dev / traditional hosting).
if (require.main === module) {
  app.listen(PORT, () => {
    const mode = process.env.NODE_ENV === 'test' ? 'TEST (Razorpay Sandbox)' : 'LIVE (Production)';
    console.log(`\n✨ Wedding Invitation Builder running\n`);
    console.log(`   URL: http://localhost:${PORT}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Key: ${RZP_KEY.substring(0, 20)}...`);
    console.log(`\n   Test card: 4111 1111 1111 1111 | Expiry: 12/25 | CVV: 123\n`);
  });
}

module.exports = app;
