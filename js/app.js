import { parseCcfoliaHtml, extractSpeakers, extractTabTypes } from './parser.js';
import {
  convertToCocolog2,
  serializeFromPreviewDocument,
  DEFAULT_STYLE_SETTINGS,
  CUSTOM_TAB_FALLBACK,
} from './converter.js';

/** @type {import('./parser.js').CcfoliaMessage[]} */
let messages = [];

/** @type {import('./parser.js').SpeakerConfig[]} */
let speakers = [];

/** @type {string[]} */
let tabTypes = [];

/** @type {Record<string, object>} */
let customTabConfigs = {};

let outputHtml = '';
let sourceFileName = 'log';
let convertGeneration = 0;
let imageDialogTarget = null;
let isHandlingFile = false;
let currentMode = 'edit';

/** @type {import('./parser.js').CcfoliaMessage[]} */
let cutSourceMessages = [];
let cutSourceFileName = 'log';
let cutSourceHtml = '';
let cutExtractedHtml = '';

/** @type {Map<string, string>} */
let textOverrides = new Map();

/** @type {Map<string, string>} */
let imageOverrides = new Map();

const $ = (id) => document.getElementById(id);

const fileInput = $('file-input');
const fileDrop = $('file-drop');
const fileInfo = $('file-info');
const speakerTbody = $('speaker-tbody');
const previewFrame = $('preview-frame');
const overlay = $('overlay');
const overlayText = $('overlay-text');
const progressTrack = $('progress-track');
const progressFill = $('progress-fill');
const progressPercent = $('progress-percent');
const imageDialog = $('image-dialog');
const imageDialogUrl = $('image-dialog-url');
const customTabsContainer = $('custom-tabs-container');
const styleJsonInput = $('style-json-input');
const speakerJsonInput = $('speaker-json-input');
const modePanels = {
  cut: $('mode-cut'),
  edit: $('mode-edit'),
};
const modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
const cutFileInput = $('cut-file-input');
const cutFileDrop = $('cut-file-drop');
const cutFileInfo = $('cut-file-info');
const cutWorkspace = $('cut-workspace');
const cutSourcePreview = $('cut-source-preview');
const cutResultPreview = $('cut-result-preview');
const cutStartLineInput = $('cut-start-line');
const cutEndLineInput = $('cut-end-line');
const cutStatus = $('cut-status');
const btnCutApply = $('btn-cut-apply');
const btnCutDownload = $('btn-cut-download');

let debounceTimer = null;

function showOverlay(text, showProgress = false) {
  overlayText.textContent = text;
  progressTrack.hidden = !showProgress;
  progressPercent.hidden = !showProgress;
  if (!showProgress) setProgress(0);
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

function setProgress(ratio) {
  const pct = Math.round(ratio * 100);
  progressFill.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;
}

function showStepsAfterUpload() {
  $('workspace').hidden = false;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeMode(mode) {
  if (mode in modePanels) return mode;
  return 'edit';
}

function modeFromHash() {
  const raw = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return normalizeMode(raw);
}

function setMode(mode, options = {}) {
  const { updateUrl = true, replace = false } = options;
  const normalizedMode = normalizeMode(mode);
  if (!(normalizedMode in modePanels)) return;
  currentMode = normalizedMode;

  if (updateUrl) {
    const nextHash = `#${normalizedMode}`;
    if (window.location.hash !== nextHash) {
      const method = replace ? 'replaceState' : 'pushState';
      window.history[method](null, '', nextHash);
    }
  }

  for (const [key, panel] of Object.entries(modePanels)) {
    if (!panel) continue;
    panel.hidden = key !== normalizedMode;
  }

  for (const tab of modeTabs) {
    const selected = tab.dataset.mode === normalizedMode;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  }
}

function initFileDrop(dropEl, inputEl, onFile) {
  if (!dropEl || !inputEl) return;

  inputEl.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  });

  dropEl.addEventListener('click', () => inputEl.click());
  dropEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    inputEl.click();
  });

  dropEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropEl.classList.add('dragover');
  });

  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropEl.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

