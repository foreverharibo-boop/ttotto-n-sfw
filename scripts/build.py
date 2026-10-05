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
        ...buildUnifiedContinuityLines(),
        '[Unified scene bookkeeping]',
        'Bookkeeping only: do not end, slow, redirect or change the story for this report.',
        'Keep the separately requested scene_state report. Output each tag type exactly once.',
        ...stateReportLines(getSettings()).map(line => line.replace('exactly one state block', 'one sfw_scene block in addition to the scene_state block')),
        'The stage in sfw_scene describes narrative progression; it is independent of the sexual stage in scene_state.',
    ].join('\\n');''')
        # Share collected facts and filtered history/hints without importing
        # the SFW pacing controller, targets, or stage caps.
        transition_rule = re.search(r"'SCENE TRANSITION GUARD: [^\n]+'", original).group(0)
        dialogue_rule = re.search(r"'DIALOGUE CONTINUITY: [^\n]+'", original).group(0)
        source += '''
function buildUnifiedContinuityLines() {
    const settings = getSettings();
    const message = assistantMessages().at(-1);
    const snapshot = snapshotForMessage(message);
    const state = snapshotMatchesMessage(message, snapshot) ? snapshot.state : null;
    const lines = ['[Shared scene continuity]'];
    if (state) {
        lines.push('CURRENT SHARED SCENE STATE (recorded facts):', ...buildStateLines(state));
        if (state.intensity !== null && state.intensity !== undefined) lines.push(`- Narrative intensity: ${state.intensity}/10 (not sexual heat)`);
        if (state.stage !== null && state.stage !== undefined) lines.push(`- Narrative stage: ${state.stage}/6 (descriptive only, not a sexual stage or pacing limit)`);
        lines.push('Preserve important objects, appearance, physical condition, held items, posture, location, time and environment until explicit on-page actions or USER instructions change them.');
        const acts = recentActs(Number(settings.repeatWindow) || DEFAULT_SETTINGS.repeatWindow);
        if (acts.length) lines.push('SHARED RECENT EVENTS — avoid repeating these exact beats; do not avoid the active target scene:', ...acts.map(row => `- ${row.acts.map(act => biText(act, 'en')).join('; ')}`));
        if (settings.dialogueBeatGuard) {
            const dialogue = recentDialogueBeats();
            if (dialogue.length) lines.push('SHARED RECENT DIALOGUE INTENTS — advance the conversation; direct answers and necessary clarifications are allowed:', ...dialogue.map(row => `- ${row.beats.map(beat => biText(beat, 'en')).join('; ')}`));
        }
        if (settings.nextBeatHints && unifiedHost.allowSharedHints()) {
            const beats = unifiedHost.filterSharedHints(nextBeatCandidates({ sharedState: state }));
            if (beats.length) lines.push(`SHARED NEXT POSSIBILITIES (optional, not facts; follow the active intimate pacing and USER intent): ${beats.map(beat => biText(beat, 'en')).join(' / ')}`);
        }
    }
    if (settings.transitionGuard) lines.push(TRANSITION_RULE);
    if (settings.dialogueFlow) lines.push(DIALOGUE_RULE);
    if (!state && !settings.transitionGuard && !settings.dialogueFlow) return [];
    lines.push('Apply continuity to the current intimate scene. These rules impose no SFW pace, stage cap, or requirement to end or cool the scene. Explicit USER changes supersede the recorded context; never force an already answered question or resolved topic back into the scene.');
    return lines;
}
'''.replace('TRANSITION_RULE', transition_rule).replace('DIALOGUE_RULE', dialogue_rule)
        source = source.replace('const { state } = nextBeatReport(options);', 'const { state } = options.sharedState ? { state: options.sharedState } : nextBeatReport(options);')
    else:
        source = source.replace("const prompt = armed ? buildInjection() : '';", "const prompt = armed ? [buildInjection(), unifiedHost?.companionPrompt?.()].filter(Boolean).join('\\n\\n') : '';")
        source = source.replace('displayGuardActive = Boolean(runtimeActive && getSettings().enabled);',
                                'displayGuardActive = Boolean(runtimeActive && (unifiedHost ? unifiedHost.anyEnabled() : getSettings().enabled));')
        source = source.replace("'c3d51f0b-6ad4-4aaa-8801-6ba5efec9a13'", "(unifiedHost ? 'ttotto-unified-hidden-reports' : 'c3d51f0b-6ad4-4aaa-8801-6ba5efec9a13')")
    # The UI may initialize on the home screen; scene work requires an open chat.
    for name in ('getChatMeta', 'isSupervising', 'observeLatestMessage', 'handleIncomingMessage',
                 'reconcileReportedRelease', 'maybeStealthRelease', 'syncNsfwSuspension', 'runRefine'):
        pattern = rf'((?:async )?function {name}\([^\n]*\) \{{)'
        source = re.sub(pattern, lambda m: m.group(0) + '\n    if (unifiedHost && !unifiedHost.chatReady()) return ' + ('false' if name == 'isSupervising' else 'null') + ';', source, count=1)
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
        api = api.replace('return { activateRuntime:', 'return { handoffReport: buildHandoffReport, activateRuntime:')
        api = api.replace('// PASSIVE_REPORT_NORMALIZATION', "const panelTime = infoPanelField(message.mes, 'Date', '날짜');\n    if (panelTime) state.time = toBi(panelTime);")
    else:
        api = api.replace('return { activateRuntime:', """return {
    allowSharedHints: () => getSettings().nextBeatHints && !slowBurnTargetProgress().active,
    filterSharedHints: beats => {
        const ignored = ignoredActSet();
        const bans = [...(getChatMeta(false)?.customBans ?? []), ...(getSettings().globalBans ?? [])].map(String).filter(Boolean);
        const recent = recentActs(Number(getSettings().repeatWindow) || DEFAULT_SETTINGS.repeatWindow).flatMap(row => row.acts);
        return beats.filter(beat => !isActIgnored(beat, ignored) && !bans.some(ban => actMatchesPlainBan(beat, ban)) && !recent.some(act => actsAreSimilar(beat, act)));
    }, activateRuntime:""")
    header = "// Generated by scripts/build.py; edit adapters or pinned vendor sources.\nexport function createEngine(unifiedHost) {\nconst sharedRuntime = unifiedHost?.shared ?? globalThis;\nconst toastr = unifiedHost?.toasts ?? globalThis.toastr;\n// BEGIN ENGINE\n"
    footer = '\n// END ENGINE\n' + api + '\n}\n'
    dest = ROOT / 'engines' / kind
    (dest / 'index.js').write_text(header + source + footer)
    for filename in ('settings.html', 'style.css', 'scene-detector.js'):
        data = (ROOT / 'vendor' / kind / filename).read_text()
        if filename == 'style.css':
            # Keep original layout/semantics, tint all engine chips and cards
            # using the user's live Silly theme instead of fixed accent colors.
            for color in ('crimson', 'royalblue', '#f4a261', 'red'):
                data = data.replace(f'in srgb, {color} ', 'in srgb, var(--SmartThemeQuoteColor, currentColor) ')
        (dest / filename).write_text(data)
