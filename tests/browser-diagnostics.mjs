// Optional real-browser check: npm run test:browser (requires Playwright + Chromium).
// Set DIAGNOSTIC_BROWSER=firefox or webkit to check those installed engines too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const html = '<div id="chat"><div class="mes" mesid="0" swipeid="0"><span class="mes_timer">52.8s</span><span class="tokenCounterDisplay">1908t</span><span class="timestamp">PRIVATE_TIME</span><div class="mes_text">PRIVATE_BODY</div></div></div><script src="/script.js"></script><script src="/scripts/extensions/third-party/probe/index.js"></script>';
const core = 'globalThis.renderReply=value=>{document.querySelector(".tokenCounterDisplay").textContent=value};globalThis.Generate=async()=>{console.log("Generate entered");await Promise.resolve();return 17};';
const probe = `globalThis.probe={
    generate(){return Generate()},
    direct(){document.querySelector('.mes_timer').textContent='95.5s'},
    indirect(){renderReply('3095t')},
    later(){return new Promise(resolve=>setTimeout(()=>{renderReply('4000t');resolve()},0))},
    markup(){document.querySelector('.mes_text').innerHTML='<b>PRIVATE_BODY</b>'},
    replace(){raw.chat[0]={mes:'PRIVATE_NEW_BODY',extra:{token_count:5000}};raw.chat[0].extra.token_count=6000},
    error(){try{throw new Error('PRIVATE_SECRET')}catch(error){console.error(error)}}
};`;

test('real browser reply replacement, DOM calls, async origin and cleanup', async t => {
    const server = createServer(async (req, res) => {
        try {
            const path = new URL(req.url, 'http://localhost').pathname;
            if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
            res.setHeader('Content-Type', 'application/javascript');
            if (path === '/script.js') { res.end(core); return; }
            if (path === '/scripts/extensions/third-party/probe/index.js') { res.end(probe); return; }
            if (['/conflict-diagnostics.js', '/diagnostic-hooks.js', '/diagnostics.js'].includes(path)) {
                res.end(await readFile(new URL('..' + path, import.meta.url))); return;
            }
            res.statusCode = 404; res.end();
        } catch { res.statusCode = 500; res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const modulePath = process.env.PLAYWRIGHT_MODULE || require.resolve('playwright', {
        paths: [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean),
    });
    const playwright = require(modulePath);
    const engine = process.env.DIAGNOSTIC_BROWSER || 'chromium';
    assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
    const browser = await playwright[engine].launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
        const { createConflictDiagnostics } = await import('/conflict-diagnostics.js');
        globalThis.raw = { chat: [{ mes: 'PRIVATE_BODY', extra: { token_count: 1908 } }], chatMetadata: {}, chatId: 'PRIVATE_CHAT' };
        globalThis.originals = { textContent: Object.getOwnPropertyDescriptor(Node.prototype, 'textContent'), timer: setTimeout,
            define: Object.defineProperty, splice: Array.prototype.splice };
        globalThis.tracker = createConflictDiagnostics({ raw: () => raw, ready: () => true, enabled: () => true });
        tracker.sync();
    });
    await page.evaluate(async () => { probe.direct(); probe.indirect(); await probe.later(); probe.markup(); probe.replace(); probe.error(); });
    assert.equal(await page.evaluate(() => probe.generate()), 17);
    const report = await page.evaluate(() => tracker.report());
    const dom = report.events.filter(row => row.stage === 'dom_write');
    assert.ok(dom.some(row => row.data.writeTrace[0]?.script === '/scripts/extensions/third-party/probe/index.js'));
    assert.ok(dom.some(row => row.data.writeTrace[0]?.script === '/script.js'
        && row.data.writeTrace.some(frame => frame.script === '/scripts/extensions/third-party/probe/index.js')));
    assert.ok(dom.some(row => row.data.asyncParents.some(parent => parent.kind === 'setTimeout'
        && parent.writeTrace[0]?.script === '/scripts/extensions/third-party/probe/index.js')));
    assert.ok(dom.some(row => row.data.operation === 'Element.innerHTML'));
    assert.ok(report.events.some(row => row.stage === 'message_slot_write' && row.data.writerLocated));
    assert.ok(report.events.some(row => row.stage === 'field_write' && row.data.after.number === 6000));
    assert.ok(report.events.some(row => row.stage === 'console_report' && row.data.errorTrace.length));
    assert.ok(report.generationTrace.events.some(row => row.stage === 'generation_entry'
        && row.data.nativeEntryLocated && row.data.writeTrace.some(frame => frame.script === '/scripts/extensions/third-party/probe/index.js')));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|127\.0\.0\.1|http:/);
    assert.equal(await page.evaluate(() => {
        tracker.stop();
        return originals.textContent.set === Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set
            && originals.timer === setTimeout && originals.define === Object.defineProperty && originals.splice === Array.prototype.splice
            && !Object.getOwnPropertyDescriptor(raw.chat, '0').get;
    }), true);
});
