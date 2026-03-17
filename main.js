const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  screen: electronScreen,
  desktopCapturer,
  nativeImage,
  dialog,
  systemPreferences,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ── Single instance ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const DEFAULT_COLOR_PRESETS = ['#FF4444', '#4488FF', '#44DD88', '#FFD700', '#FFFFFF'];
const FLOATING_OFF_WIDTH = 50;
const FLOATING_ON_WIDTH = 418;
const FLOATING_HEIGHT = 50;

// ── Default shortcuts ─────────────────────────────────────────────────────────
const DEFAULT_SHORTCUTS = {
  toggleOverlay: 'CommandOrControl+Alt+A',
  modeDraw: 'CommandOrControl+Alt+D',
  modeHighlight: 'CommandOrControl+Alt+H',
  modeEraser: 'CommandOrControl+Alt+E',
  modeNone: 'CommandOrControl+Alt+0',
  toggleZoom: 'CommandOrControl+Alt+Z',
  clearCanvas: 'CommandOrControl+Alt+C',
  undo: 'CommandOrControl+Alt+U',
  color1: 'CommandOrControl+Alt+1',
  color2: 'CommandOrControl+Alt+2',
  color3: 'CommandOrControl+Alt+3',
  color4: 'CommandOrControl+Alt+4',
  color5: 'CommandOrControl+Alt+5',
  penSizeUp: 'CommandOrControl+Alt+Up',
  penSizeDown: 'CommandOrControl+Alt+Down',
  zoomLevelUp: 'CommandOrControl+Alt+Right',
  zoomLevelDown: 'CommandOrControl+Alt+Left',
};

const SHORTCUT_META = [
  { group: '일반', key: 'toggleOverlay', label: '오버레이 켜기/끄기' },
  { group: '모드', key: 'modeDraw', label: '펜 그리기' },
  { group: '모드', key: 'modeHighlight', label: '형광펜' },
  { group: '모드', key: 'modeEraser', label: '지우개' },
  { group: '모드', key: 'modeNone', label: '모드 해제' },
  { group: '도구', key: 'toggleZoom', label: '줌 렌즈 켜기/끄기' },
  { group: '도구', key: 'clearCanvas', label: '모든 필기 지우기' },
  { group: '도구', key: 'undo', label: '마지막 획 되돌리기' },
  { group: '색상', key: 'color1', label: '색상 1' },
  { group: '색상', key: 'color2', label: '색상 2' },
  { group: '색상', key: 'color3', label: '색상 3' },
  { group: '색상', key: 'color4', label: '색상 4' },
  { group: '색상', key: 'color5', label: '색상 5' },
  { group: '크기/줌', key: 'penSizeUp', label: '펜 굵기 증가' },
  { group: '크기/줌', key: 'penSizeDown', label: '펜 굵기 감소' },
  { group: '크기/줌', key: 'zoomLevelUp', label: '줌 배율 증가' },
  { group: '크기/줌', key: 'zoomLevelDown', label: '줌 배율 감소' },
];

// ── Settings persistence ──────────────────────────────────────────────────────
function settingsPath() {
  return path.join(app.getPath('userData'), 'shortcuts.json');
}

function loadShortcuts() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const saved = JSON.parse(raw);
    return { ...DEFAULT_SHORTCUTS, ...saved };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function persistShortcuts(shortcuts) {
  fs.writeFileSync(settingsPath(), JSON.stringify(shortcuts, null, 2));
}

// ── Pen prefs persistence ─────────────────────────────────────────────────────
const PEN_PREFS_DEFAULTS = {
  penColor: DEFAULT_COLOR_PRESETS[0],
  drawSize: 4,
  highlightSize: 4,
  eraserSize: 4,
  customColors: [...DEFAULT_COLOR_PRESETS],
  floatingPosition: null,
};

function penPrefsPath() {
  return path.join(app.getPath('userData'), 'pen-prefs.json');
}

