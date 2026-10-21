"""Independent current-response and next-beat uses for selected CardInject data."""
import re

OLD_HELP = 'CardInject가 분석해둔 캐시트 카테고리 중 고른 것을 다음 전개 힌트의 참고 자료로 써요. 개입 중일 때만 주입되고, 다음 전개 힌트가 켜져 있어야 동작해요. 보조 AI 보정 호출에도 같이 전달돼요.'
NEW_HELP = '고른 캐시트 카테고리를 현재 답변과 전개 후보에 각각 사용할 수 있어요. 해당 모드가 개입할 때만 적용하며, CardInject에서 꺼둔 카테고리도 사용할 수 있어요.'

def adapt_card_usage(source, kind):
    prefix = 'tsf' if kind == 'sfw' else 'tns'
    def replace(old, new):
        nonlocal source
        assert old in source, old
        source = source.replace(old, new, 1)
    replace('    cardLinkEnabled: false,', '    cardLinkEnabled: false,\n    cardLinkUseReply: true,\n    cardLinkUseNext: true,')
    start = source.index('function buildCardPreferenceLines(')
    end = source.index('\n}', start) + 2
    source = source[:start] + """function cardLinkUsage(settings = getSettings(), targetActive = slowBurnTargetProgress().active) {
    const active = Boolean(settings.cardLinkEnabled && isFullyArmed());
    return {
        reply: active && settings.cardLinkUseReply !== false,
        next: active && settings.cardLinkUseNext !== false && Boolean(settings.nextBeatHints) && !targetActive,
    };
}

function buildCardPreferenceLines(usage = cardLinkUsage()) {
    if (!usage.reply && !usage.next) return [];
    const text = cardLinkPreferenceText();
    if (!text) return [];
    return [
        usage.reply ? 'CHARACTER SHEET CONTEXT (apply relevant character traits, voice and preferences to the CURRENT reply):'
            : 'CHARACTER PREFERENCES (inspiration for choosing what happens next, not a checklist):',
        'Use only what fits the current scene and user intent. Preferences are not required actions or established scene facts. Never override explicit user changes, hard limits, banned items, or the active target and pacing rules.',
        ...(usage.next ? ['Also use this same reference for next-beat candidates when relevant; do not repeat it in another reference block.'] : []),
        text,
    ];
}""" + source[end:]
    replace("    if (settings.nextBeatHints && !targetActive) {\n        const preferenceLines = buildCardPreferenceLines();\n        if (preferenceLines.length) sections.push('', ...preferenceLines);", "    const cardUsage = cardLinkUsage(settings, targetActive);\n    const preferenceLines = buildCardPreferenceLines(cardUsage);\n    if (preferenceLines.length) sections.push('', ...preferenceLines);\n\n    if (settings.nextBeatHints && !targetActive) {")
    replace('const nextGuidance = settings.nextBeatHints && !targetActive && cardLinkPreferenceText()', 'const nextGuidance = cardUsage.next && cardLinkPreferenceText()')
    # Both legacy and compact repair builders must obey the candidate-only gate.
    assert 'settings.cardLinkEnabled && settings.nextBeatHints ? cardLinkPreferenceText()' in source
    source = source.replace('settings.cardLinkEnabled && settings.nextBeatHints ? cardLinkPreferenceText()', 'cardLinkUsage(settings).next ? cardLinkPreferenceText()')
    marker = "    element('"+prefix+"-card-link').checked = Boolean(settings.cardLinkEnabled);"
    replace(marker, marker + "\n    element('"+prefix+"-card-link-reply').checked = settings.cardLinkUseReply !== false;\n    element('"+prefix+"-card-link-next').checked = settings.cardLinkUseNext !== false;")
    marker = "    bindSetting('"+prefix+"-card-link', 'cardLinkEnabled', Boolean);"
    replace(marker, marker + "\n    bindSetting('"+prefix+"-card-link-reply', 'cardLinkUseReply', Boolean);\n    bindSetting('"+prefix+"-card-link-next', 'cardLinkUseNext', Boolean);")
    replace('    note.textContent = duplicated', "    const usesReference = settings.cardLinkUseReply !== false || (settings.cardLinkUseNext !== false && settings.nextBeatHints);\n    note.textContent = !usesReference\n        ? `고른 ${picked}개는 보관 중이에요. 현재 켜진 사용 용도가 없어 또또에서는 주입하지 않아요.`\n        : duplicated")
    source = source.replace('프롬프트에 두 번 들어가요.', '또또가 주입할 때 중복될 수 있어요.')
    source = source.replace('고른 ${picked}개는 개입 중일 때만 주입돼요.', '고른 ${picked}개는 선택한 용도로 개입 중일 때만 주입돼요.')
    source = source.replace('from the CHARACTER PREFERENCES above when', 'from the character-sheet reference above when')
    return source

def adapt_card_html(data, kind, fragment):
    prefix = 'tsf' if kind == 'sfw' else 'tns'
    assert OLD_HELP in data
    data = data.replace(OLD_HELP, NEW_HELP, 1)
    marker = '          <div id="'+prefix+'-card-link-list"></div>'
    assert data.count(marker) == 1
    return data.replace(marker, fragment.replace('PREFIX', prefix) + marker, 1)