function renderLinePreview(container, lines, startLine = 1) {
  if (!container) return;
  if (!lines.length) {
    container.innerHTML = '<p class="line-preview-empty">미리보기할 내용이 없습니다.</p>';
    return;
  }

  container.innerHTML = lines
    .map((line, idx) => {
      const lineNumber = startLine + idx;
      const shown = line.length > 1000 ? `${line.slice(0, 1000)} ...` : line;
      return `<div class="line-preview-line">
        <span class="line-preview-num">${lineNumber.toLocaleString()}</span>
        <pre class="line-preview-content">${escapeHtml(shown) || '&nbsp;'}</pre>
      </div>`;
    })
    .join('');
}

function messageToPreviewText(message) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${message.text}</div>`, 'text/html');
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  const safeText = text || '(빈 메시지)';
  return `[${message.tab}] ${message.name}: ${safeText}`;
}

function isCcfoliaMessageParagraph(p) {
  const spans = p.querySelectorAll(':scope > span');
  if (spans.length < 3) return false;
  const tabRaw = spans[0].textContent?.trim() || '';
  const tab = tabRaw.replace(/^\[|\]$/g, '').trim().toLowerCase();
  const name = spans[1].textContent?.replace(/:\s*$/, '').trim() || '';
  return Boolean(tab && name);
}

function extractOriginalHtmlByMessageRange(rawHtml, start, end) {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  if (!doc.body) return rawHtml;

  let messageIndex = 0;
  for (const p of doc.body.querySelectorAll('p')) {
    if (!isCcfoliaMessageParagraph(p)) continue;
    messageIndex += 1;
    if (messageIndex < start || messageIndex > end) p.remove();
  }

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

function resetCutWorkspace() {
  cutSourceMessages = [];
  cutSourceHtml = '';
  cutExtractedHtml = '';
  if (cutWorkspace) cutWorkspace.hidden = true;
  if (cutFileInfo) {
    cutFileInfo.hidden = true;
    cutFileInfo.textContent = '';
  }
  if (cutStartLineInput) cutStartLineInput.value = '';
  if (cutEndLineInput) cutEndLineInput.value = '';
  if (cutStatus) cutStatus.textContent = '';
  renderLinePreview(cutSourcePreview, []);
  renderLinePreview(cutResultPreview, []);
  if (btnCutDownload) btnCutDownload.disabled = true;
}

async function handleCutFile(file) {
  if (!file) return;
  const html = await file.text();
  cutSourceHtml = html;
  const parsedMessages = parseCcfoliaHtml(html);
  if (parsedMessages.length === 0) {
    throw new Error('메시지를 찾을 수 없습니다. ccfolia 로그 HTML인지 확인해 주세요.');
  }

  cutSourceFileName = file.name.replace(/\.html?$/i, '');
  cutSourceMessages = parsedMessages;
  cutExtractedHtml = '';

  if (cutWorkspace) cutWorkspace.hidden = false;
  if (cutFileInfo) {
    cutFileInfo.hidden = false;
    cutFileInfo.textContent = `${file.name} · ${formatBytes(file.size)} · 총 ${cutSourceMessages.length.toLocaleString()}메시지`;
  }
  if (cutStartLineInput) cutStartLineInput.value = '1';
  if (cutEndLineInput) cutEndLineInput.value = String(cutSourceMessages.length);
  if (cutStatus) cutStatus.textContent = '시작/종료 메시지 번호를 입력하고 "메시지 추출"을 눌러주세요.';
  if (btnCutDownload) btnCutDownload.disabled = true;

  renderLinePreview(cutSourcePreview, cutSourceMessages.map(messageToPreviewText), 1);
  renderLinePreview(cutResultPreview, []);
}

async function applyCutRange() {
  if (cutSourceMessages.length === 0) {
    alert('먼저 HTML 파일을 업로드해 주세요.');
    return;
  }

  const start = Number.parseInt(cutStartLineInput?.value ?? '', 10);
  const end = Number.parseInt(cutEndLineInput?.value ?? '', 10);
  const total = cutSourceMessages.length;

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    alert('시작/종료 메시지 번호를 숫자로 입력해 주세요.');
    return;
  }
  if (start < 1 || end < 1 || start > total || end > total) {
    alert(`메시지 번호는 1 ~ ${total.toLocaleString()} 범위로 입력해 주세요.`);
    return;
  }
  if (start > end) {
    alert('시작 번호는 종료 번호보다 작거나 같아야 합니다.');
    return;
  }

  const extractedMessages = cutSourceMessages.slice(start - 1, end);
  cutExtractedHtml = extractOriginalHtmlByMessageRange(cutSourceHtml, start, end);

  renderLinePreview(cutResultPreview, extractedMessages.map(messageToPreviewText), start);
  if (cutStatus) {
    cutStatus.textContent = `${start.toLocaleString()}~${end.toLocaleString()}번 메시지 추출 완료 · 원본 디자인 유지 HTML 생성`;
  }
  if (btnCutDownload) btnCutDownload.disabled = extractedMessages.length === 0;
}

function downloadCutResult() {
  if (!cutExtractedHtml) return;

  const blob = new Blob([cutExtractedHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `[CocoFormat-cut]${cutSourceFileName}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseFontSize() {
  const n = parseInt($('log-font-size').value, 10);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.fontSize;
  return Math.min(24, Math.max(10, n));
}