function normalizeHexColor(color) {
  if (typeof color !== 'string') return null;
  const normalized = color.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function normalizeColorPresets(colors) {
  const merged = Array.isArray(colors) ? colors.slice(0, 5) : [];
  while (merged.length < 5) merged.push(DEFAULT_COLOR_PRESETS[merged.length]);

  return merged.map((color, index) => normalizeHexColor(color) || DEFAULT_COLOR_PRESETS[index]);
}

function clampToolSize(size, fallback = 4) {
  return Number.isFinite(size) ? Math.max(2, Math.min(40, Math.round(size))) : fallback;
}

function normalizeFloatingPosition(pos, bounds) {
  if (!bounds) {
    try { bounds = electronScreen.getPrimaryDisplay().bounds; } catch { /* screen not ready yet */ }
  }
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || !bounds) return null;
  const margin = 8;
  let localX = Math.round(pos.x);
  let localY = Math.round(pos.y);

  // Backward compatibility: previously persisted values were absolute screen coords.
  if (localX > bounds.width || localY > bounds.height || localX < 0 || localY < 0) {
    localX -= bounds.x;
    localY -= bounds.y;
  }

  return {
    x: Math.max(margin, Math.min(localX, bounds.width - FLOATING_OFF_WIDTH - margin)),
    y: Math.max(margin, Math.min(localY, bounds.height - FLOATING_HEIGHT - margin)),
  };
}

function loadPenPrefs() {
  try {
    const raw = fs.readFileSync(penPrefsPath(), 'utf8');
    const saved = JSON.parse(raw);
    const customColors = normalizeColorPresets(saved.customColors);
    const penColor = normalizeHexColor(saved.penColor) || customColors[0];
    const legacySize = clampToolSize(saved.penSize, 4);
    const drawSize = clampToolSize(saved.drawSize, legacySize);
    const highlightSize = clampToolSize(saved.highlightSize, legacySize);
    const eraserSize = clampToolSize(saved.eraserSize, legacySize);
    const floatingPosition = normalizeFloatingPosition(saved.floatingPosition);

    // Keep raw position so we can re-normalize after app is ready if screen wasn't available
    const rawFloatingPosition = saved.floatingPosition || null;

    return {
      penColor,
      drawSize,
      highlightSize,
      eraserSize,
      customColors,
      floatingPosition,
      rawFloatingPosition,
    };
  } catch {
    return { ...PEN_PREFS_DEFAULTS, rawFloatingPosition: null };
  }
}

function persistPenPrefs() {
  fs.writeFileSync(penPrefsPath(), JSON.stringify({
    penColor: state.penColor,
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    customColors: state.customColors,
    floatingPosition: state.floatingPosition,
  }, null, 2));
}

// ── App state ─────────────────────────────────────────────────────────────────
let currentShortcuts = loadShortcuts();
const savedPenPrefs = loadPenPrefs();

const overlayWins = new Map();
let zoomWin = null;
let settingsWin = null;
let floatingWin = null;
let tray = null;
let cursorTracker = null;

const state = {
  overlayActive: false,
  mode: 'none',
  zoomActive: false,
  zoomLevel: 3,
  penColor: savedPenPrefs.penColor,
  drawSize: savedPenPrefs.drawSize,
  highlightSize: savedPenPrefs.highlightSize,
  eraserSize: savedPenPrefs.eraserSize,
  customColors: normalizeColorPresets(savedPenPrefs.customColors),
  floatingPosition: savedPenPrefs.floatingPosition,
};

// ── Window creation ───────────────────────────────────────────────────────────
function createOverlayWindow() {
  for (const display of electronScreen.getAllDisplays()) {
    ensureOverlayWindowForDisplay(display);
  }

  electronScreen.on('display-metrics-changed', syncOverlayWindows);
  electronScreen.on('display-added', syncOverlayWindows);
  electronScreen.on('display-removed', syncOverlayWindows);
}

function ensureOverlayWindowForDisplay(display) {
  const existing = overlayWins.get(display.id);
  if (existing && !existing.isDestroyed()) {
    existing.setBounds(display.bounds);
    return existing;
  }

  const overlayWin = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setContentProtection(false);
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWins.set(display.id, overlayWin);

  overlayWin.webContents.on('did-finish-load', () => {
    overlayWin?.showInactive();
    sendOverlayStateToWindow(overlayWin, display.id);
  });

  overlayWin.on('closed', () => {
    overlayWins.delete(display.id);
  });

  return overlayWin;
}

function syncOverlayWindows() {
  const displays = electronScreen.getAllDisplays();
  const displayIds = new Set(displays.map((display) => display.id));

  for (const display of displays) {
    const win = ensureOverlayWindowForDisplay(display);
    win?.setBounds(display.bounds);
  }

  for (const [displayId, win] of overlayWins.entries()) {
    if (!displayIds.has(displayId)) {
      overlayWins.delete(displayId);
      if (win && !win.isDestroyed()) win.close();
    }
  }

  if (state.floatingPosition) {
    const primaryBounds = electronScreen.getPrimaryDisplay().bounds;
    state.floatingPosition = normalizeFloatingPosition(state.floatingPosition, primaryBounds);
    persistPenPrefs();
  }

  sendOverlayState();
}

