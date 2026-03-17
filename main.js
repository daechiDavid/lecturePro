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
const FLOATING_ON_WIDTH = 460;
const FLOATING_OFF_HEIGHT = 50;
const FLOATING_ON_HEIGHT = 126;
const HUD_WIDTH = 240;
const HUD_HEIGHT = 48;

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
  floatingDisplayId: null,
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
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  const margin = 8;
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);

  return { x, y };
}

// Find which display contains the given absolute screen point
function getDisplayForPoint(absX, absY) {
  const displays = electronScreen.getAllDisplays();
  for (const d of displays) {
    const b = d.bounds;
    if (absX >= b.x && absX < b.x + b.width && absY >= b.y && absY < b.y + b.height) {
      return d;
    }
  }
  return electronScreen.getPrimaryDisplay();
}

// Convert absolute position to local display coords (no clamping — renderer handles it)
function floatingToLocal(absPos, display) {
  if (!absPos || !display) return null;
  const b = display.bounds;
  return {
    x: absPos.x - b.x,
    y: absPos.y - b.y,
  };
}

function getDisplayNativeSize(display) {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

function getVirtualBounds() {
  const displays = electronScreen.getAllDisplays();
  if (displays.length === 0) {
    const primary = electronScreen.getPrimaryDisplay();
    return { ...primary.bounds };
  }

  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function getTargetFloatingDisplay() {
  if (state.floatingDisplayId) {
    const target = electronScreen.getAllDisplays().find((display) => display.id === state.floatingDisplayId);
    if (target) return target;
  }

  if (state.floatingPosition) {
    return getDisplayForPoint(state.floatingPosition.x, state.floatingPosition.y);
  }

  return electronScreen.getPrimaryDisplay();
}

function getDefaultFloatingPosition(display = getTargetFloatingDisplay()) {
  return {
    x: display.bounds.x + display.bounds.width - FLOATING_OFF_WIDTH - 24,
    y: display.bounds.y + 24,
  };
}

function clampFloatingPosition(absPos, display = getTargetFloatingDisplay()) {
  if (!absPos) return getDefaultFloatingPosition(display);
  const margin = 8;
  const maxHeight = Math.max(FLOATING_OFF_HEIGHT, FLOATING_ON_HEIGHT);
  return {
    x: Math.max(display.bounds.x + margin, Math.min(Math.round(absPos.x), display.bounds.x + display.bounds.width - FLOATING_OFF_WIDTH - margin)),
    y: Math.max(display.bounds.y + margin, Math.min(Math.round(absPos.y), display.bounds.y + display.bounds.height - maxHeight - margin)),
  };
}

function shouldExpandFloatingRight(position, display = getTargetFloatingDisplay()) {
  return position.x + (FLOATING_OFF_WIDTH / 2) < display.bounds.x + (display.bounds.width / 2);
}

function getFloatingWindowBounds() {
  const display = getTargetFloatingDisplay();
  const anchoredPos = clampFloatingPosition(state.floatingPosition || getDefaultFloatingPosition(display), display);
  const expandRight = shouldExpandFloatingRight(anchoredPos, display);
  const width = state.overlayActive ? FLOATING_ON_WIDTH : FLOATING_OFF_WIDTH;
  const height = state.overlayActive ? FLOATING_ON_HEIGHT : FLOATING_OFF_HEIGHT;
  const extraWidth = width - FLOATING_OFF_WIDTH;

  return {
    x: expandRight ? anchoredPos.x : anchoredPos.x - extraWidth,
    y: anchoredPos.y,
    width,
    height,
    expandRight,
    anchoredPos,
  };
}

function getHudWindowBounds() {
  const display = getTargetFloatingDisplay();
  return {
    x: display.bounds.x + Math.round((display.bounds.width - HUD_WIDTH) / 2),
    y: display.bounds.y + 24,
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
  };
}

function shouldShowHud() {
  return state.overlayActive && state.mode !== 'none';
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
    const floatingDisplayId = typeof saved.floatingDisplayId === 'number' ? saved.floatingDisplayId : null;

    // Keep raw position so we can re-normalize after app is ready if screen wasn't available
    const rawFloatingPosition = saved.floatingPosition || null;

    return {
      penColor,
      drawSize,
      highlightSize,
      eraserSize,
      customColors,
      floatingPosition,
      floatingDisplayId,
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
    floatingDisplayId: state.floatingDisplayId,
  }, null, 2));
}

// ── App state ─────────────────────────────────────────────────────────────────
let currentShortcuts = loadShortcuts();
const savedPenPrefs = loadPenPrefs();

let overlayWin = null;
let zoomWin = null;
let settingsWin = null;
let floatingWin = null;
let hudWin = null;
let tray = null;
let cursorTracker = null;

