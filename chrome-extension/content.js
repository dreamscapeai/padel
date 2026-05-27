// ═══════════════════════════════════════════════════════════════════════════
// VirtualFit Content Script
// Scans the page for images and overlays an interactive checkbox
// so the user can select ONE clothing image for virtual try-on.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const MIN_PX = 100; // Minimum rendered dimension (px) to be eligible
  const PROCESSED_ATTR = 'data-vf-processed';

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedSrc = null; // Currently selected image src

  // ── Eligibility Check ──────────────────────────────────────────────────────
  function isEligible(img) {
    if (img.hasAttribute(PROCESSED_ATTR)) return false;
    if (!img.src || img.src.startsWith('data:') && img.naturalWidth < MIN_PX) return false;
    if (img.naturalWidth < MIN_PX || img.naturalHeight < MIN_PX) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < MIN_PX || rect.height < MIN_PX) return false;
    // Skip SVG, tracking pixels, etc.
    const lcSrc = img.src.toLowerCase();
    if (lcSrc.endsWith('.svg') || lcSrc.endsWith('.gif') && img.naturalHeight < 10) return false;
    return true;
  }

  // ── Create Overlay Wrapper ─────────────────────────────────────────────────
  function wrapImage(img) {
    img.setAttribute(PROCESSED_ATTR, 'true');

    const parent = img.parentElement;
    if (!parent) return;

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'vf-wrapper';

    // Detect flex/grid parent — use display:contents to avoid breaking layout
    const parentDisplay = getComputedStyle(parent).display;
    if (parentDisplay.includes('flex') || parentDisplay.includes('grid')) {
      wrapper.classList.add('vf-flex-child');
    }

    // Insert wrapper before the image, then move image inside
    parent.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    // Checkbox bubble
    const checkbox = document.createElement('div');
    checkbox.className = 'vf-checkbox';
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute('aria-label', 'Select for virtual try-on');
    checkbox.setAttribute('aria-checked', 'false');
    checkbox.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<polyline points="20 6 9 17 4 12"/>' +
      '</svg>';

    // Label badge
    const label = document.createElement('div');
    label.className = 'vf-label';
    label.textContent = '✓ Selected for Try-On';

    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);

    // ── Click Handler ──────────────────────────────────────────────────────
    checkbox.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      handleSelect(img, checkbox, wrapper);
    });

    // Also allow clicking the image itself when it's already selected (to deselect)
    img.addEventListener('click', e => {
      if (wrapper.classList.contains('vf-selected')) {
        e.stopPropagation();
        e.preventDefault();
        handleSelect(img, checkbox, wrapper);
      }
    }, true);
  }

  // ── Selection Logic ────────────────────────────────────────────────────────
  function handleSelect(img, checkbox, wrapper) {
    const isSame = selectedSrc === img.src;

    // Clear all selections
    clearAllSelections();

    if (isSame) {
      // Toggle off
      selectedSrc = null;
      chrome.runtime.sendMessage({ type: 'CLEAR_SELECTED_IMAGE' }).catch(() => {});
      return;
    }

    // Select this image
    selectedSrc = img.src;
    wrapper.classList.add('vf-selected');
    checkbox.classList.add('vf-checked');
    checkbox.setAttribute('aria-checked', 'true');

    chrome.runtime
      .sendMessage({
        type: 'SET_SELECTED_IMAGE',
        payload: {
          url: img.src,
          alt: img.alt || '',
          width: img.naturalWidth,
          height: img.naturalHeight,
        },
      })
      .catch(() => {});
  }

  function clearAllSelections() {
    document.querySelectorAll('.vf-wrapper.vf-selected').forEach(w => {
      w.classList.remove('vf-selected');
      const cb = w.querySelector('.vf-checkbox');
      if (cb) {
        cb.classList.remove('vf-checked');
        cb.setAttribute('aria-checked', 'false');
      }
    });
  }

  // ── Process Image (with load-wait fallback) ────────────────────────────────
  function processImage(img) {
    if (img.complete && img.naturalWidth > 0) {
      if (isEligible(img)) wrapImage(img);
    } else {
      img.addEventListener(
        'load',
        () => {
          if (isEligible(img)) wrapImage(img);
        },
        { once: true }
      );
    }
  }

  // ── Scan a subtree for images ──────────────────────────────────────────────
  function scanRoot(root) {
    const imgs = root.querySelectorAll ? root.querySelectorAll('img') : [];
    imgs.forEach(processImage);
  }

  // ── MutationObserver: handle dynamic / SPA content ────────────────────────
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === 'IMG') {
          processImage(node);
        } else {
          scanRoot(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── Initial scan ───────────────────────────────────────────────────────────
  scanRoot(document);

  // Also scan after a short delay to catch lazy-loaded images that fire
  // their load event before our script finishes setting up listeners.
  setTimeout(() => scanRoot(document), 800);
  setTimeout(() => scanRoot(document), 2500);

  // ── Listen for popup messages ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ alive: true, selectedSrc });
    }
  });
})();
