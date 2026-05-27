// ═══════════════════════════════════════════════════════════════════════════
// VirtualFit — Background Service Worker (MV3)
//
// MV3 service workers are ephemeral: they sleep after ~30s idle.
// ALL persistent state lives in chrome.storage.local, never in variables.
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    selectedImage: null,
    serverUrl: '',
  });
  console.log('[VirtualFit] Extension installed');
});

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // ── Content script → selected a clothing image ──────────────────────────
    case 'SET_SELECTED_IMAGE': {
      chrome.storage.local.set({ selectedImage: message.payload }, () => {
        sendResponse({ ok: true });
      });
      // Also try to notify an open popup (it may not be open — that's fine)
      chrome.runtime
        .sendMessage({ type: 'IMAGE_SELECTED', payload: message.payload })
        .catch(() => {});
      return true; // async sendResponse
    }

    // ── Content script → deselected the image ──────────────────────────────
    case 'CLEAR_SELECTED_IMAGE': {
      chrome.storage.local.set({ selectedImage: null }, () => {
        sendResponse({ ok: true });
      });
      chrome.runtime
        .sendMessage({ type: 'IMAGE_CLEARED' })
        .catch(() => {});
      return true;
    }

    // ── Popup → retrieve the currently selected image ───────────────────────
    case 'GET_SELECTED_IMAGE': {
      chrome.storage.local.get('selectedImage', data => {
        sendResponse({ payload: data.selectedImage || null });
      });
      return true;
    }

    // ── Popup → save server URL ─────────────────────────────────────────────
    case 'SET_SERVER_URL': {
      const url = (message.serverUrl || '').replace(/\/$/, ''); // strip trailing slash
      chrome.storage.local.set({ serverUrl: url }, () => {
        sendResponse({ ok: true });
      });
      return true;
    }

    // ── Popup → retrieve server URL ─────────────────────────────────────────
    case 'GET_SERVER_URL': {
      chrome.storage.local.get('serverUrl', data => {
        sendResponse({ serverUrl: data.serverUrl || '' });
      });
      return true;
    }

    default:
      break;
  }
  return false;
});
