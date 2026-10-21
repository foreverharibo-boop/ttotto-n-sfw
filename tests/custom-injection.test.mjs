import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('../custom-injection.js', import.meta.url), 'utf8');
function setup(saved) {
    const nodes = new Map();
    const node = () => ({ dataset: {}, value: '', disabled: false, children: [], listeners: {},
        replaceChildren() { this.children = []; }, append(item) { this.children.push(item); },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        fire(type, value) { this.value = value; this.listeners[type]?.({ target: this }); } });
    for (const id of ['character', 'note', 'prompt', 'prompt-scope', 'kinks', 'kinks-scope']) nodes.set('tns-custom-' + id, node());
    const context = { characters: [{ name: 'Same', avatar: 'a.png' }, { name: 'Same', avatar: 'b.png' }],
        characterId: 0, chatId: 'one', extensionSettings: saved ?? {}, saveSettingsDebounced() {} };
    const env = { crypto: { randomUUID }, document: { createElement: node }, getContext: () => context,
        getSettings: () => context.extensionSettings.engine ??= {}, element: id => nodes.get(id),
        clearInjectedPrompt() {}, updateUi: () => env.api.renderCustomInjectionUi() };
    vm.createContext(env);
    vm.runInContext(source + '\nglobalThis.api = { customInjectionCharacters, customInjectionStore, customInjectionProfile, buildCustomInjectionLines, renderCustomInjectionUi, bindCustomInjectionUi };', env);
    env.api.renderCustomInjectionUi(); env.api.bindCustomInjectionUi();
    return { context, api: env.api, input: (id, value) => nodes.get('tns-custom-' + id).fire('input', value),
        change: (id, value) => nodes.get('tns-custom-' + id).fire('change', value),
        value: id => nodes.get('tns-custom-' + id).value,
        text: () => env.api.buildCustomInjectionLines().join('\n'),
        switch(id, chat = 'other') { context.characterId = id; context.chatId = chat; env.api.renderCustomInjectionUi(); } };
}

test('same-name cards have different UUIDs; scopes, drafts and IDs survive reload and another chat', () => {
    const r = setup();
    const a = r.api.customInjectionCharacters()[0].uuid;
    r.input('prompt', 'COMMON-PROMPT');
    r.change('kinks-scope', 'character'); r.input('kinks', 'A-ONLY');
    assert.match(r.text(), /COMMON-PROMPT/); assert.match(r.text(), /A-ONLY/);
    r.switch(1);
    const b = r.api.customInjectionCharacters()[0].uuid;
    assert.notEqual(a, b); assert.doesNotMatch(r.text(), /A-ONLY/);
    r.change('kinks-scope', 'character'); r.input('kinks', 'B-ONLY');
    assert.match(r.text(), /B-ONLY/); assert.doesNotMatch(r.text(), /A-ONLY/);
    r.switch(0, 'branch');
    assert.equal(r.value('kinks'), 'A-ONLY');
    r.change('kinks-scope', 'common'); r.input('kinks', 'COMMON-KINK');
    r.change('kinks-scope', 'character'); assert.equal(r.value('kinks'), 'A-ONLY');
    r.change('prompt-scope', 'off'); assert.doesNotMatch(r.text(), /COMMON-PROMPT/);
    r.change('prompt-scope', 'common'); assert.match(r.text(), /COMMON-PROMPT/);
    const reloaded = setup(JSON.parse(JSON.stringify(r.context.extensionSettings)));
    assert.equal(reloaded.api.customInjectionCharacters()[0].uuid, a);
    assert.equal(reloaded.value('kinks'), 'A-ONLY');
    reloaded.context.characters.reverse(); reloaded.switch(1);
    assert.equal(reloaded.api.customInjectionCharacters()[0].uuid, a, 'array reorder must not change identity');
    reloaded.context.characters[1].name = 'Renamed';
    assert.match(reloaded.text(), /A-ONLY/);
});

test('switching chats before a delayed input event cannot overwrite either card', () => {
    const r = setup();
    r.change('prompt-scope', 'character'); r.input('prompt', 'A-DRAFT');
    r.context.characterId = 1; r.context.chatId = 'two';
    r.input('prompt', 'LATE-OLD-EVENT');
    assert.doesNotMatch(r.text(), /LATE-OLD-EVENT|A-DRAFT/);
    r.switch(0); assert.equal(r.value('prompt'), 'A-DRAFT');
});

test('groups scope common text once, keep private entries distinct and omit disabled/unrelated cards', () => {
    const r = setup();
    r.input('prompt', 'COMMON'); r.change('kinks-scope', 'character'); r.input('kinks', 'A-ONLY');
    r.switch(1); r.change('kinks-scope', 'character'); r.input('kinks', 'B-ONLY');
    r.context.groupId = 'g'; r.context.groups = [{ id: 'g', members: ['a.png', 'b.png'], disabled_members: [] }];
    r.api.renderCustomInjectionUi();
    assert.equal((r.text().match(/COMMON/g) ?? []).length, 1);
    assert.match(r.text(), /A-ONLY/); assert.match(r.text(), /B-ONLY/);
    const a = r.api.customInjectionCharacters()[0].uuid;
    r.change('character', a); r.change('kinks-scope', 'off');
    assert.doesNotMatch(r.text(), /A-ONLY/); assert.match(r.text(), /B-ONLY/);
    r.context.groups[0].disabled_members = ['b.png'];
    assert.doesNotMatch(r.text(), /B-ONLY/);
    r.context.groups[0].members = []; assert.equal(r.text(), '');
});

test('no selected card, missing avatar and blank inputs never select card zero or inject empty blocks', () => {
    const r = setup(); assert.equal(r.text(), '');
    r.input('prompt', '   \n  '); assert.equal(r.text(), '');
    r.input('prompt', 'GLOBAL');
    r.context.characterId = null; assert.equal(r.text(), '');
    r.context.characterId = ''; assert.equal(r.text(), '');
    r.context.characterId = 0; delete r.context.characters[0].avatar;
    assert.equal(r.text(), '');
    r.api.renderCustomInjectionUi(); r.input('prompt', 'EDIT-FROM-HOME');
    assert.equal(r.api.customInjectionStore().common.prompt, 'EDIT-FROM-HOME');
});

test('arbitrary multiline text is preserved and treated as text by the editor', () => {
    const r = setup();
    const value = '<b>{{char}}</b>\n두 번째 줄\n\n  들여쓰기';
    r.input('prompt', value); r.api.renderCustomInjectionUi();
    assert.equal(r.value('prompt'), value); assert.ok(r.text().endsWith(value));
});
