/**
 * ccfolia 원본 HTML → 메시지 배열 파싱
 */

/**
 * @typedef {Object} CcfoliaMessage
 * @property {string} tab
 * @property {string} name
 * @property {string} color
 * @property {string} text
 */

/**
 * @typedef {Object} SpeakerConfig
 * @property {string} key
 * @property {string} originalName
 * @property {string} displayName
 * @property {string} color
 * @property {string} imageUrl
 * @property {boolean} isNarrator
 * @property {boolean} isSystem
 * @property {string} playerClass
 */

/**
 * @param {string} html
 * @returns {CcfoliaMessage[]}
 */
export function parseCcfoliaHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const messages = [];

  for (const p of doc.body.querySelectorAll('p')) {
    const spans = p.querySelectorAll(':scope > span');
    if (spans.length < 3) continue;

    const colorMatch = p.getAttribute('style')?.match(/color:\s*(#[0-9a-fA-F]{3,8})/i);
    const tabRaw = spans[0].textContent.trim();
    const tab = tabRaw.replace(/^\[|\]$/g, '').trim().toLowerCase();
    const name = spans[1].textContent.replace(/:\s*$/, '').trim();
    const text = spans[2].innerHTML.trim();

    if (!tab || !name) continue;

    messages.push({
      tab,
      name,
      color: colorMatch?.[1]?.toLowerCase() ?? '#888888',
      text,
    });
  }

  return messages;
}

/**
 * @param {CcfoliaMessage[]} messages
 * @returns {string[]}
 */
export function extractTabTypes(messages) {
  const seen = new Set();
  const tabs = [];
  for (const m of messages) {
    if (!seen.has(m.tab)) {
      seen.add(m.tab);
      tabs.push(m.tab);
    }
  }
  return tabs;
}

/**
 * @param {CcfoliaMessage[]} messages
 * @param {SpeakerConfig[]} [prev]
 * @returns {SpeakerConfig[]}
 */
export function extractSpeakers(messages, prev = []) {
  const prevMap = new Map(prev.map((s) => [s.key, s]));
  const order = [];
  const map = new Map();

  for (const m of messages) {
    const key = speakerKey(m.name);
    const isSystem = m.name.toLowerCase() === 'system';

    if (map.has(key)) {
      map.get(key).color = m.color;
      continue;
    }

    const existing = prevMap.get(key);
    map.set(key, {
      key,
      originalName: m.name,
      displayName: existing?.displayName ?? m.name,
      color: m.color,
      imageUrl: existing?.imageUrl ?? '',
      isNarrator: existing?.isNarrator ?? false,
      isSystem,
      playerClass: '',
    });
    order.push(key);
  }

  return order.map((k) => map.get(k));
}

/** @param {string} name */
export function speakerKey(name) {
  return name;
}
