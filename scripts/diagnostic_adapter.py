"""Explicit operation boundaries; never patch Promise or guess cross-await callers."""
import re

NAMES = ('runRefine', 'requestRefine', 'parseRefineResponse', 'persistChat',
         'saveChatMeta', 'rerenderMessage', 'applyManualEdit', 'loadSettingsHtml',
         'initializeUi', 'onEnable', 'onDisable', 'onClean')
REASONS = {
    'sfw': ['mode_or_generation_guard', 'chat_not_ready', 'disabled_or_busy', 'automatic_off', 'main_generation_pending',
            'other_mode', 'no_assistant', 'target_pending', 'cancelled_or_disabled', 'target_changed', 'record_changed', 'saved', 'aborted', 'failed'],
    'nsfw': ['mode_or_generation_guard', 'chat_not_ready', 'disabled', 'automatic_not_needed', 'main_generation_pending',
             'busy', 'adult_unconfirmed', 'no_assistant', 'target_pending', 'same_automatic_target', 'target_changed_or_disabled', 'record_changed', 'saved', 'aborted', 'failed'],
}

def instrument(source, kind):
    for name in NAMES:
        pattern = rf'((?:async )?function {name}\([^\n]*\) \{{)\n([\s\S]*?)\n\}}'
        matches = list(re.finditer(pattern, source))
        assert len(matches) == 1, (kind, name)
        match = matches[0]
        body = match[2]
        # Keep existing exception handling and return values intact. Record caught
        # failures even when the existing engine recovers or merely logs to debug.
        body = re.sub(r'catch \((\w+)\) \{',
            lambda m: m[0] + f'\n        unifiedHost?.diagnosticCaught?.(__diagOperation, {m[1]});', body)
        body = re.sub(r'\.catch\(\((\w+)\) => \{',
            lambda m: m[0] + f'\n                unifiedHost?.diagnosticCaught?.(__diagOperation, {m[1]});', body)
        parent = ', signal' if name == 'requestRefine' else ''
        header = match[1]
        if name in ('parseRefineResponse', 'persistChat', 'saveChatMeta'):
            header = header.replace('text)', 'text, __diagParent = null)') if name == 'parseRefineResponse' else header.replace('()', '(__diagParent = null)')
            parent = ', __diagParent'
        if name == 'runRefine':
            branch = 0
            def returned(m):
                nonlocal branch
                branch += 1
                value = m[1]
                return "{ unifiedHost?.diagnosticPoint?.(__diagOperation, 'return', { branch: %d, reason: '%s', accepted: %s }); return %s; }" % (branch, REASONS[kind][branch - 1], 'true' if value == 'true' else 'false', value)
            body = re.sub(r'\breturn (false|true|null);', returned, body)
            assert branch == len(REASONS[kind]), (kind, 'return branches changed')
            body = body.replace('parseRefineResponse(response)', 'parseRefineResponse(response, __diagOperation)')
            body = body.replace('persistChat();', 'persistChat(__diagOperation);').replace('saveChatMeta();', 'saveChatMeta(__diagOperation);')
            body, count = re.subn(r'(        const response = await awaitRefineResponse\(([^;]+)\);)',
                lambda m: f'        unifiedHost?.diagnosticBind?.({m[2]}, __diagOperation);\n' + m[1], body)
            assert count == 1, (kind, 'refine signal')
        if name == 'requestRefine':
            body = body.replace('    for (const tokens of ladder) {',
                "    for (const tokens of ladder) {\n        unifiedHost?.diagnosticPoint?.(__diagOperation, 'provider_attempt', { tokens, profile: Boolean(profileId), aborted: Boolean(signal?.aborted) });", 1)
            body = body.replace('const result = await service.sendRequest(profileId, prompt, tokens, { stream: false, signal, extractData: true }, overrides);',
                "const result = await service.sendRequest(profileId, prompt, tokens, { stream: false, signal, extractData: true }, overrides);\n                unifiedHost?.diagnosticPoint?.(__diagOperation, 'provider_returned', { tokens, text: typeof result === 'string', object: result !== null && typeof result === 'object' });")
            body = body.replace('return await context.generateRaw({ prompt, responseLength: tokens, trimNames: false, signal });',
                "const result = await context.generateRaw({ prompt, responseLength: tokens, trimNames: false, signal });\n            unifiedHost?.diagnosticPoint?.(__diagOperation, 'provider_returned', { tokens, text: typeof result === 'string' });\n            return result;")
        if name in ('persistChat', 'saveChatMeta'):
            body = body.replace('context.saveChatDebounced();', "{ unifiedHost?.diagnosticPoint?.(__diagOperation, 'save_scheduled'); context.saveChatDebounced(); }")
            # The metadata branch has no braces in pinned upstream code.
            body = body.replace("if (typeof context.saveMetadataDebounced === 'function') context.saveMetadataDebounced();",
                "if (typeof context.saveMetadataDebounced === 'function') { unifiedHost?.diagnosticPoint?.(__diagOperation, 'save_scheduled'); context.saveMetadataDebounced(); }")
            for method in ('saveChat', 'saveMetadata'):
                body = body.replace(f'context.{method}()', f'diagnosticSaveResult(__diagOperation, context.{method}())')
        wrapped = (header + f"\n    const __diagOperation = unifiedHost?.diagnosticBegin?.('{kind}', '{name}'{parent});\n    try {{\n"
            + body + "\n    } catch (__diagError) {\n        unifiedHost?.diagnosticError?.(__diagOperation, __diagError);\n        throw __diagError;\n    } finally {\n        unifiedHost?.diagnosticEnd?.(__diagOperation);\n    }\n}")
        source = source[:match.start()] + wrapped + source[match.end():]
    source += '''
function diagnosticSaveResult(task, result) {
    return unifiedHost?.diagnosticPromise ? unifiedHost.diagnosticPromise(task, result) : result;
}
'''
    return source
