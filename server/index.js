import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_BASE = 'https://api.wavespeed.ai/api/v3';

// ─── Directory Setup ─────────────────────────────────────────────────────────
const UPLOADS_DIR = join(__dirname, 'uploads');
const REFS_DIR = join(UPLOADS_DIR, 'refs');
const RESULTS_DIR = join(UPLOADS_DIR, 'results');
const HISTORY_FILE = join(__dirname, 'history.json');

[UPLOADS_DIR, REFS_DIR, RESULTS_DIR].forEach(d => mkdirSync(d, { recursive: true }));
if (!existsSync(HISTORY_FILE)) writeFileSync(HISTORY_FILE, '[]');

// ─── History Helpers ──────────────────────────────────────────────────────────
function readHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeHistory(data) {
  writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

// ─── Multer: Reference Photo Upload ──────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: REFS_DIR,
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve uploaded files (reference photos + results)
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Wavespeed Helpers ────────────────────────────────────────────────────────
async function wavespeedPost(endpoint, payload) {
  if (!WAVESPEED_API_KEY) throw new Error('WAVESPEED_API_KEY is not set');
  const res = await fetch(`${WAVESPEED_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WAVESPEED_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wavespeed error ${res.status}: ${text}`);
  }
  return res.json();
}

async function wavespeedGetStatus(taskId) {
  if (!WAVESPEED_API_KEY) throw new Error('WAVESPEED_API_KEY is not set');
  const res = await fetch(`${WAVESPEED_BASE}/predictions/${taskId}/result`, {
    headers: { Authorization: `Bearer ${WAVESPEED_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wavespeed status error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── POST /api/tryon ──────────────────────────────────────────────────────────
// Accepts: multipart/form-data
//   clothing_image_url  (string)  — URL of the clothing image from the website
//   reference_images    (file[])  — User's own photos (1-5 images)
//   model               (string)  — 'wavespeed' | 'gpt-image' | 'nano-banana'
// Returns: { task_id: string }
app.post('/api/tryon', upload.array('reference_images', 5), async (req, res) => {
  try {
    const { clothing_image_url, model = 'wavespeed' } = req.body;
    const refFiles = req.files;

    if (!clothing_image_url) {
      return res.status(400).json({ error: 'clothing_image_url is required' });
    }
    if (!refFiles?.length) {
      return res.status(400).json({ error: 'At least one reference image is required' });
    }

    // Build publicly-accessible URL for the uploaded reference photo
    const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const personImageUrl = `${serverUrl}/uploads/refs/${refFiles[0].filename}`;

    let taskData;

    if (model === 'wavespeed') {
      // ── Wavespeed AI Clothes Changer ─────────────────────────────────────
      taskData = await wavespeedPost('wavespeed-ai/ai-clothes-changer', {
        person_image: personImageUrl,
        clothing_images: [clothing_image_url],
      });
    } else if (model === 'gpt-image') {
      // ── GPT Image 2 Edit ─────────────────────────────────────────────────
      taskData = await wavespeedPost('openai/gpt-image-2/edit', {
        images: [personImageUrl, clothing_image_url],
        prompt:
          "Dress this person in the clothing shown in the second reference image. " +
          "Keep the person's face, skin tone, and body proportions exactly the same. " +
          "Replace only the clothing. Make it photorealistic and natural.",
        quality: 'high',
        enable_sync_mode: false,
      });
    } else if (model === 'nano-banana') {
      // ── Nano Banana 2 Edit ───────────────────────────────────────────────
      taskData = await wavespeedPost('google/nano-banana-2/edit', {
        image: personImageUrl,
        reference_images: [clothing_image_url],
        prompt:
          "Dress this person wearing the exact clothing from the reference image. " +
          "Maintain the person's face and body. Photorealistic result.",
      });
    } else {
      return res.status(400).json({ error: `Unknown model: ${model}` });
    }

    // Wavespeed returns { data: { id, status } }
    const taskId = taskData?.data?.id || taskData?.id;
    if (!taskId) {
      console.error('Wavespeed response:', JSON.stringify(taskData));
      return res.status(502).json({ error: 'Failed to create Wavespeed task — no task ID returned' });
    }

    // Store pending metadata for later resolution
    const history = readHistory();
    history.unshift({
      id: taskId,
      task_id: taskId,
      status: 'pending',
      model,
      clothing_image_url,
      result_url: null,
      created_at: new Date().toISOString(),
    });
    writeHistory(history);

    res.json({ task_id: taskId });
  } catch (err) {
    console.error('POST /api/tryon error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tryon/status/:taskId ───────────────────────────────────────────
// Polls Wavespeed for task completion.
// On success: downloads result, stores locally, updates history.json.
// Returns: { status: 'pending'|'processing'|'completed'|'failed', result_url?, error? }
app.get('/api/tryon/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

  try {
    const statusData = await wavespeedGetStatus(taskId);

    // Wavespeed status shape: { data: { id, status, outputs: [url], error } }
    const info = statusData?.data || statusData;
    const status = info?.status; // 'pending' | 'processing' | 'completed' | 'failed'

    if (status === 'completed') {
      const outputUrl = info?.outputs?.[0] || info?.output?.[0] || info?.output;

      if (outputUrl) {
        // Check if we already saved this result
        const history = readHistory();
        const existing = history.find(h => h.task_id === taskId && h.result_url);
        if (existing) {
          return res.json({ status: 'completed', result_url: existing.result_url });
        }

        // Download and store result image
        const resultFilename = `${uuidv4()}.jpg`;
        const resultPath = join(RESULTS_DIR, resultFilename);

        const imgRes = await fetch(outputUrl);
        if (!imgRes.ok) throw new Error(`Could not download result image: ${imgRes.status}`);
        const buffer = await imgRes.arrayBuffer();
        writeFileSync(resultPath, Buffer.from(buffer));

        const localResultUrl = `${serverUrl}/uploads/results/${resultFilename}`;

        // Update history entry
        const idx = history.findIndex(h => h.task_id === taskId);
        if (idx !== -1) {
          history[idx].result_url = localResultUrl;
          history[idx].status = 'completed';
        }
        writeHistory(history);

        return res.json({ status: 'completed', result_url: localResultUrl });
      }
    }

    if (status === 'failed') {
      // Mark as failed in history
      const history = readHistory();
      const idx = history.findIndex(h => h.task_id === taskId);
      if (idx !== -1) {
        history[idx].status = 'failed';
        writeHistory(history);
      }
      return res.json({ status: 'failed', error: info?.error || 'Processing failed on Wavespeed' });
    }

    // Still pending or processing
    res.json({ status: status || 'processing' });
  } catch (err) {
    console.error('GET /api/tryon/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/history ─────────────────────────────────────────────────────────
// Returns completed try-on results (paginated).
app.get('/api/history', (req, res) => {
  const history = readHistory();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const start = (page - 1) * limit;

  // Only return completed items in history tab
  const completed = history.filter(h => h.status === 'completed' && h.result_url);

  res.json({
    items: completed.slice(start, start + limit),
    total: completed.length,
    page,
    pages: Math.ceil(completed.length / limit),
  });
});

// ─── DELETE /api/history/:id ──────────────────────────────────────────────────
app.delete('/api/history/:id', (req, res) => {
  let history = readHistory();
  const item = history.find(h => h.id === req.params.id || h.task_id === req.params.id);

  if (item?.result_url) {
    // Delete the result file from disk
    const filename = item.result_url.split('/').pop();
    const filePath = join(RESULTS_DIR, filename);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (e) {
      console.warn('Could not delete file:', filePath, e.message);
    }
  }

  history = history.filter(h => h.id !== req.params.id && h.task_id !== req.params.id);
  writeHistory(history);
  res.json({ ok: true });
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    wavespeed_configured: !!WAVESPEED_API_KEY,
    history_count: readHistory().length,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Virtual Try-On server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  if (!WAVESPEED_API_KEY) {
    console.warn('⚠️  WAVESPEED_API_KEY is not set — try-on requests will fail');
  }
});
