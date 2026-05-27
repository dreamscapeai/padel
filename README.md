# VirtualFit — AI Virtual Try-On Chrome Extension

Browse any clothing website, select an item, and virtually try it on using AI. Powered by [Wavespeed AI](https://wavespeed.ai).

## ✨ Features

- **Smart image detection** — Hover over any image on any website to reveal a select button
- **One-click clothing selection** — Click the ◯ overlay to pick a clothing item as source
- **Personal reference photos** — Upload up to 5 photos of yourself (drag & drop supported)
- **3 AI models** to choose from:
  - **Wavespeed Try-On** — Best full-outfit accuracy (`wavespeed-ai/ai-clothes-changer`)
  - **GPT Image Edit** — Great for style & texture transfer (`openai/gpt-image-2/edit`)
  - **Nano Banana** — Fastest, Google's latest model (`google/nano-banana-2/edit`)
- **Animated loading** with cycling messages and progress bar
- **History** — All past try-ons stored on your server with image previews
- **Dark glassmorphism UI** with purple accents

---

## 📁 Project Structure

```
chrome-extension/     ← Load this folder in Chrome as an unpacked extension
  manifest.json
  background.js       Service worker (state management)
  content.js          Image overlay injection
  content.css
  popup.html          420px popup UI
  popup.js
  popup.css
  icons/

server/               ← Node.js Express backend — deploy to Render
  index.js
  package.json
  render.yaml         Render deployment config
  .env.example
```

---

## 🚀 Setup

### 1. Deploy the Backend (Render)

1. Fork or push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your repo — Render auto-detects `render.yaml`
4. In the Render dashboard, set these **Environment Variables**:
   - `WAVESPEED_API_KEY` — your key from [wavespeed.ai/accesskey](https://wavespeed.ai/accesskey)
   - `SERVER_URL` — the Render URL you're assigned (e.g. `https://virtual-tryon-api.onrender.com`)
5. Deploy → wait for the health check to go green

> **Persistent history**: Add a [Render Disk](https://render.com/docs/disks) (`/opt/render/project/src/uploads`, 1 GB) on the Starter plan to keep results across deploys. The free tier works but resets on redeploy.

### 2. Load the Chrome Extension

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. The VirtualFit ✨ icon appears in your toolbar

### 3. Configure the Extension

1. Click the extension icon → go to **⚙ Settings**
2. Enter your Render backend URL and click **Save Settings**
3. The extension will verify the connection

### 4. Use It!

1. Browse any clothing website (Zara, H&M, ASOS, Uniqlo…)
2. Hover over product images — a ◯ button appears
3. Click the ◯ on the clothing you want to try
4. Open the extension popup → you'll see the selected item
5. Upload your photo(s) in **Your Photos**
6. Choose an AI model and hit **Try It On ✨**
7. Watch the animated loading, then see your result!
8. Check **History** to revisit past try-ons

---

## 🔧 Local Development

```bash
# Start the server locally
cd server
cp .env.example .env
# Edit .env and add your WAVESPEED_API_KEY + set SERVER_URL=http://localhost:3000
npm install
npm run dev

# Load extension in Chrome:
# chrome://extensions → Load unpacked → select chrome-extension/
# In extension Settings tab, enter: http://localhost:3000
```

---

## 🤖 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Server health check |
| `/api/tryon` | POST | Start a try-on (multipart) |
| `/api/tryon/status/:taskId` | GET | Poll try-on status |
| `/api/history` | GET | List completed try-ons |
| `/api/history/:id` | DELETE | Delete a history item |

### POST `/api/tryon` fields

| Field | Type | Description |
|---|---|---|
| `clothing_image_url` | string | URL of the clothing image from the website |
| `reference_images` | file[] | Your photos (1–5, max 10 MB each) |
| `model` | string | `wavespeed` \| `gpt-image` \| `nano-banana` |

---

## 📝 License

MIT