function createFloatingWindow() {
  // Floating controls are now rendered inside the overlay window.
}

function bringFloatingToFront() {
  return;
}

function positionFloatingWindow() {
  return;
}

function createZoomWindow() {
  const { bounds } = electronScreen.getPrimaryDisplay();
  zoomWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  zoomWin.setAlwaysOnTop(true, 'screen-saver');
  zoomWin.setIgnoreMouseEvents(true, { forward: true });
  zoomWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  zoomWin.setContentProtection(true);
  zoomWin.loadFile(path.join(__dirname, 'renderer', 'zoom.html'));
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 560,
    height: 760,
    title: 'LecturePro 설정',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  } else {
    icon = icon.resize({ width: 22, height: 22 });
  }

  tray = new Tray(icon);
  tray.setToolTip('LecturePro');
  updateTrayMenu();
}

function updateTrayMenu() {
  const sc = currentShortcuts;

  const menu = Menu.buildFromTemplate([
    { label: 'LecturePro v1.1', enabled: false },
    { type: 'separator' },
    {
      label: state.overlayActive ? '오버레이 끄기' : '오버레이 켜기',
      accelerator: sc.toggleOverlay,
      click: toggleOverlay,
    },
    { type: 'separator' },
    { label: '── 모드 ──', enabled: false },
    { label: '펜 그리기', type: 'radio', checked: state.mode === 'draw', accelerator: sc.modeDraw, click: () => setMode('draw') },
    { label: '형광펜', type: 'radio', checked: state.mode === 'highlight', accelerator: sc.modeHighlight, click: () => setMode('highlight') },
    { label: '지우개', type: 'radio', checked: state.mode === 'eraser', accelerator: sc.modeEraser, click: () => setMode('eraser') },
    { label: '모드 해제', type: 'radio', checked: state.mode === 'none', accelerator: sc.modeNone, click: () => setMode('none') },
    { type: 'separator' },
    {
      label: state.zoomActive ? '줌 렌즈 끄기' : '줌 렌즈 켜기',
      accelerator: sc.toggleZoom,
      click: toggleZoom,
    },
    { type: 'separator' },
    { label: '모든 필기 지우기', accelerator: sc.clearCanvas, click: clearCanvas },
    { type: 'separator' },
    { label: '설정...', click: createSettingsWindow },
    { type: 'separator' },
    { label: '종료', role: 'quit' },
  ]);

  tray.setContextMenu(menu);
}

// ── Shortcut registration (data-driven) ───────────────────────────────────────
function getShortcutActions() {
  return {
    toggleOverlay: toggleOverlay,
    modeDraw: () => setMode('draw'),
    modeHighlight: () => setMode('highlight'),
    modeEraser: () => setMode('eraser'),
    modeNone: () => setMode('none'),
    toggleZoom: toggleZoom,
    clearCanvas: clearCanvas,
    undo: () => {
      for (const overlayWin of overlayWins.values()) {
        overlayWin?.webContents.send('undo');
      }
    },
    color1: () => setColorByPreset(0),
    color2: () => setColorByPreset(1),
    color3: () => setColorByPreset(2),
    color4: () => setColorByPreset(3),
    color5: () => setColorByPreset(4),
    penSizeUp: () => adjustPenSize(2),
    penSizeDown: () => adjustPenSize(-2),
    zoomLevelUp: () => adjustZoomLevel(0.5),
    zoomLevelDown: () => adjustZoomLevel(-0.5),
  };
}

function applyShortcuts(shortcuts) {
  globalShortcut.unregisterAll();
  const actions = getShortcutActions();
  const failed = [];

  for (const [key, accelerator] of Object.entries(shortcuts)) {
    if (!accelerator || !actions[key]) continue;
    try {
      const ok = globalShortcut.register(accelerator, actions[key]);
      if (!ok) failed.push({ key, accelerator });
    } catch (e) {
      console.error(`[shortcut] invalid accelerator "${accelerator}" for "${key}":`, e.message);
      failed.push({ key, accelerator });
    }
  }

  return failed;
}

