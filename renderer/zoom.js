// ── Elements ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('zoom-canvas');
const ctx = canvas.getContext('2d');
const badge = document.getElementById('badge');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── IPC: receive pre-cropped JPEG frames from main process ────────────────────
// Main process uses desktopCapturer.getSources (respects setContentProtection)
// so the zoom window itself never appears in the captured image.

const frameImg = new Image();

window.electronAPI.onZoomFrame((data) => {
  // data: { jpeg: base64, dstX, dstY, dstW, dstH, viewW, viewH }
  // dstX/Y/W/H place the captured region so the cursor lands at canvas center.
  // Any out-of-bounds area (near screen edges) is filled with black.
  frameImg.onload = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, data.viewW, data.viewH);
    ctx.drawImage(frameImg, data.dstX, data.dstY, data.dstW, data.dstH);
  };
  frameImg.src = 'data:image/jpeg;base64,' + data.jpeg;
});

// ── IPC: zoom level badge ─────────────────────────────────────────────────────
window.electronAPI.onZoomActivated((level) => {
  badge.textContent = fmt(level);
});

window.electronAPI.onZoomLevelChange((level) => {
  badge.textContent = fmt(level);
});

function fmt(level) {
  return Number.isInteger(level) ? `${level}x` : `${level.toFixed(1)}x`;
}
