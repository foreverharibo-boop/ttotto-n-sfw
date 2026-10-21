import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const provenance = JSON.parse(read('provenance.json'));

for (const kind of ['sfw', 'nsfw']) {
    test(`${kind}: pinned sources are intact and every existing function and setting control is retained`, () => {
        for (const [file, hash] of Object.entries(provenance[kind].sha256)) {
            assert.equal(crypto.createHash('sha256').update(read(`vendor/${kind}/${file}`)).digest('hex'), hash);
        }
        const original = read(`vendor/${kind}/index.js`), adapted = read(`modes/${kind}/index.js`);
        const functions = [...original.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)].map(match => match[1]);
        for (const name of functions) assert.ok(adapted.includes(`function ${name}(`), name);
        const defaults = source => source.match(/const DEFAULT_SETTINGS = Object\.freeze\(\{[\s\S]*?\n\}\);/)[0];
        assert.equal(defaults(adapted), defaults(original));
        const restoreInputs = html => html.replace(/<textarea id="((?:tns|tsf)-state-[^"]+)" rows="1" class="text_pole ttotto-scene-textarea"([^>]*)><\/textarea>/g, '<input id="$1" type="text" class="text_pole"$2>');
        let html = read(`modes/${kind}/settings.html`), css = read(`modes/${kind}/style.css`).replace(read('scene-field-size.css'), '');
        if (kind === 'nsfw') {
            html = html.replace(read('custom-injection.html'), '').replace(read('scene-collection.html'), '');
            css = css.replace(read('custom-injection.css'), '').replace(read('scene-collection.css'), '');
        } else {
            html = html.replace('\n' + read('scene-collection-sfw.html'), '');
            css = css.replace(read('scene-collection-sfw.css'), '');
        }
        assert.equal(restoreInputs(html), read(`vendor/${kind}/settings.html`));
        const withoutAccents = css => css.replace(/var\(--SmartThemeQuoteColor, currentColor\)|crimson|royalblue|#f4a261|\bred\b/g, 'THEME_ACCENT');
        assert.equal(withoutAccents(css), withoutAccents(read(`vendor/${kind}/style.css`)));
        const fields = source => source.match(/function sanitizeState\(raw\) \{[\s\S]*?\n\}/)[0];
        // The intimate schema adds a sanitized full scene record; none of its
        // original fields or parsing behavior may otherwise change.
        const addedScene = '    if (unifiedHost && raw.scene) clean.scene = unifiedHost.sanitizeCommon(raw.scene);\n';
        assert.equal(fields(adapted).replace(addedScene, '').replace('    raw = filterSceneCollection(raw, unifiedHost.collectionSettings());\n', '').replace('    return filterSceneCollection(clean, unifiedHost.collectionSettings());', '    return clean;').replace('    raw = filterSceneCollection(raw, getSettings());\n', '').replace('    return filterSceneCollection(clean, getSettings());', '    return clean;').replace(`    raw = expandCompactReport(raw, '${kind}');\n`, ''), fields(original));
    });
}
test('one public interceptor and wand entry; no extension-tab panel insertion', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.generate_interceptor, 'ttottoUnifiedGenerationInterceptor');
    const entry = read('index.js');
    assert.match(entry, /hasLegacyRuntime/);
    assert.equal((read('ui.js').match(/button\.id = 'ttu-wand-button'/g) ?? []).length, 1);
    for (const file of ['index.js', 'ui.js', 'runtime.js']) assert.doesNotMatch(read(file), /extensions_settings2?/);
});

test('production modes have no event subscriptions, prompt writers or inter-engine bridge', () => {
    for (const kind of ['sfw', 'nsfw']) {
        const source = read(`modes/${kind}/index.js`);
        assert.doesNotMatch(source, /ttottoNsfwSceneBridge|delegationDraining|\.setExtensionPrompt\(|\.eventSource\.on\(/);
        assert.match(source, /return unifiedHost\.messageStore/);
        assert.match(source, /return unifiedHost\.collect/);
    }
    assert.doesNotMatch(read('runtime.js'), /promptSlots|ttottoNsfwGenerationInterceptor|ttottoSfwGenerationInterceptor/);
});
