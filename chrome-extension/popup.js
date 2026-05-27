// ═══════════════════════════════════════════════════════════════════════════
// VirtualFit Popup Script
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

// ─── App State ────────────────────────────────────────────────────────────────
const state = {
  clothingImage: null,   // { url, alt, width, height }
  referencePhotos: [],   // Array of File objects
  model: 'wavespeed',    // 'wavespeed' | 'gpt-image' | 'nano-banana'
  serverUrl: '',
  taskId: null,
  pollingTimer: null,
  pollingStarted: null,
};

// ─── Loading Messages ─────────────────────────────────────────────────────────
const LOADING_MESSAGES = [
  'Analysing your style…',
  'Fitting the garment…',
  'Adjusting proportions…',
  'Blending textures…',
  'Almost there…',
  'Adding the finishing touches…',
];

// ─── DOM References ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const clothingPreview = $('clothing-preview');
const clothingInfo = $('clothing-info');
const clothingThumb = $('clothing-thumb');
const clothingAlt = $('clothing-alt');
const clearClothingBtn = $('clear-clothing-btn');
const photoInput = $('photo-input');
const uploadZone = $('upload-zone');
const photoGrid = $('photo-grid');
const photoCount = $('photo-count');
const tryonBtn = $('tryon-btn');
const actionHint = $('action-hint');
const loadingState = $('loading-state');
const loadingMessage = $('loading-message');
const progressFill = $('progress-fill');
const cancelBtn = $('cancel-btn');
const resultState = $('result-state');
const resultImage = $('result-image');
const downloadBtn = $('download-btn');
const newTryonBtn = $('new-tryon-btn');
const errorState = $('error-state');
const errorMessage = $('error-message');
const retryBtn = $('retry-btn');
const historyGrid = $('history-grid');
const historyEmpty = $('history-empty');
const historyServerError = $('history-server-error');
const clearHistoryBtn = $('clear-history-btn');
const serverUrlInput = $('server-url-input');
const saveSettingsBtn = $('save-settings-btn');
const settingsStatus = $('settings-status');

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadServerUrl();
  await restoreSelectedImage();
  setupTabs();
  setupClothingSection();
  setupPhotoUpload();
  setupModelSelector();
  setupActionButtons();
  setupSettings();
  updateReadyState();
}

// ─── Server URL ───────────────────────────────────────────────────────────────
async function loadServerUrl() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' }, res => {
      state.serverUrl = (res?.serverUrl || '').replace(/\/$/, '');
      serverUrlInput.value = state.serverUrl;
      resolve();
    });
  });
}

// ─── Selected Image Restore ───────────────────────────────────────────────────
async function restoreSelectedImage() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SELECTED_IMAGE' }, res => {
      if (res?.payload?.url) {
        state.clothingImage = res.payload;
        renderClothingPreview(res.payload);
      }
      resolve();
    });
  });
}

// ─── Listen for image-selected event from background ─────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'IMAGE_SELECTED') {
    state.clothingImage = msg.payload;
    renderClothingPreview(msg.payload);
    updateReadyState();
  }
  if (msg.type === 'IMAGE_CLEARED') {
    state.clothingImage = null;
    renderClothingEmpty();
    updateReadyState();
  }
});

// ─── Clothing Preview ─────────────────────────────────────────────────────────
function renderClothingPreview(img) {
  clothingPreview.classList.add('hidden');
  clothingInfo.classList.remove('hidden');
  clothingThumb.src = img.url;
  clothingThumb.onerror = () => {
    // If CORS blocks direct thumb display, show placeholder
    clothingThumb.style.display = 'none';
    clothingAlt.textContent = img.url;
  };
  clothingAlt.textContent = img.alt || img.url.split('/').pop() || 'Selected clothing';
}

function renderClothingEmpty() {
  clothingPreview.classList.remove('hidden');
  clothingInfo.classList.add('hidden');
  clothingThumb.src = '';
}

