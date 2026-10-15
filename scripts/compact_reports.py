"""Unified-only compact Korean wire format; keep legacy parsers and stores."""
import re


def adapt_compact(source, kind):
    def function(name, body):
        nonlocal source
        body = '\n'.join(line.rstrip() for line in body.split('\n'))
        pattern = rf'function {name}\([^\n]*\) \{{\n[\s\S]*?\n\}}'
        source, count = re.subn(pattern, lambda _: body, source, count=1)
        assert count == 1, (kind, name)

    source = source.replace('function sanitizeState(raw) {',
        f"function sanitizeState(raw) {{\n    raw = expandCompactReport(raw, '{kind}');", 1)
    # A single tag can feed both feature views. Legacy tags still use old parsing.
    marker = '    const source = String(text ?? \u0027\u0027);'
    start = source.index('function parseStateFromText(')
    offset = source.index(marker, start)
    source = source[:offset] + f"    const compact = readCompactReport(text, parseStateJson);\n    if (compact) return sanitizeState(compact);\n" + source[offset:]

    function('stateReportLines', """function stateReportLines(SETTINGS, nextGuidance = '') {
    return compactReportLines('KIND', unifiedHost.reportOptions(), {
        heatRules: unifiedHost.heatRules(), STAGE_RULES nextGuidance,
    });
}""".replace('SETTINGS', 'settings' if kind == 'sfw' else 'slowBurnEnabled, dialogueGuard').replace('KIND', kind)
        .replace('STAGE_RULES', 'stageRules: SLOW_BURN_STAGE_REPORT_RULES,' if kind == 'nsfw' else ''))
    function('refinePromptMessages', """function refinePromptMessages() {
    const settings = getSettings();
    const preferenceText = settings.cardLinkEnabled && settings.nextBeatHints ? cardLinkPreferenceText() : '';
    const options = unifiedHost.reportOptions();
    MONITOR_ONLY
    return [
        { role: 'system', content: compactReportLines('KIND', options, {
            repair: true, heatRules: unifiedHost.heatRules(), STAGE_RULES
            nextGuidance: preferenceText ? 'Use CHARACTER PREFERENCES as optional inspiration for next, never as a checklist.' : '',
        }).join('\\n') },
        { role: 'user', content: `${preferenceText ? `CHARACTER PREFERENCES:\\n${preferenceText}\\n\\n` : ''}Log excerpt (oldest first):\\n\\n${buildRefineInput()}` },
    ];
}""".replace('KIND', kind).replace('STAGE_RULES', 'stageRules: SLOW_BURN_STAGE_REPORT_RULES,' if kind == 'nsfw' else '')
        .replace('MONITOR_ONLY', "if (!isFullyArmed()) options.nsfw = { ...options.nsfw, slowBurnEnabled: false };" if kind == 'nsfw' else ''))
    source = source.replace('function captureRecordGuard(message) {',
        'function captureRecordGuard(message) {\n    const sharedUnchanged = unifiedHost.repairRecordGuard(message);', 1)
    source = source.replace('    return () => snapshotForMessage(message) === snapshot',
        '    return () => sharedUnchanged() && snapshotForMessage(message) === snapshot', 1)
    source += '\nconst compactRepairRecords = new WeakMap();\n'
    if kind == 'sfw':
        source = source.replace('    const state = sanitizeState(raw);',
            "    const state = sanitizeState(raw);\n    if (state && raw?._v === 2) compactRepairRecords.set(state, raw);", 1)
    else:
        source = source.replace('    const state = sanitizeState(JSON.parse(clean.slice(start, end + 1)));',
            "    const raw = parseStateJson(clean.slice(start, end + 1));\n    const state = sanitizeState(raw);\n    if (state && raw?._v === 2) compactRepairRecords.set(state, raw);", 1)
    marker = "        meta.manualState = { state, at: refinedAt, source: 'ai-refine', target: currentStateTarget() };"
    assert source.count(marker) == 1
    target = 'target.message' if kind == 'sfw' else 'target'
    source = source.replace(marker, marker + f"\n        unifiedHost.syncCompactRepair('{kind}', compactRepairRecords.get(state), {target});", 1)
    if kind == 'sfw':
        function('buildHandoffReport', """function buildHandoffReport() {
    return buildUnifiedContinuityLines().join('\\n');
}""")
        # Histories and suggestions are already merged and filtered by the active
        # intimate mode. Do not send a second copy under SFW headings.
        start = source.index('function buildUnifiedContinuityLines()')
        cut_start = source.index('        const acts = ', start)
        cut_end = source.index('\n    }\n    if (settings.transitionGuard)', cut_start)
        source = source[:cut_start] + source[cut_end:]
    else:
        # Common state carries location/appearance/pose once. Keep native contact.
        function('buildStateLines', """function buildStateLines(state) {
    const common = unifiedHost.commonState();
    const lines = [];
    if (!common && hasBi(state.location)) lines.push(`- Location: ${biText(state.location, 'en')}`);
    for (const [name, info] of Object.entries(state.characters)) {
        const shared = common?.characters?.[name];
        const parts = [];
        if (!hasBi(shared?.appearance) && hasBi(info.clothing)) parts.push(`clothing: ${biText(info.clothing, 'en')}`);
        if (!hasBi(shared?.position) && hasBi(info.position)) parts.push(`position/posture: ${biText(info.position, 'en')}`);
        if (hasBi(info.contact)) parts.push(`physical contact: ${biText(info.contact, 'en')}`);
        if (parts.length) lines.push(`- ${name} — ${parts.join('; ')}`);
    }
    return lines;
}""")
        # A compact record already has heat/stage separated from narrative scene.
        source = source.replace('function parseCompatibleSfwState(text) {',
            "function parseCompatibleSfwState(text) {\n    const compact = readCompactReport(text, parseStateJson);\n    if (compact) return sanitizeState(compact);", 1)
        function('unifiedSceneReportInstruction', """function unifiedSceneReportInstruction() {
    return 'Use the single compact scene record; never duplicate common facts.';
}""")
    return source