function parseLineHeight() {
  const n = parseFloat($('log-line-height').value);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.lineHeight;
  return Math.min(3, Math.max(1, Math.round(n * 10) / 10));
}

function parseMessagePadding() {
  const n = parseInt($('log-message-padding').value, 10);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.messagePaddingY;
  return Math.min(40, Math.max(0, n));
}

function parseAvatarSize() {
  const n = parseInt($('log-avatar-size').value, 10);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.avatarSize;
  return Math.min(96, Math.max(24, n));
}

function getStyleSettings() {
  return {
    tabs: {
      otherTitle: $('tab-other-title').value.trim() || DEFAULT_STYLE_SETTINGS.tabs.otherTitle,
      mainTitle: $('tab-main-title').value.trim() || DEFAULT_STYLE_SETTINGS.tabs.mainTitle,
      otherBg: $('tab-other-bg').value,
      mainBg: $('tab-main-bg').value,
      otherText: $('tab-other-text').value,
      mainText: $('tab-main-text').value,
      otherLabelColor: $('tab-other-label').value,
      mainLabelColor: $('tab-main-label').value,
      fontSize: parseFontSize(),
      lineHeight: parseLineHeight(),
      messagePaddingY: parseMessagePadding(),
      avatarSize: parseAvatarSize(),
      tabDividerTransparent: $('tab-divider-transparent').checked,
    },
    customTabs: { ...customTabConfigs },
    system: {
      label: $('system-label').value.trim() || 'system',
      bg: $('system-bg').value,
      textColor: $('system-text').value,
      borderColor: $('system-border').value,
    },
  };
}

