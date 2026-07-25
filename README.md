# 💍 Wedding Invitation Builder

Full-stack wedding invitation platform with two premium templates (Royal Heritage & Midnight Cinema), Razorpay payment integration, and dynamic content rendering.

## Features

✅ **Two Beautiful Templates**
- **Basic (Royal Heritage)**: Maroon/Gold, envelope animation, scratch-card save-the-date
- **Cinematic (Midnight Cinema)**: Dark luxe, horizontal event scroll, GSAP animations

✅ **Dynamic Content**
- Couple names, dates, venues, families
- 4 core events (Haldi, Mehendi, Sangeet, Wedding) + unlimited custom events
- Story section, photo gallery, custom music
- Info cards (address, parking, registry, stay)
- WhatsApp RSVP integration

✅ **Payment Integration**
- Razorpay SDK (test & production)
- Real-time order creation & verification
- HMAC-SHA256 signature validation

✅ **Mobile-First**
- Responsive builder form (6 steps)
- Touch-friendly preview
- Works on all devices

## Setup

### Local Development

```bash
git clone <your-repo>
cd wedding-builder
npm install

# Create .env file
cp .env.example .env
# Edit .env with your Razorpay credentials

npm start
# Open http://localhost:3000
```

### Vercel Deployment

1. Push to GitHub
2. Go to vercel.com → Import Project → Select your repo
3. Framework: Node.js
4. Build Command: (leave empty)
5. Environment Variables:
   - `RAZORPAY_KEY_ID`: Your test/prod key
   - `RAZORPAY_KEY_SECRET`: Your test/prod secret
   - `NODE_ENV`: test or production

6. Deploy!

## Test Card

**Razorpay Test Mode:**
- Card: 4111 1111 1111 1111
- Expiry: 12/25
- CVV: 123

## Folder Structure

```
wedding-builder/
├── server.js              # Express server
├── lib/render.js          # Template rendering engine
├── public/
│   ├── index.html        # Gallery page
│   └── builder.html      # Form wizard
├── templates/
│   ├── basic.html        # Royal Heritage template
│   └── cinematic.html    # Midnight Cinema template
├── assets/
│   ├── images/           # Event images
│   └── sounds/           # Popper sound
├── data/
│   ├── media/            # Uploaded photos/music
│   └── invites/          # Published invitations
└── vercel.json           # Vercel config
```

## Environment Variables

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
NODE_ENV=test
PORT=3000
```

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | Gallery page |
| GET | `/demo/:template` | Template preview |
| POST | `/api/preview` | Save draft → token |
| GET | `/preview/:token` | Render draft |
| POST | `/api/create-order` | Create Razorpay order |
| POST | `/api/verify-payment` | Verify & publish |
| GET | `/invite/:id` | View published invite |

## Customization

- Edit templates in `templates/basic.html` and `templates/cinematic.html`
- Update rendering logic in `lib/render.js`
- Modify form fields in `public/builder.html`
- Adjust pricing in `server.js` (PRICES object)

## License

MIT

---

**Made with ❤️ for weddings**