const state = {
  overlayActive: false,
  mode: 'none',
  zoomActive: false,
  zoomLevel: 1.5,
  penColor: savedPenPrefs.penColor,
  drawSize: savedPenPrefs.drawSize,
  highlightSize: savedPenPrefs.highlightSize,
  eraserSize: savedPenPrefs.eraserSize,
  customColors: normalizeColorPresets(savedPenPrefs.customColors),
  floatingPosition: savedPenPrefs.floatingPosition,
  floatingDisplayId: savedPenPrefs.floatingDisplayId,
};

// ── Window creation ───────────────────────────────────────────────────────────
function createOverlayWindow() {
  ensureOverlayForDisplay();

  electronScreen.on('display-metrics-changed', syncOverlayWindow);
  electronScreen.on('display-added', syncOverlayWindow);
  electronScreen.on('display-removed', syncOverlayWindow);
}

function ensureOverlayForDisplay() {
  const display = getTargetFloatingDisplay();

  const native = getDisplayNativeSize(display);
  const overlayBounds = { x: display.bounds.x, y: display.bounds.y, width: native.width, height: native.height };

  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setBounds(overlayBounds);
    return;
  }

  overlayWin = new BrowserWindow({
    x: overlayBounds.x,
    y: overlayBounds.y,
    width: overlayBounds.width,
    height: overlayBounds.height,
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
  // Use uniform alpha (setOpacity) so Windows treats the entire window as
  // clickable, bypassing the per-pixel alpha hit test that is limited to DIP.
  overlayWin.setOpacity(0.99);
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  overlayWin.webContents.on('did-finish-load', () => {
    const d = getTargetFloatingDisplay();
    const n = getDisplayNativeSize(d);
    overlayWin?.setBounds({ x: d.bounds.x, y: d.bounds.y, width: n.width, height: n.height });
    overlayWin?.showInactive();
    sendOverlayState();
  });

  overlayWin.on('closed', () => {
    overlayWin = null;
  });
}

function syncOverlayWindow() {
  // Edge case: if the selected floating display was disconnected, reset to primary
  if (state.floatingDisplayId) {
    const displays = electronScreen.getAllDisplays();
    if (!displays.find((d) => d.id === state.floatingDisplayId)) {
      const primary = electronScreen.getPrimaryDisplay();
      state.floatingDisplayId = primary.id;
      state.floatingPosition = getDefaultFloatingPosition(primary);
      persistPenPrefs();
    }
  }

  ensureOverlayForDisplay();
  sendOverlayState();
  positionFloatingWindow();
  positionHudWindow();
}

function createFloatingWindow() {
  const bounds = getFloatingWindowBounds();

  floatingWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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
      backgroundThrottling: false,
    },
  });

  floatingWin.setAlwaysOnTop(true, 'screen-saver');
  floatingWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWin.setContentProtection(false);
  floatingWin.setMenuBarVisibility(false);
  floatingWin.setBounds(bounds);
  floatingWin.setMinimumSize(FLOATING_OFF_WIDTH, FLOATING_OFF_HEIGHT);
  floatingWin.loadFile(path.join(__dirname, 'renderer', 'floating.html'));

  floatingWin.webContents.on('did-finish-load', () => {
    floatingWin?.showInactive();
    floatingWin?.setBounds(getFloatingWindowBounds());
    floatingWin?.webContents.send('floating-direction', bounds.expandRight);
    sendFloatingState();
  });

  floatingWin.on('closed', () => {
    floatingWin = null;
  });
}

function createHudWindow() {
  const bounds = getHudWindowBounds();

  hudWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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
      backgroundThrottling: false,
    },
  });

  hudWin.setAlwaysOnTop(true, 'screen-saver');
  hudWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWin.setIgnoreMouseEvents(true, { forward: true });
  hudWin.setContentProtection(false);
  hudWin.setMenuBarVisibility(false);
  hudWin.loadFile(path.join(__dirname, 'renderer', 'hud.html'));

  hudWin.webContents.on('did-finish-load', () => {
    positionHudWindow();
    sendHudState();
  });

  hudWin.on('closed', () => {
    hudWin = null;
  });
}

function bringFloatingToFront() {
  if (!floatingWin || floatingWin.isDestroyed()) return;
  floatingWin.showInactive();
  floatingWin.moveTop();
}

function positionFloatingWindow() {
  if (!floatingWin || floatingWin.isDestroyed()) return;

  const bounds = getFloatingWindowBounds();
  state.floatingPosition = bounds.anchoredPos;
  floatingWin.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  floatingWin.webContents.send('floating-direction', bounds.expandRight);
}