function renderCustomTabSettings() {
  const extra = tabTypes.filter((t) => t !== 'main' && t !== 'other');
  if (extra.length === 0) {
    customTabsContainer.hidden = true;
    customTabsContainer.innerHTML = '';
    return;
  }

  customTabsContainer.hidden = false;
  customTabsContainer.innerHTML = '<h3 class="custom-tabs-heading">개별 탭 스타일</h3><div class="custom-tabs-grid"></div>';
  const grid = customTabsContainer.querySelector('.custom-tabs-grid');

  for (const tab of extra) {
    if (!customTabConfigs[tab]) {
      customTabConfigs[tab] = {
        title: tab,
        bg: CUSTOM_TAB_FALLBACK.bg,
        text: CUSTOM_TAB_FALLBACK.text,
        labelColor: CUSTOM_TAB_FALLBACK.labelColor,
      };
    }

    const cfg = customTabConfigs[tab];
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'custom-tab-fieldset';
    fieldset.innerHTML = `
      <legend>[${escapeHtml(tab)}]</legend>
      <label>탭 이름 <input type="text" data-tab-field="title" value="${escapeAttr(cfg.title)}" /></label>
      <label>배경색 <input type="color" data-tab-field="bg" value="${cfg.bg}" /></label>
      <label>글자색 <input type="color" data-tab-field="text" value="${cfg.text}" /></label>
      <label>칩 색 <input type="color" data-tab-field="labelColor" value="${cfg.labelColor}" /></label>
    `;

    fieldset.querySelectorAll('[data-tab-field]').forEach((input) => {
      const field = input.dataset.tabField;
      const handler = () => {
        customTabConfigs[tab][field] = input.value;
        if (messages.length > 0) scheduleConvert();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });

    grid.appendChild(fieldset);
  }
}

function collectTextOverrides() {
  const doc = previewFrame.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('[data-edit-id]').forEach((block) => {
    const id = block.getAttribute('data-edit-id');
    const textEl = block.querySelector('.ccl_Utext');
    if (id && textEl) textOverrides.set(id, textEl.innerHTML);
  });
}

function syncPreviewToOutput() {
  collectTextOverrides();
  const doc = previewFrame.contentDocument;
  if (!doc?.documentElement) return;
  outputHtml = serializeFromPreviewDocument(doc);
}

async function handleFile(file) {
  if (!file || isHandlingFile) return;
  isHandlingFile = true;
  fileInput.value = '';

  showOverlay('파일 읽는 중...');
  try {
    const html = await file.text();
    sourceFileName = file.name.replace(/\.html?$/i, '');

    messages = parseCcfoliaHtml(html);
    if (messages.length === 0) {
      alert('메시지를 찾을 수 없습니다. ccfolia 로그 HTML인지 확인해 주세요.');
      return;
    }

    tabTypes = extractTabTypes(messages);
    customTabConfigs = {};
    speakers = extractSpeakers(messages);
    textOverrides = new Map();
    imageOverrides = new Map();

    renderCustomTabSettings();
    renderSpeakerTable();

    fileInfo.hidden = false;
    fileInfo.textContent = `${file.name} · ${formatBytes(file.size)} · 메시지 ${messages.length.toLocaleString()}개 · 화자 ${speakers.length}명 · 탭 ${tabTypes.join(', ')}`;

    showStepsAfterUpload();
    hideOverlay();
    await runConvert();
  } catch (err) {
    console.error(err);
    alert(`파일 처리 중 오류: ${err.message}`);
  } finally {
    isHandlingFile = false;
    hideOverlay();
  }
}

function renderSpeakerTable() {
  speakerTbody.innerHTML = '';

  for (const speaker of speakers) {
    const tr = document.createElement('tr');
    if (speaker.isSystem) tr.classList.add('is-system');

    const avatarHtml = speaker.isSystem || speaker.isNarrator
      ? '<span class="avatar-placeholder" aria-hidden="true"></span>'
      : `<button type="button" class="avatar-btn" title="기본 프로필 이미지 URL">
          ${speaker.imageUrl
            ? `<img class="avatar-preview" src="${escapeAttr(speaker.imageUrl)}" alt="" />`
            : '<span class="avatar-empty">+</span>'}
        </button>`;

    tr.innerHTML = `
      <td class="col-original">
        <div class="speaker-identity">
          ${avatarHtml}
          <span class="speaker-name" style="color:${escapeAttr(speaker.color)}">${escapeHtml(speaker.originalName)}</span>
        </div>
      </td>
      <td>
        <input type="text" data-field="displayName" value="${escapeAttr(speaker.displayName)}"
          ${speaker.isSystem ? 'readonly' : ''} />
      </td>
      <td>
        <div class="color-cell">
          <input type="color" class="color-picker" data-field="color" value="${speaker.color}"
            ${speaker.isSystem || speaker.isNarrator ? 'disabled' : ''} />
        </div>
      </td>
      <td class="narrator-cell">
        ${speaker.isSystem ? 'system' : `<input type="checkbox" data-field="isNarrator" ${speaker.isNarrator ? 'checked' : ''} />`}
      </td>
    `;

    tr.dataset.key = speaker.key;
    bindSpeakerRow(tr, speaker);
    speakerTbody.appendChild(tr);
  }
}

function bindSpeakerRow(tr, speaker) {
  const avatarBtn = tr.querySelector('.avatar-btn');
  if (avatarBtn) {
    avatarBtn.addEventListener('click', () => openImageDialog({ mode: 'speaker', speaker }));
  }

  tr.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.dataset.field;
    const event = el.type === 'checkbox' ? 'change' : 'input';

    el.addEventListener(event, () => {
      if (field === 'displayName') speaker.displayName = el.value;
      if (field === 'color') {
        speaker.color = el.value;
        const nameSpan = tr.querySelector('.speaker-name');
        if (nameSpan) nameSpan.style.color = el.value;
      }
      if (field === 'isNarrator') {
        speaker.isNarrator = el.checked;
        scheduleConvert();
        renderSpeakerTable();
        return;
      }
      scheduleConvert();
    });
  });
}

