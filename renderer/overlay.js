const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const cursorCanvas = document.getElementById('cursor-canvas');
const cursorCtx = cursorCanvas.getContext('2d');
const highlightCanvas = document.createElement('canvas');
const highlightCtx = highlightCanvas.getContext('2d');
const hud = document.getElementById('hud');
const hudDot = document.getElementById('hud-dot');
const hudLabel = document.getElementById('hud-label');
const colorSwatch = document.getElementById('color-swatch');
const sizeLabel = document.getElementById('size-label');
const floatingRoot = document.getElementById('floating-root');
const toggleButton = document.getElementById('toggle');
const panel = document.getElementById('panel');
const colorsWrap = document.getElementById('colors');
const clearAllButton = document.getElementById('clear-all-btn');
const toolButtons = Array.from(document.querySelectorAll('.tool-btn[data-mode]'));
const sizeControls = Array.from(document.querySelectorAll('.size-control'));
const sizeInputs = {
  draw: document.getElementById('size-draw'),
  highlight: document.getElementById('size-highlight'),
  eraser: document.getElementById('size-eraser'),
};
const sizeValueEls = {
  draw: document.getElementById('size-draw-value'),
  highlight: document.getElementById('size-highlight-value'),
  eraser: document.getElementById('size-eraser-value'),
};

let mode = 'none';
let overlayActive = false;
let isDrawing = false;
let penColor = '#FF4444';
let drawSize = 4;
let highlightSize = 4;
let eraserSize = 4;
let colorPresets = ['#FF4444', '#4488FF', '#44DD88', '#FFD700', '#FFFFFF'];
let paths = [];
let currentPath = null;
let lastCursorPos = null;
let dragState = null;
let floatingPos = null;
let hoveringFloating = false;
let canvasDpr = window.devicePixelRatio || 1;
let showFloatingControls = true;
let showHud = true;
// Authoritative display dimensions from main process (fallback to window.innerWidth)
let knownDisplayWidth = null;
let knownDisplayHeight = null;

const CURSOR_MODES = new Set(['draw', 'highlight', 'eraser']);
const MODE_INFO = {
  draw: { label: '펜', dotClass: 'draw', showColor: true },
  highlight: { label: '형광펜', dotClass: 'highlight', showColor: true },
  eraser: { label: '지우개', dotClass: 'eraser', showColor: false },
  none: { label: '', dotClass: '', showColor: false },
};

function logicalW() { return window.innerWidth; }
function logicalH() { return window.innerHeight; }

function coordScale() { return window.devicePixelRatio || 1; }
function screenW() { return logicalW() * coordScale(); }
function screenH() { return logicalH() * coordScale(); }
function cssToNative(value) { return value * coordScale(); }
function nativeToCss(value) { return value / coordScale(); }

function getToolSize(toolMode = mode) {
  if (toolMode === 'highlight') return highlightSize;
  if (toolMode === 'eraser') return eraserSize;
  return drawSize;
}

function defaultFloatingPos() {
  return {
    x: screenW() - cssToNative(50) - cssToNative(24),
    y: cssToNative(24),
  };
}

function clampFloatingPos(x, y) {
  const margin = cssToNative(8);
  const buttonSize = cssToNative(50);
  return {
    x: Math.max(margin, Math.min(x, screenW() - buttonSize - margin)),
    y: Math.max(margin, Math.min(y, screenH() - buttonSize - margin)),
  };
}

function getFloatingPos() {
  if (!floatingPos) floatingPos = defaultFloatingPos();
  floatingPos = clampFloatingPos(floatingPos.x, floatingPos.y);
  return floatingPos;
}

function shouldExpandRight() {
  const pos = getFloatingPos();
  return pos.x + cssToNative(25) < screenW() / 2;
}

function applyFloatingPosition() {
  const pos = getFloatingPos();
  const expandRight = shouldExpandRight();
  floatingRoot.classList.toggle('expand-right', expandRight);

  const totalWidthCss = floatingRoot.offsetWidth || 50;
  const buttonWidthCss = toggleButton.offsetWidth || 50;
  const totalWidth = cssToNative(totalWidthCss);
  const extraWidth = cssToNative(Math.max(0, totalWidthCss - buttonWidthCss));
  const anchoredLeft = expandRight ? pos.x : pos.x - extraWidth;
  const clampedLeft = Math.max(cssToNative(8), Math.min(anchoredLeft, screenW() - totalWidth - cssToNative(8)));
  const clampedTop = Math.max(cssToNative(8), Math.min(pos.y, screenH() - cssToNative(50) - cssToNative(8)));

  floatingRoot.style.left = `${nativeToCss(clampedLeft)}px`;
  floatingRoot.style.top = `${nativeToCss(clampedTop)}px`;
}

