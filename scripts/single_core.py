"""Turn pinned implementations into feature libraries, with no independent lifecycle.

Legacy controllers are removed from production; the regression harness separately
builds the compatibility adapter to check retained feature behavior.
The installed extension delegates all collection, ownership and injection to core.js.
"""
import re


def adapt(source, kind):
    # Missing/unverified reports are not evidence of a stage-one scene. Keep
    # that uncertainty through the UI and prompt instead of feeding 1 back.
    source = source.replace("return { stage: 1, source: 'default' };",
        "return { stage: null, source: 'unknown' };")
    source = source.replace('if (!snapshot?.state) break;',
        'if (!snapshot?.state || !snapshotMatchesMessage(messages[i], snapshot)) break;')
    source = source.replace('const canAdvance = !locked && stage < 6',
        'const canAdvance = stage !== null && !locked && stage < 6')
    prompt_start = source.index('function buildSlowBurnLines(settings) {')
    source = source[:prompt_start] + source[prompt_start:].replace(
        '    const progress = slowBurnProgress(settings);',
        '''    const progress = slowBurnProgress(settings);
    if (progress.stage === null) return [
        '[SLOW-BURN — CURRENT STAGE UNCONFIRMED]',
        'No verified current stage is available. A missing or invalidated report is NOT a reset to stage 1 and supplies no numeric stage cap.',
        'Use the latest visible conversation to identify the ongoing scene. Preserve its established progress; do not restart earlier setup because the report is unavailable.',
        'Continue the present beat at a measured pace without skipping stages, replaying completed setup, jumping in time, or forcing a conclusion while stage residence is unverified.',
        `SESSION COUNT: ${progress.sessionTurns}/${progress.requiredTurns} responses since activation. Stage residence is unconfirmed.`,
        'Return the stage actually reached at the END of this response in the hidden report (integer 1-6), using the scale for this mode. Do not copy a fallback stage.',
    ];''', 1)
    prefix = 'tsf' if kind == 'sfw' else 'tns'
    stage_label = "`${sceneTypeDef(sceneType).ko} · ${progress.stage}단계 · ${stage.ko}`" if kind == 'sfw' else "`${progress.stage}단계 · ${stage.ko}`"
    source = source.replace(f"element('{prefix}-slow-burn-stage').textContent = {stage_label};",
        f"element('{prefix}-slow-burn-stage').textContent = progress.stage === null ? '단계 확인 대기' : {stage_label};")
    source = source.replace("default: '초기 단계',", "unknown: '유효한 단계 보고 대기',")
    source = source.replace('const stageText = `현재 단계', "const stageText = progress.stage === null ? '단계 확인 대기' : `현재 단계")
    source = source.replace(f"    element('{prefix}-slow-burn-prev').disabled =",
        f"    element('{prefix}-slow-burn-lock').disabled = progress.stage === null && !progress.locked;\n"
        f"    element('{prefix}-slow-burn-next').textContent = progress.stage === null ? '1단계 직접 선택' : '다음 ▶';\n"
        f"    element('{prefix}-slow-burn-prev').disabled =")
    source = source.replace('const current = slowBurnStageInfo().stage;',
        'const current = slowBurnStageInfo().stage ?? 0;')
    source = source.replace('            meta.slowBurnStageOverride = slowBurnStageInfo().stage;',
        '            const stage = slowBurnStageInfo().stage;\n            if (stage === null) return;\n            meta.slowBurnStageOverride = stage;')
    # Unified diagnostics are labelled as the installed extension, not the
    # upstream feature versions. Body writes are observed once by core.js.
    source = source.replace('extension: MODULE_NAME, version: EXTENSION_VERSION, recording:',
        f"extension: 'ttotto-unified', mode: '{kind}', version: '0.2.6', recording:")
    source = source.replace('current: diagnosticState(), events: diagnosticRows',
        'bodyWriteNote: DIAGNOSTIC_NOTE, current: diagnosticState(), events: diagnosticRows')
    source = source.replace('function clearDiagnostics() {',
        'function clearDiagnostics() {\n    unifiedHost.resetBodyDiagnostics();')
    source = source.replace('function syncDiagnosticFetch() {',
        'function syncDiagnosticFetch() {\n    unifiedHost.syncBodyDiagnostics();')
    source = source.replace("        else if (key === 'reason'", "        else if (key === 'writeTrace') values[key] = sanitizeWriteTrace(value);\n"
        "        else if (key === 'stageSource' && ['manual', 'reported', 'heat', 'intensity', 'unknown'].includes(value)) values[key] = value;\n"
        "        else if (key === 'reason'", 1)
    source = source.replace('parsed: Boolean(state),', 'parsed: Boolean(state), ...diagnosticStage(state),')
    source = source.replace('saved: Boolean(snapshot?.state),', "...diagnosticStage(snapshot?.state, 'saved'), saved: Boolean(snapshot?.state),", 1)
    source = source.replace('function diagnosticState() {',
        'function diagnosticState() {\n    const stageInfo = slowBurnStageInfo();')
    source = source.replace('return { enabled: Boolean(settings.enabled),',
        "return { ...diagnosticStage(effectiveState().state, 'current'), displayedStage: stageInfo.stage, stageSource: stageInfo.source, enabled: Boolean(settings.enabled),", 1)
    def guard(name, statement):
        nonlocal source
        pattern = rf'((?:async )?function {name}\([^\n]*\) \{{)'
        source, count = re.subn(pattern, lambda m: m[0] + '\n    if (unifiedHost) { ' + statement + ' }', source, count=1)
        assert count == 1, name

    def controller(name, statement):
        nonlocal source
        pattern = rf'((?:async )?function {name}\([^\n]*\) \{{)\n[\s\S]*?\n\}}'
        source, count = re.subn(pattern, lambda m: m[1] + '\n    ' + statement + '\n}', source, count=1)
        assert count == 1, name

    controller('getMessageStore', f"return unifiedHost.messageStore(message, '{kind}', create);")
    controller('isFullyArmed', f"return isSupervising() && unifiedHost.isMode('{kind}');")
    controller('handleIncomingMessage', 'return unifiedHost.collect(index);')
    controller('observeLatestMessage', 'return;')
    controller('registerEvents', 'return;')
    controller('prepareSceneInjection', 'return unifiedHost.prepare(generationType, consumeBridge);')
    controller('clearInjectedPrompt', 'unifiedHost.invalidatePrompt(); return;')
    controller('holdsRewriteGeneration', 'return unifiedHost.holdsRewrite();')
    controller('beginSceneGeneration', 'return;')
    controller('finishReceivedGeneration', 'return;')
    controller('finishSceneGeneration', 'return false;')
    # Initialize only controls and diagnostic helpers. Core owns subscriptions/timers.
    controller('initialize', 'getSettings(); syncDiagnosticFetch(); return initializeUi();')
    guard('scheduleAutoRefine', f"if (!unifiedHost.canRefine('{kind}')) return;")
    guard('runRefine', f"if (!unifiedHost.canRefine('{kind}', manual)) return false;")
    source = source.replace('if (store) delete message.extra[MESSAGE_EXTRA_KEY];', f"if (store) {{ if (unifiedHost) unifiedHost.clearRecords(message, '{kind}'); else delete message.extra[MESSAGE_EXTRA_KEY]; }}")
    # Saved suspension markers from older versions are not ownership authority.
    if kind == 'sfw':
        start = source.index('function buildUnifiedContinuityLines()')
        source = source[:start] + source[start:].replace(
            'const acts = recentActs(Number(settings.repeatWindow) || DEFAULT_SETTINGS.repeatWindow);',
            'const acts = settings.repeatGuard ? unifiedHost.activeActs() : [];', 1).replace(
            'const dialogue = recentDialogueBeats();', 'const dialogue = unifiedHost.activeDialogue();', 1)
        source = source.replace('suspended: Boolean(meta.nsfwSuspended), resumePending: Boolean(meta.nsfwResumePending)', "suspended: unifiedHost ? !unifiedHost.isMode('sfw') : Boolean(meta.nsfwSuspended), resumePending: unifiedHost ? false : Boolean(meta.nsfwResumePending)")
        source = source.replace('const state = snapshotMatchesMessage(message, snapshot) ? snapshot.state : null;', 'const state = unifiedHost.commonState();')
        controller('syncNsfwSuspension', "return !unifiedHost.isMode('sfw');")
        controller('localNsfwBlocksSfw', 'return false;')
        controller('nsfwExtensionOwnsScene', "return unifiedHost.isMode('nsfw');")
        controller('nsfwExtensionInstalled', 'return false;')
        source = source.replace("if (meta?.nsfwResumePending || meta?.manualState?.source === 'nsfw-handoff')", "if (!unifiedHost && (meta?.nsfwResumePending || meta?.manualState?.source === 'nsfw-handoff'))")
        source = source.replace('meta?.nsfwSuspended', "(unifiedHost ? !unifiedHost.isMode('sfw') : meta?.nsfwSuspended)")
        source = source.replace('const resuming = Boolean(meta?.nsfwResumePending);', 'const resuming = !unifiedHost && Boolean(meta?.nsfwResumePending);')
        source = source.replace('NSFW 장면을 다른 확장에 인계한 동안에는 SFW 보정을 쉬어요.', '현재 친밀 장면 모드에서는 일반 장면 보정을 쉬어요.')
    else:
        # One set of SFW-shaped character cards, with NSFW contact in the same card.
        source = source.replace('    const characters = state?.characters ?? {};',
            '    const scene = unifiedHost.commonState({ display: true });\n'
            '    const characters = { ...(scene?.characters ?? {}), ...(state?.characters ?? {}) };', 1)
        source = source.replace("        for (const [field, label] of [['clothing', '복장'], ['position', '자세·위치'], ['contact', '접촉']]) {",
            "        const details = scene?.characters?.[name] ?? {};\n"
            "        const fields = [['appearance', '외형·복장'], ['position', '자세·위치'], ['holding', '소지품'], ['condition', '신체 상태'], ['contact', '접촉']];\n"
            "        if (hasBi(info.clothing) && hasBi(details.appearance) && biText(info.clothing) !== biText(details.appearance)) fields.splice(1, 0, ['clothing', '복장 상세']);\n"
            "        for (const [field, label] of fields) {", 1)
        source = source.replace('            input.value = biText(info[field]);',
            "            input.value = biText(field === 'appearance' ? details.appearance || info.clothing : info[field] || details[field]);", 1)
        source = source.replace('                    draft.characters[name][field] = input.value;',
            "                    if (['appearance', 'position', 'holding', 'condition'].includes(field)) {\n"
            "                        draft.scene ??= structuredClone(unifiedHost.commonState() ?? {});\n"
            "                        draft.scene.characters ??= {};\n"
            "                        draft.scene.characters[name] ??= {};\n"
            "                        draft.scene.characters[name][field] = input.value;\n"
            "                    }\n"
            "                    if (['clothing', 'position', 'contact'].includes(field)) draft.characters[name][field] = input.value;\n"
            "                    if (field === 'appearance') draft.characters[name].clothing = input.value;", 1)
        # Display and inject the same merged lists, retaining removal/filtering.
        source = source.replace('if (!snapshot?.state?.acts?.length || !snapshotMatchesMessage(messages[i], snapshot)) continue;\n        const acts = snapshot.state.acts.filter',
            "if (!snapshotMatchesMessage(messages[i], snapshot)) continue;\n        const acts = unifiedList(snapshot?.state, 'acts', messages[i]).filter", 1)
        source = source.replace('if (!snapshot?.state?.dialogueBeats?.length || !snapshotMatchesMessage(message, snapshot)) continue;\n        const beats = snapshot.state.dialogueBeats.filter',
            "if (!snapshotMatchesMessage(message, snapshot)) continue;\n        const beats = unifiedList(snapshot?.state, 'dialogueBeats', message).filter", 1)
        source = source.replace('    if (!state?.next?.length) return [];',
            "    const candidates = unifiedList(state, 'next', assistantMessages().at(-1));\n    if (!candidates.length) return [];", 1)
        source = source.replace('    for (const beat of state.next) {', '    for (const beat of candidates) {', 1)
        source += '''
function unifiedList(state, field, message) {
    if (!state) return [];
    const companion = unifiedHost.commonRecord(message);
    const values = [...(state[field] ?? []), ...(state.scene?.[field] ?? companion?.[field] ?? [])];
    const unique = [];
    for (const value of values) if (!unique.some(item => actsAreSimilar(item, value))) unique.push(value);
    return unique;
}
'''
        # Preserve all scene facts in the intimate report, including repairs.
        source = source.replace('    const hasCharacters = Object.values(clean.characters)',
            "    if (unifiedHost && raw.scene) clean.scene = unifiedHost.sanitizeCommon(raw.scene);\n    const hasCharacters = Object.values(clean.characters)", 1)
        source = source.replace('    merged.dialogueReported ||= compatible.dialogueReported;',
            '    if (compatible.scene) merged.scene ??= compatible.scene;\n    merged.dialogueReported ||= compatible.dialogueReported;', 1)
        source = source.replace('    const lines = [...(slowBurnEnabled ? SLOW_BURN_STATE_REPORT_LINES : STATE_REPORT_LINES)];',
            '    const lines = [...(slowBurnEnabled ? SLOW_BURN_STATE_REPORT_LINES : STATE_REPORT_LINES), unifiedSceneReportInstruction()];', 1)
        source = source.replace("        { role: 'system', content: system },",
            "        { role: 'system', content: system + '\\n' + unifiedSceneReportInstruction() },", 1)
        source += '''
function unifiedSceneReportInstruction() {
    return 'In the same scene_state JSON object (or the repair JSON object), include a "scene" object with the full end-of-response scene record. This is required even if no sfw_scene block is requested. Schema: "scene":{"location":"English || 한국어","time":"English || 한국어","environment":"English || 한국어","important_objects":{"object name":"current location/state, English || 한국어"},"characters":{"exact name":{"appearance":"appearance and clothing, English || 한국어","position":"posture/location, English || 한국어","holding":"carried or held items, English || 한국어","condition":"physical condition, English || 한국어"}},"scene_type":"general","intensity":0,"stage":1,"acts":[],"dialogue_beats":[],"dialogue_flow":{"topic":"English || 한국어","last_question":"English || 한국어","new_facts":[]},"next":[]}. Include every present character and relevant object. Unknown facts stay empty; never invent facts. scene.intensity and scene.stage describe narrative progression, independently of the top-level sexual heat and stage. Populate scene.acts, dialogue_beats, dialogue_flow and next from the current reply. If sfw_scene is also requested, its scene facts must agree with this record.';
}
'''
        # The bridge object and both private generation interceptors are never
        # installed in single-core mode, including on a shared JS object.
        source, count = re.subn(r'sharedRuntime\.ttottoNsfwSceneBridge = Object\.freeze\(\{[\s\S]*?\n\}\);', '', source, count=1)
        assert count == 1
        # Heat policy is reusable; deciding/committing the mode belongs to core.
        guard('applyReportedHeat', 'if (!unifiedHost.classifying()) return unifiedHost.acceptHeat(state, message);')
    for name in ['ttottoSfwGenerationInterceptor', 'ttottoNsfwGenerationInterceptor']:
        source = re.sub(r'sharedRuntime\.' + name + r' = async function[^\n]*\n[\s\S]*?\n\};', '', source, count=1)
    # The generation queue is a mirror of the core's single queue for feature guards.
    # UI preview is the actual core composition; reading it never consumes a bridge.
    if kind == 'nsfw':
        source = source.replace("const prompt = armed ? [buildInjection(), unifiedHost?.companionPrompt?.()].filter(Boolean).join('\\n\\n') : '';", "const prompt = unifiedHost ? unifiedHost.preview('nsfw') : armed ? buildInjection() : '';")
    else:
        source = source.replace("const prompt = armed ? buildInjection() : '';", "const prompt = unifiedHost ? unifiedHost.preview('sfw') : armed ? buildInjection() : '';")
    return source