function openImageDialog(target) {
  imageDialogTarget = target;
  const title = $('image-dialog-title');
  const hint = $('image-dialog-hint');

  if (target.mode === 'block') {
    title.textContent = '이 메시지의 프로필 이미지';
    hint.hidden = false;
    hint.textContent = '이 블록에만 적용됩니다. 다른 메시지는 변경되지 않습니다.';
    imageDialogUrl.value = imageOverrides.get(target.editId) ?? target.fallbackUrl ?? '';
  } else {
    title.textContent = '기본 프로필 이미지 URL';
    hint.hidden = false;
    hint.textContent = `${target.speaker.displayName}의 기본 이미지입니다. 미리보기에서 개별 변경한 메시지는 유지됩니다.`;
    imageDialogUrl.value = target.speaker.imageUrl || '';
  }

  imageDialog.showModal();
}

function syncSpeakersFromTable() {
  for (const tr of speakerTbody.querySelectorAll('tr')) {
    const key = tr.dataset.key;
    const speaker = speakers.find((s) => s.key === key);
    if (!speaker) continue;

    const nameEl = tr.querySelector('[data-field="displayName"]');
    const colorEl = tr.querySelector('[data-field="color"]');
    const narratorEl = tr.querySelector('[data-field="isNarrator"]');

    if (nameEl) speaker.displayName = nameEl.value;
    if (colorEl && !colorEl.disabled) speaker.color = colorEl.value;
    if (narratorEl) speaker.isNarrator = narratorEl.checked;
  }
}

function scheduleConvert() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runConvert(), 400);
}

function capturePreviewAnchor(doc, scrollEl) {
  if (!doc || !scrollEl) return null;
  const blocks = Array.from(doc.querySelectorAll('[data-edit-id]'));
  if (blocks.length === 0) return null;

  let anchorEl = null;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom > 0) {
      anchorEl = block;
      break;
    }
  }
  if (!anchorEl) anchorEl = blocks[blocks.length - 1];
  if (!anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const anchorId = anchorEl.getAttribute('data-edit-id');
  if (!anchorId) return null;
  const anchorTop = scrollEl.scrollTop + rect.top;

  return {
    id: anchorId,
    offsetX: scrollEl.scrollLeft,
    offsetYWithin: scrollEl.scrollTop - anchorTop,
    fallbackY: scrollEl.scrollTop,
  };
}

function restorePreviewAnchor(doc, scrollEl, anchor) {
  if (!doc || !scrollEl || !anchor) return;
  const target = Array.from(doc.querySelectorAll('[data-edit-id]')).find(
    (el) => el.getAttribute('data-edit-id') === anchor.id,
  );
  scrollEl.scrollLeft = anchor.offsetX ?? 0;
  if (!target) {
    scrollEl.scrollTop = anchor.fallbackY ?? 0;
    return;
  }
  const rect = target.getBoundingClientRect();
  const top = scrollEl.scrollTop + rect.top;
  scrollEl.scrollTop = top + (anchor.offsetYWithin ?? 0);
}