// ── State sync ────────────────────────────────────────────────────────────────
function sendOverlayState() {
  for (const [displayId, overlayWin] of overlayWins.entries()) {
    sendOverlayStateToWindow(overlayWin, displayId);
  }
}

function getSizeKeyForMode(mode) {
  if (mode === 'highlight') return 'highlightSize';
  if (mode === 'eraser') return 'eraserSize';
  return 'drawSize';
}

function getToolSize(mode) {
  return state[getSizeKeyForMode(mode)];
}

function setToolSize(mode, size) {
  state[getSizeKeyForMode(mode)] = clampToolSize(size, getToolSize(mode));
}

function sendOverlayStateToWindow(overlayWin, displayId) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.webContents.send('overlay-state', {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    penSize: getToolSize(state.mode),
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    colorPresets: state.customColors,
    floatingPosition: state.floatingPosition,
    showFloatingControls: displayId === electronScreen.getPrimaryDisplay().id,
  });
}

function sendFloatingState() {
  floatingWin?.webContents.send('floating-state', {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    colorPresets: state.customColors,
  });
}

function syncAllStates() {
  sendOverlayState();
  sendFloatingState();

  const needsMouse = state.overlayActive && ['draw', 'highlight', 'eraser'].includes(state.mode);
  for (const overlayWin of overlayWins.values()) {
    overlayWin?.setIgnoreMouseEvents(!needsMouse, { forward: true });
  }

  updateTrayMenu();
}

// ── State actions ─────────────────────────────────────────────────────────────
function toggleOverlay(forceValue) {
  const next = typeof forceValue === 'boolean' ? forceValue : !state.overlayActive;
  if (state.overlayActive === next) return;

  state.overlayActive = next;

  if (state.overlayActive) {
    for (const overlayWin of overlayWins.values()) {
      overlayWin?.showInactive();
    }
    if (state.mode === 'none') state.mode = 'draw';
  } else {
    state.mode = 'none';
  }

  const needsMouse = state.overlayActive && ['draw', 'highlight', 'eraser'].includes(state.mode);
  for (const overlayWin of overlayWins.values()) {
    overlayWin?.setIgnoreMouseEvents(!needsMouse, { forward: true });
  }

  syncAllStates();
}

function setMode(newMode) {
  if (!['draw', 'highlight', 'eraser', 'none'].includes(newMode)) return;

  if (newMode !== 'none' && !state.overlayActive) {
    toggleOverlay(true);
  }

  if (state.mode === newMode && newMode !== 'none') {
    newMode = 'none';
  }

  state.mode = newMode;

  const needsMouse = state.overlayActive && ['draw', 'highlight', 'eraser'].includes(state.mode);
  for (const overlayWin of overlayWins.values()) {
    overlayWin?.setIgnoreMouseEvents(!needsMouse, { forward: true });
  }

  syncAllStates();
}

async function ensureScreenCapturePermission() {
  if (process.platform !== 'darwin') return true;

  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['시스템 설정 열기', '취소'],
    defaultId: 0,
    cancelId: 1,
    title: '화면 기록 권한 필요',
    message: '줌 렌즈를 사용하려면 화면 기록 권한이 필요합니다.',
    detail: '시스템 설정 > 개인정보 보호 및 보안 > 화면 기록에서 LecturePro를 허용한 뒤 앱을 다시 실행하세요.',
  });

  if (response === 0) {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }

  return false;
}

async function toggleZoom() {
  state.zoomActive = !state.zoomActive;

  if (state.zoomActive) {
    const allowed = await ensureScreenCapturePermission();
    if (!allowed) {
      state.zoomActive = false;
      updateTrayMenu();
      return;
    }

    const cursor = electronScreen.getCursorScreenPoint();
    const display = electronScreen.getDisplayNearestPoint(cursor);

    zoomWin?.setBounds(display.bounds);
    zoomWin?.showInactive();
    zoomWin?.webContents.send('zoom-activated', state.zoomLevel);

    const cachedPayload = lastZoomFrameByDisplay.get(display.id);
    if (cachedPayload) {
      zoomWin?.webContents.send('zoom-frame', cachedPayload);
    }

    captureZoomFrame(cursor, display);
    startCursorTracking();
  } else {
    stopCursorTracking();
    zoomWin?.hide();
  }

  updateTrayMenu();
}

