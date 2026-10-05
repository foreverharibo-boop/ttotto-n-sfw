"""Turn pinned implementations into feature libraries, with no independent lifecycle.

Legacy controllers are removed from production; the regression harness separately
builds the compatibility adapter to check retained feature behavior.
The installed extension delegates all collection, ownership and injection to core.js.
"""
import re


def adapt(source, kind):
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
