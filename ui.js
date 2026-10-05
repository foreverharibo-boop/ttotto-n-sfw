const ownerLabels = { sfw: '일반 장면 추적 중', nsfw: '친밀 장면 추적 중', waiting: '채팅을 열면 장면을 추적해요', off: '사용 중지' };

export function createUi(getRuntime) {
    let overlay, status, notificationCheckbox, selected = 'sfw', view = 'state', lastFocus;
    let body, scenePicker, sceneHome, settingsHome, common, problems, chatNotice;
    const settingsHomes = {}, diagnosticHomes = {};
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
        const nav = el('div', undefined, 'ttu-tabs'); nav.setAttribute('role', 'group');
        nav.setAttribute('aria-label', '장면 관리 화면');
        for (const [key, name] of [['state', '장면 상태'], ['settings', '설정']]) {
            const button = el('button', name, 'menu_button'); button.type = 'button'; button.dataset.ttuPage = key;
            button.addEventListener('click', () => { view = key; refresh(); body.scrollTop = 0; }); nav.append(button);
        }
        body = el('div', undefined, 'ttu-body'); body.id = 'ttu-body';
        chatNotice = el('p', '채팅을 연 뒤 장면별 상태와 설정을 사용할 수 있어요.', 'ttu-chat-notice');
        scenePicker = el('div', undefined, 'ttu-tabs');
        scenePicker.setAttribute('role', 'group'); scenePicker.setAttribute('aria-label', '장면 선택');
        for (const [key, name] of [['sfw', '일반 장면'], ['nsfw', '친밀 장면']]) {
            const button = el('button', name, 'menu_button'); button.type = 'button'; button.dataset.ttuView = key;
            button.addEventListener('click', () => { selected = key; refresh(); }); scenePicker.append(button);
        }
        sceneHome = el('div');
        settingsHome = el('div'); settingsHome.id = 'ttu-settings';
        common = el('section', undefined, 'ttotto-sfw-settings ttu-common');
        common.append(el('h3', '공통 설정'));
        const options = buildCommonMenu();
        common.append(options);
        settingsHome.append(common);
        for (const [kind, title] of [['sfw', '일반 장면 설정'], ['nsfw', '친밀 장면 설정']]) {
            const group = el('details', undefined, 'ttu-setting-group');
            group.append(el('summary', title)); settingsHomes[kind] = el('div'); group.append(settingsHomes[kind]);
            settingsHome.append(group);
        }
        problems = el('details', undefined, 'ttu-problems'); problems.id = 'ttu-problems';
        problems.append(el('summary', '문제 해결'));
        problems.append(diagnosticDownloadButton());
        for (const [kind, title] of [['sfw', '일반 장면 진단'], ['nsfw', '친밀 장면 진단']]) {
            const group = el('details', undefined, `ttotto-${kind}-settings ttu-diagnostic-group`);
            group.append(el('summary', title)); diagnosticHomes[kind] = el('div'); group.append(diagnosticHomes[kind]); problems.append(group);
        }
        settingsHome.append(problems);
        body.append(chatNotice, scenePicker, sceneHome, settingsHome);
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
        const menu = el('div', undefined, 'ttu-common-menu');
        const options = el('div', undefined, 'ttu-options');
        const label = el('label'); const checkbox = el('input'); checkbox.type = 'checkbox';
        notificationCheckbox = checkbox;
        checkbox.addEventListener('change', () => {
            const runtime = getRuntime();
            runtime.settings().transitionNotifications = checkbox.checked;
            runtime.context('sfw').saveSettingsDebounced?.();
        });
        label.append(checkbox, document.createTextNode('자동 전환 알림 표시')); options.append(label);
        menu.append(options);
        return menu;
    }
    function diagnosticDownloadButton() {
        const diagnosticButton = el('button', '양쪽 진단 기록 내려받기', 'menu_button'); diagnosticButton.type = 'button';
        diagnosticButton.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(getRuntime().diagnostics(), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob); const anchor = el('a'); anchor.href = url; anchor.download = 'ttotto-unified-diagnostics.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        return diagnosticButton;
    }
    function show(node, visible) {
        if (!node) return;
        node.hidden = !visible;
        if (visible) node.style.removeProperty('display');
        else node.style.setProperty('display', 'none', 'important');
    }
    function refresh() {
        ensureButton();
        if (!overlay || overlay.hidden) return;
        const runtime = getRuntime(); status.textContent = ownerLabels[runtime.owner()];
        const ready = runtime.chatReady();
        show(chatNotice, !ready);
        show(scenePicker, view === 'state'); show(sceneHome, view === 'state'); show(settingsHome, view === 'settings');
        for (const button of overlay.querySelectorAll('[data-ttu-page]')) button.setAttribute('aria-pressed', String(button.dataset.ttuPage === view));
        for (const button of overlay.querySelectorAll('[data-ttu-view]')) button.setAttribute('aria-pressed', String(button.dataset.ttuView === selected));
        notificationCheckbox.checked = Boolean(runtime.settings().transitionNotifications);
        overlay.dataset.ttuPage = view;
        for (const kind of ['sfw', 'nsfw']) {
            const panel = document.getElementById(`ttotto-${kind}-settings`);
            if (!panel) continue;
            const prefix = kind === 'sfw' ? 'tsf' : 'tns';
            const home = view === 'state' ? sceneHome : settingsHomes[kind];
            if (panel.parentElement !== home) home.append(panel);
            panel.classList.add(`${prefix}-in-popup`);
            panel.inert = !ready;
            show(panel, view === 'settings' || selected === kind);
            runtime.engines[kind].setTab(view);
            const diagnostic = document.getElementById(`${prefix}-panel-diagnostics`);
            if (diagnostic && diagnostic.parentElement !== diagnosticHomes[kind]) {
                diagnosticHomes[kind].append(diagnostic);
                diagnostic.removeAttribute('role'); diagnostic.removeAttribute('aria-labelledby');
            }
            show(diagnostic, true);
            const content = document.getElementById(`${prefix}-panel-${view}`);
            content?.removeAttribute('role'); content?.removeAttribute('aria-labelledby');
        }
        for (const id of ['tsf-transition-guard', 'tsf-dialogue-flow']) {
            const field = document.getElementById(id)?.closest('label');
            if (field && field.parentElement !== common) common.append(field);
        }
    }
    function open(kind) {
        view = 'state';
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