function positionHudWindow() {
  if (!hudWin || hudWin.isDestroyed()) return;
  hudWin.setBounds(getHudWindowBounds());
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
    { label: 'LecturePro v1.1.1', enabled: false },
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
      if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('undo');
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
  sendOverlayStateToWindow();
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

function sendOverlayStateToWindow() {
  if (!overlayWin || overlayWin.isDestroyed()) return;

  const display = getTargetFloatingDisplay();
  overlayWin.webContents.send('overlay-state', {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    penSize: getToolSize(state.mode),
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    colorPresets: state.customColors,
    floatingPosition: null,
    showFloatingControls: false,
    showHud: false,
    displayWidth: display.bounds.width,
    displayHeight: display.bounds.height,
  });
}

function sendFloatingState() {
  if (!floatingWin || floatingWin.isDestroyed()) return;
  positionFloatingWindow();
  floatingWin?.webContents.send('floating-state', {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    colorPresets: state.customColors,
  });
}

function sendHudState() {
  if (!hudWin || hudWin.isDestroyed()) return;

  positionHudWindow();
  hudWin.webContents.send('hud-state', {
    visible: shouldShowHud(),
    mode: state.mode,
    penColor: state.penColor,
    penSize: getToolSize(state.mode),
  });

  if (shouldShowHud()) hudWin.showInactive();
  else hudWin.hide();
}

function syncAllStates() {
  sendOverlayState();
  sendFloatingState();
  sendHudState();
  bringFloatingToFront();

  const needsMouse = state.overlayActive && ['draw', 'highlight', 'eraser'].includes(state.mode);
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(!needsMouse, { forward: true });
  }

  updateTrayMenu();
}

// ── State actions ─────────────────────────────────────────────────────────────
function toggleOverlay(forceValue) {
  const next = typeof forceValue === 'boolean' ? forceValue : !state.overlayActive;
  if (state.overlayActive === next) return;

  state.overlayActive = next;

  if (state.overlayActive) {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.showInactive();
    if (state.mode === 'none') state.mode = 'draw';
  } else {
    state.mode = 'none';
  }

  syncAllStates();
}

function setMode(newMode) {
  if (!['draw', 'highlight', 'eraser', 'none'].includes(newMode)) return;

  const wasActive = state.overlayActive;

  if (newMode !== 'none' && !state.overlayActive) {
    toggleOverlay(true);
  }

  // Only toggle off if the overlay was already active before this call.
  // When the overlay was just turned on, don't toggle the requested mode off.
  if (wasActive && state.mode === newMode && newMode !== 'none') {
    newMode = 'none';
  }

  state.mode = newMode;

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

    // Take a single full-screen snapshot before showing zoom window
    await captureZoomSnapshot(display);

    zoomWin?.setBounds(display.bounds);
    zoomWin?.showInactive();
    zoomWin?.webContents.send('zoom-activated', state.zoomLevel);

    startCursorTracking();
  } else {
    stopCursorTracking();
    zoomWin?.hide();
  }

  updateTrayMenu();
}

function clearCanvas() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('clear-canvas');
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

// ── Zoom: one-shot snapshot + cursor panning ─────────────────────────────────
// Instead of continuous capture, take a single screenshot when zoom activates.
// The renderer pans the static image following the cursor at 60 fps.

async function captureZoomSnapshot(display) {
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

    // Send full screenshot as PNG buffer (lossless, one-time cost)
    zoomWin.webContents.send('zoom-snapshot', {
      png: thumb.toPNG(),
      screenW: capW,
      screenH: capH,
    });
  } catch (e) {
    console.error('[zoom snapshot]', e.message);
  }
}