function setupClothingSection() {
  clearClothingBtn.addEventListener('click', () => {
    state.clothingImage = null;
    chrome.runtime.sendMessage({ type: 'CLEAR_SELECTED_IMAGE' }).catch(() => {});
    renderClothingEmpty();
    updateReadyState();
  });
}

// ─── Photo Upload ─────────────────────────────────────────────────────────────
function setupPhotoUpload() {
  uploadZone.addEventListener('click', e => {
    if (e.target === photoInput) return;
    photoInput.click();
  });

  uploadZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') photoInput.click();
  });

  photoInput.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    addPhotos(files);
    photoInput.value = ''; // reset so the same file can be re-selected
  });

  // Drag & drop
  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []).filter(f =>
      f.type.startsWith('image/')
    );
    addPhotos(files);
  });
}

function addPhotos(files) {
  const validFiles = files.filter(f => f.size <= 10 * 1024 * 1024 && f.type.startsWith('image/'));
  const remaining = 5 - state.referencePhotos.length;
  state.referencePhotos = [...state.referencePhotos, ...validFiles.slice(0, remaining)];
  renderPhotoGrid();
  updateReadyState();
}

function renderPhotoGrid() {
  const photos = state.referencePhotos;
  photoCount.textContent = `${photos.length}/5`;

  if (photos.length === 0) {
    photoGrid.classList.add('hidden');
    return;
  }

  photoGrid.classList.remove('hidden');
  photoGrid.innerHTML = photos
    .map(
      (file, i) => `
      <div class="photo-thumb ${i === 0 ? 'primary-badge' : ''}">
        <img src="${URL.createObjectURL(file)}" alt="Reference photo ${i + 1}" />
        <button class="remove-photo" data-index="${i}" title="Remove photo" aria-label="Remove photo ${i + 1}">✕</button>
      </div>
    `
    )
    .join('');

  photoGrid.querySelectorAll('.remove-photo').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      state.referencePhotos.splice(idx, 1);
      renderPhotoGrid();
      updateReadyState();
    });
  });
}

// ─── Model Selector ───────────────────────────────────────────────────────────
function setupModelSelector() {
  document.querySelectorAll('input[name="model"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.model = radio.value;
    });
  });
}

// ─── Ready State ──────────────────────────────────────────────────────────────
function updateReadyState() {
  const hasClothing = !!state.clothingImage;
  const hasPhotos = state.referencePhotos.length > 0;
  const hasServer = !!state.serverUrl;
  const isReady = hasClothing && hasPhotos && hasServer;

  tryonBtn.disabled = !isReady;

  if (!hasServer) {
    actionHint.textContent = '⚙️ Set your backend URL in Settings first';
  } else if (!hasClothing && !hasPhotos) {
    actionHint.textContent = 'Select a clothing image and upload your photo to begin';
  } else if (!hasClothing) {
    actionHint.textContent = 'Browse a clothing site and select an image';
  } else if (!hasPhotos) {
    actionHint.textContent = 'Upload at least one photo of yourself';
  } else {
    actionHint.textContent = 'Ready! Hit the button to try on this look ✨';
  }
}

// ─── Action Buttons ───────────────────────────────────────────────────────────
function setupActionButtons() {
  tryonBtn.addEventListener('click', startTryOn);
  cancelBtn.addEventListener('click', cancelTryOn);
  newTryonBtn.addEventListener('click', resetToInitial);
  retryBtn.addEventListener('click', resetToInitial);
  downloadBtn.addEventListener('click', handleDownload);
}