function syncIgnoreMouse() {
  const needsCanvasMouse = overlayActive && CURSOR_MODES.has(mode);
  const allowMouse = needsCanvasMouse || (showFloatingControls && (hoveringFloating || !!dragState));
  window.electronAPI.setIgnoreMouse(!allowMouse);
}

function renderTools() {
  toolButtons.forEach((button) => {
    const toolMode = button.dataset.mode;
    button.classList.toggle('active', overlayActive && mode === toolMode);
  });
}

function renderSizeControls() {
  sizeControls.forEach((control) => {
    const toolMode = control.dataset.sizeMode;
    const active = overlayActive && mode === toolMode;
    control.classList.toggle('active', active);
  });

  for (const [toolMode, input] of Object.entries(sizeInputs)) {
    if (!input) continue;
    const size = getToolSize(toolMode);
    input.value = String(size);
    input.disabled = !(overlayActive && mode === toolMode);
    if (sizeValueEls[toolMode]) {
      sizeValueEls[toolMode].textContent = String(size);
    }
  }
}

function renderColors() {
  colorsWrap.innerHTML = '';
  colorPresets.forEach((color) => {
    const button = document.createElement('button');
    button.className = 'color-btn';
    button.style.background = color;
    button.classList.toggle('active', overlayActive && color.toUpperCase() === penColor.toUpperCase());
    button.addEventListener('click', () => {
      if (!overlayActive) return;
      window.electronAPI.setOverlayColor(color);
    });
    colorsWrap.appendChild(button);
  });
}

function updateHUD() {
  if (!showHud || !overlayActive || mode === 'none') {
    hud.classList.remove('visible');
    return;
  }

  const info = MODE_INFO[mode] || MODE_INFO.none;
  hud.classList.add('visible');
  hudLabel.textContent = info.label;
  hudDot.className = `hud-dot ${info.dotClass}`;

  if (info.showColor) {
    colorSwatch.style.background = penColor;
    colorSwatch.style.display = 'block';
    document.documentElement.style.setProperty('--pen-color', penColor);
  } else {
    colorSwatch.style.display = 'none';
  }

  sizeLabel.textContent = `${getToolSize()}px`;
}

function renderFloating() {
  floatingRoot.style.display = showFloatingControls ? 'flex' : 'none';
  if (!showFloatingControls) {
    hoveringFloating = false;
    dragState = null;
    syncIgnoreMouse();
    return;
  }

  toggleButton.textContent = overlayActive ? 'ON' : 'OFF';
  toggleButton.classList.toggle('on', overlayActive);
  panel.classList.toggle('visible', overlayActive);
  applyFloatingPosition();
  renderTools();
  renderSizeControls();
  renderColors();
  syncIgnoreMouse();
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvasDpr = dpr;
  const width = logicalW();
  const height = logicalH();


  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  cursorCanvas.width = Math.round(width * dpr);
  cursorCanvas.height = Math.round(height * dpr);
  cursorCanvas.style.width = `${width}px`;
  cursorCanvas.style.height = `${height}px`;
  cursorCtx.setTransform(1, 0, 0, 1, 0, 0);
  cursorCtx.scale(dpr, dpr);

  highlightCanvas.width = Math.round(width * dpr);
  highlightCanvas.height = Math.round(height * dpr);
  highlightCtx.setTransform(1, 0, 0, 1, 0, 0);
  highlightCtx.scale(dpr, dpr);

  applyFloatingPosition();
  redrawAll();
  refreshCursor();
}

function clearScreen() {
  ctx.clearRect(0, 0, logicalW(), logicalH());
}

function clearHighlightLayer() {
  highlightCtx.clearRect(0, 0, logicalW(), logicalH());
}

function redrawAll() {
  clearScreen();
  for (const path of paths) drawPath(path);
}

function traceStroke(targetCtx, path) {
  if (!path.points || path.points.length === 0) return;

  if (path.points.length === 1) {
    const point = path.points[0];
    targetCtx.beginPath();
    targetCtx.arc(point.x, point.y, Math.max(path.size / 2, 1), 0, Math.PI * 2);
    targetCtx.fill();
    return;
  }

  const points = path.points;
  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    targetCtx.lineTo(points[1].x, points[1].y);
    targetCtx.stroke();
    return;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    targetCtx.quadraticCurveTo(current.x, current.y, midX, midY);
  }

  const last = points[points.length - 1];
  targetCtx.lineTo(last.x, last.y);
  targetCtx.stroke();
}

