"""Convert state-only text inputs to growing multiline controls."""
import re

def adapt_state_height(source):
    start=source.index('function renderStatePanel() {');end=source.index('\n}',start)
    part=source[start:end].replace("document.createElement('input')", "document.createElement('textarea')").replace("input.type = 'text';", "input.rows = 1;").replace("input.className = 'text_pole';", "input.className = 'text_pole ttotto-scene-textarea';")
    source=source[:start]+part+source[end:]
    assert '        renderStatePanel();' in source
    return source.replace('        renderStatePanel();', '        renderStatePanel();\n        autoSizeSceneFields();',1)

def adapt_state_html(data):
    return re.sub(r'<input id="((?:tns|tsf)-state-[^" ]+)" type="text" class="text_pole"([^>]*)>', r'<textarea id="\1" rows="1" class="text_pole ttotto-scene-textarea"\2></textarea>',data)
