const MODULE_ID = 'argas-day-night-slider';
const SNAP_THRESHOLD = 18;
const SLIDER_WIDTH_FACTOR = 2.0;
const SLIDER_MIN_WIDTH = 100;

let sliderElement = null;
let wrapperElement = null;
let spacerElement = null;

let _resizeObserver = null;
let _mutationObserver = null;
let _debounceTimer = null;
let _uiScaleEl = null;
let _windowResizeHandler = null;
let _snapTargetCache = null;
let _snapTargetCacheTimer = null;

function cleanupListenersAndObservers() {
  clearTimeout(_debounceTimer);
  _debounceTimer = null;
  clearTimeout(_snapTargetCacheTimer);
  _snapTargetCacheTimer = null;
  _snapTargetCache = null;
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  if (_mutationObserver) {
    _mutationObserver.disconnect();
    _mutationObserver = null;
  }
  if (_windowResizeHandler) {
    window.removeEventListener('resize', _windowResizeHandler);
    _windowResizeHandler = null;
  }
}

function applyUiScale() {
  if (!_uiScaleEl || !wrapperElement) return;
  const scale = parseFloat(getComputedStyle(_uiScaleEl).getPropertyValue('--ui-scale')) || 1;
  wrapperElement.style.transformOrigin = 'left bottom';
  wrapperElement.style.transform = `scale(${scale})`;
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'enabled', {
    name: 'Enable DayNight Slider',
    scope: 'client',
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, 'position', {
    name: 'Slider Position',
    scope: 'client',
    config: false,
    type: Object,
    default: { x: null, y: null }
  });

  game.settings.register(MODULE_ID, 'pinned', {
    name: 'Pinned to Players',
    scope: 'client',
    config: false,
    type: Boolean,
    default: true
  });

  // Inject CSS once; it never changes between scenes.
  const style = document.createElement('style');
  style.dataset.darknessStyle = 'true';
  style.textContent = `
    .dns-wrapper {
      position: fixed;
      z-index: 100;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 4px 18px 13px 5px;
      user-select: none;
    }
    .dns-wrapper.dns-dragging { opacity: 0.85; }
    .dns-handle {
      width: 24px; height: 10px; margin-bottom: 2px;
      background: radial-gradient(circle, #aaa 1.5px, transparent 1.5px);
      background-size: 8px 8px; background-position: center;
      border-radius: 3px; opacity: 0;
      transition: opacity 0.15s; cursor: grab;
    }
    .dns-handle:active { cursor: grabbing; }
    .dns-wrapper:hover .dns-handle { opacity: 1.0; }
    .dns-container { display: flex; align-items: center; gap: 5px; }
    .dns-icon {
      cursor: pointer; transform: translateY(0px) translateX(-4px);
      border: none; outline: none; box-shadow: none;
    }
    .dns-slider {
      -webkit-appearance: none; appearance: none;
      background: transparent;
      border: none; outline: none; box-shadow: none;
      height: 16px;
      cursor: pointer;
    }
    .dns-slider::-webkit-slider-runnable-track {
      background: #888;
      height: 8px; border-radius: 4px;
      border: none; outline: none; box-shadow: none;
      margin: 0 6px;
    }
    .dns-slider::-webkit-slider-thumb {
      -webkit-appearance: none; width: 28px; height: 16px;
      background: orange; border: 1px solid grey; border-radius: 5px; cursor: pointer;
      margin-top: -4px;
    }
    .dns-slider::-moz-range-track {
      background: #888;
      height: 8px; border-radius: 4px;
      border: none; outline: none; box-shadow: none;
      margin: 0 6px;
    }
    .dns-slider::-moz-range-thumb {
      width: 28px; height: 16px;
      background: orange; border: 1px solid grey; border-radius: 5px; cursor: pointer;
    }
    .dns-spacer {
      height: 0;
      overflow: hidden;
      pointer-events: none;
    }
    @keyframes dns-jiggle {
      0%   { transform: rotate(0deg); }
      25%  { transform: rotate(-1deg); }
      50%  { transform: rotate(1deg); }
      75%  { transform: rotate(-1deg); }
      100% { transform: rotate(0deg); }
    }
  `;
  document.head.appendChild(style);
});

Hooks.on('canvasReady', () => {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, 'enabled')) return;
  createDayNightSlider();
});

