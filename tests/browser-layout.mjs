// npm run test:layout (Playwright and a local Chromium executable required).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require(require.resolve('playwright', { paths: [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean) }));
const root = new URL('../', import.meta.url);
const fixture = async missing => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${missing ? '' : '<link rel="stylesheet" href="/style.css">'}
<style>
${process.env.LAYOUT_TEST_FONT ? '@font-face { font-family:FixtureKorean; src:url(/fixture-font.woff2); }' : ''}
:root { --SmartThemeBodyColor:#222; --SmartThemeBlurTintColor:#fff; --SmartThemeBorderColor:#888; }
body { font:16px FixtureKorean,sans-serif; } button,input,select { font:inherit; } .menu_button { padding:5px 8px; margin:0; }
/* Emulate a theme loaded after extension CSS, not the unidentified reporter theme. */
dialog div { display:block !important; }
.menu_button { width:20px !important; white-space:normal !important; word-break:break-all !important; }
.ttu-tabs,.tsf-tabs,.tns-tabs { flex-direction:column !important; }
</style><button id="outside" class="menu_button">outside</button><div id="extensionsMenu"></div>
${await readFile(new URL('modes/sfw/settings.html', root), 'utf8')}
${await readFile(new URL('modes/nsfw/settings.html', root), 'utf8')}
<script type="module">
import { createUi } from '/ui.js';
const runtime={owner:()=> 'sfw',chatReady:()=>true,settings:()=>({}),diagnosticsEnabled:()=>false,core:{commonSummary:()=>null}};
window.ui=createUi(()=>runtime);window.ready=true;
</script>`;

test('narrow popup, theme collisions, hidden panels and missing stylesheet recovery', async t => {
    let failStyle = false;
    const server = createServer(async (req, res) => {
        const path = new URL(req.url, 'http://local').pathname;
        try {
            if (path === '/') { res.setHeader('Content-Type','text/html'); res.end(await fixture(req.url.includes('missing'))); return; }
            if (path === '/fixture-font.woff2' && process.env.LAYOUT_TEST_FONT) { res.setHeader('Content-Type','font/woff2'); res.end(await readFile(process.env.LAYOUT_TEST_FONT)); return; }
            if (path === '/style.css' && failStyle) { res.writeHead(503); res.end(); return; }
            if (!['/ui.js','/style.css','/modes/sfw/style.css','/modes/nsfw/style.css'].includes(path)) { res.writeHead(404);res.end();return; }
            res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'application/javascript');
            res.end(await readFile(new URL(path.slice(1),root)));
        } catch { res.writeHead(500);res.end(); }
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const browser=await playwright.chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    t.after(()=>browser.close());
    const page=await browser.newPage();
    const url=`http://127.0.0.1:${server.address().port}/`;
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for (const width of [320,375,390,480,768,1280]) {
        await page.setViewportSize({width,height:844});await page.goto(url);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);
        for (const kind of ['sfw','nsfw']) {
            await page.evaluate(k=>ui.open(k),kind);
            const state=await page.evaluate(k=>{
                const prefix=k==='sfw'?'tsf':'tns';
                const box=document.querySelector('.ttu-dialog').getBoundingClientRect();
                const tabs=[...document.querySelectorAll(`.ttu-tabs button,#${prefix}-tab-state,#${prefix}-tab-settings`)];
                const body=document.getElementById('ttu-body');
                return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,overflow:body.scrollWidth>body.clientWidth+1,
                    buttons:tabs.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),
                    hidden:getComputedStyle(document.getElementById(`${prefix}-tab-diagnostics`)).display,
                    other:getComputedStyle(document.getElementById(`ttotto-${k==='sfw'?'nsfw':'sfw'}-settings`)).display,
                    outside:getComputedStyle(document.getElementById('outside')).width,
                    bg:getComputedStyle(document.querySelector('.ttu-dialog')).backgroundColor,
                    fallback:!!document.getElementById('ttu-layout-fallback')};
            },kind);
            assert.ok(state.left>=7 && state.right<=width-7 && state.top>=7 && state.bottom<=837,JSON.stringify({width,kind,state}));
            assert.equal(state.overflow,false,JSON.stringify({width,kind,state}));
            assert.ok(state.buttons.every(b=>b.width>50&&b.height<60),JSON.stringify({width,kind,state}));
            assert.equal(state.hidden,'none');assert.equal(state.other,'none');assert.equal(state.outside,'20px');
            assert.equal(state.bg,'rgb(255, 255, 255)');assert.equal(state.fallback,false);
            if(width===320 && process.env.LAYOUT_SCREENSHOT_PREFIX) await page.screenshot({path:`${process.env.LAYOUT_SCREENSHOT_PREFIX}-${kind}.png`});
        }
        await page.keyboard.press('Escape');assert.equal(await page.locator('#ttu-overlay').isVisible(),false);
    }
    // Larger text and a long diagnostic action must wrap without horizontal scrolling.
    await page.setViewportSize({width:320,height:640});
    await page.evaluate(()=>{document.body.style.fontSize='24px';ui.open('sfw');document.querySelector('.ttu-common-menu').open=true;});
    assert.equal(await page.locator('#ttu-body').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
    const action=await page.locator('.ttu-options button').first().boundingBox();
    assert.ok(action.width>100 && action.width<300 && action.height<120,JSON.stringify(action));
    // Stylesheet omitted by host; first fallback request fails, next opening retries.
    await page.goto(url+'?missing');await page.waitForFunction(()=>window.ready);failStyle=true;
    await page.evaluate(()=>ui.open());
    await page.waitForFunction(()=>!document.getElementById('ttu-layout-fallback'));
    failStyle=false;await page.evaluate(()=>{ui.close();ui.open();});
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('ttu-overlay')).getPropertyValue('--ttu-layout-version').trim()==='1');
    await page.evaluate(()=>{ui.close();ui.open();ui.open();});
    assert.equal(await page.locator('#ttu-layout-fallback').count(),1);
    assert.equal(await page.locator('.ttu-header').evaluate(e=>getComputedStyle(e).display),'flex');
    assert.deepEqual(errors,[]);
});
