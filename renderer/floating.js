const toggleButton = document.getElementById('toggle');
const toggleFace = document.getElementById('toggle-face');
const panel = document.getElementById('panel');
const root = document.getElementById('root');
const colorsWrap = document.getElementById('colors');
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
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

let overlayActive = false;
let currentMode = 'none';
let penColor = '#FF4444';
let colorPresets = ['#FF4444', '#4488FF', '#44DD88', '#FFD700', '#FFFFFF'];
let drawSize = 4;
let highlightSize = 4;
let eraserSize = 4;
let dragState = null;

function getToolSize(toolMode = currentMode) {
  if (toolMode === 'highlight') return highlightSize;
  if (toolMode === 'eraser') return eraserSize;
  return drawSize;
}

function renderTools() {
  toolButtons.forEach((button) => {
    const mode = button.dataset.mode;
    button.classList.toggle('active', overlayActive && currentMode === mode);
  });
}

function renderSizeControls() {
  sizeControls.forEach((control) => {
    const toolMode = control.dataset.sizeMode;
    control.classList.toggle('active', overlayActive && currentMode === toolMode);
  });

  for (const [toolMode, input] of Object.entries(sizeInputs)) {
    if (!input) continue;
    const size = getToolSize(toolMode);
    input.value = String(size);
    input.disabled = !(overlayActive && currentMode === toolMode);
    if (sizeValueEls[toolMode]) sizeValueEls[toolMode].textContent = String(size);
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

function render() {
  toggleFace.textContent = overlayActive ? 'ON' : 'OFF';
  toggleButton.classList.toggle('on', overlayActive);
  panel.classList.toggle('visible', overlayActive);
  renderTools();
  renderSizeControls();
  renderColors();
}

async function triggerOverlayToggle() {
  await window.electronAPI.toggleOverlay(!overlayActive);
}

toggleButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const toggleRect = toggleButton.getBoundingClientRect();
  dragState = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    startAnchorX: window.screenX + toggleRect.left,
    startAnchorY: window.screenY + toggleRect.top,
    moved: false,
  };
  toggleButton.setPointerCapture(event.pointerId);
});

toggleButton.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const dx = event.screenX - dragState.startScreenX;
  const dy = event.screenY - dragState.startScreenY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    dragState.moved = true;
    window.electronAPI.setFloatingPosition(
      dragState.startAnchorX + dx,
      dragState.startAnchorY + dy,
    );
  }
});

toggleButton.addEventListener('pointerup', async (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const shouldToggle = !dragState.moved;
  dragState = null;

  if (shouldToggle) {
    await triggerOverlayToggle();
  }
});

toggleButton.addEventListener('pointercancel', () => {
  dragState = null;
});

toggleButton.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    await triggerOverlayToggle();
  }
});

toolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!overlayActive) return;
    window.electronAPI.setOverlayMode(button.dataset.mode);
  });
});

const clearAllButton = document.getElementById('clear-all-btn');
clearAllButton?.addEventListener('click', () => {
  if (!overlayActive) return;
  window.electronAPI.clearCanvas();
});

Object.entries(sizeInputs).forEach(([toolMode, input]) => {
  if (!input) return;
  input.addEventListener('input', () => {
    const size = Number(input.value);
    if (sizeValueEls[toolMode]) sizeValueEls[toolMode].textContent = String(size);
    window.electronAPI.setOverlaySize(toolMode, size);
  });
});

window.electronAPI.onFloatingState((state) => {
  if (typeof state.overlayActive === 'boolean') overlayActive = state.overlayActive;
  if (typeof state.mode === 'string') currentMode = state.mode;
  if (typeof state.penColor === 'string') penColor = state.penColor;
  if (typeof state.drawSize === 'number') drawSize = state.drawSize;
  if (typeof state.highlightSize === 'number') highlightSize = state.highlightSize;
  if (typeof state.eraserSize === 'number') eraserSize = state.eraserSize;
  if (Array.isArray(state.colorPresets)) colorPresets = state.colorPresets;
  render();
});

window.electronAPI.onFloatingDirection((expandRight) => {
  root.classList.toggle('expand-right', !!expandRight);
});

window.electronAPI.getOverlayState().then((state) => {
  overlayActive = !!state.overlayActive;
  currentMode = state.mode || 'none';
  penColor = state.penColor || '#FF4444';
  drawSize = typeof state.drawSize === 'number' ? state.drawSize : drawSize;
  highlightSize = typeof state.highlightSize === 'number' ? state.highlightSize : highlightSize;
  eraserSize = typeof state.eraserSize === 'number' ? state.eraserSize : eraserSize;
  colorPresets = Array.isArray(state.colorPresets) ? state.colorPresets : colorPresets;
  render();
});
