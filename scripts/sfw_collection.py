"""SFW scene descriptions use the active owner's independent collection mask."""
import re

def adapt_sfw_collection(source, unified=False):
    settings = "unifiedHost.collectionSettings()" if unified else "getSettings()"
    def replace(old,new):
        nonlocal source
        assert old in source, old
        source=source.replace(old,new,1)
    replace('function sanitizeState(raw) {', 'function sanitizeState(raw) {\n    raw = filterSceneCollection(raw, '+settings+');')
    start=source.index('function sanitizeState(raw) {');end=source.index('\n}',start)
    part=source[start:end].replace('    return clean;', '    return filterSceneCollection(clean, '+settings+');')
    source=source[:start]+part+source[end:]
    replace("    if (!hasBi(state.location)) issues.push('location');", "    const fields = sceneCollectionFields(settings);\n    if (fields.location && !hasBi(state.location)) issues.push('location');")
    replace("    if (!hasCharacterState) issues.push('characters');", "    if ((fields.appearance || fields.position || fields.holding || fields.condition) && !hasCharacterState) issues.push('characters');")
    for name in ['effectiveState','stateForDisplay']:
        start=source.index('function '+name+'(');end=source.index('\n}',start)
        part=re.sub(r'return \{ state: (.*?), source:', lambda m:'return { state: filterSceneCollection('+m[1]+', '+settings+'), source:',source[start:end])
        source=source[:start]+part+source[end:]
    replace('function buildStateLines(state) {','function buildStateLines(state) {\n    state = filterSceneCollection(state, '+settings+');')
    start=source.index('function updateUi() {');end=source.index('\n}',start)
    part=source[start:end].replace('    try {','    try {\n        renderSceneCollectionUi();',1)
    source=source[:start]+part+source[end:]
    replace('function bindUi() {','function bindUi() {\n    bindSceneCollectionUi();')
    replace("    const locationInput = element('tsf-state-location');", "    const collectionFields = sceneCollectionFields(getSettings());\n    const locationInput = element('tsf-state-location');\n    locationInput.closest('label').hidden = !collectionFields.location;")
    for field in ['time','environment']:
        replace("    const "+field+"Input = element('tsf-state-"+field+"');", "    const "+field+"Input = element('tsf-state-"+field+"');\n    "+field+"Input.closest('label').hidden = !collectionFields."+field+";")
    replace("    element('tsf-object-empty').hidden = Object.keys(importantObjects).length > 0;", "    element('tsf-object-empty').hidden = Object.keys(importantObjects).length > 0 || !collectionFields.objects;")
    replace("            const wrap = document.createElement('label');\n            wrap.className = 'tsf-char-field';", "            if (!collectionFields[field]) continue;\n            const wrap = document.createElement('label');\n            wrap.className = 'tsf-char-field';")
    replace("    element('tsf-char-empty').hidden = Object.keys(characters).length > 0;", "    element('tsf-char-empty').hidden = Object.keys(characters).length > 0 || !(collectionFields.appearance || collectionFields.position || collectionFields.holding || collectionFields.condition);")
    return source
