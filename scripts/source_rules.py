"""Independent per-mode scene sources; keep the pinned individual engines intact."""
import re


def adapt_source_api(api, kind):
    if kind == 'sfw':
        api = api.replace('if (panelTime) state.time', 'if (panelTime && (!sourceRulesEnabled() || !hasBi(state.time))) state.time')
    else:
        api = api.replace("MONITOR_REPORT_LINES.join('\\n')", "[...MONITOR_REPORT_LINES, ...sourceRuleInstructions(getSettings(), 'nsfw')].join('\\n')")
    return api


def adapt_source_rules(source, kind):
    prefix = 'tsf' if kind == 'sfw' else 'tns'
    def replace(old, new):
        nonlocal source
        assert old in source, (kind, old)
        source = source.replace(old, new, 1)

    # This is an analysis-only copy; never change chat/swipes/display signatures.
    replace('let messageText = stripStateTag(message.mes);',
            'let messageText = filterSceneSources(stripStateTag(message.mes), settings);')
    if kind == 'sfw':
        pattern = r'function infoPanelField\([^\n]*\) \{\n[\s\S]*?\n\}'
        source, count = re.subn(pattern, lambda _: '''function infoPanelField(text, englishKey, koreanKey) {
    return sourcePanelField(text, sourceReadSettings(), englishKey, koreanKey);
}''', source, count=1)
        assert count == 1
        for variable, field in [('panelTime', 'time'), ('panelWeather', 'environment'), ('panelLocation', 'location')]:
            source = source.replace(f'if ({variable}) state.{field}',
                                    f'if ({variable} && (!sourceRulesEnabled() || !hasBi(state.{field}))) state.{field}')
    else:
        replace('return scoreScene(text, getSettings().stealthKeywords);',
                'const settings = getSettings();\n    return scoreScene(filterSceneSources(text, settings, { physical: false }), settings.stealthKeywords);')
        replace("if (settings.armMode !== 'stealth') parts.push(...MONITOR_REPORT_LINES);",
                "if (settings.armMode !== 'stealth') parts.push(...MONITOR_REPORT_LINES, ...sourceRuleInstructions(settings, 'nsfw'));")

    # Settings may change during a request, including via a different device.
    replace('function captureRecordGuard(message) {', '''function captureRecordGuard(message) {
    const sourceKey = sourceRulesKey(getSettings());''')
    replace('return () => sharedUnchanged() && snapshotForMessage(message) === snapshot',
            'return () => sourceRulesKey(getSettings()) === sourceKey && sharedUnchanged() && snapshotForMessage(message) === snapshot')

    start = source.index('function getSettings() {')
    end = source.index('\n}', start)
    chunk = source[start:end]
    assert 'return settings;' in chunk
    chunk = chunk.replace('return settings;', 'if (!Array.isArray(settings.sceneSourceRules)) settings.sceneSourceRules = [];\n    return settings;')
    source = source[:start] + chunk + source[end:]

    start = source.index('function updateUi() {')
    end = source.index('\n}', start)
    chunk = source[start:end]
    assert 'const settings = getSettings();' in chunk
    chunk = chunk.replace('const settings = getSettings();', 'const settings = getSettings();\n        sourceRulesUi?.render();', 1)
    source = source[:start] + chunk + source[end:]
    replace('function bindUi() {', f'''function bindUi() {{
    sourceRulesUi = createSceneSourceUi(element('{prefix}-source-rules'), getSettings, () => {{
        clearTimeout(refineTimer); refineTimer = null;
        queuedRefineTarget = null;
        refineAbortController?.abort();
        getContext().saveSettingsDebounced?.();
        clearInjectedPrompt(); updateUi();
    }});''')
    source += '\nlet sourceRulesUi = null;\n'
    if kind == 'sfw':
        source += '''
function sourceReadSettings() {
    return unifiedHost?.collectionSettings?.() ?? getSettings();
}
function sourceRulesEnabled() {
    return normalizeSourceRules(sourceReadSettings()).some(rule => rule.enabled);
}
'''
    return source
