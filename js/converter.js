/**
 * 메시지 배열 → cocolog2 호환 HTML 변환
 */

import { speakerKey } from "./parser.js";

/** @typedef {import('./parser.js').CcfoliaMessage} CcfoliaMessage */
/** @typedef {import('./parser.js').SpeakerConfig} SpeakerConfig */

/**
 * @typedef {Object} TabStyle
 * @property {string} title
 * @property {string} bg
 * @property {string} text
 * @property {string} labelColor
 */

/**
 * @typedef {Object} StyleSettings
 * @property {Object} tabs
 * @property {Object} customTabs
 * @property {Object} system
 */

export const DEFAULT_STYLE_SETTINGS = {
  tabs: {
    otherTitle: "잡담",
    mainTitle: "메인",
    otherBg: "#27262C",
    mainBg: "#1f1e22",
    otherText: "#c8c8cc",
    mainText: "#ffffff",
    otherLabelColor: "#8e8c9a",
    mainLabelColor: "#b0aebc",
    fontSize: 15,
    lineHeight: 1.6,
    messagePaddingY: 14,
    avatarSize: 40,
    tabDividerTransparent: false,
  },
  customTabs: {},
  system: {
    label: "system",
    bg: "#1f1e22",
    textColor: "#8a8898",
    borderColor: "#5a5870",
  },
};

export const CUSTOM_TAB_FALLBACK = {
  bg: "#2a2930",
  text: "#c8c8cc",
  labelColor: "#9492a0",
};

const BASE_CSS = `    html, body { padding: 0; margin: 0; }
    * { box-sizing: border-box; }
    #cclog_ccf .ccl_inWrap { letter-spacing: -.5px; }

    #cclog_ccf .ccl_inWrap .ccl_tab {
      width: 100%;
      position: relative;
      border-radius: 0;
      overflow: hidden;
    }

    #cclog_ccf .ccl_tab_chip {
      position: absolute;
      top: 8px;
      right: 10px;
      z-index: 2;
      margin: 0;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.65rem;
      font-weight: 500;
      letter-spacing: 0.03em;
      line-height: 1.5;
      pointer-events: none;
      border: 1px solid;
      opacity: 0.92;
    }

    #cclog_ccf .ccl_tab_chip.ccl_tab_chip--hidden {
      display: none;
    }

    #cclog_ccf .ccl_inWrap .ccl_player {
      display: flex;
      overflow: hidden;
      padding-left: 20px;
      padding-right: 18px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }

    #cclog_ccf .ccl_inWrap .ccl_player:last-child {
      border-bottom: none;
    }

    #cclog_ccf .ccl_inWrap .ccl_infoWrap .ccl_imgWrap {
      overflow: hidden;
      width: var(--ccl-avatar-size, 40px);
      height: var(--ccl-avatar-size, 40px);
      background-color: rgba(0, 0, 0, 0.25);
      border-radius: 6px;
      cursor: pointer;
      flex-shrink: 0;
    }

    #cclog_ccf .ccl_inWrap .ccl_infoWrap .ccl_imgWrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    #cclog_ccf .ccl_inWrap .ccl_infoWrap .ccl_imgWrap:not(:has(img)) {
      opacity: 0.2;
    }

    #cclog_ccf .ccl_inWrap .ccl_textWrap {
      margin-left: 14px;
      margin-right: 8px;
      flex: 1;
      min-width: 0;
    }

    #cclog_ccf .ccl_inWrap .ccl_textWrap .ccl_Uname {
      margin: 0 0 2px;
      font-weight: 700;
      font-size: 0.92em;
    }

    #cclog_ccf .ccl_inWrap .ccl_textWrap .ccl_Utext {
      margin: 0;
      font-weight: 400;
      outline: none;
    }

    #cclog_ccf .ccl_inWrap .ccl_textWrap .ccl_Utext:focus {
      box-shadow: 0 0 0 2px rgba(124, 108, 240, 0.4);
      border-radius: 3px;
    }

    #cclog_ccf .ccl_inWrap .ccl_player.system {
      padding-left: 24px;
      padding-right: 24px;
      justify-content: center;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }

    #cclog_ccf .ccl_inWrap .ccl_player.system .ccl_infoWrap { display: none; }

    #cclog_ccf .ccl_inWrap .ccl_player.system .ccl_textWrap {
      margin-left: 0;
      text-align: center;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    #cclog_ccf .ccl_sys_chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: lowercase;
      border: 1px solid;
      line-height: 1.5;
    }

    #cclog_ccf .ccl_inWrap .ccl_player.system .ccl_Utext {
      font-size: 0.85em;
    }

    #cclog_ccf .ccl_inWrap .ccl_player.narrator {
      padding-left: 28px;
      padding-right: 28px;
      text-align: center;
      justify-content: center;
    }

    #cclog_ccf .ccl_inWrap .ccl_player.narrator .ccl_infoWrap { display: none; }

    #cclog_ccf .ccl_inWrap .ccl_player.narrator .ccl_textWrap {
      margin-left: 0;
      max-width: 100%;
    }

    #cclog_ccf .ccl_inWrap .ccl_player.narrator .ccl_Uname { display: none; }

    #cclog_ccf .ccl_inWrap .ccl_player.narrator .ccl_Utext {
      letter-spacing: -0.2px;
    }`;