def feature_api(kind):
    # Policy/sanitization/rendering helpers are preserved. None subscribes to
    # host events or writes the host's prompt slot.
    common = '''
function settleReport(message, state, fresh) {
    const meta = getChatMeta(false);
    if (!meta) return;
    const latest = message === assistantMessages().at(-1);
    if (fresh && latest) {
        meta.manualState = null;
        if (!stateCompletenessIssues(state, getSettings()).length) refineFailure = null;
        saveChatMeta();
    }
    if (!latest) return;
    if (unifiedHost.isMode(KIND)) {
        const progress = slowBurnTargetProgress();
        if (progress.active && progress.completedTurns >= progress.requiredTurns) {
            meta.slowBurnTargetActive = false;
            meta.slowBurnTargetCompleted = true;
            meta.slowBurnRecoveryPending = false;
            saveChatMeta();
            toastr.success(`“${progress.target}” ${progress.requiredTurns}회 진행을 채웠어요. 다음 AI 답변부터는 전환할 수 있어요.`, '또또(N)SFW');
        }
    }
    const valid = snapshotMatchesMessage(message);
    diagnosticRecord('collection_result', { message: getContext().chat.indexOf(message), swipe: currentSwipeIndex(message), found: valid, wrote: fresh, ...diagnosticCache(message) });
    if (!valid || stateCompletenessIssues(state, getSettings()).length) scheduleAutoRefine();
}
function resetFeatureSession() {
    clearTimeout(refineTimer); refineTimer = null;
    queuedRefineTarget = null; lastAutoRefineTarget = null; refineFailure = null;
    refineAbortController?.abort();
    rewriteGeneration = null; generationEvents = []; lastCompletedAssistant = null;
    RESET_OBSERVATION
    resetDiagnosticEvidence();
    populateProfiles();
}
function leaveMode() {
    clearTimeout(refineTimer); refineTimer = null; queuedRefineTarget = null;
    refineAbortController?.abort();
    const meta = getChatMeta(false);
    if (meta) { resetSlowBurnSession(meta); saveChatMeta(); }
}
'''.replace('KIND', repr(kind)).replace('RESET_OBSERVATION', "lastObservedMessageKey = '';" if kind == 'sfw' else 'lastObservedMessage = null;')
    # SFW uses a simpler diagnostic reset helper.
    if kind == 'sfw':
        common = common.replace('resetDiagnosticEvidence();', 'diagnosticBodies.clear();')
    parse = '''parseReport: message => {
        const state = parseStateFromText(message.mes);
        if (state) {
            const panelTime = infoPanelField(message.mes, 'Date', '날짜');
            if (panelTime) state.time = toBi(panelTime);
        }
        return state;
    },''' if kind == 'sfw' else '''parseReport: message => {
        const direct = parseStateFromText(message.mes);
        const compatible = unifiedHost.isMode('nsfw') || direct?.heat >= AUTO_ARM_ON ? parseCompatibleSfwState(message.mes) : null;
        return compatible ? mergeCurrentReports(direct ?? (snapshotMatchesMessage(message) ? snapshotForMessage(message).state : null), compatible) : direct;
    },'''
    specific = '''commonPrompt: buildHandoffReport, continuityPrompt: () => buildUnifiedContinuityLines().join('\\n'), sanitizeState,''' if kind == 'sfw' else '''
    recentActs, recentDialogueBeats,
    detect: (state, message) => {
        if (!isSupervising()) return;
        maybeStealthArm();
        if (message) applyReportedHeat(state, message);
        reconcileReportedRelease();
        maybeStealthRelease();
        maybeStealthArm();
    },
    monitorPrompt: () => getSettings().armMode === 'stealth' ? '' : MONITOR_REPORT_LINES.join('\\n'),'''
    exports = '''
    isSupervising, settleReport, resetFeatureSession, leaveMode, buildInjection, currentState: effectiveState,
    syncGeneration: events => { generationEvents = [...events]; },
    startSlowBurn: () => { if (getSettings().slowBurnEnabled && isFullyArmed()) startSlowBurnSessionIfNeeded(); },
    exitPrompt: () => BRIDGE_LINES.join('\\n'),
    stripReport: stripStateTag, currentSwipeIndex, isPendingAssistant, diagnosticRecord, diagnosticTrackBody, diagnosticResponse, diagnosticCache,
    rerenderMessage, saveChatMeta, populateProfiles,
''' + parse + specific
    return common, exports