function drawPathToContext(targetCtx, path, options = {}) {
  const color = options.color ?? path.color;
  const composite = options.composite ?? (path.type === 'eraser' ? 'destination-out' : 'source-over');

  targetCtx.save();
  targetCtx.globalCompositeOperation = composite;
  targetCtx.globalAlpha = 1;
  targetCtx.lineWidth = path.size;
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.strokeStyle = color;
  targetCtx.fillStyle = color;
  traceStroke(targetCtx, path);
  targetCtx.restore();
}

function drawPath(path) {
  if (!path.points || path.points.length === 0) return;

  if (path.type === 'highlight') {
    clearHighlightLayer();
    drawPathToContext(highlightCtx, path, { color: path.baseColor || path.color, composite: 'source-over' });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = path.alpha ?? 0.35;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(highlightCanvas, 0, 0);
    ctx.restore();
    return;
  }

  drawPathToContext(ctx, path);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function updateCursorStyle() {
  canvas.style.cursor = CURSOR_MODES.has(mode) ? 'none' : 'default';
}

function drawCursor(x, y) {
  cursorCtx.clearRect(0, 0, logicalW(), logicalH());

  if (mode === 'draw' || mode === 'highlight') {
    const radius = Math.max(getToolSize() / 2, 2);
    cursorCtx.save();
    cursorCtx.beginPath();
    cursorCtx.arc(x, y, radius, 0, Math.PI * 2);
    cursorCtx.fillStyle = mode === 'highlight' ? hexToRgba(penColor, 0.45) : penColor;
    cursorCtx.fill();
    cursorCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    cursorCtx.lineWidth = 1.2;
    cursorCtx.stroke();
    cursorCtx.restore();
  } else if (mode === 'eraser') {
    const radius = Math.max(getToolSize() * 3, 20) / 2;
    cursorCtx.save();
    cursorCtx.beginPath();
    cursorCtx.arc(x, y, radius, 0, Math.PI * 2);
    cursorCtx.strokeStyle = 'rgba(255,255,255,0.85)';
    cursorCtx.lineWidth = 1.4;
    cursorCtx.stroke();
    cursorCtx.restore();
  }
}

function refreshCursor() {
  if (lastCursorPos && CURSOR_MODES.has(mode)) {
    drawCursor(lastCursorPos.x, lastCursorPos.y);
  } else {
    clearCursor();
  }
}

function clearCursor() {
  cursorCtx.clearRect(0, 0, logicalW(), logicalH());
  lastCursorPos = null;
}

function getEventPoint(event) {
  return {
    x: Math.max(0, Math.min(logicalW(), event.clientX)),
    y: Math.max(0, Math.min(logicalH(), event.clientY)),
  };
}

canvas.addEventListener('mousedown', (event) => {
  if (!overlayActive) return;
  if (!CURSOR_MODES.has(mode)) return;
  if (event.button === 2) return;

  const point = getEventPoint(event);

  isDrawing = true;
  const isEraser = mode === 'eraser';
  const isHighlight = mode === 'highlight';
  currentPath = {
    type: mode,
    color: penColor,
    baseColor: penColor,
    alpha: isHighlight ? 0.35 : 1,
    size: isEraser
      ? Math.max(getToolSize('eraser') * 3, 20)
      : (isHighlight
        ? Math.max(getToolSize('highlight') * 2.2, getToolSize('highlight') + 6)
        : getToolSize('draw')),
    points: [point],
  };
  paths.push(currentPath);
  redrawAll();
});

canvas.addEventListener('mousemove', (event) => {
  const point = getEventPoint(event);
  lastCursorPos = point;
  if (CURSOR_MODES.has(mode)) drawCursor(point.x, point.y);

  if (!isDrawing || !currentPath) return;

  const points = currentPath.points;
  const cur = point;
  const prev = points[points.length - 1];
  if (prev && prev.x === cur.x && prev.y === cur.y) return;
  points.push(cur);
  redrawAll();
});

canvas.addEventListener('mouseup', () => {
  if (!isDrawing) return;
  isDrawing = false;
  if (currentPath && currentPath.points.length < 2) {
    paths.pop();
  }
  currentPath = null;
  redrawAll();
});

canvas.addEventListener('mouseleave', () => {
  clearCursor();
  if (isDrawing) {
    isDrawing = false;
    currentPath = null;
    redrawAll();
  }
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (paths.length > 0) {
    paths.pop();
    redrawAll();
  }
});

toggleButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.stopPropagation();
  const pos = getFloatingPos();
  dragState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLeft: pos.x,
    startTop: pos.y,
    moved: false,
  };
  hoveringFloating = true;
  syncIgnoreMouse();
  toggleButton.setPointerCapture(event.pointerId);
});

