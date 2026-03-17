const hud = document.getElementById('hud');
const hudDot = document.getElementById('hud-dot');
const hudLabel = document.getElementById('hud-label');
const colorSwatch = document.getElementById('color-swatch');
const sizeLabel = document.getElementById('size-label');

const MODE_INFO = {
  draw: { label: '펜', dotClass: 'draw', showColor: true },
  highlight: { label: '형광펜', dotClass: 'highlight', showColor: true },
  eraser: { label: '지우개', dotClass: 'eraser', showColor: false },
  none: { label: '', dotClass: '', showColor: false },
};

function applyHudState(payload) {
  if (!payload?.visible || !payload?.mode || payload.mode === 'none') {
    hud.classList.remove('visible');
    return;
  }

  const info = MODE_INFO[payload.mode] || MODE_INFO.none;
  hud.classList.add('visible');
  hudLabel.textContent = info.label;
  hudDot.className = `hud-dot ${info.dotClass}`;

  if (info.showColor && payload.penColor) {
    colorSwatch.style.background = payload.penColor;
    colorSwatch.style.display = 'block';
    document.documentElement.style.setProperty('--pen-color', payload.penColor);
  } else {
    colorSwatch.style.display = 'none';
  }

  sizeLabel.textContent = `${payload.penSize || 0}px`;
}

window.electronAPI.onHudState((state) => {
  applyHudState(state);
});
