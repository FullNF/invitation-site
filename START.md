# 🚀 Quick Start — Wedding Invitation Builder

## Prerequisites
- Node.js 16+ installed (check: `node -v`)
- .env file with Razorpay credentials (already created ✓)

## ▶️ Start Server

### Windows PowerShell
```powershell
npm start
```

### Mac/Linux Terminal
```bash
npm start
```

**Expected Output:**
```
✨ Wedding Invitation Builder running

   URL: http://localhost:3000
   Mode: TEST (Razorpay Sandbox)
   Key: rzp_test_THUIoPoGqV4nAG...

   Test card: 4111 1111 1111 1111 | Expiry: 12/25 | CVV: 123
```

## 📱 Open in Browser
```
http://localhost:3000
```

## 🎯 Test Complete Payment Flow

### Step 1: Browse Templates
- See "Royal Heritage" (₹1,499) and "Midnight Cinema" (₹2,499)
- Click "View Demo" to see template with dummy data
- Click "Customise →" to start building

### Step 2: Fill Form (5 Steps)

**Step 1 — THE COUPLE**
- Groom's Name: `Aarav`
- Bride's Name: `Ishita`
- Hashtag: (leave blank for auto-generation)
- ➜ NEXT

**Step 2 — FAMILY** (optional fields)
- Leave blank or fill in parent names
- ➜ NEXT

**Step 3 — EVENTS**
- Toggle which events to include
- Fill dates and times
- ➜ NEXT

**Step 4 — VENUE & CONTACT**
- Venue Name: `Rambagh Palace`
- Address: `Jaipur, Rajasthan`
- City: `Jaipur, India`
- Contact 1 Name: `Karan (Brother)`
- Contact 1 Phone: `9811112222`
- Contact 2 Name: `Neha (Sister)`
- Contact 2 Phone: `9833334444`
- ➜ NEXT

**Step 5 — REVIEW & PAY**
- Review all details
- Click **"PAY & PUBLISH MY INVITATION 💍"**

### Step 3: Complete Razorpay Payment
Razorpay modal opens automatically.

**Fill test card details:**
- **Card Number**: `4111 1111 1111 1111`
- **Expiry**: `12/25` (or any future date)
- **CVV**: `123` (or any 3 digits)
- **Name**: `Aarav Malhotra`
- **Email**: `test@example.com`
- **Phone**: `9811112222`

**Click**: `Pay Now` (or equivalent button)

### Step 4: Success 🎉
Backend verifies signature automatically:
- ✅ Signature matches → Invitation published
- ❌ Signature doesn't match → Error shown

**On Success:**
- Unique URL displayed: `http://localhost:3000/invite/ABC12XYZ`
- Copy link button
- Share on WhatsApp button
- "Open my invitation" link

### Step 5: View Final Invitation
Click the URL or "Open my invitation" to see:
- Your custom couple names
- Your family details
- Your events (only ones you enabled)
- Your venue info
- Your contact numbers
- All with original template animations intact

## 🧪 Additional Testing

### Test Invalid Payment
1. Try using wrong CVV or invalid card number
2. Modal shows error
3. Can retry or close modal

### Test Preview Before Payment
1. During form filling, click **"👁 PREVIEW"** button
2. Opens new tab with real template render
3. Go back and continue editing
4. Data is saved (refresh-proof)

### Test Multiple Invitations
1. Complete one full payment flow
2. Notice invitation ID in URL (e.g., `K7BMZk9K`)
3. Create another invitation with different couple name
4. Different ID created
5. Both URLs work independently

### Test Invitation Sharing
1. After publishing, click **"SHARE ON WHATSAPP"**
2. Opens WhatsApp (if installed) with invitation link
3. Guest clicks link, sees invitation in browser (mobile-friendly)

## 📁 Key Files

```
├── .env                          ← Razorpay credentials (SECRET, never commit)
├── .gitignore                    ← Excludes .env, node_modules
├── server.js                     ← Express backend + Razorpay endpoints
├── lib/render.js                 ← Template data injection engine
├── templates/
│   ├── basic.html               ← Template 1 (original, unchanged)
│   └── cinematic.html           ← Template 2 (original, unchanged)
├── public/
│   ├── index.html               ← Gallery homepage
│   └── builder.html             ← 5-step form wizard
├── data/
│   └── invites/                 ← Published invitations (JSON)
├── assets/
│   ├── images/                  ← Haldi, Mehendi, Sangeet, Wedding photos
│   └── sounds/                  ← Popper effect audio
└── RAZORPAY_INTEGRATION.md      ← Full technical documentation
```

## 🔒 Security Notes

✅ **Already Secured:**
- Razorpay KEY_SECRET never exposed in frontend
- Signature verification server-side only
- .env excluded from Git
- Environment-based configuration

⚠️ **Before Going Live:**
1. Upgrade .env to live keys (rzp_live_...)
2. Test with Razorpay live test cards
3. Deploy to production domain
4. Enable HTTPS
5. Add database for permanent order storage

## 🆘 Troubleshooting

### "Cannot find module 'razorpay'"
```powershell
npm install razorpay dotenv
npm start
```

### "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set"
- Make sure `.env` file exists in project root
- Contains both KEY_ID and KEY_SECRET
- Restart server with `npm start`

### "Port 3000 already in use"
```powershell
# Windows: Find and kill process
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux: 
lsof -i :3000
kill -9 <PID>

# Or use different port:
set PORT=3001
npm start
```

### Razorpay modal not opening
- Check browser console for errors (F12 → Console)
- Verify Razorpay checkout.js loaded (Network tab)
- Try incognito/private browser window

### Payment succeeds but invitation doesn't publish
- Check server logs (terminal where npm start runs)
- Verify `/api/verify-payment` response (DevTools → Network)
- Check `data/invites/` folder for JSON file

## 📞 Need Help?

1. **Check logs** → Terminal where server runs
2. **DevTools** → Browser F12 → Console & Network tabs
3. **Razorpay Dashboard** → See payment details
4. **RAZORPAY_INTEGRATION.md** → Full technical docs

---

**Ready to test?**
```powershell
npm start
```
Then open: **http://localhost:3000** 🎊
