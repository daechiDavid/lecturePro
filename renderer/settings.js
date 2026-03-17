let meta = [];
let original = {};
let pending = {};
let platform = 'darwin';
let capturingKey = null;
let originalColors = [];
let pendingColors = [];

async function init() {
  const data = await window.electronAPI.settingsGet();
  meta = data.meta;
  platform = data.platform;
  original = { ...data.shortcuts };
  pending = { ...data.shortcuts };

  const incoming = data.penPrefs?.customColors ?? ['#FF4444', '#4488FF', '#44DD88', '#FFD700', '#FFFFFF'];
  originalColors = normalizeColors(incoming);
  pendingColors = [...originalColors];

  renderList();
  renderColorPickers();
}

const MAC_SYMBOLS = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
  Return: 'Return', Escape: 'Esc', Backspace: '⌫', Delete: '⌦',
  Space: 'Space', Tab: 'Tab',
};

const WIN_LABELS = {
  CommandOrControl: 'Ctrl',
  Command: 'Win',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
  Return: 'Enter', Escape: 'Esc', Backspace: 'Bksp', Delete: 'Del',
  Space: 'Space', Tab: 'Tab',
};

function displayAccelerator(acc) {
  if (!acc) return null;
  const parts = acc.split('+');
  const map = platform === 'darwin' ? MAC_SYMBOLS : WIN_LABELS;
  return parts.map((part) => map[part] ?? part).join(platform === 'darwin' ? '' : ' + ');
}

function codeToElectronKey(code) {
  if (/^Key([A-Z])$/.test(code)) return code.slice(3);
  if (/^Digit([0-9])$/.test(code)) return code.slice(5);
  if (/^Numpad([0-9])$/.test(code)) return `num${code.slice(6)}`;
  if (/^F(1[0-2]|[1-9])$/.test(code)) return code;

  const map = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Enter: 'Return', Escape: 'Escape', Backspace: 'Backspace',
    Delete: 'Delete', Space: 'Space', Tab: 'Tab',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Backquote: '`', Backslash: '\\',
  };

  return map[code] ?? null;
}

function buildAccelerator(event) {
  if (['Control', 'Meta', 'Alt', 'Shift', 'OS', 'Super'].includes(event.key)) return null;

  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Command');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = codeToElectronKey(event.code);
  if (!key) return null;

  parts.push(key);
  return parts.join('+');
}

function renderList() {
  const list = document.getElementById('list');
  list.innerHTML = '';

  let currentGroup = null;
  for (const item of meta) {
    if (item.group !== currentGroup) {
      if (currentGroup !== null) {
        const sep = document.createElement('div');
        sep.className = 'group-sep';
        list.appendChild(sep);
      }

      currentGroup = item.group;
      const header = document.createElement('div');
      header.className = 'group-header';
      header.textContent = item.group;
      list.appendChild(header);
    }

    list.appendChild(buildRow(item));
  }

  updateConflicts();
}

function buildRow(item) {
  const row = document.createElement('div');
  row.className = 'shortcut-row';
  row.dataset.key = item.key;

  const label = document.createElement('span');
  label.className = 'shortcut-label';
  label.textContent = item.label;

  const badge = document.createElement('div');
  badge.className = 'key-badge';

  const keyTag = document.createElement('span');
  keyTag.className = 'key-tag';
  keyTag.id = `tag-${item.key}`;
  refreshKeyTag(keyTag, item.key);

  const button = document.createElement('button');
  button.className = 'btn btn-capture';
  button.id = `btn-${item.key}`;
  button.textContent = '변경';
  button.addEventListener('click', () => toggleCapture(item.key));

  badge.appendChild(keyTag);
  badge.appendChild(button);
  row.appendChild(label);
  row.appendChild(badge);

  return row;
}

function refreshKeyTag(tagEl, key) {
  const accelerator = pending[key];
  if (!accelerator) {
    tagEl.textContent = '없음';
    tagEl.className = 'key-tag empty';
    return;
  }

  tagEl.textContent = displayAccelerator(accelerator);
  tagEl.className = 'key-tag';
}

function refreshAllTags() {
  for (const item of meta) {
    const tag = document.getElementById(`tag-${item.key}`);
    if (tag) refreshKeyTag(tag, item.key);
  }
}

function toggleCapture(key) {
  if (capturingKey === key) {
    stopCapture();
    return;
  }
  if (capturingKey) stopCapture();
  startCapture(key);
}

function startCapture(key) {
  capturingKey = key;

  const row = document.querySelector(`.shortcut-row[data-key="${key}"]`);
  const button = document.getElementById(`btn-${key}`);
  const tag = document.getElementById(`tag-${key}`);

  row?.classList.add('capturing');
  if (button) {
    button.textContent = '취소';
    button.classList.add('active');
  }
  if (tag) {
    tag.textContent = '단축키 입력...';
    tag.className = 'key-tag';
  }

  setStatus('warn', `"${getLabelForKey(key)}" 단축키를 입력하세요 (Esc = 취소)`);
}