toggleButton.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const dx = event.clientX - dragState.startClientX;
  const dy = event.clientY - dragState.startClientY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    dragState.moved = true;
    const clamped = clampFloatingPos(
      dragState.startLeft + cssToNative(dx),
      dragState.startTop + cssToNative(dy),
    );
    floatingPos = clamped;
    applyFloatingPosition();
    window.electronAPI.setFloatingPosition(nativeToCss(clamped.x), nativeToCss(clamped.y));
  }
});

toggleButton.addEventListener('pointerup', async (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const shouldToggle = !dragState.moved;
  dragState = null;
  if (shouldToggle) {
    await window.electronAPI.toggleOverlay(!overlayActive);
  }
  syncIgnoreMouse();
});

toggleButton.addEventListener('pointercancel', () => {
  dragState = null;
  syncIgnoreMouse();
});

toolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!overlayActive) return;
    window.electronAPI.setOverlayMode(button.dataset.mode);
  });
});

clearAllButton?.addEventListener('click', () => {
  if (!overlayActive) return;
  window.electronAPI.clearCanvas();
});

Object.entries(sizeInputs).forEach(([toolMode, input]) => {
  if (!input) return;
  input.addEventListener('input', () => {
    const size = Number(input.value);
    if (sizeValueEls[toolMode]) {
      sizeValueEls[toolMode].textContent = String(size);
    }
    window.electronAPI.setOverlaySize(toolMode, size);
  });
});

window.addEventListener('mousemove', (event) => {
  if (!showFloatingControls) return;
  const rect = floatingRoot.getBoundingClientRect();
  const inside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  if (inside !== hoveringFloating && !dragState) {
    hoveringFloating = inside;
    syncIgnoreMouse();
  }
});

window.addEventListener('resize', resizeCanvas);

function applyOverlayState(payload) {
  if (!payload) return;

  if (typeof payload.overlayActive === 'boolean') {
    overlayActive = payload.overlayActive;
    if (overlayActive) {
      document.body.style.backgroundColor = 'rgba(0,0,0,0.005)';
    } else {
      document.body.style.backgroundColor = 'transparent';
      isDrawing = false;
      currentPath = null;
      clearCursor();
    }
  }

  if (typeof payload.mode === 'string') {
    mode = payload.mode;
  }

  if (payload.penColor) {
    penColor = payload.penColor;
  }

  if (typeof payload.penSize === 'number') {
    drawSize = payload.penSize;
  }

  if (typeof payload.drawSize === 'number') {
    drawSize = payload.drawSize;
  }

  if (typeof payload.highlightSize === 'number') {
    highlightSize = payload.highlightSize;
  }

  if (typeof payload.eraserSize === 'number') {
    eraserSize = payload.eraserSize;
  }

  if (Array.isArray(payload.colorPresets)) {
    colorPresets = payload.colorPresets;
  }

  if (typeof payload.showFloatingControls === 'boolean') {
    showFloatingControls = payload.showFloatingControls;
  }

  if (typeof payload.showHud === 'boolean') {
    showHud = payload.showHud;
  }

  // Store display dimensions from main process for canvas sizing
  if (typeof payload.displayWidth === 'number' && typeof payload.displayHeight === 'number') {
    knownDisplayWidth = payload.displayWidth;
    knownDisplayHeight = payload.displayHeight;
  }

  if (payload.floatingPosition && typeof payload.floatingPosition.x === 'number' && typeof payload.floatingPosition.y === 'number') {
    floatingPos = clampFloatingPos(cssToNative(payload.floatingPosition.x), cssToNative(payload.floatingPosition.y));
  } else if (!floatingPos) {
    floatingPos = defaultFloatingPos();
  }

  resizeCanvas();
  updateHUD();
  updateCursorStyle();
  refreshCursor();
  renderFloating();
}

resizeCanvas();
window.electronAPI.getOverlayState().then(applyOverlayState);
window.electronAPI.onOverlayState((state) => applyOverlayState(state));

window.electronAPI.onClearCanvas(() => {
  paths = [];
  currentPath = null;
  isDrawing = false;
  redrawAll();
});

window.electronAPI.onUndo(() => {
  if (paths.length > 0) {
    paths.pop();
    redrawAll();
  }
});
