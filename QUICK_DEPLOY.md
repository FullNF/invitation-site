# ⚡ Quick Deploy to Vercel (5 minutes)

## Prerequisites
- GitHub account
- Vercel account (free, vercel.com)

## Steps

### 1️⃣ Push to GitHub
```bash
# In your project folder
git init
git add .
git commit -m "Wedding Invitation Builder"
git remote add origin https://github.com/YOUR_USERNAME/wedding-builder.git
git branch -M main
git push -u origin main
```

### 2️⃣ Connect to Vercel
- Go to **vercel.com**
- Click **Import Project**
- Paste your GitHub repo URL
- Click **Import**

### 3️⃣ Add Environment Variables
In Vercel dashboard → Project Settings → Environment Variables

Add these:
```
RAZORPAY_KEY_ID=rzp_test_THl1DST02z5WOV
RAZORPAY_KEY_SECRET=6RKaEwYoV3WDAMuvHe66yVVz
NODE_ENV=test
```

### 4️⃣ Deploy
- Vercel auto-deploys
- Wait 2-3 minutes
- Your URL: `https://wedding-builder-xxxxx.vercel.app`

### 5️⃣ Test on Phone
- Open URL on mobile
- Fill form
- Try payment with card: `4111 1111 1111 1111` (expiry: 12/25, CVV: 123)

---

**That's it! 🎉**

For more details, see DEPLOYMENT.md