function stopCapture() {
  if (!capturingKey) return;
  const key = capturingKey;
  capturingKey = null;

  const row = document.querySelector(`.shortcut-row[data-key="${key}"]`);
  const button = document.getElementById(`btn-${key}`);
  const tag = document.getElementById(`tag-${key}`);

  row?.classList.remove('capturing');
  if (button) {
    button.textContent = '변경';
    button.classList.remove('active');
  }
  if (tag) refreshKeyTag(tag, key);

  setStatus('info', '준비됨');
  updateConflicts();
}

document.addEventListener('keydown', (event) => {
  if (!capturingKey) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    stopCapture();
    return;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete')
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    pending[capturingKey] = '';
    stopCapture();
    return;
  }

  const accelerator = buildAccelerator(event);
  if (!accelerator) return;

  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    setStatus('warn', '단독 키는 등록할 수 없습니다. 수정 키(Ctrl/Cmd/Alt/Shift)를 함께 누르세요.');
    return;
  }

  pending[capturingKey] = accelerator;

  const tag = document.getElementById(`tag-${capturingKey}`);
  if (tag) {
    tag.textContent = displayAccelerator(accelerator);
    tag.className = 'key-tag';
  }

  const captured = capturingKey;
  stopCapture();
  setStatus('info', `"${getLabelForKey(captured)}" → ${displayAccelerator(accelerator)}`);
});

function updateConflicts() {
  const count = {};
  for (const [key, value] of Object.entries(pending)) {
    if (!value) continue;
    if (!count[value]) count[value] = [];
    count[value].push(key);
  }

  const conflicted = new Set();
  for (const keys of Object.values(count)) {
    if (keys.length > 1) keys.forEach((key) => conflicted.add(key));
  }

  for (const item of meta) {
    const tag = document.getElementById(`tag-${item.key}`);
    if (!tag) continue;
    if (conflicted.has(item.key)) tag.classList.add('conflict');
    else tag.classList.remove('conflict');
  }

  return conflicted.size === 0;
}

function normalizeHex(color) {
  if (typeof color !== 'string') return null;
  const normalized = color.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function normalizeColors(colors) {
  const fallback = ['#FF4444', '#4488FF', '#44DD88', '#FFD700', '#FFFFFF'];
  const source = Array.isArray(colors) ? colors.slice(0, 5) : [];
  while (source.length < 5) source.push(fallback[source.length]);
  return source.map((value, index) => normalizeHex(value) || fallback[index]);
}

function renderColorPickers() {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = '';

  pendingColors.forEach((color, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'color-item';

    const label = document.createElement('label');
    label.textContent = `색상 ${index + 1}`;
    label.htmlFor = `color-${index}`;

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.id = `color-${index}`;
    picker.value = color;
    picker.addEventListener('input', () => {
      pendingColors[index] = picker.value.toUpperCase();
    });

    wrapper.appendChild(label);
    wrapper.appendChild(picker);
    grid.appendChild(wrapper);
  });
}

document.getElementById('btn-save').addEventListener('click', async () => {
  if (capturingKey) stopCapture();
  if (!updateConflicts()) {
    setStatus('error', '중복된 단축키가 있습니다. 저장 전에 수정해 주세요.');
    return;
  }

  setStatus('info', '저장 중...');
  try {
    const payload = {
      shortcuts: pending,
      customColors: normalizeColors(pendingColors),
    };

    const result = await window.electronAPI.settingsSave(payload);
    if (result.ok) {
      original = { ...pending };
      originalColors = [...payload.customColors];
      pendingColors = [...payload.customColors];
      setStatus('success', '저장됐습니다.');
      return;
    }

    if (result.partial) {
      original = { ...pending };
      originalColors = [...payload.customColors];
      pendingColors = [...payload.customColors];
      setStatus('error', `일부 단축키 등록 실패 (시스템 충돌): ${result.failed.join(', ')}`);
      return;
    }

    setStatus('error', result.error || '저장 실패');
  } catch (error) {
    setStatus('error', `저장 오류: ${error.message}`);
  }
});

document.getElementById('btn-cancel').addEventListener('click', () => {
  if (capturingKey) stopCapture();
  pending = { ...original };
  pendingColors = [...originalColors];
  refreshAllTags();
  renderColorPickers();
  updateConflicts();
  setStatus('info', '변경사항을 취소했습니다.');
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  if (capturingKey) stopCapture();

  const result = await window.electronAPI.settingsReset();
  original = { ...result.shortcuts };
  pending = { ...result.shortcuts };

  originalColors = normalizeColors(result.penPrefs?.customColors);
  pendingColors = [...originalColors];

  refreshAllTags();
  renderColorPickers();
  updateConflicts();
  setStatus('success', '기본값으로 복원됐습니다.');
});

let statusTimer = null;
function setStatus(type, message, autoClear = false) {
  const statusEl = document.getElementById('status');
  const textEl = document.getElementById('status-text');
  statusEl.className = `status ${type}`;
  textEl.textContent = message;

  if (statusTimer) clearTimeout(statusTimer);
  if (autoClear) {
    statusTimer = setTimeout(() => setStatus('info', '준비됨'), 3000);
  }
}

function getLabelForKey(key) {
  return meta.find((item) => item.key === key)?.label ?? key;
}

init();
