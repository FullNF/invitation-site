/* ShaadiPath-style Wedding Invitation Builder — server with Razorpay integration
 * Routes:
 *   GET  /                        -> template gallery
 *   GET  /builder?template=id     -> mobile-first wizard
 *   GET  /demo/:template          -> template demo with dummy data
 *   POST /api/preview             -> save draft, returns preview token
 *   GET  /preview/:token          -> render selected template with draft data
 *   POST /api/create-order        -> create Razorpay order via SDK
 *   POST /api/verify-payment      -> HMAC verify signature + publish invite
 *   GET  /invite/:id              -> final published invitation
 */
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');
const { render } = require('./lib/render');

const app = express();
app.use(express.json({ limit: '60mb' }));

/* ---- media handling: save base64 photos/music to files, return public URLs ----
 * Vercel's deployed filesystem is read-only outside /tmp, and /tmp is wiped
 * between cold starts — fine for a demo, but drafts/invites won't survive
 * long-term there. Use /tmp on Vercel, the local data/ dir otherwise. */
const DATA_ROOT = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA_ROOT, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function saveMedia(id, data) {
  // returns { photoUrls: [], musicUrl: null } and strips base64 from data
  const out = { photoUrls: [], musicUrl: null };
  const dir = path.join(MEDIA_DIR, id);
  const extFrom = (dataUrl, fallback) => {
    const m = /^data:([a-z]+)\/([a-z0-9.+-]+);base64,/i.exec(dataUrl || '');
    return m ? m[2].replace('mpeg','mp3').replace('jpeg','jpg') : fallback;
  };
  const writeDataUrl = (dataUrl, name) => {
    const b64 = dataUrl.split(',')[1];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
    return `/media/${id}/${name}`;
  };
  if (data && data.photos) {
    for (const k of Object.keys(data.photos)) {
      const p = data.photos[k];
      if (p && typeof p === 'string' && p.startsWith('data:image')) {
        out.photoUrls.push(writeDataUrl(p, `photo${k}.${extFrom(p,'jpg')}`));
      } else if (p && typeof p === 'string' && p.startsWith('/media/')) {
        out.photoUrls.push(p); // already saved
      }
    }
    data.photos = {}; // don't keep base64 in JSON records
  }
  if (data && data.musicFile && typeof data.musicFile === 'string' && data.musicFile.startsWith('data:audio')) {
    out.musicUrl = writeDataUrl(data.musicFile, `music.${extFrom(data.musicFile,'mp3')}`);
    data.musicFile = null;
  } else if (data && typeof data.musicFile === 'string' && data.musicFile.startsWith('/media/')) {
    out.musicUrl = data.musicFile;
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

const PRICES = { basic: 149900, cinematic: 249900 }; // paise
const TEMPLATE_META = {
  basic:     { name: 'Royal Heritage',   desc: 'Envelope opening · scratch-card save-the-date · maroon & gold classic', price: '₹1,499' },
  cinematic: { name: 'Midnight Cinema',  desc: 'Dark luxury · pinned horizontal event scroll · glowing gold', price: '₹2,499' }
};

const INVITES_DIR = path.join(DATA_ROOT, 'invites');
fs.mkdirSync(INVITES_DIR, { recursive: true });

/* in-memory drafts + orders (drafts persist client-side via localStorage too) */
const drafts = new Map();
const orders = new Map();

app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/templates', (req, res) => {
  res.json(Object.entries(TEMPLATE_META).map(([id, m]) => ({ id, ...m, amount: PRICES[id] })));
});

/* demo with untouched dummy data */
app.get('/demo/:template', (req, res) => {
  try { res.send(render(req.params.template, {})); }
  catch (e) { res.status(404).send('Template not found'); }
});

/* save draft -> preview token */
app.post('/api/preview', (req, res) => {
  const { template, data } = req.body || {};
  if (!TEMPLATE_META[template]) return res.status(400).json({ error: 'invalid template' });
  const token = nanoid(12);
  const media = saveMedia('draft-' + token, data);
  drafts.set(token, { template, data, media, ts: Date.now() });
  // GC old drafts (>2h)
  for (const [k, v] of drafts) if (Date.now() - v.ts > 72e5) drafts.delete(k);
  res.json({ token });
});

app.get('/preview/:token', (req, res) => {
  const d = drafts.get(req.params.token);
  if (!d) return res.status(404).send('Preview expired — go back and tap Preview again.');
  res.send(render(d.template, d.data, { photoUrls: d.media?.photoUrls || [], musicUrl: d.media?.musicUrl || null }));
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

    // Save media (photos/music) to disk now; store URLs with the order
    const media = saveMedia(internalId, data);

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
    console.error('Order creation error:', error);
    res.status(502).json({ error: 'Failed to create order', detail: error.message });
  }
});

/**
 * POST /api/verify-payment
 * Verifies Razorpay payment signature and publishes invitation
 * Body: { internalId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Returns: { inviteId, url } on success
 */
app.post('/api/verify-payment', (req, res) => {
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
    const inviteId = publishInvitation(orderRec);
    orderRec.inviteId = inviteId;

    res.json({
      success: true,
      inviteId,
      url: `/invite/${inviteId}`
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Verification failed', detail: error.message });
  }
});

/**
 * Helper: Publish invitation to permanent JSON file
 */
function publishInvitation(rec) {
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
  fs.writeFileSync(path.join(INVITES_DIR, id + '.json'), JSON.stringify(record, null, 2));
  return id;
}

/* final invitation */
app.get('/invite/:id', (req, res) => {
  const f = path.join(INVITES_DIR, req.params.id.replace(/[^A-Za-z0-9_-]/g, '') + '.json');
  if (!fs.existsSync(f)) return res.status(404).send('Invitation not found');
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  res.send(render(rec.template, rec.data, { photoUrls: rec.media?.photoUrls || [], musicUrl: rec.media?.musicUrl || null }));
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
