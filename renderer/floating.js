const toggleButton = document.getElementById('toggle');
const toggleFace = document.getElementById('toggle-face');
const panel = document.getElementById('panel');
const root = document.getElementById('root');
const colorsWrap = document.getElementById('colors');
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));

let overlayActive = false;
let currentMode = 'none';
let penColor = '#FF4444';
let colorPresets = ['#FF4444', '#4488FF', '#44DD88', '#FFD700', '#FFFFFF'];
let dragState = null;

function renderTools() {
  toolButtons.forEach((button) => {
    const mode = button.dataset.mode;
    button.classList.toggle('active', overlayActive && currentMode === mode);
  });
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
  renderColors();
}

async function triggerOverlayToggle() {
  await window.electronAPI.toggleOverlay(!overlayActive);
}

toggleButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  dragState = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    startWindowX: window.screenX,
    startWindowY: window.screenY,
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
      dragState.startWindowX + dx,
      dragState.startWindowY + dy,
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

window.electronAPI.onFloatingState((state) => {
  if (typeof state.overlayActive === 'boolean') overlayActive = state.overlayActive;
  if (typeof state.mode === 'string') currentMode = state.mode;
  if (typeof state.penColor === 'string') penColor = state.penColor;
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
  colorPresets = Array.isArray(state.colorPresets) ? state.colorPresets : colorPresets;
  render();
});