async function runConvert() {
  if (messages.length === 0) return;

  syncSpeakersFromTable();
  collectTextOverrides();

  const gen = ++convertGeneration;
  showOverlay('변환 중...', true);

  try {
    outputHtml = await convertToCocolog2(
      messages,
      speakers,
      getStyleSettings(),
      (ratio) => {
        if (gen !== convertGeneration) return;
        setProgress(ratio);
      },
      textOverrides,
      imageOverrides,
    );

    if (gen !== convertGeneration) return;

    $('status').textContent = `변환 완료 · 출력 ${formatBytes(new Blob([outputHtml]).size)} · 메시지 ${messages.length.toLocaleString()}개`;
    updatePreview();
  } catch (err) {
    console.error(err);
    alert(`변환 중 오류: ${err.message}`);
  } finally {
    if (gen === convertGeneration) hideOverlay();
  }
}

function updatePreview() {
  const currentDoc = previewFrame.contentDocument;
  const currentWrap = currentDoc?.getElementById('cclog_ccf');
  const currentStyle = currentDoc?.querySelector('style');

  // 이미 로드된 문서가 있으면 iframe 재로드 대신 내용만 교체해 스크롤 점프를 줄인다.
  if (currentDoc && currentWrap && currentStyle) {
    const parser = new DOMParser();
    const nextDoc = parser.parseFromString(outputHtml, 'text/html');
    const nextWrap = nextDoc.getElementById('cclog_ccf');
    const nextStyle = nextDoc.querySelector('style');
    if (nextWrap && nextStyle) {
      const scrollEl = currentDoc.scrollingElement || currentDoc.documentElement;
      const anchor = capturePreviewAnchor(currentDoc, scrollEl);

      currentStyle.textContent = nextStyle.textContent || '';
      currentWrap.innerHTML = nextWrap.innerHTML;

      requestAnimationFrame(() => {
        restorePreviewAnchor(currentDoc, scrollEl, anchor);
      });
      setupPreviewInteractions();
      return;
    }
  }

  previewFrame.onload = () => setupPreviewInteractions();
  previewFrame.srcdoc = outputHtml;
}

function setupPreviewInteractions() {
  const doc = previewFrame.contentDocument;
  if (!doc) return;

  doc.querySelectorAll('.ccl_Utext').forEach((el) => {
    el.addEventListener('input', () => {
      const block = el.closest('[data-edit-id]');
      const id = block?.getAttribute('data-edit-id');
      if (id) textOverrides.set(id, el.innerHTML);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncPreviewToOutput, 300);
    });
  });

  doc.querySelectorAll('.ccl_imgWrap[data-edit-id]').forEach((wrap) => {
    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      const editId = wrap.getAttribute('data-edit-id');
      const block = wrap.closest('[data-edit-id]');
      const speakerKey = block?.getAttribute('data-speaker-key');
      const speaker = speakers.find((s) => s.key === speakerKey);
      const fallbackUrl = imageOverrides.get(editId) ?? speaker?.imageUrl ?? '';

      openImageDialog({
        mode: 'block',
        editId,
        fallbackUrl,
      });
    });
  });
}

