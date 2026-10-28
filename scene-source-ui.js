import { normalizeSourceRules, validSourceDelimiters, SOURCE_RULE_LIMIT, SOURCE_DELIMITER_LIMIT } from './scene-source-rules.js';

export function createSceneSourceUi(root, getSettings, changed) {
    if (!root) return { render() {} };
    const list = root.querySelector('[data-source-list]');
    const start = root.querySelector('[data-source-start]');
    const end = root.querySelector('[data-source-end]');
    const mode = root.querySelector('[data-source-mode]');
    const status = root.querySelector('[data-source-status]');
    let rendered = '';
    const node = (tag, text, cls) => {
        const el = document.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (cls) el.className = cls;
        return el;
    };
    const commit = rules => {
        getSettings().sceneSourceRules = normalizeSourceRules({ sceneSourceRules: rules });
        changed(); render();
    };
    const choices = () => {
        const select = node('select', undefined, 'text_pole');
        for (const [value, label] of [['exclude', '전체 제외'], ['physical', '장면 정보만 참고']]) {
            const option = node('option', label); option.value = value; select.append(option);
        }
        return select;
    };
    function render() {
        const rules = normalizeSourceRules(getSettings()), key = JSON.stringify(rules);
        if (rendered === key) return;
        rendered = key; list.replaceChildren();
        rules.forEach((rule, index) => {
            const row = node('div', undefined, 'ttu-source-rule');
            row.append(node('code', `${rule.start} … ${rule.end}`));
            const actions = node('div', undefined, 'ttu-source-actions');
            const label = node('label');
            const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled;
            label.append(enabled, node('span', '사용'));
            enabled.addEventListener('change', () => {
                const next = normalizeSourceRules(getSettings()); next[index].enabled = enabled.checked; commit(next);
            });
            const select = choices(); select.value = rule.mode;
            select.setAttribute('aria-label', `${rule.start} 구간 처리 방식`);
            select.addEventListener('change', () => {
                const next = normalizeSourceRules(getSettings()); next[index].mode = select.value; commit(next);
            });
            const remove = node('button', '삭제', 'menu_button'); remove.type = 'button';
            remove.setAttribute('aria-label', `${rule.start} 규칙 삭제`);
            remove.addEventListener('click', () => {
                const next = normalizeSourceRules(getSettings()); next.splice(index, 1); commit(next);
            });
            actions.append(label, select, remove); row.append(actions); list.append(row);
        });
    }
    root.querySelector('[data-source-add]').addEventListener('click', () => {
        const opening = start.value.trim(), closing = end.value.trim();
        if (!validSourceDelimiters(opening, closing)) {
            status.textContent = `서로 다른 시작·종료 문자열을 1~${SOURCE_DELIMITER_LIMIT}자로 입력해 주세요. 또또 기록 태그(sfw_scene/scene_state)는 지정할 수 없어요.`; return;
        }
        const rules = normalizeSourceRules(getSettings());
        if (rules.length >= SOURCE_RULE_LIMIT) { status.textContent = `최대 ${SOURCE_RULE_LIMIT}개까지 등록할 수 있어요.`; return; }
        if (rules.some(rule => rule.start === opening && rule.end === closing)) { status.textContent = '이미 등록한 구간이에요.'; return; }
        rules.push({ start: opening, end: closing, mode: mode.value, enabled: true });
        commit(rules); start.value = ''; end.value = ''; status.textContent = '저장했어요. 다음 기록 요청부터 적용돼요.';
    });
    render();
    return { render };
}
