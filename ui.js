const ownerLabels = { sfw: '일반 장면 추적 중', nsfw: '친밀 장면 추적 중', waiting: '채팅을 열면 장면을 추적해요', off: '사용 중지' };

export function createUi(getRuntime) {
    let overlay, status, notificationCheckbox, selected = 'sfw', lastFocus;
    const arrangedPanels = new WeakSet();
    let sharedStatePanel, sharedFlowPanel, sharedStateKey;
    const el = (tag, text, cls) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (cls) node.className = cls;
        return node;
    };
    function ensureButton() {
        if (document.getElementById('ttu-wand-button')) return;
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return;
        const button = el('div', undefined, 'list-group-item flex-container flexGap5 interactable');
        button.id = 'ttu-wand-button'; button.tabIndex = 0; button.setAttribute('role', 'button');
        const icon = el('span', '🦋', 'extensionsMenuExtensionButton');
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon, el('span', '또또(N)SFW'));
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
        });
        button.addEventListener('click', () => { menu.style.display = 'none'; open(); });
        menu.append(button);
    }
    function build() {
        if (overlay) return;
        overlay = el('dialog', undefined, 'ttu-overlay'); overlay.id = 'ttu-overlay'; overlay.hidden = true;
        overlay.setAttribute('aria-labelledby', 'ttu-title');
        const dialog = el('div', undefined, 'ttu-dialog');
        const header = el('div', undefined, 'ttu-header');
        const titles = el('div'); const title = el('strong', '또또(N)SFW'); title.id = 'ttu-title';
        status = el('small', '장면 관리', 'ttu-status'); titles.append(title, status);
        const closeButton = el('button', '✕', 'menu_button'); closeButton.type = 'button';
        closeButton.setAttribute('aria-label', '닫기'); closeButton.addEventListener('click', close);
        header.append(titles, closeButton);
        const nav = el('div', undefined, 'ttu-tabs'); nav.setAttribute('role', 'group'); nav.setAttribute('aria-label', '장면 관리 화면');
        for (const [key, name] of [['sfw', '일반 장면'], ['nsfw', '친밀 장면']]) {
            const button = el('button', name, 'menu_button'); button.type = 'button'; button.dataset.ttuView = key;
            button.addEventListener('click', () => { selected = key; refresh(); }); nav.append(button);
        }
        const body = el('div', undefined, 'ttu-body'); body.id = 'ttu-body';
        body.append(buildCommonMenu());
        dialog.append(header, nav, body); overlay.append(dialog); document.body.append(overlay);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('cancel', event => { event.preventDefault(); close(); });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if (event.key === 'Tab') {
                const buttons = [...dialog.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(n => !n.disabled && !n.closest('[inert]') && n.getClientRects().length);
                const first = buttons[0], last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });
    }
    function buildCommonMenu() {
        const menu = el('details', undefined, 'ttu-common-menu');
        menu.append(el('summary', '공통 메뉴'));
        const options = el('div', undefined, 'ttu-options');
        const label = el('label'); const checkbox = el('input'); checkbox.type = 'checkbox';
        notificationCheckbox = checkbox;
        checkbox.addEventListener('change', () => {
            const runtime = getRuntime();
            runtime.settings().transitionNotifications = checkbox.checked;
            runtime.context('sfw').saveSettingsDebounced?.();
        });
        label.append(checkbox, document.createTextNode('자동 전환 알림 표시')); options.append(label);
        const diagnosticButton = el('button', '양쪽 진단 기록 내려받기', 'menu_button'); diagnosticButton.type = 'button';
        diagnosticButton.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(getRuntime().diagnostics(), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob); const anchor = el('a'); anchor.href = url; anchor.download = 'ttotto-unified-diagnostics.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }); options.append(diagnosticButton); menu.append(options);
        return menu;
    }
    const fieldLabels = {
        location: '장소', time: '시간·시간대', environment: '환경 상태',
        importantObjects: '중요 사물 상태', characters: '인물 상태',
        appearance: '외형·복장', position: '자세·위치', holding: '소지품', condition: '신체 상태',
        acts: '최근 전개', dialogueBeats: '최근 대화', dialogueFlow: '대화 흐름',
        topic: '현재 주제', lastQuestion: '마지막 질문', newFacts: '새로 밝혀진 사실',
        sceneType: '장면 유형', intensity: '장면 강도', stage: '장면 진행 단계', next: '다음 전개 후보',
    };
    function displayValue(value) {
        if (value && typeof value === 'object') return value.ko || value.en || '';
        return value === null || value === undefined ? '' : String(value);
    }
    function stateInput(label, value, row = false) {
        const wrap = el('label', undefined, row ? 'tns-char-field' : 'tns-field');
        const input = el('input', undefined, 'text_pole');
        input.type = 'text'; input.readOnly = true; input.value = displayValue(value);
        input.placeholder = '기록 없음';
        wrap.append(el('span', label), input);
        return wrap;
    }
    function stateValue(value, translateKeys = true) {
        if (Array.isArray(value)) {
            const list = el('div', undefined, 'tns-acts-list');
            for (const item of value) list.append(el('span', displayValue(item), 'ttu-record-chip'));
            if (!value.length) list.append(el('small', '기록 없음'));
            return list;
        }
        if (value && typeof value === 'object' && !('ko' in value || 'en' in value)) {
            const list = el('div', undefined, 'tns-char-list');
            for (const [key, item] of Object.entries(value)) {
                const label = translateKeys ? fieldLabels[key] || key : key;
                if (item && typeof item === 'object' && !Array.isArray(item) && !('ko' in item || 'en' in item)) {
                    const card = el('div', undefined, 'tns-char-row'); card.append(el('strong', label), stateValue(item)); list.append(card);
                } else if (Array.isArray(item)) {
                    const group = el('div'); group.append(el('span', label), stateValue(item)); list.append(group);
                } else list.append(stateInput(label, item, true));
            }
            if (!list.childElementCount) list.append(el('small', '기록 없음'));
            return list;
        }
        return stateInput('수집값', value);
    }
    function refreshSharedState(runtime) {
        const anchor = document.getElementById('tns-state-location')?.closest('label');
        if (!anchor) return;
        if (!sharedStatePanel?.isConnected) {
            sharedStatePanel = el('section', undefined, 'ttu-shared-state');
            sharedStatePanel.id = 'ttu-intimate-shared-state';
            sharedStatePanel.setAttribute('aria-label', '장면·인물·대화 기록');
            anchor.after(sharedStatePanel);
            sharedFlowPanel = el('section', undefined, 'ttu-shared-state');
            sharedFlowPanel.id = 'ttu-intimate-dialogue-flow';
            document.getElementById('tns-next-section').before(sharedFlowPanel);
            sharedStateKey = undefined;
        }
        const ready = runtime.chatReady();
        const active = ready && runtime.owner() === 'nsfw';
        sharedStatePanel.hidden = !active;
        sharedFlowPanel.hidden = !active;
        if (!active) { sharedStatePanel.replaceChildren(); sharedFlowPanel.replaceChildren(); sharedStateKey = undefined; return; }
        const snapshot = ready ? runtime.core.commonSummary({ display: true }) : null;
        const state = { location: '', sceneType: '', time: '', environment: '', importantObjects: {}, characters: {},
            intensity: null, stage: null, acts: [], dialogueBeats: [], dialogueFlow: { topic: '', lastQuestion: '', newFacts: [] }, next: [],
            ...(snapshot?.state ?? {}) };
        const key = JSON.stringify([ready, snapshot?.valid, Boolean(snapshot?.state), state]);
        if (key === sharedStateKey) return;
        sharedStateKey = key;
        sharedStatePanel.replaceChildren();
        if (!snapshot?.valid) {
            sharedStatePanel.append(el('p', snapshot?.state
                ? '저장 후 본문이 변경됐어요. 아래는 이 답변에 저장된 기록이며, 검증 전에는 다음 답변에 주입하지 않아요.'
                : '아직 수집된 장면 정보가 없어요. 다음 응답에서 수집하거나 상태 다시 분석을 사용할 수 있어요.', 'ttu-state-note'));
        }
        // Enrich the existing NSFW form instead of stacking a second full record.
        // Location, character cards, recent events and candidates stay in their
        // native editable/removable controls, each rendered exactly once.
        sharedFlowPanel.replaceChildren();
        const metrics = el('small', [state.intensity != null ? `서사 강도 ${state.intensity}/10` : '',
            state.stage != null ? `서사 진행 ${state.stage}/6단계` : ''].filter(Boolean).join(' · '), 'ttu-state-note');
        sharedStatePanel.append(metrics);
        const orderedFields = ['sceneType', 'time', 'environment', 'importantObjects', 'dialogueFlow'];
        for (const field of orderedFields) {
            if (!(field in state)) continue;
            const value = state[field];
            if (field === 'dialogueReported') continue; // Parser bookkeeping, not a collected field.
            const group = el('div', undefined, 'ttu-state-group'); group.dataset.stateField = field;
            if (field === 'sceneType') {
                // Use the engine's own translated labels to keep scene types in sync.
                const label = [...document.querySelectorAll('#tsf-state-scene-type option')].find(option => option.value === value)?.textContent;
                group.append(stateInput(fieldLabels[field], label || value));
            } else if (value === null || typeof value !== 'object' || 'ko' in value || 'en' in value) {
                group.append(stateInput(fieldLabels[field] || field, value));
            } else {
                if (field !== 'characters') group.append(el('strong', fieldLabels[field] || field));
                if (field === 'importantObjects') group.append(el('small', '현재 장면에서 위치나 상태가 중요한 물건만 추적해요.'));
                group.append(stateValue(value, !['characters', 'importantObjects'].includes(field)));
            }
            (field === 'dialogueFlow' ? sharedFlowPanel : sharedStatePanel).append(group);
        }
    }
    function refreshSceneVisibility(runtime) {
        const owner = runtime.owner();
        for (const [kind, prefix] of [['sfw', 'tsf'], ['nsfw', 'tns']]) {
            const root = document.getElementById(`ttotto-${kind}-settings`);
            if (!root) continue;
            const active = runtime.chatReady() && owner === kind;
            root.classList.toggle('ttu-scene-idle', !active);
            let note = document.getElementById(`ttu-${kind}-idle-note`);
            if (!note) {
                note = el('p', undefined, 'ttu-state-note ttu-idle-note'); note.id = `ttu-${kind}-idle-note`;
                document.querySelector(`#${prefix}-panel-state > .${prefix}-section-head`)?.after(note);
            }
            note.textContent = !runtime.chatReady() ? '채팅을 열면 장면을 추적해요.'
                : owner === 'nsfw' ? '친밀 장면에서 수집·관리 중이에요. 일반 장면은 쉬고 있어요.'
                : owner === 'sfw' ? '일반 장면에서 수집·관리 중이에요. 친밀 장면은 감지 대기 중이에요.'
                : '현재 개입 대기 중이에요. 개입을 시작하면 수집한 정보를 표시해요.';
            note.hidden = active;
        }
    }
    function refresh() {
        ensureButton();
        if (!overlay || overlay.hidden) return;
        const runtime = getRuntime(); status.textContent = ownerLabels[runtime.owner()];
        for (const button of overlay.querySelectorAll('[data-ttu-view]')) button.setAttribute('aria-pressed', String(button.dataset.ttuView === selected));
        notificationCheckbox.checked = Boolean(runtime.settings().transitionNotifications);
        for (const kind of ['sfw', 'nsfw']) {
            const panel = document.getElementById(`ttotto-${kind}-settings`);
            if (!panel) continue;
            const body = document.getElementById('ttu-body');
            if (panel.parentElement !== body) body.append(panel);
            panel.classList.add(kind === 'sfw' ? 'tsf-in-popup' : 'tns-in-popup');
            panel.hidden = selected !== kind;
            panel.inert = !runtime.chatReady();
            const prefix = kind === 'sfw' ? 'tsf' : 'tns';
            const diagnostic = document.getElementById(`${prefix}-panel-diagnostics`);
            const settingsPanel = document.getElementById(`${prefix}-panel-settings`);
            if (!arrangedPanels.has(panel) && diagnostic && settingsPanel) {
                diagnostic.append(el('p', '진단 기록을 켜고 새 답변을 받으면 본문 변경량·문자 종류와 추적 가능한 쓰기 호출의 스크립트 위치를 남겨요. 슬로우번 단계도 보고값·저장값·현재 유효값·표시값을 구분해요. 대화 원문은 내보내지 않으며, 추적 전 변경이나 객체 교체의 원인은 미확인으로 남겨요.', 'ttu-state-note'));
                const problems = el('details', undefined, 'ttu-problems');
                problems.append(el('summary', '문제 해결'), diagnostic);
                settingsPanel.append(problems);
                diagnostic.removeAttribute('role'); diagnostic.removeAttribute('aria-labelledby');
                const oldTab = document.getElementById(`${prefix}-tab-diagnostics`);
                if (oldTab) oldTab.hidden = true;
                // Native engine tab clicks hide diagnostics; keep its content available
                // inside the folded settings section without changing the chosen tab.
                panel.addEventListener('click', event => {
                    if (event.target.closest(`[data-${prefix}-tab]`)) refresh();
                });
                arrangedPanels.add(panel);
            }
            if (diagnostic) {
                diagnostic.hidden = false;
                diagnostic.style.removeProperty('display');
            }
        }
        refreshSceneVisibility(runtime);
        refreshSharedState(runtime);
    }
    function open(kind) {
        const owner = getRuntime().owner();
        selected = ['sfw', 'nsfw'].includes(kind) ? kind : owner === 'nsfw' ? 'nsfw' : 'sfw'; build(); lastFocus = document.activeElement; overlay.hidden = false;
        syncViewport();
        if (!overlay.open) overlay.showModal();
        window.visualViewport?.addEventListener('resize', syncViewport);
        window.visualViewport?.addEventListener('scroll', syncViewport);
        window.addEventListener('resize', syncViewport);
        refresh(); overlay.querySelector('button')?.focus({ preventScroll: true });
    }
    function syncViewport() {
        const viewport = window.visualViewport;
        for (const [name, value] of Object.entries({ top: viewport?.offsetTop ?? 0, left: viewport?.offsetLeft ?? 0,
            width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight })) {
            overlay.style.setProperty(`--ttu-viewport-${name}`, `${value}px`);
        }
    }
    function close() {
        window.visualViewport?.removeEventListener('resize', syncViewport);
        window.visualViewport?.removeEventListener('scroll', syncViewport);
        window.removeEventListener('resize', syncViewport);
        if (overlay) { if (overlay.open) overlay.close(); overlay.hidden = true; }
        for (const kind of ['sfw', 'nsfw']) {
            const panel = document.getElementById(`ttotto-${kind}-settings`);
            if (panel) panel.hidden = true;
        }
        if (lastFocus?.getClientRects().length) lastFocus.focus({ preventScroll: true });
    }
    function dispose() { close(); document.getElementById('ttu-wand-button')?.remove(); }
    return { ensureButton, refresh, open, close, dispose };
}