Hooks.once('ready', () => {
  const majorVersion = parseInt(game.version);
  if (majorVersion >= 14) {
    console.log(`${MODULE_ID} | v14+ compat check:`, {
      players: !!document.getElementById('players'),
      playersActive: !!document.getElementById('players-active'),
      playersInactive: !!document.getElementById('players-inactive'),
      sidebar: !!document.getElementById('sidebar'),
      hotbar: !!document.getElementById('hotbar'),
      navigation: !!document.getElementById('navigation'),
      controls: !!document.getElementById('controls'),
      uiScale: getComputedStyle(
        document.getElementById('ui-top')?.closest('[style*="--ui-scale"]') ?? document.documentElement
      ).getPropertyValue('--ui-scale')
    });
  }
});

Hooks.on('updateSetting', (setting) => {
  if (setting.key !== `${MODULE_ID}.enabled`) return;
  if (setting.value) {
    createDayNightSlider();
  } else {
    cleanupListenersAndObservers();
    wrapperElement?.remove();
    spacerElement?.remove();
    wrapperElement = null;
    spacerElement = null;
    sliderElement = null;
  }
});

Hooks.on('updateScene', (scene, changes) => {
  if (!game.user.isGM) return;
  if (scene.id !== canvas.scene?.id) return;
  const dl = changes?.environment?.darknessLevel;
  if (dl !== undefined && sliderElement?.isConnected) {
    sliderElement.value = dl;
  }
});