function clearCanvas() {
  for (const overlayWin of overlayWins.values()) {
    overlayWin?.webContents.send('clear-canvas');
  }
}

function setColor(color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) return;

  state.penColor = normalized;
  sendOverlayState();
  sendFloatingState();
  persistPenPrefs();
}

function setColorByPreset(index) {
  if (index < 0 || index > 4) return;
  setColor(state.customColors[index]);
}

function setCustomColors(colors) {
  state.customColors = normalizeColorPresets(colors);
  if (!state.customColors.includes(state.penColor)) {
    state.penColor = state.customColors[0];
  }
  sendOverlayState();
  sendFloatingState();
  persistPenPrefs();
}

function adjustPenSize(delta) {
  const targetMode = ['draw', 'highlight', 'eraser'].includes(state.mode) ? state.mode : 'draw';
  setToolSize(targetMode, getToolSize(targetMode) + delta);
  sendOverlayState();
  persistPenPrefs();
}

function adjustZoomLevel(delta) {
  state.zoomLevel = Math.max(1.5, Math.min(8, state.zoomLevel + delta));
  zoomWin?.webContents.send('zoom-level-change', state.zoomLevel);
}

// ── Zoom frame capture (main process, avoids renderer recursive capture) ──────
let zoomCaptureBusy = false;
const lastZoomFrameByDisplay = new Map();

async function captureZoomFrame(cursor, display) {
  if (zoomCaptureBusy) return;
  zoomCaptureBusy = true;
  try {
    const capW = display.bounds.width;
    const capH = display.bounds.height;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: capW, height: capH },
    });
    if (!sources.length || !zoomWin || zoomWin.isDestroyed()) return;

    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    const thumb = src.thumbnail;
    const { width: imgW, height: imgH } = thumb.getSize();

    const cx = Math.round(cursor.x - display.bounds.x);
    const cy = Math.round(cursor.y - display.bounds.y);

    const regionW = capW / state.zoomLevel;
    const regionH = capH / state.zoomLevel;
    const desiredX = cx - regionW / 2;
    const desiredY = cy - regionH / 2;

    const cropX = Math.max(0, Math.min(imgW - 1, Math.floor(desiredX)));
    const cropY = Math.max(0, Math.min(imgH - 1, Math.floor(desiredY)));
    const cropW = Math.max(1, Math.min(imgW - cropX, Math.ceil(desiredX + regionW) - cropX));
    const cropH = Math.max(1, Math.min(imgH - cropY, Math.ceil(desiredY + regionH) - cropY));

    const cropped = thumb.crop({ x: cropX, y: cropY, width: cropW, height: cropH });

    const dstX = Math.round((cropX - desiredX) * state.zoomLevel);
    const dstY = Math.round((cropY - desiredY) * state.zoomLevel);
    const dstW = Math.round(cropW * state.zoomLevel);
    const dstH = Math.round(cropH * state.zoomLevel);

    const payload = {
      jpeg: cropped.toJPEG(82).toString('base64'),
      dstX,
      dstY,
      dstW,
      dstH,
      viewW: capW,
      viewH: capH,
    };

    lastZoomFrameByDisplay.set(display.id, payload);

    if (state.zoomActive && zoomWin && !zoomWin.isDestroyed()) {
      zoomWin.webContents.send('zoom-frame', payload);
    }
  } catch (e) {
    console.error('[zoom capture]', e.message);
  } finally {
    zoomCaptureBusy = false;
  }
}

// ── Cursor tracking ───────────────────────────────────────────────────────────
function startCursorTracking() {
  if (cursorTracker) return;

  const tick = () => {
    const cursor = electronScreen.getCursorScreenPoint();
    const display = electronScreen.getDisplayNearestPoint(cursor);

    if (state.zoomActive && zoomWin && !zoomWin.isDestroyed()) {
      zoomWin.setBounds(display.bounds);
      captureZoomFrame(cursor, display);
    }
  };

  tick();
  cursorTracker = setInterval(tick, 12);
}

function stopCursorTracking() {
  if (cursorTracker) {
    clearInterval(cursorTracker);
    cursorTracker = null;
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-screen-source', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  });
  return sources[0]?.id ?? null;
});

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  const overlayWin = BrowserWindow.fromWebContents(_e.sender);
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.handle('overlay:get-state', (event) => {
  const overlayWin = BrowserWindow.fromWebContents(event.sender);
  const display = overlayWin
    ? electronScreen.getDisplayMatching(overlayWin.getBounds())
    : electronScreen.getPrimaryDisplay();

  return {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    penSize: getToolSize(state.mode),
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    colorPresets: state.customColors,
    floatingPosition: state.floatingPosition,
    showFloatingControls: display.id === electronScreen.getPrimaryDisplay().id,
  };
});

