/* ShaadiPath-style Wedding Invitation Builder — server with Razorpay integration
 * Routes:
 *   GET  /                        -> template gallery
 *   GET  /builder?template=id     -> mobile-first wizard
 *   GET  /demo/:template          -> template demo with dummy data
 *   POST /api/upload-music        -> upload a music file directly, returns its URL
 *   POST /api/preview             -> save draft, returns preview token
 *   GET  /preview/:token          -> render selected template with draft data
 *   POST /api/create-order        -> create Razorpay order via SDK
 *   POST /api/verify-payment      -> HMAC verify signature + publish invite
 *   GET  /invite/:id              -> final published invitation
 */
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { put, list } = require('@vercel/blob');
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');
const { render } = require('./lib/render');

const app = express();
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
    } else if (/^https?:\/\//.test(data.musicFile)) {
      out.musicUrl = data.musicFile; // already uploaded via /api/upload-music
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

const PRICES = { basic: 149900, cinematic: 249900 }; // paise
const TEMPLATE_META = {
  basic:     { name: 'Royal Heritage',   desc: 'Envelope opening · scratch-card save-the-date · maroon & gold classic', price: '₹1,499' },
  cinematic: { name: 'Midnight Cinema',  desc: 'Dark luxury · pinned horizontal event scroll · glowing gold', price: '₹2,499' }
};

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
      console.error('Music upload error:', e);
      res.status(502).json({ error: 'Upload failed — try again' });
    }
  });
});

/* save draft -> preview token */
app.post('/api/preview', async (req, res) => {
  try {
    const { template, data } = req.body || {};
    if (!TEMPLATE_META[template]) return res.status(400).json({ error: 'invalid template' });
    const token = nanoid(12);
    const media = await saveMedia('draft-' + token, data);
    drafts.set(token, { template, data, media, ts: Date.now() });
    // GC old drafts (>2h)
    for (const [k, v] of drafts) if (Date.now() - v.ts > 72e5) drafts.delete(k);
    res.json({ token });
  } catch (error) {
    console.error('Preview save error:', error);
    res.status(502).json({ error: 'Could not save preview', detail: error.message });
  }
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
    console.error('Invite load error:', error);
    res.status(500).send('Something went wrong loading this invitation.');
  }
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
