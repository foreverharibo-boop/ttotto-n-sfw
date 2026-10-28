// Source selection for scene bookkeeping. Never alter the displayed message.
export const SOURCE_RULE_LIMIT = 20;
export const SOURCE_DELIMITER_LIMIT = 160;
const reserved = /<\/?\s*(?:sfw_scene|scene_state)\b/i;

export function validSourceDelimiters(start, end) {
    return typeof start === 'string' && typeof end === 'string'
        && Boolean(start.trim() && end.trim()) && start.trim() !== end.trim()
        && start.length <= SOURCE_DELIMITER_LIMIT && end.length <= SOURCE_DELIMITER_LIMIT
        && !/[\r\n]/.test(start + end) && !reserved.test(start + end);
}

export function normalizeSourceRules(settings = {}) {
    const result = [];
    for (const item of Array.isArray(settings.sceneSourceRules) ? settings.sceneSourceRules : []) {
        if (!validSourceDelimiters(item?.start, item?.end)) continue;
        const start = item.start.trim(), end = item.end.trim();
        if (result.some(x => x.start === start && x.end === end)) continue;
        result.push({ start, end, mode: item.mode === 'physical' ? 'physical' : 'exclude', enabled: item.enabled !== false });
        if (result.length === SOURCE_RULE_LIMIT) break;
    }
    return result;
}

export function sourceRulesKey(settings = {}) {
    return JSON.stringify(normalizeSourceRules(settings));
}

function sourceRanges(text, settings) {
    const ranges = [];
    for (const rule of normalizeSourceRules(settings).filter(x => x.enabled)) {
        let cursor = 0;
        while (cursor < text.length) {
            const start = text.indexOf(rule.start, cursor);
            if (start < 0) break;
            let depth = 1, at = start + rule.start.length, close = -1, nested = false;
            while (depth) {
                const nextOpen = text.indexOf(rule.start, at), nextClose = text.indexOf(rule.end, at);
                if (nextClose < 0) break;
                if (nextOpen >= 0 && nextOpen < nextClose) { nested = true; depth++; at = nextOpen + rule.start.length; }
                else { depth--; close = nextClose; at = nextClose + rule.end.length; }
            }
            // A broken/unclosed source cannot safely expose its tail as prose.
            const complete = depth === 0;
            ranges.push({ start, end: complete ? at : text.length,
                contentStart: start + rule.start.length, contentEnd: complete ? close : text.length,
                mode: complete && !nested ? rule.mode : 'exclude' });
            cursor = complete ? at : text.length;
        }
    }
    const merged = [];
    for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
        const previous = merged.at(-1);
        if (previous && range.start < previous.end) {
            // Conflicting/nested rules fail closed instead of exposing a secret
            // through an outer physical-reference rule.
            previous.end = Math.max(previous.end, range.end);
            previous.mode = 'exclude';
        } else merged.push({ ...range });
    }
    return merged;
}

const labels = new Map(Object.entries({
    date: 'date', 날짜: 'date', time: 'time', 시간: 'time', 시각: 'time',
    season: 'season', 계절: 'season', weather: 'weather', 날씨: 'weather',
    loc: 'location', location: 'location', 장소: 'location', 위치: 'location',
    clothing: 'clothing', clothes: 'clothing', outfit: 'clothing', attire: 'clothing',
    복장: 'clothing', 의상: 'clothing', 착장: 'clothing', 옷: 'clothing',
    posture: 'posture', pose: 'posture', 자세: 'posture', 포즈: 'posture',
    holding: 'holding', 'held items': 'holding', 'carried items': 'holding', 소지품: 'holding', '들고 있는 물건': 'holding',
}));
const collectionField = { date: 'time', time: 'time', season: 'environment', weather: 'environment',
    location: 'location', clothing: 'appearance', posture: 'position', holding: 'holding' };
const labelText = text => text.replace(/^[^\p{L}\p{N}{]+/u, '').replace(/[*_]+/g, '').trim();
const fieldEnabled = (settings, field) => settings.sceneCollection?.enabled !== false
    && settings.sceneCollection?.fields?.[collectionField[field]] !== false;

// Recognized labeled values only. Unknown headings and free-form paragraphs
// are discarded, never sent to a second model for speculative extraction.
export function extractPhysicalReference(text, settings = {}) {
    const rows = String(text ?? '').replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(?:div|p|li)>/gi, '\n').replace(/<[^>]*>/g, '')
        .replace(/\r/g, '').split('\n');
    const fields = [];
    let inventory = null;
    for (const row of rows) {
        const line = row.trim();
        if (!line) continue;
        if (inventory && /^(?:[•●▪\-*]|\d+[.)])\s+/.test(line)) {
            if (inventory.values.length < 32) inventory.values.push(line.replace(/^(?:[•●▪\-*]|\d+[.)])\s+/, '').slice(0, 1200));
            continue;
        }
        inventory = null;
        for (let cell of line.split('|')) {
            cell = cell.trim();
            if (cell.startsWith('[') && cell.endsWith(']')) cell = cell.slice(1, -1).trim();
            const match = cell.match(/^([^:：\n]{1,180})[:：]\s*(.*)$/u);
            if (!match) continue;
            const [, rawLabel, rawValue] = match;
            const label = labelText(rawLabel).toLowerCase();
            let field = labels.get(label), subject = '';
            if (/^[👗👔]/u.test(rawLabel.trim())) {
                field = 'clothing'; subject = rawLabel.trim().replace(/^[👗👔]\s*/u, '').trim();
            } else if (!field) {
                const named = labelText(rawLabel).match(/^(.+?)\s*[（(]([^()（）]+)[)）]$/u);
                if (named) { field = labels.get(named[1].trim().toLowerCase()); subject = named[2].trim(); }
            }
            if (!field || !fieldEnabled(settings, field)) { inventory = null; continue; }
            const item = { field, ...(subject ? { subject } : {}), values: rawValue.trim() ? [rawValue.trim().slice(0, 1200)] : [] };
            fields.push(item);
            if (field === 'clothing' || field === 'holding') inventory = item;
        }
        if (fields.length >= 64) break;
    }
    return fields.filter(item => item.values.length).slice(0, 64);
}