ipcMain.handle('overlay:toggle', (_e, nextValue) => {
  toggleOverlay(typeof nextValue === 'boolean' ? nextValue : undefined);
  return {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    colorPresets: state.customColors,
  };
});

ipcMain.on('overlay:set-mode', (_e, mode) => {
  setMode(mode);
});

ipcMain.on('overlay:set-color', (_e, color) => {
  setColor(color);
});

ipcMain.on('overlay:clear-canvas', () => {
  clearCanvas();
});

ipcMain.on('overlay:set-size', (_e, payload) => {
  const mode = payload?.mode;
  const size = payload?.size;
  if (!['draw', 'highlight', 'eraser'].includes(mode)) return;
  setToolSize(mode, size);
  sendOverlayState();
  persistPenPrefs();
});

ipcMain.on('floating:set-position', (_e, pos) => {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
  state.floatingPosition = normalizeFloatingPosition(pos);
  persistPenPrefs();
  sendOverlayState();
});

ipcMain.handle('settings:get', () => ({
  shortcuts: currentShortcuts,
  defaults: DEFAULT_SHORTCUTS,
  meta: SHORTCUT_META,
  platform: process.platform,
  penPrefs: {
    penColor: state.penColor,
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    customColors: state.customColors,
  },
}));

ipcMain.handle('settings:save', (_e, payload) => {
  const newShortcuts = payload?.shortcuts ?? payload;
  const requestedColors = payload?.customColors ?? state.customColors;

  const values = Object.values(newShortcuts).filter(Boolean);
  const seen = new Set();
  const dupes = [];
  for (const v of values) {
    if (seen.has(v)) dupes.push(v);
    seen.add(v);
  }

  if (dupes.length > 0) {
    return { ok: false, error: '중복된 단축키가 있습니다: ' + dupes.join(', ') };
  }

  const failed = applyShortcuts(newShortcuts);
  currentShortcuts = { ...newShortcuts };
  persistShortcuts(currentShortcuts);

  state.customColors = normalizeColorPresets(requestedColors);
  if (!state.customColors.includes(state.penColor)) {
    state.penColor = state.customColors[0];
  }
  persistPenPrefs();

  syncAllStates();

  if (failed.length > 0) {
    return {
      ok: false,
      partial: true,
      failed: failed.map((f) => {
        const item = SHORTCUT_META.find((meta) => meta.key === f.key);
        return item ? item.label : f.key;
      }),
      penPrefs: {
        customColors: state.customColors,
      },
    };
  }

  return {
    ok: true,
    penPrefs: {
      customColors: state.customColors,
    },
  };
});

ipcMain.handle('settings:reset', () => {
  const failed = applyShortcuts(DEFAULT_SHORTCUTS);
  currentShortcuts = { ...DEFAULT_SHORTCUTS };
  persistShortcuts(currentShortcuts);

  state.customColors = [...DEFAULT_COLOR_PRESETS];
  state.penColor = state.customColors[0];
  state.drawSize = 4;
  state.highlightSize = 4;
  state.eraserSize = 4;
  state.floatingPosition = null;
  persistPenPrefs();

  syncAllStates();

  return {
    shortcuts: currentShortcuts,
    failed,
    penPrefs: {
      customColors: state.customColors,
      penColor: state.penColor,
      drawSize: state.drawSize,
      highlightSize: state.highlightSize,
      eraserSize: state.eraserSize,
    },
  };
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();

  // Re-normalize floating position now that screen is available
  if (!state.floatingPosition && savedPenPrefs.rawFloatingPosition) {
    state.floatingPosition = normalizeFloatingPosition(savedPenPrefs.rawFloatingPosition);
  }

  createOverlayWindow();
  createZoomWindow();
  createTray();
  applyShortcuts(currentShortcuts);
  syncAllStates();

  setTimeout(() => {
    const cursor = electronScreen.getCursorScreenPoint();
    const display = electronScreen.getDisplayNearestPoint(cursor);
    captureZoomFrame(cursor, display);
  }, 120);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopCursorTracking();
});

app.on('window-all-closed', (e) => e.preventDefault());