/**
 * @param {string} tab
 * @param {StyleSettings} style
 * @returns {TabStyle}
 */
export function resolveTabStyle(tab, style) {
  const t = style.tabs;
  const custom = style.customTabs?.[tab];

  if (tab === "main") {
    return {
      title: t.mainTitle,
      bg: t.mainBg,
      text: t.mainText,
      labelColor: t.mainLabelColor,
    };
  }
  if (tab === "other") {
    return {
      title: t.otherTitle,
      bg: t.otherBg,
      text: t.otherText,
      labelColor: t.otherLabelColor,
    };
  }
  if (custom) {
    return {
      title: custom.title || tab,
      bg: custom.bg || CUSTOM_TAB_FALLBACK.bg,
      text: custom.text || CUSTOM_TAB_FALLBACK.text,
      labelColor: custom.labelColor || CUSTOM_TAB_FALLBACK.labelColor,
    };
  }
  return {
    title: tab,
    bg: CUSTOM_TAB_FALLBACK.bg,
    text: CUSTOM_TAB_FALLBACK.text,
    labelColor: CUSTOM_TAB_FALLBACK.labelColor,
  };
}

function buildDynamicCss(style) {
  const t = style.tabs;
  const s = style.system;
  const fontSize = clampFontSize(t.fontSize);
  const lineHeight = clampLineHeight(t.lineHeight);
  const messagePaddingY = clampMessagePadding(t.messagePaddingY);
  const avatarSize = clampAvatarSize(t.avatarSize);
  let css = `
    #cclog_ccf .ccl_inWrap {
      font-size: ${fontSize}px;
      --ccl-avatar-size: ${avatarSize}px;
    }
    #cclog_ccf .ccl_inWrap .ccl_textWrap { line-height: ${lineHeight}; }
    #cclog_ccf .ccl_inWrap .ccl_player.system .ccl_Utext { line-height: ${lineHeight}; }
    #cclog_ccf .ccl_inWrap .ccl_player {
      padding-top: ${messagePaddingY}px;
      padding-bottom: ${messagePaddingY}px;
    }
    #cclog_ccf .ccl_inWrap .ccl_tab.ccl_main .ccl_textWrap .ccl_Utext { color: ${t.mainText}; }
    #cclog_ccf .ccl_inWrap .ccl_tab.ccl_other .ccl_textWrap .ccl_Utext { color: ${t.otherText}; }
    #cclog_ccf .ccl_inWrap .ccl_tab.ccl_main { background: ${t.mainBg}; }
    #cclog_ccf .ccl_inWrap .ccl_tab.ccl_other { background: ${t.otherBg}; }
    #cclog_ccf .ccl_sys_chip {
      color: ${s.borderColor};
      border-color: ${s.borderColor}66;
      background: rgba(0,0,0,0.25);
    }
    #cclog_ccf .ccl_inWrap .ccl_player.system { background: ${s.bg}; }
    #cclog_ccf .ccl_inWrap .ccl_player.system .ccl_Utext { color: ${s.textColor}; }
    #cclog_ccf .ccl_inWrap .ccl_tab.ccl_custom { background: ${CUSTOM_TAB_FALLBACK.bg}; }
    #cclog_ccf .ccl_inWrap .ccl_tab.ccl_custom .ccl_textWrap .ccl_Utext { color: ${CUSTOM_TAB_FALLBACK.text}; }`;

  for (const [tabId, cfg] of Object.entries(style.customTabs || {})) {
    const safe = tabId.replace(/[^a-z0-9_-]/gi, "_");
    css += `
    #cclog_ccf .ccl_inWrap .ccl_tab.tab_${safe} { background: ${cfg.bg}; }
    #cclog_ccf .ccl_inWrap .ccl_tab.tab_${safe} .ccl_textWrap .ccl_Utext { color: ${cfg.text}; }`;
  }

  return css;
}

function clampFontSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.fontSize;
  return Math.min(24, Math.max(10, Math.round(n)));
}

function clampLineHeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.lineHeight;
  return Math.min(3, Math.max(1, Math.round(n * 10) / 10));
}

function clampMessagePadding(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.messagePaddingY;
  return Math.min(40, Math.max(0, Math.round(n)));
}

function clampAvatarSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_STYLE_SETTINGS.tabs.avatarSize;
  return Math.min(96, Math.max(24, Math.round(n)));
}

function tabCssClass(tab) {
  if (tab === "main") return "ccl_main";
  if (tab === "other") return "ccl_other";
  return `ccl_custom tab_${tab.replace(/[^a-z0-9_-]/gi, "_")}`;
}

function systemChipStyle(s) {
  return `color:${s.borderColor}; border-color:${s.borderColor}66; background:rgba(0,0,0,0.25);`;
}

function tabChipStyle(ts) {
  return `color:${ts.labelColor}; border-color:${ts.labelColor}66; background:rgba(0,0,0,0.3);`;
}

function renderTabChip(ts, tc, hidden) {
  if (hidden) return "";
  return `<span class="ccl_tab_chip ${tc}" style="${tabChipStyle(ts)}">${escapeHtml(ts.title)}</span>`;
}

/**
 * @param {StyleSettings} style
 * @param {'other'|'main'|'system'|string} type
 */
export function buildStyleSampleHtml(style, type) {
  const sample = "이것은 테스트 메시지입니다.";
  const fontSize = clampFontSize(style.tabs.fontSize);

  if (type === "system") {
    const s = style.system;
    return `<div style="background:#1a191e;padding:12px;font-size:${fontSize}px;">
      <div class="ccl_player system" style="padding:14px 20px 16px;text-align:center;">
        <div class="ccl_textWrap" style="margin:0;display:flex;flex-direction:column;align-items:center;gap:8px;">
          <span class="ccl_sys_chip" style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:0.8rem;border:1px solid;${systemChipStyle(s)}">${escapeHtml(s.label)}</span>
          <p style="margin:0;color:${s.textColor};font-size:0.85em;line-height:1.55;">${sample}</p>
        </div>
      </div>
    </div>`;
  }

  const tabKey = type === "other" || type === "main" ? type : type;
  const ts = resolveTabStyle(tabKey, style);
  const tc = tabCssClass(tabKey);
  const chip = style.tabs.tabDividerTransparent
    ? ""
    : `<span class="ccl_tab_chip" style="position:absolute;top:6px;right:8px;${tabChipStyle(ts)} padding:2px 10px;border-radius:999px;font-size:0.65rem;border:1px solid;">${escapeHtml(ts.title)}</span>`;

  return `<div style="background:#1a191e;padding:12px;font-size:${fontSize}px;">
    <div class="ccl_tab ${tc}" style="position:relative;background:${ts.bg};padding:28px 14px 10px;">
      ${chip}
      <p style="margin:0 0 2px;font-weight:700;font-size:0.92em;color:#ff9800;">테스트</p>
      <p style="margin:0;color:${ts.text};">${sample}</p>
    </div>
  </div>`;
}

/**
 * @param {CcfoliaMessage[]} messages
 * @param {SpeakerConfig[]} speakers
 * @param {StyleSettings} styleSettings
 * @param {(ratio: number) => void} [onProgress]
 * @param {Map<string, string>} [textOverrides]
 * @param {Map<string, string>} [imageOverrides]
 */