const handlePlayersRender = () => {
  try {
    if (!game.settings.get(MODULE_ID, 'pinned')) return;
    ensureSpacerInFlow();
    syncWrapperToSpacer();
    const pl = document.getElementById('players');
    if (pl && sliderElement) {
      const w = pl.offsetWidth * SLIDER_WIDTH_FACTOR;
      sliderElement.style.width = `${Math.max(w, SLIDER_MIN_WIDTH)}px`;
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | Players render handler failed:`, e);
  }
};

Hooks.on('renderPlayers', handlePlayersRender);
Hooks.on('renderPlayerList', handlePlayersRender);

function getPlayersPinAnchor() {
  const inactive = document.getElementById('players-inactive');
  if (inactive && inactive.offsetHeight > 20) return inactive;
  return (
    document.getElementById('players-active') ||
    document.getElementById('players') ||
    document.getElementById('players-inactive')
  );
}

// The spacer is created detached and inserted into the DOM via
// insertAdjacentElement('beforebegin', ...) which works for both
// attached and detached elements.
function ensureSpacerInFlow() {
  if (!spacerElement) return;
  const anchor = getPlayersPinAnchor();
  if (!anchor) return;

  if (spacerElement.nextElementSibling !== anchor) {
    anchor.insertAdjacentElement('beforebegin', spacerElement);
  }
}

function syncWrapperToSpacer() {
  if (!wrapperElement || !spacerElement?.isConnected) return;

  const sr = spacerElement.getBoundingClientRect();
  wrapperElement.style.left = `${sr.left}px`;
  wrapperElement.style.top = '';
  wrapperElement.style.bottom = `${window.innerHeight - sr.top}px`;
}

function pinApp() {
  if (!wrapperElement || !spacerElement) return false;

  const anchor = getPlayersPinAnchor();
  if (!anchor) return false;

  ensureSpacerInFlow();

  if (wrapperElement.parentElement !== document.body) {
    document.body.appendChild(wrapperElement);
  }
  wrapperElement.classList.add('dns-pinned');
  syncWrapperToSpacer();

  return true;
}

function unPinApp() {
  if (!wrapperElement) return false;
  if (!wrapperElement.classList.contains('dns-pinned')) return false;

  const rect = wrapperElement.getBoundingClientRect();
  const scale = wrapperElement.offsetHeight
    ? (rect.height / wrapperElement.offsetHeight)
    : 1;
  wrapperElement.classList.remove('dns-pinned');
  wrapperElement.style.left = `${rect.left}px`;
  wrapperElement.style.top = `${rect.top - wrapperElement.offsetHeight * (1 - scale)}px`;
  wrapperElement.style.bottom = '';

  return true;
}

function computePinZone(clientX, clientY) {
  const anchor = getPlayersPinAnchor();
  if (!anchor) return false;

  const rect = anchor.getBoundingClientRect();
  return (
    clientX > rect.left &&
    clientX < rect.left + rect.width &&
    clientY > rect.top - 80 &&
    clientY < rect.top + 80
  );
}

function getSnapTargets() {
  if (_snapTargetCache) return _snapTargetCache;

  const targets = [];

  document.querySelectorAll('.window-app').forEach(el => {
    if (el.style.display === 'none') return;
    targets.push(el.getBoundingClientRect());
  });

  for (const id of ['sidebar', 'hotbar', 'navigation', 'controls']) {
    const el = document.getElementById(id);
    if (el) targets.push(el.getBoundingClientRect());
  }

  _snapTargetCache = targets;
  clearTimeout(_snapTargetCacheTimer);
  _snapTargetCacheTimer = setTimeout(() => { _snapTargetCache = null; }, 200);

  return targets;
}

function rangesOverlap(aMin, aMax, bMin, bMax) {
  return aMax > bMin && aMin < bMax;
}

function snapPosition(x, y, wrapperW, wrapperH) {
  const targets = getSnapTargets();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let sx = x, sy = y;
  let bestDx = SNAP_THRESHOLD, bestDy = SNAP_THRESHOLD;

  if (Math.abs(x - 15) < SNAP_THRESHOLD)              { sx = 15; bestDx = 0; }
  if (Math.abs(x + wrapperW - vw) < SNAP_THRESHOLD)  { sx = vw - wrapperW; bestDx = 0; }
  if (Math.abs(y) < SNAP_THRESHOLD)                   { sy = 0; bestDy = 0; }
  if (Math.abs(y + wrapperH - vh) < SNAP_THRESHOLD)   { sy = vh - wrapperH; bestDy = 0; }

  for (const t of targets) {
    const overlapH = rangesOverlap(y, y + wrapperH, t.top, t.bottom);
    const overlapV = rangesOverlap(x, x + wrapperW, t.left, t.right);

    if (overlapH) {
      const edges = [
        { dist: Math.abs(x - t.right),            val: t.right },
        { dist: Math.abs(x + wrapperW - t.left),  val: t.left - wrapperW },
        { dist: Math.abs(x - t.left),             val: t.left },
        { dist: Math.abs(x + wrapperW - t.right), val: t.right - wrapperW }
      ];
      for (const e of edges) {
        if (e.dist < bestDx) { bestDx = e.dist; sx = e.val; }
      }
    }

    if (overlapV) {
      const edges = [
        { dist: Math.abs(y - t.bottom),            val: t.bottom },
        { dist: Math.abs(y + wrapperH - t.top),    val: t.top - wrapperH },
        { dist: Math.abs(y - t.top),               val: t.top },
        { dist: Math.abs(y + wrapperH - t.bottom), val: t.bottom - wrapperH }
      ];
      for (const e of edges) {
        if (e.dist < bestDy) { bestDy = e.dist; sy = e.val; }
      }
    }
  }

  return { x: sx, y: sy };
}

function createDayNightSlider() {
  cleanupListenersAndObservers();

  document.querySelectorAll('[data-darkness-wrapper]').forEach(el => el.remove());
  document.querySelectorAll('[data-darkness-spacer]').forEach(el => el.remove());

  const spacer = document.createElement('div');
  spacer.dataset.darknessSpacer = 'true';
  spacer.classList.add('dns-spacer');
  spacerElement = spacer;

  const wrapper = document.createElement('div');
  wrapper.dataset.darknessWrapper = 'true';
  wrapper.classList.add('dns-wrapper');
  wrapperElement = wrapper;

  const handle = document.createElement('div');
  handle.classList.add('dns-handle');

  const container = document.createElement('div');
  container.classList.add('dns-container');

  const sun = document.createElement('img');
  sun.src = `modules/${MODULE_ID}/assets/sun.png`;
  sun.width = 24; sun.height = 24;
  sun.classList.add('dns-icon');
  sun.draggable = false;

  const moon = document.createElement('img');
  moon.src = `modules/${MODULE_ID}/assets/moon.png`;
  moon.width = 24; moon.height = 24;
  moon.classList.add('dns-icon');
  moon.draggable = false;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 0; slider.max = 1; slider.step = 'any';
  slider.value = canvas.scene?.environment?.darknessLevel ?? 0;
  slider.classList.add('dns-slider');
  sliderElement = slider;

  sun.addEventListener('click', async () => {
    if (!canvas.scene) return;
    slider.value = 0;
    try {
      await canvas.scene.update({ environment: { darknessLevel: 0 } }, { animate: false });
    } catch (e) {
      console.warn(`${MODULE_ID} | Scene update failed:`, e);
    }
  });

  moon.addEventListener('click', async () => {
    if (!canvas.scene) return;
    slider.value = 1;
    try {
      await canvas.scene.update({ environment: { darknessLevel: 1 } }, { animate: false });
    } catch (e) {
      console.warn(`${MODULE_ID} | Scene update failed:`, e);
    }
  });

  slider.addEventListener('input', () => {
    if (!canvas.scene) return;
    const sceneId = canvas.scene.id;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(async () => {
      const target = game.scenes.get(sceneId);
      if (!target || target.id !== canvas.scene?.id) return;
      try {
        await target.update(
          { environment: { darknessLevel: parseFloat(slider.value) } },
          { animate: false }
        );
      } catch (e) {
        console.warn(`${MODULE_ID} | Scene update failed:`, e);
      }
    }, 80);
  });

  const onWheel = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if (!canvas.scene) return;
    const sceneId = canvas.scene.id;
    const step = ev.ctrlKey ? 1/300 : ev.shiftKey ? 1/12 : 0.01;
    const raw = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    if (raw === 0) return;
    const delta = raw > 0 ? step : -step;
    const v = Math.max(0, Math.min(1, Math.round((parseFloat(slider.value) + delta) * 1200) / 1200));
    slider.value = v;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(async () => {
      const target = game.scenes.get(sceneId);
      if (!target || target.id !== canvas.scene?.id) return;
      try {
        await target.update({ environment: { darknessLevel: v } }, { animate: false });
      } catch (e) {
        console.warn(`${MODULE_ID} | Scene update failed:`, e);
      }
    }, 80);
  };

  for (const el of [wrapper, slider, sun, moon]) {
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
  }

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let wasPinnedAtStart = false;
  let hasUnpinnedOnThisDrag = false;
  let inPinZone = false;

  handle.addEventListener('pointerdown', (ev) => {
    isDragging = true;
    wasPinnedAtStart = wrapper.classList.contains('dns-pinned');
    hasUnpinnedOnThisDrag = false;
    inPinZone = false;

    const rect = wrapper.getBoundingClientRect();
    dragOffsetX = ev.clientX - rect.left;
    dragOffsetY = ev.clientY - rect.top;

    try { handle.setPointerCapture(ev.pointerId); } catch (_) { /* ignored */ }
    wrapper.classList.add('dns-dragging');
    ev.preventDefault();
  });

  handle.addEventListener('pointermove', (ev) => {
    if (!isDragging) return;

    if (wasPinnedAtStart && !hasUnpinnedOnThisDrag) {
      const rect = wrapper.getBoundingClientRect();
      unPinApp();
      hasUnpinnedOnThisDrag = true;
      dragOffsetX = ev.clientX - rect.left;
      dragOffsetY = ev.clientY - rect.top;
    }

    const rawX = ev.clientX - dragOffsetX;
    const rawY = ev.clientY - dragOffsetY;

    inPinZone = computePinZone(ev.clientX, ev.clientY);

    if (inPinZone) {
      syncWrapperToSpacer();
      wrapper.style.animation = 'dns-jiggle 0.2s infinite';
    } else {
      const wRect = wrapper.getBoundingClientRect();
      const scale = wrapper.offsetHeight
        ? (wRect.height / wrapper.offsetHeight)
        : 1;
      const snapped = snapPosition(rawX, rawY, wRect.width, wRect.height);
      wrapper.style.left = `${snapped.x}px`;
      wrapper.style.top  = `${snapped.y - wrapper.offsetHeight * (1 - scale)}px`;
      wrapper.style.bottom = '';
      wrapper.style.animation = '';
    }
  });

  handle.addEventListener('pointerup', async (ev) => {
    if (!isDragging) return;
    isDragging = false;
    wrapper.classList.remove('dns-dragging');
    wrapper.style.animation = '';

    const droppedInPinZone = computePinZone(ev.clientX, ev.clientY) || inPinZone;

    try {
      if (droppedInPinZone) {
        pinApp();
        await game.settings.set(MODULE_ID, 'pinned', true);
        await game.settings.set(MODULE_ID, 'position', { x: null, y: null });
      } else {
        const rect = wrapper.getBoundingClientRect();
        await game.settings.set(MODULE_ID, 'pinned', false);
        await game.settings.set(MODULE_ID, 'position', {
          x: Math.round(rect.left),
          y: Math.round(rect.top)
        });
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to save position:`, e);
    }
  });

  handle.addEventListener('dblclick', async () => {
    pinApp();
    applyUiScale();
    try {
      await game.settings.set(MODULE_ID, 'pinned', true);
      await game.settings.set(MODULE_ID, 'position', { x: null, y: null });
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to save pin state:`, e);
    }
  });

  handle.addEventListener('lostpointercapture', async () => {
    if (!isDragging) return;
    isDragging = false;
    wrapper.classList.remove('dns-dragging');
    wrapper.style.animation = '';

    try {
      if (wasPinnedAtStart) {
        pinApp();
        await game.settings.set(MODULE_ID, 'pinned', true);
        await game.settings.set(MODULE_ID, 'position', { x: null, y: null });
      } else {
        const rect = wrapper.getBoundingClientRect();
        await game.settings.set(MODULE_ID, 'pinned', false);
        await game.settings.set(MODULE_ID, 'position', {
          x: Math.round(rect.left),
          y: Math.round(rect.top)
        });
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to save position after capture loss:`, e);
    }
  });

  container.append(sun, slider, moon);
  wrapper.append(handle, container);
  document.body.appendChild(wrapper);

  const isPinned = game.settings.get(MODULE_ID, 'pinned');

  ensureSpacerInFlow();

  if (isPinned) {
    pinApp();
  } else {
    const saved = game.settings.get(MODULE_ID, 'position');
    if (saved.x != null && saved.y != null) {
      wrapper.style.left = `${saved.x}px`;
      wrapper.style.top = `${saved.y}px`;
    } else {
      const fallbackEl = getPlayersPinAnchor();
      if (fallbackEl) {
        const pr = fallbackEl.getBoundingClientRect();
        wrapper.style.left = `${pr.left}px`;
        wrapper.style.bottom = `${window.innerHeight - pr.top}px`;
      } else {
        wrapper.style.left = '50%';
        wrapper.style.bottom = '20px';
      }
    }
  }

  function updateSliderWidth() {
    const pl = document.getElementById('players');
    if (!pl) return;
    const w = pl.offsetWidth * SLIDER_WIDTH_FACTOR;
    slider.style.width = `${Math.max(w, SLIDER_MIN_WIDTH)}px`;
  }

  updateSliderWidth();
  if (!document.getElementById('players')) {
    slider.style.width = `${SLIDER_MIN_WIDTH}px`;
  }

  _uiScaleEl = document.getElementById('ui-top')?.closest('[style*="--ui-scale"]') ?? null;

  applyUiScale();

  if (_uiScaleEl) {
    _mutationObserver = new MutationObserver(() => applyUiScale());
    _mutationObserver.observe(_uiScaleEl, { attributes: true, attributeFilter: ['style'] });
  }

  const playersForObserver = document.getElementById('players');
  if (playersForObserver) {
    _resizeObserver = new ResizeObserver(() => {
      try {
        updateSliderWidth();
        if (game.settings.get(MODULE_ID, 'pinned')) {
          ensureSpacerInFlow();
          syncWrapperToSpacer();
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | ResizeObserver callback failed:`, e);
      }
    });
    _resizeObserver.observe(playersForObserver);
  }

  _windowResizeHandler = () => {
    try {
      if (!wrapperElement?.isConnected) return;
      if (game.settings.get(MODULE_ID, 'pinned')) {
        syncWrapperToSpacer();
      } else {
        const rect = wrapperElement.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const clampedX = Math.max(0, Math.min(rect.left, vw - rect.width));
        const clampedY = Math.max(0, Math.min(rect.top, vh - rect.height));
        if (clampedX !== rect.left || clampedY !== rect.top) {
          wrapperElement.style.left = `${clampedX}px`;
          wrapperElement.style.top = `${clampedY}px`;
          wrapperElement.style.bottom = '';
        }
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Window resize handler failed:`, e);
    }
  };
  window.addEventListener('resize', _windowResizeHandler);
}
