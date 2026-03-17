// ── Elements ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('zoom-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const badge = document.getElementById('badge');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Static snapshot panning ───────────────────────────────────────────────────
// On zoom activation the main process sends a single full-screen PNG snapshot.
// The renderer pans a zoomed view of this static image following the cursor
// at a full 60 fps with zero IPC per frame — only lightweight cursor updates.

let snapshotBitmap = null;
let screenW = 0;
let screenH = 0;
let cursorX = 0;
let cursorY = 0;
let zoomLevel = 1.5;
let animating = false;

function animate() {
  if (!animating) return;
  requestAnimationFrame(animate);
  if (!snapshotBitmap) return;

  const viewW = screenW;
  const viewH = screenH;

  // Source region on the snapshot (centered on cursor)
  const srcW = viewW / zoomLevel;
  const srcH = viewH / zoomLevel;
  let srcX = cursorX - srcW / 2;
  let srcY = cursorY - srcH / 2;

  // Clamp so we don't go outside the snapshot
  srcX = Math.max(0, Math.min(srcX, viewW - srcW));
  srcY = Math.max(0, Math.min(srcY, viewH - srcH));

  // Draw: source rect from snapshot → full canvas
  ctx.drawImage(
    snapshotBitmap,
    // src rect (snapshot coords — use bitmap's native pixel ratio)
    srcX * (snapshotBitmap.width / viewW),
    srcY * (snapshotBitmap.height / viewH),
    srcW * (snapshotBitmap.width / viewW),
    srcH * (snapshotBitmap.height / viewH),
    // dst rect (full viewport)
    0, 0, viewW, viewH,
  );
}

function startAnimation() {
  if (animating) return;
  animating = true;
  requestAnimationFrame(animate);
}

function stopAnimation() {
  animating = false;
}

// ── IPC: one-time snapshot from main process ──────────────────────────────────
window.electronAPI.onZoomSnapshot(async (data) => {
  try {
    const blob = new Blob([data.png], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    if (snapshotBitmap) snapshotBitmap.close();
    snapshotBitmap = bitmap;
    screenW = data.screenW;
    screenH = data.screenH;
  } catch (_) { /* skip corrupt snapshot */ }
});

// ── IPC: high-frequency cursor position ───────────────────────────────────────
window.electronAPI.onZoomCursorUpdate((data) => {
  cursorX = data.x;
  cursorY = data.y;
  screenW = data.screenW;
  screenH = data.screenH;
});

// ── IPC: zoom level ───────────────────────────────────────────────────────────
window.electronAPI.onZoomActivated((level) => {
  zoomLevel = level;
  badge.textContent = fmt(level);
  startAnimation();
});

window.electronAPI.onZoomLevelChange((level) => {
  zoomLevel = level;
  badge.textContent = fmt(level);
});

function fmt(level) {
  return Number.isInteger(level) ? `${level}x` : `${level.toFixed(1)}x`;
}