export async function convertToCocolog2(
  messages,
  speakers,
  styleSettings = DEFAULT_STYLE_SETTINGS,
  onProgress,
  textOverrides,
  imageOverrides,
) {
  assignPlayerClasses(speakers);
  const speakerMap = new Map(speakers.map((s) => [s.key, s]));
  const runs = groupIntoRuns(messages);

  const bodyParts = [];
  const total = runs.length || 1;

  for (let i = 0; i < runs.length; i++) {
    bodyParts.push(
      renderRun(
        runs[i],
        speakerMap,
        styleSettings,
        i,
        textOverrides,
        imageOverrides,
      ),
    );
    if (onProgress && (i % 40 === 0 || i === runs.length - 1)) {
      onProgress((i + 1) / total);
      await yieldToMain();
    }
  }

  if (onProgress) onProgress(1);
  return assembleHtml(bodyParts.join("\n"), styleSettings);
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assembleHtml(bodyParts, styleSettings) {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
</head>
<body>
<style>
${BASE_CSS}
${buildDynamicCss(styleSettings)}
</style>
<div class="cclog_wrap" id="cclog_ccf">
${bodyParts}
</div>
</body>
</html>`;
}

function assignPlayerClasses(speakers) {
  let index = 1;
  for (const s of speakers) {
    if (s.isSystem || s.isNarrator) {
      s.playerClass = "";
      continue;
    }
    s.playerClass = `p${String(index).padStart(3, "0")}`;
    index += 1;
  }
}

function groupIntoRuns(messages) {
  const runs = [];
  for (const m of messages) {
    const key = speakerKey(m.name);
    let run = runs[runs.length - 1];
    if (!run || run.tab !== m.tab) {
      run = { tab: m.tab, blocks: [] };
      runs.push(run);
    }
    let block = run.blocks[run.blocks.length - 1];
    if (!block || block.speakerKey !== key) {
      block = { speakerKey: key, texts: [] };
      run.blocks.push(block);
    }
    block.texts.push(m.text);
  }
  return runs;
}

function renderRun(
  run,
  speakerMap,
  styleSettings,
  runIndex,
  textOverrides,
  imageOverrides,
) {
  const ts = resolveTabStyle(run.tab, styleSettings);
  const tc = tabCssClass(run.tab);
  const chip = renderTabChip(ts, tc, styleSettings.tabs.tabDividerTransparent);
  const players = run.blocks
    .map((b, bi) =>
      renderPlayer(
        b,
        speakerMap,
        styleSettings,
        runIndex,
        bi,
        textOverrides,
        imageOverrides,
      ),
    )
    .join("\n");

  return `    <div class="ccl_inWrap" data-run="${runIndex}">
        <div class="ccl_tab ${tc}" style="background:${ts.bg};">
            ${chip}
${players}
        </div>
    </div>`;
}

function renderPlayer(
  block,
  speakerMap,
  styleSettings,
  runIndex,
  blockIndex,
  textOverrides,
  imageOverrides,
) {
  const speaker = speakerMap.get(block.speakerKey);
  const editId = `r${runIndex}-b${blockIndex}`;
  const mergedText = textOverrides?.get(editId) ?? block.texts.join("<br>");
  const name = speaker?.displayName ?? block.speakerKey;
  const color = speaker?.color ?? "#888888";

  if (speaker?.isSystem) {
    const label = escapeHtml(styleSettings.system.label);
    const chipStyle = systemChipStyle(styleSettings.system);
    return `            <div class="ccl_player system" data-edit-id="${editId}">
                <div class="ccl_textWrap">
                    <span class="ccl_sys_chip" style="${chipStyle}">${label}</span>
                    <p class="ccl_Utext" contenteditable="true">${mergedText}</p>
                </div>
            </div>`;
  }

  if (speaker?.isNarrator) {
    return `            <div class="ccl_player narrator" data-edit-id="${editId}">
                <div class="ccl_textWrap">
                    <p class="ccl_Uname" style="color: ${escapeHtml(color)}">${escapeHtml(name)}</p>
                    <p class="ccl_Utext" contenteditable="true">${mergedText}</p>
                </div>
            </div>`;
  }

  const imageUrl = imageOverrides?.get(editId) ?? speaker?.imageUrl ?? "";
  const imgTag = imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="">` : "";
  const playerClass = speaker?.playerClass ?? "";

  return `            <div class="ccl_player ${playerClass}" data-edit-id="${editId}" data-speaker-key="${escapeAttr(block.speakerKey)}">
                <div class="ccl_infoWrap">
                    <div class="ccl_imgWrap" data-edit-id="${editId}" title="이 메시지의 프로필 이미지만 변경">${imgTag}</div>
                </div>
                <div class="ccl_textWrap">
                    <p class="ccl_Uname" style="color: ${escapeHtml(color)}">${escapeHtml(name)}</p>
                    <p class="ccl_Utext" contenteditable="true">${mergedText}</p>
                </div>
            </div>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** @param {Document} doc */
export function serializeFromPreviewDocument(doc) {
  const clone = doc.documentElement.cloneNode(true);
  clone
    .querySelectorAll(".ccl_Utext")
    .forEach((el) => el.removeAttribute("contenteditable"));
  return `<!DOCTYPE html>\n${clone.outerHTML}`;
}
