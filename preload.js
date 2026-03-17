const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Overlay ────────────────────────────────────────────────────────────────
  onModeChange:            (cb) => ipcRenderer.on('mode-change',            (_e, m, c, s) => cb(m, c, s)),
  onOverlayState:          (cb) => ipcRenderer.on('overlay-state',          (_e, d) => cb(d)),
  onClearCanvas:           (cb) => ipcRenderer.on('clear-canvas',           () => cb()),
  onUndo:                  (cb) => ipcRenderer.on('undo',                   () => cb()),
  onColorChange:           (cb) => ipcRenderer.on('color-change',           (_e, c) => cb(c)),
  onSizeChange:            (cb) => ipcRenderer.on('size-change',            (_e, s) => cb(s)),
  getOverlayState:         ()   => ipcRenderer.invoke('overlay:get-state'),
  toggleOverlay:           (next) => ipcRenderer.invoke('overlay:toggle', next),
  setOverlayMode:          (mode) => ipcRenderer.send('overlay:set-mode', mode),
  setOverlayColor:         (color) => ipcRenderer.send('overlay:set-color', color),
  setOverlaySize:          (mode, size) => ipcRenderer.send('overlay:set-size', { mode, size }),
  clearCanvas:             () => ipcRenderer.send('overlay:clear-canvas'),

  // ── Floating control ───────────────────────────────────────────────────────
  onFloatingState:         (cb) => ipcRenderer.on('floating-state', (_e, d) => cb(d)),
  onFloatingDirection:     (cb) => ipcRenderer.on('floating-direction', (_e, d) => cb(d)),
  setFloatingPosition:     (x, y) => ipcRenderer.send('floating:set-position', { x, y }),

  // ── Zoom ───────────────────────────────────────────────────────────────────
  onZoomActivated:    (cb) => ipcRenderer.on('zoom-activated',    (_e, l) => cb(l)),
  onZoomLevelChange:  (cb) => ipcRenderer.on('zoom-level-change', (_e, l) => cb(l)),
  onZoomCursorUpdate: (cb) => ipcRenderer.on('zoom-cursor-update', (_e, d) => cb(d)),
  onZoomFrame:        (cb) => ipcRenderer.on('zoom-frame',         (_e, d) => cb(d)),

  // ── General calls ──────────────────────────────────────────────────────────
  getScreenSource: () => ipcRenderer.invoke('get-screen-source'),
  setIgnoreMouse:  (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),

  // ── Settings ───────────────────────────────────────────────────────────────
  settingsGet:   ()       => ipcRenderer.invoke('settings:get'),
  settingsSave:  (data)   => ipcRenderer.invoke('settings:save', data),
  settingsReset: ()       => ipcRenderer.invoke('settings:reset'),
});
