"""Unified-only reporting policy and local diagnostics; no new requests."""
import re


def adapt_stage_policy(source):
    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, old[:90]
        source = source.replace(old, new, 1)

    replace("{ en: 'Peak or conclusion permitted', ko: '마무리 허용' }",
            "{ en: 'Final phase actually reached', ko: '마지막 국면' }")
    # One compact definition used by the main report and existing repair call.
    policy = '''const SLOW_BURN_STAGE_REPORT_RULES = [
    'Sexual stage scale: 1 tension/atmosphere; 2 gaze/words/proximity; 3 initial light contact; 4 deepening contact/reactions; 5 main activity starting or continuing; 6 final phase actually reached. Judge the actual END of the latest response, independently of heat and nested narrative scene.stage.',
    'Stage 6 requires clear on-page evidence that the current scene has reached its final phase. Strong wording, intense reactions, high heat, elapsed turns, predictions, wishes, or permission to finish are not such evidence. Main activity that has just begun or is continuing without final-phase evidence remains stage 5; do not force an ending to justify a stored 6.',
    'Report observed progress, not the allowed maximum or a copied previous number. Permission to advance or conclude is a separate pacing rule, not evidence that advancement or conclusion occurred. Reassess against the latest prose. For stage assessment, populate the existing stage field only; do not add a rationale field. Keep all other required scene fields.',
];

'''
    replace('const SLOW_BURN_MIN_TURNS = Object.freeze({', policy + 'const SLOW_BURN_MIN_TURNS = Object.freeze({')
    old = next(line for line in source.splitlines() if "'Sexual stage scale:" in line and 'peak or conclusion permitted' in line)
    replace(old, '        ...SLOW_BURN_STAGE_REPORT_RULES,')
    pattern = r"    const stageRule = slowBurnEnabled\n        \? [^\n]+\n        : '';"
    source, count = re.subn(pattern, lambda _: "    const stageRule = slowBurnEnabled\n        ? '\\n' + SLOW_BURN_STAGE_REPORT_RULES.join('\\n')\n        : '';", source, count=1)
    assert count == 1
    # Monitoring a general scene must not acquire new stage instructions.
    replace('    const slowBurnEnabled = settings.slowBurnEnabled;',
            '    const slowBurnEnabled = settings.slowBurnEnabled && isFullyArmed();')
    replace("if (settings.slowBurnEnabled && (state.stage === null || state.stage === undefined)) issues.push('stage');",
            "if (settings.slowBurnEnabled && isFullyArmed() && (state.stage === null || state.stage === undefined)) issues.push('stage');")

    helper = '''function diagnosticSlowBurn() {
    const settings = getSettings();
    const meta = getChatMeta(false);
    const progress = slowBurnProgress(settings);
    const active = Boolean(settings.slowBurnEnabled && isFullyArmed());
    const targetHold = Boolean(progress.target.active && progress.target.remaining > 0);
    const targetMode = Boolean(progress.target.active);
    const reason = !settings.slowBurnEnabled ? 'disabled' : !active ? 'inactive'
        : targetMode ? 'target_rule' : progress.stage === null ? 'stage_unknown'
        : progress.locked ? 'manual_lock'
        : progress.sessionRemaining > 0 || progress.stageRemaining > 0 ? 'minimum_turns'
        : progress.stage !== 6 ? 'stage_not_final' : 'permitted';
    const override = Number(meta?.slowBurnStageOverride);
    return {
        stageSource: progress.source,
        stageAppliedPresent: progress.stage !== null,
        ...(progress.stage !== null ? { stageApplied: progress.stage } : {}),
        stageManualOverride: Number.isFinite(override) && override >= 1 && override <= 6,
        slowBurnPolicyActive: active,
        stageCapPresent: active && !targetMode && progress.maxStage !== null,
        ...(active && !targetMode && progress.maxStage !== null ? { stageCap: progress.maxStage } : {}),
        slowBurnTargetRule: active && targetMode,
        slowBurnTargetHold: active && targetHold,
        slowBurnUserOverrideAllowed: active && !targetMode && Boolean(settings.slowBurnUserOverride),
        slowBurnConclusionBlocked: active && (targetMode || !progress.canConclude),
        slowBurnLimitReason: reason,
        slowBurnSessionRemaining: progress.sessionRemaining,
        slowBurnStageRemaining: progress.stageRemaining,
    };
}

'''
    replace('function diagnosticState() {', helper + 'function diagnosticState() {')
    replace('stageSource: stageInfo.source, enabled:', 'stageSource: stageInfo.source, ...diagnosticSlowBurn(), enabled:')
    replace("        else if (key === 'writeTrace')", "        else if (key === 'slowBurnLimitReason' && ['disabled', 'inactive', 'target_rule', 'stage_unknown', 'manual_lock', 'minimum_turns', 'stage_not_final', 'permitted'].includes(value)) values[key] = value;\n        else if (key === 'writeTrace')")
    replace('function buildSlowBurnLines(settings) {', "function buildSlowBurnLines(settings) {\n    diagnosticRecord('slow_burn_policy_composed', { ...diagnosticStage(effectiveState().state, 'current'), ...diagnosticSlowBurn() });")
    return source