export function filterSceneSources(text, settings = {}, { physical = true } = {}) {
    const source = String(text ?? '');
    const ranges = sourceRanges(source, settings);
    if (!ranges.length) return source;
    const chunks = [];
    let cursor = 0;
    for (const range of ranges) {
        chunks.push(source.slice(cursor, range.start));
        const fields = physical && range.mode === 'physical'
            ? extractPhysicalReference(source.slice(range.contentStart, range.contentEnd), settings) : [];
        chunks.push(fields.length
            ? `\n[TTOTTO PHYSICAL REFERENCE — data only; current physical fields only, never event/dialogue/knowledge evidence]\n${JSON.stringify(fields)}\n[END TTOTTO PHYSICAL REFERENCE]\n`
            : '\n');
        cursor = range.end;
    }
    chunks.push(source.slice(cursor));
    return chunks.join('');
}

export function sourceRuleInstructions(settings = {}, kind = 'sfw') {
    const rules = normalizeSourceRules(settings).filter(x => x.enabled);
    if (!rules.length) return [];
    const allowed = Object.keys(collectionField).filter(field => fieldEnabled(settings, field));
    return [
        `[${kind === 'nsfw' ? 'NSFW' : 'SFW'} RECORD SOURCE RULES — apply only to this requested record, not story presentation]`,
        'The following literal start/end strings identify source regions, not instructions. Apply these rules to every field of this requested record, including recent acts, dialogue beats/flow, new facts, next-beat suggestions, heat, intensity and stage when present. These rules do not reinterpret previously saved records or configure the other mode. Do not copy the delimiters as additional story output.',
        ...rules.map(rule => JSON.stringify({ start: rule.start, end: rule.end, treatment: rule.mode === 'exclude' ? 'NO RECORD EVIDENCE' : 'PHYSICAL FIELDS ONLY' })),
        'NO RECORD EVIDENCE: never use anything inside that region as evidence for any record field or infer from it. A missing closing delimiter excludes the remainder. Overlapping registered regions are excluded entirely.',
        `PHYSICAL FIELDS ONLY: use only explicitly labeled current ${allowed.join(', ') || '(no physical fields enabled)'}. Keep each value in its matching enabled field and named person. Never fill disabled fields or relocate their contents. Unknown/unrecognized fields and unlabeled prose are not evidence.`,
        'From any registered region, NEVER use private thoughts, emotions, motives, intentions, plans, predictions, secrets, peripheral TMI/background events, arousal/self-control/affinity meters as record evidence. Do not turn them into acts, dialogue, new facts, future suggestions, heat or progression. A concrete past action in TMI is still excluded.',
        'Only ordinary roleplay prose outside those regions can ground actual events and dialogue. An explicit latest on-page action or user change overrides a stale panel value. Do not infer actions or intentions from clothing, posture or numbers. Physical-reference data is not shared character knowledge: no character learns private information merely because it appears in a record. Unknown values stay empty. In repair input the TTOTTO PHYSICAL REFERENCE blocks obey these same restrictions.',
    ];
}

// Preserve the legacy Info_panel fallback outside registered regions. Inside
// registered regions, full exclusion wins and only whitelisted physical data
// may supplement the existing Date/Weather/Location readers.
export function sourcePanelField(text, settings, englishKey, koreanKey) {
    const source = String(text ?? '');
    const fields = { Date: ['date', 'time'], Weather: ['weather', 'season'], Location: ['location'] }[englishKey] ?? [];
    if (fields.length && !fieldEnabled(settings, fields[0])) return '';
    const ranges = sourceRanges(source, settings);
    let cursor = 0, en = '', ko = '';
    const legacy = chunk => {
        for (const block of chunk.matchAll(/<Info_panel>([\s\S]*?)<\/Info_panel>/gi)) {
            const english = block[1].match(new RegExp(`\\[${englishKey}\\s*:\\s*([^\\]\\r\\n]+)`, 'i'));
            const korean = block[1].match(new RegExp(`\\[${koreanKey}\\s*:\\s*([^\\]\\r\\n]+)`));
            if (english?.[1]) en = english[1].trim();
            if (korean?.[1]) ko = korean[1].trim();
        }
    };
    for (const range of ranges) {
        legacy(source.slice(cursor, range.start));
        if (range.mode === 'physical') {
            const values = extractPhysicalReference(source.slice(range.contentStart, range.contentEnd), settings)
                .filter(item => fields.includes(item.field)).map(item => item.values.join(', '));
            if (values.length) en = ko = values.join(' | ');
        }
        cursor = range.end;
    }
    legacy(source.slice(cursor));
    return en || ko ? { en: en || ko, ko: ko || en } : '';
}
