// Global NSFW description settings, independent of custom prompt scopes.
function renderSceneCollectionUi() {
    const settings = getSettings(), config = settings.sceneCollection ?? {};
    const master = element('tns-scene-collection-enabled');
    if (!master) return;
    master.checked = config.enabled !== false;
    for (const key of Object.keys(sceneCollectionFields())) {
        const input = element(`tns-scene-collect-${key}`);
        if (!input) continue;
        input.checked = config.fields?.[key] !== false;
        input.disabled = !master.checked;
    }
}
function bindSceneCollectionUi() {
    for (const key of ['enabled', ...Object.keys(sceneCollectionFields())]) {
        const input = element(key === 'enabled' ? 'tns-scene-collection-enabled' : `tns-scene-collect-${key}`);
        input?.addEventListener('change', () => {
            const settings = getSettings();
            const config = settings.sceneCollection ??= {};
            if (key === 'enabled') config.enabled = input.checked;
            else (config.fields ??= {})[key] = input.checked;
            getContext().saveSettingsDebounced?.();
            clearInjectedPrompt();
            updateUi();
        });
    }
}
