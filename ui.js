const labels = { location: '장소', time: '시간·시간대', environment: '환경', importantObjects: '중요 사물', characters: '인물', appearance: '외형·복장', clothing: '복장', position: '자세·위치', holding: '소지품', contact: '접촉', condition: '몸 상태', acts: '최근 전개', dialogueBeats: '대사 의도', dialogueFlow: '대화 흐름', topic: '현재 주제', lastQuestion: '미응답 질문', newFacts: '새 사실', sceneType: '장면 유형', intensity: '서사 강도', heat: '성적 온도', stage: '진행 단계', next: '다음 전개 후보' };
const ownerLabels = { sfw: '일반 장면 추적 중', nsfw: '친밀 장면 추적 중', waiting: '장면 감지 대기 중', off: '사용 중지' };

export function createUi(getRuntime) {
    let overlay, overview, status, selected = 'overview', lastFocus, overviewKey = '';
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
        const icon = el('span', undefined, 'extensionsMenuExtensionButton fa-solid fa-layer-group');
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
        for (const [key, name] of [['overview', '전체 상태'], ['sfw', '일반 장면'], ['nsfw', '친밀 장면']]) {
            const button = el('button', name, 'menu_button'); button.type = 'button'; button.dataset.ttuView = key;
            button.addEventListener('click', () => { selected = key; refresh(); }); nav.append(button);
        }
        const body = el('div', undefined, 'ttu-body'); body.id = 'ttu-body';
        overview = el('section'); overview.id = 'ttu-overview'; body.append(overview);
        dialog.append(header, nav, body); overlay.append(dialog); document.body.append(overlay);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('cancel', event => { event.preventDefault(); close(); });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if (event.key === 'Tab') {
                const buttons = [...dialog.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length);
                const first = buttons[0], last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });
    }
    function renderValue(value) {
        if (value === null || value === undefined || value === '') return el('span', '미보고');
        if (typeof value !== 'object') return el('span', String(value));
        if ('en' in value || 'ko' in value) return el('span', value.ko || value.en || '미보고');
        if (Array.isArray(value)) {
            const list = el('ul');
            if (!value.length) list.append(el('li', '없음'));
            for (const item of value) { const row = el('li'); row.append(renderValue(item)); list.append(row); }
            return list;
        }
        const list = el('dl', undefined, 'ttu-values');
        for (const [key, item] of Object.entries(value)) {
            if (key === 'dialogueReported') continue;
            list.append(el('dt', labels[key] ?? key)); const detail = el('dd'); detail.append(renderValue(item)); list.append(detail);
        }
        if (!list.children.length) return el('span', '없음');
        return list;
    }
    function renderOverview() {
        const runtime = getRuntime();
        const summaries = { sfw: runtime.engines.sfw.summary(), nsfw: runtime.engines.nsfw.summary() };
        const nextKey = JSON.stringify([runtime.settings().transitionNotifications,
            ...['sfw', 'nsfw'].map(kind => [summaries[kind].valid, summaries[kind].state])]);
        if (nextKey === overviewKey) return;
        overviewKey = nextKey;
        overview.replaceChildren();
        const options = el('div', undefined, 'ttu-options');
        const label = el('label'); const checkbox = el('input'); checkbox.type = 'checkbox';
        checkbox.checked = Boolean(runtime.settings().transitionNotifications);
        checkbox.addEventListener('change', () => {
            runtime.settings().transitionNotifications = checkbox.checked;
            runtime.context('sfw').saveSettingsDebounced?.();
        });
        label.append(checkbox, document.createTextNode('자동 전환 알림 표시')); options.append(label);
        const diagnosticButton = el('button', '양쪽 진단 기록 내려받기', 'menu_button'); diagnosticButton.type = 'button';
        diagnosticButton.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(runtime.diagnostics(), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob); const anchor = el('a'); anchor.href = url; anchor.download = 'ttotto-unified-diagnostics.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }); options.append(diagnosticButton); overview.append(options);
        overview.append(el('p', '두 장면의 기록을 각각 보존해요. 세부 설정과 직접 수정은 위의 장면 탭에서 할 수 있어요.', 'ttu-muted'));
        for (const [kind, title] of [['sfw', '일반 장면 기록'], ['nsfw', '친밀 장면 기록']]) {
            const summary = summaries[kind];
            const section = el('section', undefined, 'ttu-card'); section.append(el('h3', title));
            if (!summary.state) section.append(el('p', '현재 답변에서 아직 수집된 기록이 없어요.', 'ttu-muted'));
            else {
                if (!summary.valid) section.append(el('p', '수집 뒤 본문이 변경되어 현재 기록으로 확인되지 않았어요.', 'ttu-stale'));
                section.append(renderValue(summary.state));
            }
            overview.append(section);
        }
    }
    function refresh() {
        ensureButton();
        if (!overlay || overlay.hidden) return;
        const runtime = getRuntime(); status.textContent = ownerLabels[runtime.owner()];
        for (const button of overlay.querySelectorAll('[data-ttu-view]')) button.setAttribute('aria-pressed', String(button.dataset.ttuView === selected));
        overview.hidden = selected !== 'overview';
        for (const kind of ['sfw', 'nsfw']) {
            const panel = document.getElementById(`ttotto-${kind}-settings`);
            if (!panel) continue;
            const body = document.getElementById('ttu-body');
            if (panel.parentElement !== body) body.append(panel);
            panel.classList.add(kind === 'sfw' ? 'tsf-in-popup' : 'tns-in-popup');
            panel.hidden = selected !== kind;
        }
        if (selected === 'overview') renderOverview();
    }
    function open(kind = 'overview') {
        selected = kind; build(); lastFocus = document.activeElement; overlay.hidden = false;
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
