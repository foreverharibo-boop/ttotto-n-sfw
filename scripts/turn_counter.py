"""Shared logical-turn bookkeeping; leave report and pacing prose unchanged."""
import re


def adapt_turn_counter(source):
    def replace(old, new):
        nonlocal source
        assert old in source, old[:100]
        source = source.replace(old, new)

    replace('    meta.slowBurnSessionStartAssistantCount = null;',
            '    meta.slowBurnSessionStartAssistantCount = null;\n    meta.slowBurnTurnSession = null;')
    replace('    meta.slowBurnSessionStartAssistantCount = assistantMessages().length;',
            '    meta.slowBurnSessionStartAssistantCount = assistantMessages().length;\n    meta.slowBurnTurnSession = beginTurnSession(getContext().chat, isPendingAssistant);')
    source += '''
function slowBurnTurnProgress() {
    const result = sessionTurns(getChatMeta(false), getContext().chat, isPendingAssistant);
    if (result.changed) saveChatMeta();
    return result;
}
'''
    # Preserve the old helper's public name for source parity, but no controller
    # uses its absolute index to slice a changed conversation anymore.
    source, count = re.subn(r'function slowBurnSessionStartCount\(\) \{\n[\s\S]*?\n\}',
        '''function slowBurnSessionStartCount() {
    return Math.max(0, assistantMessages().length - slowBurnTurnProgress().messages.length);
}''', source, count=1)
    assert count == 1
    replace('Math.max(0, assistantMessages().length - slowBurnSessionStartCount())',
            'slowBurnTurnProgress().messages.length')
    replace('function consecutiveSlowBurnTurns(stage, startCount = slowBurnSessionStartCount()) {',
            'function consecutiveSlowBurnTurns(stage, messages = slowBurnTurnProgress().messages) {')
    replace('    const messages = assistantMessages().slice(Math.max(0, startCount));\n', '')
    replace('    const startCount = slowBurnSessionStartCount();\n    const sessionTurns = Math.max(0, assistantMessages().length - startCount);\n    const turns = consecutiveSlowBurnTurns(stage, startCount);',
            '    const counter = slowBurnTurnProgress();\n    const sessionTurns = counter.messages.length;\n    const turns = consecutiveSlowBurnTurns(stage, counter.messages);')
    replace('        sessionTurns,\n', '        sessionTurns,\n        baselineTurns: counter.baselineTurns,\n        legacyRebased: counter.legacyRebased,\n')
    if 'function diagnosticSlowBurn()' in source:
        replace('        slowBurnSessionRemaining: progress.sessionRemaining,', '''        slowBurnCountedTurns: progress.sessionTurns,
        slowBurnStageTurns: progress.turns,
        slowBurnRequiredTurns: progress.requiredTurns,
        slowBurnBaselineTurns: progress.baselineTurns,
        slowBurnLegacyRebased: progress.legacyRebased,
        slowBurnSessionRemaining: progress.sessionRemaining,''')
    else:
        replace('function diagnosticState() {\n    const stageInfo',
                'function diagnosticState() {\n    const progress = slowBurnProgress();\n    const stageInfo')
        replace('        refineRunning, pendingGenerations: generationEvents.length };', '''        slowBurnCountedTurns: progress.sessionTurns, slowBurnStageTurns: progress.turns,
        slowBurnRequiredTurns: progress.requiredTurns, slowBurnBaselineTurns: progress.baselineTurns,
        slowBurnLegacyRebased: progress.legacyRebased,
        slowBurnSessionRemaining: progress.sessionRemaining, slowBurnStageRemaining: progress.stageRemaining,
        refineRunning, pendingGenerations: generationEvents.length };''')
    return source
