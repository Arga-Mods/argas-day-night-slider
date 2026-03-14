const MODULE_ID = 'argas-day-night-slider';
const SNAP_THRESHOLD = 18;
const SLIDER_WIDTH_FACTOR = 2.0;
const SLIDER_MIN_WIDTH = 100;

let sliderElement = null;
let wrapperElement = null;
let spacerElement = null;

let _resizeObserver = null;
let _sidebarObserver = null;
let _sceneNavObserver = null;
let _mutationObserver = null;
let _debounceTimer = null;
let _uiScaleEl = null;
let _windowResizeHandler = null;
let _snapTargetCache = null;
let _snapTargetCacheTimer = null;
let _pushedBySidebar = false;
let _snappedToSidebar = false;
let _isRespondingToSiblingMove = false; // Verhindert Endlosschleifen beim Widget-zu-Widget-Sync.
let _isDragging = false; // Module-level damit sync-Funktionen darauf zugreifen können.
let _justDocked = false; // Unterdrückt Event-Dispatch direkt nach eigenem Dock-Vorgang.
// Merkt sich den dockTarget des Benny Panels zum Zeitpunkt des Andockens.
// Nur wenn Benny seinen Target ÄNDERT, wird die Verbindung getrennt.
// null = kein aktives Widget-zu-Widget-Docking (→ altes Verhalten beibehalten).
let _lastKnownBennyTarget = null;

