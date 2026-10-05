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
        assert.equal(read(`modes/${kind}/settings.html`), read(`vendor/${kind}/settings.html`));
        // Theme adaptation may replace accent colors, but no layout rule is lost.
        const withoutAccents = css => css.replace(/var\(--SmartThemeQuoteColor, currentColor\)|crimson|royalblue|#f4a261|\bred\b/g, 'THEME_ACCENT');
        assert.equal(withoutAccents(read(`modes/${kind}/style.css`)), withoutAccents(read(`vendor/${kind}/style.css`)));
        const fields = source => source.match(/function sanitizeState\(raw\) \{[\s\S]*?\n\}/)[0];
        assert.equal(fields(adapted), fields(original));
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
