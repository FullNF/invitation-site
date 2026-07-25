# Razorpay Integration — Wedding Invitation Builder

## ✅ Integration Status
- ✅ Backend: Razorpay SDK (`razorpay` npm package)
- ✅ Frontend: Razorpay Checkout.js modal
- ✅ Payment Flow: Order creation → Modal → Signature verification → Publish
- ✅ Environment: .env with test credentials

## 📋 Files Modified/Created

### Created
- `.env` — Test credentials (NEVER commit this)
- `.gitignore` — Excludes .env, node_modules, etc.
- `RAZORPAY_INTEGRATION.md` — This file

### Modified
- `server.js` — Added /api/create-order and /api/verify-payment endpoints
- `public/builder.html` — Updated payment flow with Razorpay modal
- `package.json` — Added start script, updated dependencies

## 🔐 Security Implementation

### Backend (server.js)
1. **Order Creation** (`POST /api/create-order`)
   - Razorpay SDK creates order with amount validation
   - Returns: `orderId`, `keyId` (public), `internalId` (for tracking)
   - Backend stores order details in-memory

2. **Payment Verification** (`POST /api/verify-payment`)
   - Frontend sends: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`
   - **CRITICAL**: Server verifies HMAC-SHA256 signature using KEY_SECRET
   - Only backend knows KEY_SECRET — frontend never has access
   - If signature matches: publish invitation; if not: reject

### Frontend (builder.html)
- Never exposes KEY_SECRET anywhere
- Uses only PUBLIC key (RAZORPAY_KEY_ID)
- Razorpay modal handles all payment UI/UX
- On payment success, frontend sends signature to backend for verification

## 🧪 Testing

### 1. Start Server
```powershell
# Windows PowerShell
$env:NODE_ENV="test"
npm start
```

```bash
# Mac/Linux
export NODE_ENV=test
npm start
```

Server output:
```
✨ Wedding Invitation Builder running

   URL: http://localhost:3000
   Mode: TEST (Razorpay Sandbox)
   Key: rzp_test_THUIoPoGqV4nAG...

   Test card: 4111 1111 1111 1111 | Expiry: 12/25 | CVV: 123
```

### 2. Test Full Flow

1. Open `http://localhost:3000` in browser
2. Click **Customise** on any template
3. Fill all 5 steps:
   - Step 1: Couple names (required)
   - Step 2: Family info (optional)
   - Step 3: Events (toggle on/off)
   - Step 4: Venue + Contacts
   - Step 5: Review & Pay
4. Click **PAY & PUBLISH MY INVITATION 💍**
5. Razorpay modal opens → Fill test details:
   - **Card**: 4111 1111 1111 1111
   - **Expiry**: 12/25
   - **CVV**: 123
   - **Name**: Any name
   - Click **Pay**
6. Backend verifies signature automatically
7. If signature matches: ✅ Invitation published with unique URL
8. Copy URL and share on WhatsApp

### 3. Check Published Invitation
Published invitations stored in `data/invites/` as JSON files:
```bash
# Windows PowerShell
Get-ChildItem data/invites/

# Mac/Linux
ls data/invites/
```

Each file contains: couple data, template used, payment ID, timestamp.

## 💳 Test Card Details

| Field | Value |
|-------|-------|
| Card Number | 4111 1111 1111 1111 |
| Expiry | 12/25 (any future month/year) |
| CVV | 123 (any 3-4 digits) |
| Name | Any name |

**This card always succeeds.** Other test scenarios:
- `5555 5555 5555 4444` — MasterCard (also succeeds)
- OTP: `123456` (if prompted)

## 🚀 Going Live

When ready for production:

### 1. Upgrade .env
```env
PORT=3000
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXX
NODE_ENV=production
```

### 2. Verify Razorpay Live Keys
- Log into Razorpay Dashboard
- Settings → API Keys → Copy live keys
- Paste into `.env` (never in code)

### 3. Update billing, GST (if applicable)
- Razorpay Dashboard → Account → Activate
- Add business details, bank account, KYC docs

### 4. Test with Razorpay Live Cards
- Razorpay provides test cards for live mode
- Do NOT use real customer cards to test

### 5. Deploy
```powershell
# Set env vars in deployment platform (Vercel, Heroku, etc.)
RAZORPAY_KEY_ID = rzp_live_...
RAZORPAY_KEY_SECRET = rzp_live_...
NODE_ENV = production
```

## 📊 API Endpoints Reference

### POST /api/create-order
**Request:**
```json
{
  "template": "basic",
  "data": { "groom": "Aarav", "bride": "Ishita", ... },
  "customer": { "name": "Aarav & Ishita" }
}
```

**Response (Success):**
```json
{
  "success": true,
  "orderId": "order_2LiYvxR...",
  "amount": 149900,
  "currency": "INR",
  "keyId": "rzp_test_THUIoPoGqV4nAG",
  "internalId": "abc123xyz"
}
```

**Response (Error):**
```json
{
  "error": "Invalid template"
}
```

### POST /api/verify-payment
**Request:**
```json
{
  "internalId": "abc123xyz",
  "razorpay_order_id": "order_2LiYvxR...",
  "razorpay_payment_id": "pay_2LiYvxR...",
  "razorpay_signature": "9ef4dffb...(256 chars)"
}
```

**Response (Success):**
```json
{
  "success": true,
  "inviteId": "K7BMZk9K",
  "url": "/invite/K7BMZk9K"
}
```

**Response (Verification Failed):**
```json
{
  "error": "Payment verification failed — signature mismatch"
}
```

## 🔍 Debugging

### Enable detailed logs
Modify `server.js` to add console.log:
```javascript
console.log('Order creation:', orderData);
console.log('Signature verification:', { generated, received });
```

### Check stored orders
```javascript
// In Node.js console:
console.log(orders);  // In-memory order tracking
```

### Razorpay Dashboard
- Log in to https://dashboard.razorpay.com
- Payments → Recent Transactions
- Click any transaction to see full details
- Orders → View all orders with timestamps

## ⚠️ Important Notes

1. **Never commit .env** — It's in .gitignore automatically
2. **KEY_SECRET never leaves server** — Only used for signature verification
3. **Order IDs are unique** — Razorpay auto-generates them
4. **Invitations are permanent** — Once published, always accessible at `/invite/:id`
5. **Test mode vs Live** — Switching between is just .env change; code stays same
6. **In-memory orders** — They persist only while server is running; use database for production

## 📞 Support

**Razorpay Docs:** https://razorpay.com/docs/payments/
**Razorpay Test Cards:** https://razorpay.com/docs/payments/payment-gateway/test-card-details/
**Razorpay Dashboard:** https://dashboard.razorpay.com

---

**Last Updated:** July 25, 2026
**Integrated By:** Ayush Singh