function downloadResult() {
  syncPreviewToOutput();
  if (!outputHtml) return;

  const blob = new Blob([outputHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `[CocoFormat]${sourceFileName}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeStylePayload(raw) {
  const fallback = DEFAULT_STYLE_SETTINGS;
  const tabs = raw?.tabs ?? {};
  const system = raw?.system ?? {};
  const rawCustomTabs = raw?.customTabs && typeof raw.customTabs === 'object' ? raw.customTabs : {};

  const normalizedCustomTabs = {};
  for (const [key, cfg] of Object.entries(rawCustomTabs)) {
    if (!cfg || typeof cfg !== 'object') continue;
    normalizedCustomTabs[key] = {
      title: typeof cfg.title === 'string' && cfg.title.trim() ? cfg.title.trim() : key,
      bg: typeof cfg.bg === 'string' ? cfg.bg : CUSTOM_TAB_FALLBACK.bg,
      text: typeof cfg.text === 'string' ? cfg.text : CUSTOM_TAB_FALLBACK.text,
      labelColor: typeof cfg.labelColor === 'string' ? cfg.labelColor : CUSTOM_TAB_FALLBACK.labelColor,
    };
  }

  return {
    tabs: {
      otherTitle: typeof tabs.otherTitle === 'string' && tabs.otherTitle.trim()
        ? tabs.otherTitle.trim()
        : fallback.tabs.otherTitle,
      mainTitle: typeof tabs.mainTitle === 'string' && tabs.mainTitle.trim()
        ? tabs.mainTitle.trim()
        : fallback.tabs.mainTitle,
      otherBg: typeof tabs.otherBg === 'string' ? tabs.otherBg : fallback.tabs.otherBg,
      mainBg: typeof tabs.mainBg === 'string' ? tabs.mainBg : fallback.tabs.mainBg,
      otherText: typeof tabs.otherText === 'string' ? tabs.otherText : fallback.tabs.otherText,
      mainText: typeof tabs.mainText === 'string' ? tabs.mainText : fallback.tabs.mainText,
      otherLabelColor: typeof tabs.otherLabelColor === 'string' ? tabs.otherLabelColor : fallback.tabs.otherLabelColor,
      mainLabelColor: typeof tabs.mainLabelColor === 'string' ? tabs.mainLabelColor : fallback.tabs.mainLabelColor,
      fontSize: Number.isFinite(Number(tabs.fontSize)) ? Number(tabs.fontSize) : fallback.tabs.fontSize,
      lineHeight: Number.isFinite(Number(tabs.lineHeight)) ? Number(tabs.lineHeight) : fallback.tabs.lineHeight,
      messagePaddingY: Number.isFinite(Number(tabs.messagePaddingY)) ? Number(tabs.messagePaddingY) : fallback.tabs.messagePaddingY,
      avatarSize: Number.isFinite(Number(tabs.avatarSize)) ? Number(tabs.avatarSize) : fallback.tabs.avatarSize,
      tabDividerTransparent: Boolean(tabs.tabDividerTransparent),
    },
    customTabs: normalizedCustomTabs,
    system: {
      label: typeof system.label === 'string' && system.label.trim() ? system.label.trim() : fallback.system.label,
      bg: typeof system.bg === 'string' ? system.bg : fallback.system.bg,
      textColor: typeof system.textColor === 'string' ? system.textColor : fallback.system.textColor,
      borderColor: typeof system.borderColor === 'string' ? system.borderColor : fallback.system.borderColor,
    },
  };
}

function applyStyleSettings(style) {
  const normalized = normalizeStylePayload(style);
  const t = normalized.tabs;
  const s = normalized.system;

  $('tab-divider-transparent').checked = t.tabDividerTransparent;
  $('log-font-size').value = String(t.fontSize);
  $('log-line-height').value = String(t.lineHeight);
  $('log-message-padding').value = String(t.messagePaddingY);
  $('log-avatar-size').value = String(t.avatarSize);
  $('tab-other-title').value = t.otherTitle;
  $('tab-main-title').value = t.mainTitle;
  $('tab-other-bg').value = t.otherBg;
  $('tab-main-bg').value = t.mainBg;
  $('tab-other-text').value = t.otherText;
  $('tab-main-text').value = t.mainText;
  $('tab-other-label').value = t.otherLabelColor;
  $('tab-main-label').value = t.mainLabelColor;
  $('system-label').value = s.label;
  $('system-bg').value = s.bg;
  $('system-text').value = s.textColor;
  $('system-border').value = s.borderColor;

  customTabConfigs = normalized.customTabs;
  renderCustomTabSettings();

  if (messages.length > 0) scheduleConvert();
}

function exportStyleSettingsJson() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    style: getStyleSettings(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `[CocoFormat]style-${sourceFileName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importStyleSettingsJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const style = parsed?.style ?? parsed;
  if (!style || typeof style !== 'object') {
    throw new Error('유효한 스타일 JSON 형식이 아닙니다.');
  }
  applyStyleSettings(style);
}

function exportSpeakerSettingsJson() {
  syncSpeakersFromTable();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    speakers: speakers.map((s) => ({
      key: s.key,
      color: s.color,
      imageUrl: s.imageUrl || '',
      isNarrator: Boolean(s.isNarrator),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `[CocoFormat]speakers-${sourceFileName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function applySpeakerSettings(data) {
  const entries = Array.isArray(data?.speakers) ? data.speakers : Array.isArray(data) ? data : null;
  if (!entries) {
    throw new Error('유효한 화자 JSON 형식이 아닙니다.');
  }

  const byKey = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const key = typeof entry.key === 'string' ? entry.key : '';
    if (!key) continue;
    byKey.set(key, entry);
  }

  let appliedCount = 0;
  for (const speaker of speakers) {
    const incoming = byKey.get(speaker.key);
    if (!incoming) continue;
    if (typeof incoming.color === 'string') speaker.color = incoming.color;
    if (typeof incoming.imageUrl === 'string') speaker.imageUrl = incoming.imageUrl;
    if ('isNarrator' in incoming) speaker.isNarrator = Boolean(incoming.isNarrator);
    appliedCount += 1;
  }

  renderSpeakerTable();
  if (messages.length > 0) scheduleConvert();
  return appliedCount;
}

async function importSpeakerSettingsJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  return applySpeakerSettings(parsed);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

initFileDrop(fileDrop, fileInput, handleFile);
initFileDrop(cutFileDrop, cutFileInput, async (file) => {
  try {
    await handleCutFile(file);
  } catch (err) {
    console.error(err);
    alert(`파일 처리 중 오류: ${err.message}`);
  } finally {
    if (cutFileInput) cutFileInput.value = '';
  }
});

for (const tab of modeTabs) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode || 'edit'));
}

window.addEventListener('hashchange', () => {
  setMode(modeFromHash(), { updateUrl: false });
});

setMode(modeFromHash(), { replace: true });
resetCutWorkspace();

$('btn-download').addEventListener('click', downloadResult);
$('btn-style-export').addEventListener('click', exportStyleSettingsJson);
$('btn-style-import').addEventListener('click', () => styleJsonInput.click());
$('btn-speaker-export').addEventListener('click', exportSpeakerSettingsJson);
$('btn-speaker-import').addEventListener('click', () => speakerJsonInput.click());
btnCutApply?.addEventListener('click', applyCutRange);
btnCutDownload?.addEventListener('click', downloadCutResult);

for (const el of [cutStartLineInput, cutEndLineInput]) {
  el?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCutRange();
    }
  });
}

styleJsonInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await importStyleSettingsJson(file);
  } catch (err) {
    console.error(err);
    alert(`스타일 JSON 적용 실패: ${err.message}`);
  } finally {
    styleJsonInput.value = '';
  }
});

speakerJsonInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const applied = await importSpeakerSettingsJson(file);
    if (applied === 0) {
      alert('이름이 일치하는 화자가 없어 적용되지 않았습니다.');
    }
  } catch (err) {
    console.error(err);
    alert(`화자 JSON 적용 실패: ${err.message}`);
  } finally {
    speakerJsonInput.value = '';
  }
});

$('image-dialog-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!imageDialogTarget) return;

  const url = imageDialogUrl.value.trim();

  if (imageDialogTarget.mode === 'block') {
    if (url) imageOverrides.set(imageDialogTarget.editId, url);
    else imageOverrides.delete(imageDialogTarget.editId);
  } else {
    imageDialogTarget.speaker.imageUrl = url;
    renderSpeakerTable();
  }

  imageDialog.close();
  imageDialogTarget = null;
  scheduleConvert();
});

$('image-dialog-clear').addEventListener('click', () => {
  imageDialogUrl.value = '';
});

const settingIds = [
  'tab-divider-transparent',
  'log-font-size',
  'log-line-height',
  'log-message-padding',
  'log-avatar-size',
  'tab-other-title', 'tab-main-title',
  'tab-other-bg', 'tab-main-bg',
  'tab-other-text', 'tab-main-text',
  'tab-other-label', 'tab-main-label',
  'system-label', 'system-bg', 'system-text', 'system-border',
];

for (const id of settingIds) {
  const el = $(id);
  if (!el) continue;
  const event = el.type === 'checkbox' ? 'change' : 'input';
  el.addEventListener(event, () => {
    if (messages.length > 0) scheduleConvert();
  });
  if (el.type !== 'checkbox') {
    el.addEventListener('change', () => {
      if (messages.length > 0) scheduleConvert();
    });
  }
}