// ─── Main Try-On Flow ─────────────────────────────────────────────────────────
async function startTryOn() {
  if (!state.serverUrl) return;

  showScreen('loading');
  startProgressAnimation();
  startMessageCycle();

  const formData = new FormData();
  formData.append('clothing_image_url', state.clothingImage.url);
  formData.append('model', state.model);
  state.referencePhotos.forEach(f => formData.append('reference_images', f));

  try {
    const res = await fetch(`${state.serverUrl}/api/tryon`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();

    if (data.task_id) {
      state.taskId = data.task_id;
      state.pollingStarted = Date.now();
      startPolling(data.task_id);
    } else if (data.result_url) {
      showResult(data.result_url);
    } else {
      throw new Error(data.error || 'Unexpected server response');
    }
  } catch (err) {
    showError(
      err.message.includes('fetch')
        ? 'Cannot connect to server. Check the URL in Settings.'
        : err.message
    );
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function startPolling(taskId) {
  const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes timeout

  state.pollingTimer = setInterval(async () => {
    // Safety timeout
    if (Date.now() - state.pollingStarted > MAX_WAIT_MS) {
      clearInterval(state.pollingTimer);
      showError('Processing took too long. Please try again.');
      return;
    }

    try {
      const res = await fetch(`${state.serverUrl}/api/tryon/status/${taskId}`);
      if (!res.ok) return; // transient error, keep polling

      const data = await res.json();

      if (data.status === 'completed' && data.result_url) {
        clearInterval(state.pollingTimer);
        showResult(data.result_url);
      } else if (data.status === 'failed') {
        clearInterval(state.pollingTimer);
        showError(data.error || 'The AI model failed to process your try-on. Please try again.');
      }
      // pending / processing → keep polling
    } catch {
      // Network blip — keep trying
    }
  }, 2000);
}

function cancelTryOn() {
  clearInterval(state.pollingTimer);
  stopProgressAnimation();
  stopMessageCycle();
  resetToInitial();
}

// ─── Screen Management ────────────────────────────────────────────────────────
function showScreen(screen) {
  // Hide all dynamic states
  loadingState.classList.add('hidden');
  resultState.classList.add('hidden');
  errorState.classList.add('hidden');

  // Also show/hide the form sections
  const tryon = $('tab-tryon');
  const cards = tryon.querySelectorAll('.card, .action-area');

  if (screen === 'loading') {
    cards.forEach(c => c.classList.add('hidden'));
    loadingState.classList.remove('hidden');
  } else if (screen === 'result') {
    cards.forEach(c => c.classList.add('hidden'));
    resultState.classList.remove('hidden');
  } else if (screen === 'error') {
    cards.forEach(c => c.classList.add('hidden'));
    errorState.classList.remove('hidden');
  } else {
    // 'initial'
    cards.forEach(c => c.classList.remove('hidden'));
  }
}

function resetToInitial() {
  stopMessageCycle();
  stopProgressAnimation();
  clearInterval(state.pollingTimer);
  showScreen('initial');
}

// ─── Result Display ───────────────────────────────────────────────────────────
function showResult(url) {
  stopMessageCycle();
  stopProgressAnimation();

  // Complete progress bar
  progressFill.style.animation = 'none';
  progressFill.style.width = '100%';

  resultImage.src = url;
  downloadBtn.href = url;

  showScreen('result');
}

// ─── Error Display ────────────────────────────────────────────────────────────
function showError(msg) {
  stopMessageCycle();
  stopProgressAnimation();
  errorMessage.textContent = msg;
  showScreen('error');
}

// ─── Download Handler ─────────────────────────────────────────────────────────
async function handleDownload(e) {
  e.preventDefault();
  const url = resultImage.src;
  if (!url) return;

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `virtualfit-${Date.now()}.jpg`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}

// ─── Progress Animation ───────────────────────────────────────────────────────
function startProgressAnimation() {
  progressFill.style.animation = 'none';
  progressFill.style.width = '0%';
  // Force reflow
  void progressFill.offsetWidth;
  progressFill.classList.add('animating');
  progressFill.style.animation = '';
}

function stopProgressAnimation() {
  progressFill.classList.remove('animating');
  progressFill.style.animation = 'none';
  progressFill.style.width = '0%';
}

// ─── Loading Message Cycle ────────────────────────────────────────────────────
let msgTimer = null;
let msgIndex = 0;

function startMessageCycle() {
  msgIndex = 0;
  loadingMessage.style.opacity = '1';
  loadingMessage.textContent = LOADING_MESSAGES[0];

  msgTimer = setInterval(() => {
    loadingMessage.style.opacity = '0';
    setTimeout(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
      loadingMessage.textContent = LOADING_MESSAGES[msgIndex];
      loadingMessage.style.opacity = '1';
    }, 350);
  }, 3500);
}

function stopMessageCycle() {
  clearInterval(msgTimer);
  msgTimer = null;
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });

      document.querySelectorAll('.tab-pane').forEach(pane => {
        const isTarget = pane.id === `tab-${target}`;
        pane.classList.toggle('active', isTarget);
        pane.classList.toggle('hidden', !isTarget);
      });

      if (target === 'history') loadHistory();
    });
  });
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  historyEmpty.classList.add('hidden');
  historyServerError.classList.add('hidden');
  clearHistoryBtn.classList.add('hidden');

  if (!state.serverUrl) {
    historyGrid.innerHTML = '';
    historyServerError.classList.remove('hidden');
    return;
  }

  // Show skeletons
  historyGrid.innerHTML = Array(6)
    .fill('<div class="skeleton"></div>')
    .join('');

  try {
    const res = await fetch(`${state.serverUrl}/api/history`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    const items = data.items || [];

    historyGrid.innerHTML = '';

    if (!items.length) {
      historyEmpty.classList.remove('hidden');
      return;
    }

    clearHistoryBtn.classList.remove('hidden');

    historyGrid.innerHTML = items
      .map(
        item => `
        <div class="history-item" data-id="${item.id}">
          <img src="${item.result_url}" alt="Try-on result from ${new Date(item.created_at).toLocaleDateString()}" loading="lazy" />
          <div class="history-item-overlay">
            <span class="history-date">${formatDate(item.created_at)}</span>
            <button class="history-delete" data-id="${item.id}" title="Delete" aria-label="Delete this result">🗑</button>
          </div>
        </div>
      `
      )
      .join('');

    // Full-size preview on image click
    historyGrid.querySelectorAll('.history-item img').forEach(img => {
      img.addEventListener('click', () => window.open(img.src, '_blank'));
    });

    // Delete handlers
    historyGrid.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          await fetch(`${state.serverUrl}/api/history/${id}`, { method: 'DELETE' });
          loadHistory(); // refresh
        } catch {
          btn.textContent = '🗑';
          btn.disabled = false;
        }
      });
    });
  } catch {
    historyGrid.innerHTML = '';
    historyServerError.classList.remove('hidden');
  }
}

clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Delete all history? This cannot be undone.')) return;
  try {
    const res = await fetch(`${state.serverUrl}/api/history`);
    const data = await res.json();
    for (const item of data.items || []) {
      await fetch(`${state.serverUrl}/api/history/${item.id}`, { method: 'DELETE' });
    }
    loadHistory();
  } catch {
    // ignore
  }
});

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function setupSettings() {
  saveSettingsBtn.addEventListener('click', saveSettings);
  serverUrlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveSettings();
  });
}

async function saveSettings() {
  const url = serverUrlInput.value.trim().replace(/\/$/, '');
  settingsStatus.className = 'settings-status hidden';

  if (!url) {
    showSettingsStatus('error', 'Please enter a valid URL.');
    return;
  }

  // Validate by pinging the health endpoint
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Status ${res.status}`);

    state.serverUrl = url;
    chrome.runtime.sendMessage({ type: 'SET_SERVER_URL', serverUrl: url });
    showSettingsStatus('success', '✅ Connected successfully!');
    updateReadyState();
  } catch {
    showSettingsStatus('error', '❌ Could not reach that URL. Is the server running?');
  }
}

function showSettingsStatus(type, text) {
  settingsStatus.textContent = text;
  settingsStatus.className = `settings-status ${type}`;
  setTimeout(() => {
    settingsStatus.className = 'settings-status hidden';
  }, 4000);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
init();
