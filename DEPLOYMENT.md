# 🚀 Deployment Guide

## Vercel (Recommended - Free)

### Step 1: GitHub Setup
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/wedding-builder.git
git branch -M main
git push -u origin main
```

### Step 2: Vercel Connection
1. Go to **vercel.com**
2. Click **"New Project"**
3. Import your GitHub repo
4. Select **Node.js** as framework
5. Keep defaults for Build & Output settings
6. Add Environment Variables:

| Key | Value |
|-----|-------|
| RAZORPAY_KEY_ID | `rzp_test_THl1DST02z5WOV` |
| RAZORPAY_KEY_SECRET | `6RKaEwYoV3WDAMuvHe66yVVz` |
| NODE_ENV | `test` |

7. Click **"Deploy"** → Wait 2-3 minutes

Your site will be live at: `https://your-project.vercel.app`

### Step 3: Test on Phone
- Open the Vercel URL on your phone/tablet
- Test form submission
- Try Razorpay payment (use test card above)

---

## Important Notes

### Media Storage (Photos/Music)
- **Local (localhost)**: Stored in `data/media/` folder ✓
- **Vercel**: Uses in-memory storage (clears on redeploy)
  - Photos show in preview but disappear after redeploy
  - **Solution for production**: Use Vercel Blob Storage or AWS S3

### For Production (Optional)
If you need persistent media storage on Vercel:

1. **Vercel Blob** (easiest):
```bash
npm install @vercel/blob
```
Update `server.js` to use `@vercel/blob` instead of filesystem.

2. **AWS S3**:
```bash
npm install aws-sdk
```

---

## Live Testing Checklist

- [ ] Form loads on phone
- [ ] All fields work (text, date, time, file upload)
- [ ] Preview button works
- [ ] Photos appear in preview
- [ ] Music plays
- [ ] Couple names show correctly
- [ ] Event dates sync
- [ ] Countdown shows
- [ ] Payment button works
- [ ] Razorpay modal opens
- [ ] After payment, invite loads
- [ ] Invite looks good on mobile

---

## Troubleshooting

### "Cannot find module"
→ Run `npm install` on Vercel (auto, but check logs)

### Photos not showing
→ Check Vercel logs: `vercel logs <url>`

### Razorpay error
→ Verify KEY_ID and KEY_SECRET in Vercel Environment Variables

### Timeout errors
→ Increase function timeout in `vercel.json`:
```json
{
  "functions": {
    "server.js": {
      "maxDuration": 30
    }
  }
}
```

---

## Update After Changes

```bash
git add .
git commit -m "Update description"
git push origin main
# Vercel auto-deploys!
```

---

**Questions?** Check Vercel docs: vercel.com/docs
