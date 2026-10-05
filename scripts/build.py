"""Auditable adapters over complete, pinned upstream engines; no feature pruning."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def replace_function(source, name, body):
    # Functions in the pinned sources have a closing brace in column zero.
    pattern = rf'(?:async )?function {name}\([^\n]*\) \{{\n[\s\S]*?\n\}}'
    source, count = re.subn(pattern, lambda _: body, source, count=1)
    assert count == 1, name
    return source

for kind in ('nsfw', 'sfw'):
    original = (ROOT / 'vendor' / kind / 'index.js').read_text()
    source = original[:original.index('const bootContext = getContext();')]
    source = source.replace('export function ', 'function ')
    source = source.replace('return SillyTavern.getContext();',
                            f"return unifiedHost ? unifiedHost.context('{kind}') : SillyTavern.getContext();")
    for symbol in ('ttottoNsfwSceneBridge', 'ttottoNsfwGenerationInterceptor', 'ttottoSfwGenerationInterceptor'):
        source = source.replace('globalThis.' + symbol, 'sharedRuntime.' + symbol)
    legacy_key = 'ttottoSfw' if kind == 'sfw' else 'ttottoNsfw'
    source = source.replace(f"const MESSAGE_EXTRA_KEY = '{legacy_key}';",
                            f"const MESSAGE_EXTRA_KEY = unifiedHost ? 'ttottoUnified{kind.title()}' : '{legacy_key}';")
    source = source.replace('function getMessageStore(message, create = true) {',
        f"function getMessageStore(message, create = true) {{\n    unifiedHost?.migrateMessage(message, '{kind}');")
    # Capture BOTH complete reports before either engine removes its own tag.
    source = source.replace('    diagnosticResponse(message,', '    unifiedHost?.capture(message);\n    diagnosticResponse(message,')
    # Engine observers are driven in deterministic NSFW -> SFW order by one host timer.
    source = source.replace('function startMessageObserver() {',
                            'function startMessageObserver() {\n    if (unifiedHost) return;')
    source = source.replace('function schedulePostGenerationHarvest(index) {',
                            'function schedulePostGenerationHarvest(index) {\n    if (unifiedHost) { handleIncomingMessage(index); return; }')
    source = source.replace('function addWandButton() {',
                            'function addWandButton() {\n    if (unifiedHost) { unifiedHost.uiChanged(); return; }')
    source = source.replace('function openPopup() {',
                            f"function openPopup() {{\n    if (unifiedHost) {{ unifiedHost.open('{kind}'); return; }}")
    source = source.replace('function closePopup() {',
                            'function closePopup() {\n    if (unifiedHost) return;')
    # Only one display scrubber/regex rule for both tag types, even if one mode is off.
    if kind == 'sfw':
        source = source.replace('function clearLegacyDiagnostics() {', 'function clearLegacyDiagnostics() {\n    if (unifiedHost) return;')
        for name in ('syncStateTagDisplayGuard', 'stopStateTagDisplayGuard'):
            source = source.replace(f'function {name}() {{', f'function {name}() {{\n    if (unifiedHost) return;')
        source = source.replace('function buildHandoffReport() {', '''function buildHandoffReport() {
    if (unifiedHost) return [
        '[Unified scene bookkeeping]',
        'Bookkeeping only: do not end, slow, redirect or change the story for this report.',
        'Keep the separately requested scene_state report. Output each tag type exactly once.',
        ...stateReportLines(getSettings()).map(line => line.replace('exactly one state block', 'one sfw_scene block in addition to the scene_state block')),
        'The stage in sfw_scene describes narrative progression; it is independent of the sexual stage in scene_state.',
    ].join('\\n');''')
    else:
        source = source.replace('displayGuardActive = Boolean(runtimeActive && getSettings().enabled);',
                                'displayGuardActive = Boolean(runtimeActive && (unifiedHost ? unifiedHost.anyEnabled() : getSettings().enabled));')
        source = source.replace("'c3d51f0b-6ad4-4aaa-8801-6ba5efec9a13'", "(unifiedHost ? 'ttotto-unified-hidden-reports' : 'c3d51f0b-6ad4-4aaa-8801-6ba5efec9a13')")
    source = source.replace('function updateUi() {', 'function updateUi() {\n    unifiedHost?.uiChanged();')
    api = '''
function capturePassive(message) {
    if (!runtimeActive || !isSupervising() || !message || message.is_user || message.is_system
        || isPendingAssistant(message) || holdsRewriteGeneration()
        || generationEvents.some(type => ALLOWED_GENERATION_TYPES.has(type))) return false;
    const state = parseStateFromText(message.mes);
    if (!state) return false;
    // PASSIVE_REPORT_NORMALIZATION
    const previous = snapshotForMessage(message);
    if (snapshotMatchesMessage(message, previous) && JSON.stringify(previous.state) === JSON.stringify(state)) return false;
    const messageSignature = messageStateSignature(message);
    getMessageStore(message).swipes[String(currentSwipeIndex(message))] = {
        state, at: Date.now(), messageSignature, signatureVersion: 2,
    };
    return true;
}
function summary() {
    const message = assistantMessages().at(-1);
    const snapshot = snapshotForMessage(message);
    return { valid: snapshotMatchesMessage(message, snapshot), state: snapshot?.state ?? null,
        armed: isFullyArmed(), supervising: isSupervising(), diagnostics: diagnosticState() };
}
return { activateRuntime: () => { runtimeActive = true; }, onActivate, onEnable, onDisable, onClean, initialize, initializeUi, registerEvents,
    observeLatestMessage, handleIncomingMessage, prepareSceneInjection, getSettings, getChatMeta,
    capturePassive, summary, diagnosticReport, clearDiagnostics, updateUi, setTab,
    syncStateTagDisplayGuard, stopStateTagDisplayGuard, runRefine, persistChat,
    parseStateFromText, snapshotMatchesMessage, snapshotForMessage, messageStateSignature,
    finishReceivedGeneration, beginSceneGeneration, finishSceneGeneration, syncDiagnosticFetch };
'''
    if kind == 'sfw':
        api = api.replace('// PASSIVE_REPORT_NORMALIZATION', "const panelTime = infoPanelField(message.mes, 'Date', '날짜');\n    if (panelTime) state.time = toBi(panelTime);")
    header = "// Generated by scripts/build.py; edit adapters or pinned vendor sources.\nexport function createEngine(unifiedHost) {\nconst sharedRuntime = unifiedHost?.shared ?? globalThis;\nconst toastr = unifiedHost?.toasts ?? globalThis.toastr;\n// BEGIN ENGINE\n"
    footer = '\n// END ENGINE\n' + api + '\n}\n'
    dest = ROOT / 'engines' / kind
    (dest / 'index.js').write_text(header + source + footer)
    for filename in ('settings.html', 'style.css', 'scene-detector.js'):
        (dest / filename).write_bytes((ROOT / 'vendor' / kind / filename).read_bytes())