function cleanupListenersAndObservers() {
  clearTimeout(_debounceTimer);
  _debounceTimer = null;
  clearTimeout(_snapTargetCacheTimer);
  _snapTargetCacheTimer = null;
  _snapTargetCache = null;
  _pushedBySidebar = false;
  _snappedToSidebar = false;
  _lastKnownBennyTarget = null;
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  if (_sidebarObserver) {
    _sidebarObserver.disconnect();
    _sidebarObserver = null;
  }
  if (_sceneNavObserver) {
    _sceneNavObserver.disconnect();
    _sceneNavObserver = null;
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
  if (!wrapperElement.style.transformOrigin) {
    wrapperElement.style.transformOrigin = 'left bottom';
  }
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

  game.settings.register(MODULE_ID, 'pinTarget', {
    name: 'Pin Target',
    scope: 'client',
    config: false,
    type: String,
    default: 'players'
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
      padding: 4px 8px 13px 5px;
      user-select: none;
      min-width: max-content;
    }
    .dns-wrapper.dns-dragging { opacity: 0.85; }
    .dns-wrapper.dns-jiggling .dns-container {
      animation: dns-jiggle 0.2s infinite;
    }
    .dns-handle {
      width: 24px; height: 10px; margin-bottom: 8px;
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
    if (game.settings.get(MODULE_ID, 'pinTarget') !== 'players') return;
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

const handleSceneNavRender = () => {
  try {
    if (!game.settings.get(MODULE_ID, 'pinned')) return;
    if (game.settings.get(MODULE_ID, 'pinTarget') !== 'scene') return;
    syncWrapperToSceneAnchor();
  } catch (e) {
    console.warn(`${MODULE_ID} | Scene nav render handler failed:`, e);
  }
};

Hooks.on('renderSceneNavigation', handleSceneNavRender);

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
  wrapperElement.style.transformOrigin = 'left bottom';

  if (!_isRespondingToSiblingMove && !_isDragging && !_justDocked) {
    window.dispatchEvent(new CustomEvent('argas:widgetMoved', { detail: { source: MODULE_ID } }));
  }
}

function syncWrapperToSceneAnchor() {
  if (!wrapperElement) return;
  const anchor = getScenePinAnchor();
  if (!anchor) return;

  const ar = anchor.getBoundingClientRect();
  wrapperElement.style.left = `${ar.left}px`;
  wrapperElement.style.top = `${ar.bottom}px`;
  wrapperElement.style.bottom = '';
  wrapperElement.style.transformOrigin = 'left top';

  if (!_isRespondingToSiblingMove && !_isDragging && !_justDocked) {
    window.dispatchEvent(new CustomEvent('argas:widgetMoved', { detail: { source: MODULE_ID } }));
  }
}

function syncWrapperToBennyPanel(position) {
  if (!wrapperElement) return;
  const benny = window.ArgasMods?.bennyPanel;
  if (!benny?.isConnected) return;

  const br = benny.getBoundingClientRect();
  wrapperElement.style.left = `${br.left}px`;
  if (position === 'above') {
    wrapperElement.style.bottom = `${window.innerHeight - br.top + 5}px`;
    wrapperElement.style.top = '';
    wrapperElement.style.transformOrigin = 'left bottom';
  } else {
    wrapperElement.style.top = `${br.bottom + 5}px`;
    wrapperElement.style.bottom = '';
    wrapperElement.style.transformOrigin = 'left top';
  }

  if (!_isRespondingToSiblingMove && !_isDragging && !_justDocked) {
    window.dispatchEvent(new CustomEvent('argas:widgetMoved', { detail: { source: MODULE_ID } }));
  }
}

function pinApp(target = 'players') {
  if (!wrapperElement) return false;

  if (wrapperElement.parentElement !== document.body) {
    document.body.appendChild(wrapperElement);
  }
  wrapperElement.classList.add('dns-pinned');

  if (target === 'scene') {
    syncWrapperToSceneAnchor();
  } else if (target === 'widget-benny-above') {
    syncWrapperToBennyPanel('above');
  } else if (target === 'widget-benny-below') {
    syncWrapperToBennyPanel('below');
  } else {
    if (!spacerElement) return false;
    const anchor = getPlayersPinAnchor();
    if (!anchor) return false;
    ensureSpacerInFlow();
    syncWrapperToSpacer();
  }

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
  wrapperElement.style.transformOrigin = 'left bottom';

  return true;
}

function getScenePinAnchor() {
  const nav = document.getElementById('scene-navigation');
  if (nav?.classList.contains('expanded')) {
    const inactive = document.getElementById('scene-navigation-inactive');
    const lastLi = inactive?.querySelector('li:last-child');
    if (lastLi) return lastLi;
  }
  return document.getElementById('scene-navigation-active');
}

function computePinZone(clientX, clientY) {
  // Benny Panel Widget zuerst prüfen (höhere Priorität als native Dock-Ziele).
  const benny = window.ArgasMods?.bennyPanel;
  if (benny?.isConnected) {
    let bennyDockedToDns = false;
    try {
      const dt = game.settings.get('argas-benny-and-wound-panel-swade', 'dockTarget') ?? '';
      bennyDockedToDns = dt.startsWith('widget-dns');
    } catch (_) {}

    if (!bennyDockedToDns) {
      const br = benny.getBoundingClientRect();
      const nearX = clientX >= br.left - 80 && clientX <= br.right + 80;
      const nearY = clientY >= br.top  - 80 && clientY <= br.bottom + 80;
      if (nearX && nearY) {
        return clientY < (br.top + br.bottom) / 2 ? 'widget-benny-above' : 'widget-benny-below';
      }
    }
  }

  const playersAnchor = getPlayersPinAnchor();
  if (playersAnchor) {
    const rect = playersAnchor.getBoundingClientRect();
    if (clientX < rect.left + rect.width &&
        clientY > rect.top - 80) {
      return 'players';
    }
  }

  const sceneAnchor = getScenePinAnchor();
  if (sceneAnchor) {
    const rect = sceneAnchor.getBoundingClientRect();
    if (clientX < rect.right + 40 &&
        clientY < rect.bottom + 80) {
      return 'scene';
    }
  }

  return false;
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

  const uiScale = parseFloat(
    getComputedStyle(_uiScaleEl || document.documentElement)
      .getPropertyValue('--ui-scale')
  ) || 1;
  const leftMargin = 15 * uiScale;

  if (Math.abs(x - leftMargin) < SNAP_THRESHOLD)       { sx = leftMargin; bestDx = 0; }
  if (Math.abs(x + wrapperW - vw) < SNAP_THRESHOLD)  { sx = vw - wrapperW; bestDx = 0; }
  if (Math.abs(y) < SNAP_THRESHOLD)                   { sy = 0; bestDy = 0; }
  if (Math.abs(y + wrapperH - vh) < SNAP_THRESHOLD)   { sy = vh - wrapperH; bestDy = 0; }

  // Snap line: right edge of left toolbar (column 2), top half of screen
  if (y + wrapperH > 0 && y < vh / 2) {
    const col2 = document.getElementById('ui-left-column-2')
      || document.getElementById('ui-left-column-1');
    if (col2) {
      const lineX = col2.getBoundingClientRect().right + 15 * uiScale;
      const distLeft  = Math.abs(x - lineX);
      const distRight = Math.abs(x + wrapperW - lineX);
      if (distLeft < bestDx)  { bestDx = distLeft;  sx = lineX; }
      if (distRight < bestDx) { bestDx = distRight; sx = lineX - wrapperW; }
    }
  }

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
  wrapper.classList.add('dns-wrapper', 'faded-ui');
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

  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let wasPinnedAtStart = false;
  let wasPinTargetAtStart = 'players';
  let hasUnpinnedOnThisDrag = false;
  let inPinZone = false;
  let _dragCaptureTarget = null;

  function startDrag(ev, captureTarget) {
    _isDragging = true;
    _dragCaptureTarget = captureTarget;
    wasPinnedAtStart = wrapper.classList.contains('dns-pinned');
    try { wasPinTargetAtStart = game.settings.get(MODULE_ID, 'pinTarget'); } catch (_) {}
    hasUnpinnedOnThisDrag = false;
    inPinZone = false;
    _snappedToSidebar = false;
    _pushedBySidebar = false;

    const rect = wrapper.getBoundingClientRect();
    dragOffsetX = ev.clientX - rect.left;
    dragOffsetY = ev.clientY - rect.top;

    try { captureTarget.setPointerCapture(ev.pointerId); } catch (_) { /* ignored */ }
    wrapper.classList.add('dns-dragging');
    wrapper.style.cursor = 'grabbing';
    ev.preventDefault();
  }

  function onDragMove(ev) {
    if (!_isDragging) return;

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
      if (inPinZone === 'scene') {
        syncWrapperToSceneAnchor();
      } else if (inPinZone === 'widget-benny-above') {
        syncWrapperToBennyPanel('above');
      } else if (inPinZone === 'widget-benny-below') {
        syncWrapperToBennyPanel('below');
      } else {
        syncWrapperToSpacer();
      }
      applyUiScale();
      wrapper.classList.add('dns-jiggling');
    } else {
      const wRect = wrapper.getBoundingClientRect();
      const scale = wrapper.offsetHeight
        ? (wRect.height / wrapper.offsetHeight)
        : 1;
      const snapped = snapPosition(rawX, rawY, wRect.width, wRect.height);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clampedX = Math.max(15 * scale, Math.min(snapped.x, vw - wRect.width));
      const clampedY = Math.max(0, Math.min(snapped.y, vh - wRect.height));
      wrapper.style.left = `${clampedX}px`;
      wrapper.style.top  = `${clampedY - wrapper.offsetHeight * (1 - scale)}px`;
      wrapper.style.bottom = '';
      wrapper.classList.remove('dns-jiggling');
    }
  }

  async function onDragEnd(ev) {
    if (!_isDragging) return;
    _isDragging = false;
    wrapper.classList.remove('dns-dragging');
    wrapper.style.cursor = '';
    wrapper.classList.remove('dns-jiggling');

    const droppedInPinZone = computePinZone(ev.clientX, ev.clientY) || inPinZone;

    try {
      if (droppedInPinZone) {
        const target = typeof droppedInPinZone === 'string' ? droppedInPinZone : 'players';
        _justDocked = true;
        pinApp(target);
        _justDocked = false;
        // Benny-Docking: aktuellen dockTarget merken, bevor async-Saves
        // potenzielle argas:widgetMoved Events auslösen können.
        if (target === 'widget-benny-above' || target === 'widget-benny-below') {
          try {
            _lastKnownBennyTarget = game.settings.get('argas-benny-and-wound-panel-swade', 'dockTarget');
          } catch (_) { _lastKnownBennyTarget = null; }
        }
        await game.settings.set(MODULE_ID, 'pinned', true);
        await game.settings.set(MODULE_ID, 'pinTarget', target);
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
  }

  async function onDragLost() {
    if (!_isDragging) return;
    _isDragging = false;
    wrapper.classList.remove('dns-dragging');
    wrapper.style.cursor = '';
    wrapper.classList.remove('dns-jiggling');

    try {
      if (wasPinnedAtStart) {
        pinApp(wasPinTargetAtStart);
        await game.settings.set(MODULE_ID, 'pinned', true);
        await game.settings.set(MODULE_ID, 'pinTarget', wasPinTargetAtStart);
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
  }

  // Left-click drag on handle
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    startDrag(ev, handle);
  });
  handle.addEventListener('pointermove', onDragMove);
  handle.addEventListener('pointerup', onDragEnd);
  handle.addEventListener('lostpointercapture', onDragLost);

  // Right-click drag anywhere on wrapper
  wrapper.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 2) return;
    startDrag(ev, wrapper);
  });
  wrapper.addEventListener('pointermove', onDragMove);
  wrapper.addEventListener('pointerup', onDragEnd);
  wrapper.addEventListener('lostpointercapture', onDragLost);
  wrapper.addEventListener('contextmenu', (ev) => ev.preventDefault());

  handle.addEventListener('dblclick', async () => {
    let target = 'players';
    try { target = game.settings.get(MODULE_ID, 'pinTarget'); } catch (_) {}
    pinApp(target);
    applyUiScale();
    try {
      await game.settings.set(MODULE_ID, 'pinned', true);
      await game.settings.set(MODULE_ID, 'pinTarget', target);
      await game.settings.set(MODULE_ID, 'position', { x: null, y: null });
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to save pin state:`, e);
    }
  });

  container.append(sun, slider, moon);
  wrapper.append(handle, container);
  document.body.appendChild(wrapper);

  // In gemeinsamer Registry registrieren, damit andere Arga-Module das Widget finden.
  (window.ArgasMods ??= {}).dayNightSlider = wrapper;

  const isPinned = game.settings.get(MODULE_ID, 'pinned');
  const pinTarget = game.settings.get(MODULE_ID, 'pinTarget');

  // Falls das Widget bereits an das Benny Panel angedockt ist (Session-Persistenz),
  // merken wir uns Bennys aktuellen dockTarget, damit Routine-Sync-Events
  // nicht sofort einen Disconnect auslösen.
  if (isPinned && (pinTarget === 'widget-benny-above' || pinTarget === 'widget-benny-below')) {
    try {
      _lastKnownBennyTarget = game.settings.get('argas-benny-and-wound-panel-swade', 'dockTarget');
    } catch (_) {}
  }

  ensureSpacerInFlow();

  if (isPinned) {
    pinApp(pinTarget);
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
        if (game.settings.get(MODULE_ID, 'pinned') &&
            game.settings.get(MODULE_ID, 'pinTarget') === 'players') {
          ensureSpacerInFlow();
          syncWrapperToSpacer();
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | ResizeObserver callback failed:`, e);
      }
    });
    _resizeObserver.observe(playersForObserver);
  }

  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) {
    _sidebarObserver = new ResizeObserver(() => {
      try {
        if (!wrapperElement?.isConnected) return;
        if (game.settings.get(MODULE_ID, 'pinned')) return;
        const wr = wrapperElement.getBoundingClientRect();
        const sr = sidebarEl.getBoundingClientRect();

        // Erkennung: Widget klebt an der Sidebar (einmalig pro Snap)
        if (!_snappedToSidebar && !_pushedBySidebar &&
            Math.abs(wr.right - sr.left) < SNAP_THRESHOLD && sr.width > 100) {
          _snappedToSidebar = true;
        }

        // Angesnappt: bedingungslos folgen, kein anderer Zweig darf eingreifen
        if (_snappedToSidebar) {
          wrapperElement.style.left = `${sr.left - wr.width}px`;
          wrapperElement.style.bottom = '';
          // Sidebar vollständig zugeklappt → finale Position speichern
          if (sr.width <= 60) {
            _snappedToSidebar = false;
            const newRect = wrapperElement.getBoundingClientRect();
            game.settings.set(MODULE_ID, 'position', {
              x: Math.round(newRect.left),
              y: Math.round(newRect.top)
            });
          }
          return;
        }

        // Weggedrückt: Sidebar überlappt das Widget
        if (wr.right > sr.left && sr.width > 100) {
          _pushedBySidebar = true;
          wrapperElement.style.left = `${sr.left - wr.width}px`;
          wrapperElement.style.bottom = '';
        } else if (_pushedBySidebar && sr.width <= 100) {
          _pushedBySidebar = false;
          const saved = game.settings.get(MODULE_ID, 'position');
          if (saved.x != null) {
            wrapperElement.style.left = `${saved.x}px`;
          }
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | Sidebar observer failed:`, e);
      }
    });
    _sidebarObserver.observe(sidebarEl);
  }

  const sceneNavEl = document.getElementById('scene-navigation');
  if (sceneNavEl) {
    _sceneNavObserver = new MutationObserver(() => {
      try {
        if (!wrapperElement?.isConnected) return;
        if (!game.settings.get(MODULE_ID, 'pinned')) return;
        if (game.settings.get(MODULE_ID, 'pinTarget') !== 'scene') return;
        syncWrapperToSceneAnchor();
      } catch (e) {
        console.warn(`${MODULE_ID} | Scene nav observer failed:`, e);
      }
    });
    _sceneNavObserver.observe(sceneNavEl, { attributes: true, attributeFilter: ['class'] });
  }

  _windowResizeHandler = () => {
    try {
      if (!wrapperElement?.isConnected) return;
      if (game.settings.get(MODULE_ID, 'pinned')) {
        const target = game.settings.get(MODULE_ID, 'pinTarget');
        if (target === 'scene') {
          syncWrapperToSceneAnchor();
        } else if (target === 'widget-benny-above') {
          syncWrapperToBennyPanel('above');
        } else if (target === 'widget-benny-below') {
          syncWrapperToBennyPanel('below');
        } else {
          syncWrapperToSpacer();
        }
      } else {
        const rect = wrapperElement.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const uiScale = parseFloat(
          getComputedStyle(_uiScaleEl || document.documentElement)
            .getPropertyValue('--ui-scale')
        ) || 1;

        // Gespeicherte Position als Basis nehmen, damit das Widget
        // nach einem Resize (z.B. F12 DevTools) zurückkehrt.
        const saved = game.settings.get(MODULE_ID, 'position');
        const baseX = saved.x ?? rect.left;
        const baseY = saved.y ?? rect.top;

        let clampedX = Math.max(15 * uiScale, Math.min(baseX, vw - rect.width));
        const clampedY = Math.max(0, Math.min(baseY, vh - rect.height));

        // Sidebar-Überlappung prüfen (z.B. bei F12/DevTools)
        const sb = document.getElementById('sidebar');
        if (sb) {
          const sr = sb.getBoundingClientRect();
          if (clampedX + rect.width > sr.left) {
            clampedX = sr.left - rect.width;
          }
        }

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

  // Geschwister-Widget-Sync: Wenn ein anderes Arga-Modul sein Widget bewegt,
  // prüfen ob wir an jenem Widget angedockt sind und ggf. nachziehen.
  window.addEventListener('argas:widgetMoved', (ev) => {
    if (ev.detail?.source === MODULE_ID) return;
    if (!wrapperElement?.isConnected) return;
    if (!game.settings.get(MODULE_ID, 'pinned')) return;
    const target = game.settings.get(MODULE_ID, 'pinTarget');
    if (target === 'widget-benny-above' || target === 'widget-benny-below') {
      const bennyTarget = ev.detail?.dockTarget ?? '';
      if (bennyTarget.startsWith('widget-dns')) {
        // Benny ist an uns angedockt → folgen und neuen Target merken.
        _lastKnownBennyTarget = bennyTarget;
        _isRespondingToSiblingMove = true;
        syncWrapperToBennyPanel(target === 'widget-benny-above' ? 'above' : 'below');
        _isRespondingToSiblingMove = false;
      } else if (_lastKnownBennyTarget !== null && bennyTarget === _lastKnownBennyTarget) {
        // Benny ist noch am selben Ziel wie beim Andocken → nur folgen, nicht trennen.
        // Dies verhindert, dass Routine-Sync-Events (ResizeObserver, renderPlayers)
        // einen Disconnect auslösen, obwohl Benny sich gar nicht bewegt hat.
        _isRespondingToSiblingMove = true;
        syncWrapperToBennyPanel(target === 'widget-benny-above' ? 'above' : 'below');
        _isRespondingToSiblingMove = false;
      } else {
        // Benny hat seinen Target geändert (oder _lastKnownBennyTarget ist null = Legacy)
        // → Verbindung trennen.
        _lastKnownBennyTarget = null;
        game.settings.set(MODULE_ID, 'pinned', false);
        game.settings.set(MODULE_ID, 'position', {
          x: Math.round(wrapperElement.getBoundingClientRect().left),
          y: Math.round(wrapperElement.getBoundingClientRect().top)
        });
        wrapperElement.classList.remove('dns-pinned');
        wrapperElement.style.bottom = '';
        return;
      }
    }
  });
}