// ── Cursor tracking (lightweight — only sends cursor position) ────────────────
function startCursorTracking() {
  if (cursorTracker) return;

  let lastCX = -1;
  let lastCY = -1;

  const tick = () => {
    if (!state.zoomActive || !zoomWin || zoomWin.isDestroyed()) return;

    const cursor = electronScreen.getCursorScreenPoint();
    const display = electronScreen.getDisplayNearestPoint(cursor);
    const cx = cursor.x - display.bounds.x;
    const cy = cursor.y - display.bounds.y;

    if (cx !== lastCX || cy !== lastCY) {
      zoomWin.webContents.send('zoom-cursor-update', {
        x: cx,
        y: cy,
        screenW: display.bounds.width,
        screenH: display.bounds.height,
      });
      lastCX = cx;
      lastCY = cy;
    }
  };

  tick();
  cursorTracker = setInterval(tick, 8);
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
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.handle('overlay:get-state', () => {
  const display = getTargetFloatingDisplay();
  return {
    overlayActive: state.overlayActive,
    mode: state.mode,
    penColor: state.penColor,
    penSize: getToolSize(state.mode),
    drawSize: state.drawSize,
    highlightSize: state.highlightSize,
    eraserSize: state.eraserSize,
    colorPresets: state.customColors,
    floatingPosition: null,
    showFloatingControls: false,
    showHud: false,
    displayWidth: display.bounds.width,
    displayHeight: display.bounds.height,
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

  const senderWin = BrowserWindow.fromWebContents(_e.sender);

  if (floatingWin && senderWin && senderWin.id === floatingWin.id) {
    state.floatingPosition = clampFloatingPosition({
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    });
    persistPenPrefs();
    positionFloatingWindow();
    positionHudWindow();
    sendOverlayState();
    sendHudState();
    return;
  }

  // pos.x/y are local overlay coords in the same DIP space as display.bounds
  const targetDisplayId = state.floatingDisplayId || electronScreen.getPrimaryDisplay().id;
  const targetDisplay = electronScreen.getAllDisplays().find((d) => d.id === targetDisplayId)
    || electronScreen.getPrimaryDisplay();

  const absX = targetDisplay.bounds.x + Math.round(pos.x);
  const absY = targetDisplay.bounds.y + Math.round(pos.y);

  state.floatingPosition = clampFloatingPosition({ x: absX, y: absY }, targetDisplay);
  persistPenPrefs();
  positionFloatingWindow();
  positionHudWindow();
  sendOverlayState();
  sendHudState();
});

ipcMain.handle('settings:get', () => {
  const displays = electronScreen.getAllDisplays();
  const primary = electronScreen.getPrimaryDisplay();
  const virtualBounds = getVirtualBounds();

  return {
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
    floatingDisplayId: state.floatingDisplayId || primary.id,
    floatingPosition: state.floatingPosition,
    virtualBounds,
    displays: displays.map((d) => {
      const nativeSize = getDisplayNativeSize(d);
      return {
        id: d.id,
        label: `${nativeSize.width}×${nativeSize.height}${d.id === primary.id ? ' (주 모니터)' : ''}`,
        bounds: d.bounds,
        rendererWidth: d.bounds.width,
        rendererHeight: d.bounds.height,
        nativeWidth: nativeSize.width,
        nativeHeight: nativeSize.height,
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === primary.id,
      };
    }),
  };
});

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

  // Handle floating display/position from settings
  if (typeof payload?.floatingDisplayId === 'number') {
    const displays = electronScreen.getAllDisplays();
    const targetDisplay = displays.find((d) => d.id === payload.floatingDisplayId);
    if (targetDisplay) {
      state.floatingDisplayId = payload.floatingDisplayId;
      if (payload.floatingPosition
        && typeof payload.floatingPosition.x === 'number'
        && typeof payload.floatingPosition.y === 'number') {
        // payload coords are local overlay coords in the same DIP space as display.bounds
        state.floatingPosition = clampFloatingPosition({
          x: targetDisplay.bounds.x + Math.round(payload.floatingPosition.x),
          y: targetDisplay.bounds.y + Math.round(payload.floatingPosition.y),
        }, targetDisplay);
      } else {
        // Default: top-right of selected display
        state.floatingPosition = getDefaultFloatingPosition(targetDisplay);
      }
    }
  }

  persistPenPrefs();

  // Move overlay to the (possibly new) target display
  ensureOverlayForDisplay();
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
  state.floatingDisplayId = null;
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
  // Backward compat: old saves were local coords → convert to absolute
  if (!state.floatingPosition && savedPenPrefs.rawFloatingPosition) {
    const raw = savedPenPrefs.rawFloatingPosition;
    if (raw && typeof raw.x === 'number' && typeof raw.y === 'number') {
      const primary = electronScreen.getPrimaryDisplay().bounds;
      // If coords look like local (within a single display size), convert to absolute
      if (raw.x < primary.width && raw.y < primary.height && raw.x >= 0 && raw.y >= 0) {
        state.floatingPosition = { x: primary.x + raw.x, y: primary.y + raw.y };
      } else {
        state.floatingPosition = { x: raw.x, y: raw.y };
      }
    }
  }

  // Validate saved floatingDisplayId — if display no longer exists, fallback to primary
  if (state.floatingDisplayId) {
    const displays = electronScreen.getAllDisplays();
    if (!displays.find((d) => d.id === state.floatingDisplayId)) {
      const primary = electronScreen.getPrimaryDisplay();
      state.floatingDisplayId = primary.id;
      state.floatingPosition = getDefaultFloatingPosition(primary);
      persistPenPrefs();
    }
  }

  createOverlayWindow();
  createFloatingWindow();
  createHudWindow();
  createZoomWindow();
  createTray();
  applyShortcuts(currentShortcuts);
  syncAllStates();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopCursorTracking();
});

app.on('window-all-closed', (e) => e.preventDefault());
