"""Selective NSFW scene descriptions; leave controller/history fields intact."""
import re

def adapt_scene_collection(source):
    def replace(old, new):
        nonlocal source
        assert old in source, old
        source = source.replace(old, new, 1)
    replace('function sanitizeState(raw) {', 'function sanitizeState(raw) {\n    raw = filterSceneCollection(raw, getSettings());')
    # Filter again after alias conversion (holding must not revive disabled contact).
    start = source.index('function sanitizeState(raw) {')
    end = source.index('\n}', start)
    chunk = source[start:end].replace('    return clean;', '    return filterSceneCollection(clean, getSettings());')
    source = source[:start] + chunk + source[end:]
    replace("    if (!hasBi(state.location)) issues.push('location');", "    const fields = sceneCollectionFields(settings);\n    if (fields.location && !hasBi(state.location)) issues.push('location');")
    replace("    if (!hasCharacterState) issues.push('characters');", "    if ((fields.appearance || fields.position || fields.contact) && !hasCharacterState) issues.push('characters');")
    # Stored history is retained, but disabled facts cannot enter current state or UI.
    for name in ['effectiveState', 'stateForDisplay']:
        start = source.index('function ' + name + '(')
        end = source.index('\n}', start)
        chunk = source[start:end]
        chunk = chunk.replace('state: manual.state,', 'state: filterSceneCollection(manual.state, getSettings()),')
        chunk = chunk.replace('state: snapshot.state,', 'state: filterSceneCollection(snapshot.state, getSettings()),')
        chunk = chunk.replace('state: snapshotForMessage(assistantMessages().at(-1))?.state ?? null,', 'state: filterSceneCollection(snapshotForMessage(assistantMessages().at(-1))?.state ?? null, getSettings()),')
        source = source[:start] + chunk + source[end:]
    replace('function buildStateLines(state) {', 'function buildStateLines(state) {\n    state = filterSceneCollection(state, getSettings());')
    replace('        renderCustomInjectionUi();\n        const settings = getSettings();', '        renderCustomInjectionUi();\n        renderSceneCollectionUi();\n        const settings = getSettings();')
    replace('    bindCustomInjectionUi();', '    bindCustomInjectionUi();\n    bindSceneCollectionUi();')
    replace("    const locationInput = element('tns-state-location');", "    const collectionFields = sceneCollectionFields(settings);\n    const locationInput = element('tns-state-location');\n    locationInput.closest('label').hidden = !collectionFields.location;")
    replace("            const wrap = document.createElement('label');\n            wrap.className = 'tns-char-field';", "            if (!collectionFields[field === 'clothing' ? 'appearance' : field]) continue;\n            const wrap = document.createElement('label');\n            wrap.className = 'tns-char-field';")
    replace("    element('tns-char-empty').hidden = Object.keys(characters).length > 0;", "    element('tns-char-empty').hidden = Object.keys(characters).length > 0 || !(collectionFields.appearance || collectionFields.position || collectionFields.contact || collectionFields.holding || collectionFields.condition);")
    source = source.replace('No location/character state has been recorded yet. Derive the current state from the latest roleplay prose, preserve those established facts, and report the complete state in the block below. A temperature-only record is not a full scene state.', 'No current state has been recorded yet. Use the latest roleplay prose and report only the selected fields in the schema below. Do not reconstruct disabled fields.')
    return source
