import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const index = fs.readFileSync(new URL('index.js', root), 'utf8');
const moduleSource = fs.readFileSync(new URL('scene-detector.js', root), 'utf8');
const { scoreScene } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const inline = vm.runInNewContext(index.split('// BEGIN LOCAL SCENE DETECTOR\n')[1].split('// END LOCAL SCENE DETECTOR')[0] + '\nscoreScene;');
const plain = x => JSON.parse(JSON.stringify(x));
const ordinary = [
    '샤워를 하며 비누로 가슴을 문지르고 바지를 내렸다.',
    '그녀는 목욕을 하며 가슴을 비볐다.',
    '샤워 중이었다. 손으로 유두 주변을 문질렀다.',
    '그는 비누를 묻혀 성기를 문지르고 헹궜다.',
    '그는 수건으로 가슴의 물기를 닦았다.',
    'She washed her nipples with her hand, rubbing soap over them.',
    'She stepped into the shower. Her hands rubbed her nipples.',
    'He washed himself in the bath. His hand rubbed his genitals.',
    'He rubbed his erection with soap in the shower.',
    'She rinsed the soap off her breasts and dried herself with a towel.',
    'She whimpered in pain. She moaned from a bruise.',
    '그녀는 아픈 가슴을 문질렀다.',
    'The doctor inserted a catheter during the medical examination.',
    'He did not lick her nipples.',
    '그는 그녀의 유두를 핥지 않았다.',
    '그녀는 옷을 벗겨 갈아입었다. 바지를 내리고 팬티를 내렸다.',
    'She explained what an orgasm was.',
];
for (const text of ordinary) test(`ordinary/denied: ${text}`, () => {
    assert.equal(scoreScene(text).score, 0);
    assert.deepEqual(plain(inline(text)), scoreScene(text));
});
const active = [
    'He licked her nipples.',
    '그는 그녀의 유두를 핥았다.',
    'She showered. He licked her nipples.',
    '목욕 중이었다. 그는 그녀의 유두를 핥았다.',
    'He sucked her nipple in the shower.',
    'She washed her hair while he licked her nipples.',
    'He licked her nipples while she washed her hair.',
    'He did not stop licking her nipples.',
    'His hands rubbed her nipples.',
    'He rubbed his jeans against her hips. His penis was hard.',
    '그는 바지를 비비며 골반을 밀어붙였다. 성기가 단단하게 발기했다.',
    'He masturbated in the shower.',
    '그는 샤워 중에 자위를 했다.',
];
for (const text of active) test(`active contact: ${text}`, () => {
    assert.ok(scoreScene(text).score >= 4, JSON.stringify(scoreScene(text)));
    assert.deepEqual(plain(inline(text)), scoreScene(text));
});

test('state metadata is not evidence, including incomplete tags', () => {
    for (const ending of ['</scene_state>', '']) {
        assert.equal(scoreScene('She showered. <scene_state>{"heat":9,"acts":["lick nipples"]}' + ending).score, 0);
    }
});
test('bath-only classification does not suppress separate actual contact', () => {
    assert.equal(scoreScene('She showered.').routineOnly, true);
    assert.equal(scoreScene('She showered. He licked her nipples.').routineOnly, false);
});
test('custom keywords do not turn washing anatomy into sex', () => {
    assert.equal(scoreScene('She washed her breasts with soap.', 'breasts,soap').score, 0);
    assert.equal(scoreScene('Their private signal was velvet.', 'velvet').score, 3);
});
test('nonsexual pain is excluded but other vocal signals keep their original score', () => {
    assert.equal(scoreScene('He licked her nipples.\n\nShe whimpered in pain. She moaned.').score, 7);
});

function runtime({mode='stealth', sensitivity='normal', armed=false, force=false, autoRefine=false, chat=[]}={}) {
    const foreign = { preset:[{identifier:'A'}, {identifier:'B'}], prompt:{text:'foreign'}, settings:{flag:true} };
    const savedForeign = JSON.stringify(foreign);
    const context = {
        chat, chatMetadata:{ttottoNsfw:{chatSchemaVersion:1,enabled:true,autoArmed:armed,forceArmed:force}},
        extensionSettings:{'ttotto-nsfw':{settingsSchemaVersion:3, enabled:true, adultConfirmed:true, armMode:mode, stealthSensitivity:sensitivity, autoRefine, slowBurnEnabled:false}},
        setExtensionPrompt(){}, saveMetadataDebounced(){}, saveSettingsDebounced(){}, saveChat(){}, foreign,
    };
    let calls=0;
    const env = { SillyTavern:{getContext:()=>context}, URL, console:{log(){},warn(){},error(){},debug(){}}, structuredClone,
        toastr:{info(){},warning(){},success(){},error(){}}, setTimeout:()=>{calls++;return 1;}, clearTimeout(){}, AbortController,
        document:{getElementById:()=>null}, window:{}, };
    vm.createContext(env);
    const script = index.slice(0,index.indexOf('const bootContext = getContext();'))
        .replaceAll('export function ', 'function ').replace('import.meta.url', "'file:///extension/index.js'");
    vm.runInContext(script + '\nglobalThis.testApi={getSettings,getChatMeta,maybeStealthArm,maybeStealthRelease,stealthWindowDetail,handleIncomingMessage,prepareSceneInjection,isFullyArmed,beginSceneGeneration,finishSceneGeneration};',env);
    const api=env.testApi;
    api.getSettings(); api.getChatMeta();
    return {api, context, env, meta:context.chatMetadata.ttottoNsfw, noForeignChanges:()=>assert.equal(JSON.stringify(foreign),savedForeign), noCalls:()=>assert.equal(calls,0), get scheduled(){return calls;}};
}
const message = (mes,is_user=false)=>({mes,is_user});
for (const mode of ['stealth','auto']) for (const sensitivity of ['high','normal','low']) {
    test(`bath remains inactive: ${mode}/${sensitivity}`,()=>{
        const r=runtime({mode,sensitivity,chat:[message('샤워를 하며 비누로 가슴을 문지르고 바지를 내렸다.')]});
        assert.equal(r.api.maybeStealthArm(),false);
        assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
        assert.equal(r.meta.autoArmed,false);
        r.noForeignChanges();r.noCalls();
    });
}
test('new routine user message does not inherit previous sexual score',()=>{
    const r=runtime({chat:[message('He licked her nipples.'), message('I am washing with soap in the shower.',true)]});
    assert.equal(r.api.stealthWindowDetail().score,0);
    assert.equal(r.api.maybeStealthArm(),false);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
});
for (const mode of ['stealth','auto']) test(`high model heat cannot activate bath: ${mode}`,()=>{
    const body='She washed her nipples with her hand, rubbing soap over them.';
    const r=runtime({mode,chat:[message(body+'<scene_state>{"heat":9}</scene_state>')]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,false);
    assert.equal(r.context.chat[0].mes,body); // existing state harvesting only
    assert.equal(r.context.chat[0].extra.ttottoNsfw.swipes['0'].state.heat,9); // no falsified report
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    r.noCalls();r.noForeignChanges();
});
test('bath transition releases local auto activation despite high previous report',()=>{
    const r=runtime({armed:true,chat:[message('He licked her nipples.<scene_state>{"heat":9}</scene_state>'),message('I showered with soap.',true)]});
    assert.equal(r.api.maybeStealthRelease(),true);
    assert.equal(r.meta.autoArmed,false);
    assert.equal(r.meta.sfwImmediateHandoff,true);
    assert.equal(r.meta.bridgePending,false);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
});
test('high heat in a new ordinary bath reply does not keep stale activation',()=>{
    const r=runtime({armed:true,chat:[message('He licked her nipples.'),message('She washed with soap in the shower.<scene_state>{"heat":8}</scene_state>')]});
    r.api.handleIncomingMessage(1);
    assert.equal(r.meta.autoArmed,false);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
});
test('real contact in a bath still arms and low reported heat does not cancel it',()=>{
    const r=runtime({chat:[message('She showered. He licked her nipples.<scene_state>{"heat":0}</scene_state>')]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,true);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),true);
});
test('manual mode and force activation remain intentional overrides',()=>{
    for (const options of [{mode:'manual'}, {armed:true,force:true}]) {
        const r=runtime({...options,chat:[message('She showered with soap.')]});
        assert.equal(r.api.maybeStealthRelease(),false);
        assert.equal(r.env.ttottoNsfwSceneBridge.sync(),true);
    }
});
test('slow burn no-conclusion lock remains user controlled',()=>{
    const r=runtime({armed:true,chat:[message('She showered with soap.')]});
    r.context.extensionSettings['ttotto-nsfw'].slowBurnEnabled=true;
    r.meta.slowBurnSessionActive=true;
    r.meta.slowBurnStageOverride=1;
    r.meta.slowBurnLocked=true;
    assert.equal(r.api.maybeStealthRelease(),false);
    assert.equal(r.meta.slowBurnRecoveryPending,true);
    assert.equal(r.meta.autoArmed,true);
});
test('different selected swipes are evaluated from their current body',()=>{
    const r=runtime({chat:[message('He licked her nipples.')]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,true);
    r.context.chat[0].mes='She washed with soap in the shower.';
    r.context.chat[0].swipe_id=1;
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,false);
});
test('unrelated ordinary scenes still honor two-message cold streak',()=>{
    const r=runtime({armed:true,chat:[message('They drank tea.'),message('She opened a book.',true)]});
    assert.equal(r.api.maybeStealthRelease(),true);
});
test('thresholds, UI, version and heat instructions agree',()=>{
    assert.match(index,/high: 3, normal: 4, low: 7/);
    assert.match(index,/Ordinary bathing, showering/);
    assert.equal(JSON.parse(fs.readFileSync(new URL('manifest.json',root))).version,'0.13.26');
    assert.match(fs.readFileSync(new URL('settings.html',root),'utf8'),/민감 3점 · 보통 4점 · 둔감 7점/);
});

for (const mode of ['stealth','auto']) test(`bath does not schedule enabled auxiliary analysis: ${mode}`,()=>{
    const r=runtime({mode,autoRefine:true,chat:[message('She washed her nipples with her hand, rubbing soap over them.<scene_state>{"heat":9}</scene_state>')]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    r.noCalls();
});
for (const first of ['sync','incoming']) test(`handoff order ${first} does not rearm a bath`,()=>{
    const r=runtime({armed:true,chat:[message('He licked her nipples.<scene_state>{"heat":9}</scene_state>'),message('She washed with soap in the shower.<scene_state>{"heat":9}</scene_state>')]});
    if(first==='sync') r.env.ttottoNsfwSceneBridge.sync();
    r.api.handleIncomingMessage(1);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    assert.equal(r.meta.autoArmed,false);
    r.noForeignChanges();
});
test('low sensitivity retains its two-strong-message threshold',()=>{
    const r=runtime({sensitivity:'low',chat:[message('He licked her nipples.')]});
    assert.equal(r.api.maybeStealthArm(),false);
    r.context.chat.push(message('He licked her nipples.',true));
    assert.equal(r.api.maybeStealthArm(),true);
});
test('score calculation never changes source body, swipes or settings',()=>{
    const r=runtime({chat:[{...message('She washed with soap in the shower.'),swipes:['She washed with soap in the shower.'],extra:{foreign:'keep'}}]});
    const before=JSON.stringify({chat:r.context.chat,settings:r.context.extensionSettings});
    for (let i=0;i<100;i++) r.api.stealthWindowDetail();
    assert.equal(JSON.stringify({chat:r.context.chat,settings:r.context.extensionSettings}),before);
    r.noForeignChanges();
});

test('module and actual runtime detector are identical',()=>{
    const actual=index.split('const scoreScene = (() => {\n')[1].split('\nreturn scoreScene;')[0];
    assert.equal(actual,moduleSource.replace('export function scoreScene(', 'function scoreScene(',1));
});
test('later intentional custom keyword is not hidden by an earlier washing mention',()=>{
    assert.equal(scoreScene('She washed the velvet with soap. Their private signal was velvet.', 'velvet').score,3);
});

test('kissing plus moaning reaches the default threshold without explicit acts',()=>{
    const text='She kissed deeply. She moaned.';
    assert.equal(scoreScene(text).score,4);
    assert.deepEqual(plain(inline(text)),scoreScene(text));
    const r=runtime({chat:[message(text)]});
    assert.equal(r.api.maybeStealthArm(),true);
});
test('romantic signals accumulate across the two-message window',()=>{
    const r=runtime({chat:[message('She kissed deeply.'),message('She moaned.',true)]});
    assert.equal(r.api.stealthWindowDetail().score,4);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),true);
});
test('repeated Korean vocal signals retain their former scores',()=>{
    assert.equal(scoreScene('하앙. 흐응. 아앙.').score,9);
});
test('unclothing without a washing/changing context retains its former score',()=>{
    assert.equal(scoreScene('그는 바지를 내렸다. 옷을 벗겨 내렸다.').score,2);
});

test('changing clothes does not turn nearby undressing into sex',()=>{
    assert.equal(scoreScene('She changed her clothes. She moaned while removing a tight shirt.').score,0);
    assert.equal(scoreScene('She changed her clothes.').routineOnly,true);
});
test('changing a decision is not a nonsexual-care filter',()=>{
    assert.equal(scoreScene('She changed her mind and kissed deeply. She moaned.').score,4);
});

test('kissing plus moaning in a bath remains eligible',()=>{
    for(const text of ['She showered. She kissed him deeply. She moaned.', '목욕 중이었다. 키스가 깊어졌다. 하앙.']) {
        assert.equal(scoreScene(text).score,4);
        assert.equal(scoreScene(text).routineOnly,false);
        assert.deepEqual(plain(inline(text)),scoreScene(text));
        const r=runtime({chat:[message(text)]});
        assert.equal(r.api.maybeStealthArm(),true);
    }
});
test('washing plus vocal sounds without intimacy remains excluded',()=>{
    assert.equal(scoreScene('She showered. She moaned under the warm water.').score,0);
    assert.equal(scoreScene('샤워 중이었다. 흐응. 하앙.').score,0);
});
test('denied kissing does not legitimize ordinary bath sounds',()=>{
    assert.equal(scoreScene('She showered. She did not kiss him deeply. She moaned under warm water.').score,0);
});

// Public regressions use minimal everyday examples rather than private chat transcripts.
const everydayKorean = [
    '폰만 보지 말고 빨리 내려서 트렁크 문짝이나 좀 열어!',
    '폰만 보지말고 빨리 내려.',
    '그녀를 보지도 않고 팔을 문질렀다.',
    '먹어 보지 못한 음식을 입술을 핥으며 살폈다.',
    '그는 자지 않고 손을 문질렀다.',
    '그는 바지를 입은 채 자지 않고 버텼고, 바지 주름은 팽팽했다.',
    '그는 자지러지게 웃으며 손을 문질렀다.',
    '가슴이 철렁해서 빨리 일어났다.',
    '가슴 앞에 빨간 리본을 달았다.',
    '가슴 앞에 빨래 바구니를 들었다.',
    '가슴에 명찰을 단 주무관이 서 있었다.',
    '가슴에 명찰을 단 문지기가 서 있었다.',
    '가슴에 달린 이름표를 빤히 봤다.',
    '3리터짜리 액체 세제에 치약 묶음, 변기 솔까지 쑤셔 넣어 팽팽하게 부풀어 오른 종이 가방 손잡이를 그가 한 손으로 낚아채듯 가볍게 들어 올렸다.',
    '짐을 가방에 쑤셔 넣었다.',
    '가슴 앞에서 봉투를 들고 물건을 쑤셔 넣었다.',
    '카드를 단말기에 삽입했다.',
    '벽에 못을 박아 넣었다.',
    '그는 시간을 달라고 사정했다.',
    '그녀의 가슴 앞을 팔로 막아 급정거에 대비했다.',
];
for (const text of everydayKorean) test(`everyday Korean is not a sexual signal: ${text}`,()=>{
    assert.equal(scoreScene(text).score,0,JSON.stringify(scoreScene(text)));
    assert.deepEqual(plain(inline(text)),scoreScene(text));
});
const validKoreanContact = [
    '유두를 빨았다.',
    '유두를 빠는 행동.',
    '가슴을 주무르고 있었다.',
    '성기를 문질렀다.',
    '보지를 애무했다.',
    '자지를 애무했다.',
    '질 안에 삽입했다.',
    '성기를 밀어 넣었다.',
    '성기를 쑤셔 넣었다.',
    '애무하며 삽입했다.',
    '유두만을 빨았다.',
    '성기에는 애무를 이어갔다.',
];
for (const text of validKoreanContact) test(`grounded Korean contact still detected: ${text}`,()=>{
    assert.ok(scoreScene(text).score>=4,JSON.stringify(scoreScene(text)));
    assert.deepEqual(plain(inline(text)),scoreScene(text));
});
test('ordinary objects do not cancel a separate real signal',()=>{
    assert.equal(scoreScene('짐을 가방에 쑤셔 넣었다. 키스가 깊어졌다. 흐응.').score,4);
    assert.ok(scoreScene('폰만 보지 말고 빨리 내려. 유두를 빨았다.').score>=4);
});
for (const mode of ['stealth','auto']) for (const sensitivity of ['high','normal','low']) {
    test(`ordinary Korean remains inactive; only enabled monitor repair may be scheduled: ${mode}/${sensitivity}`,()=>{
        const r=runtime({mode,sensitivity,autoRefine:true,chat:[
            message(everydayKorean[0],true), message(everydayKorean[13]),
        ]});
        assert.equal(r.api.stealthWindowDetail().score,0);
        r.api.handleIncomingMessage(1);
        assert.equal(r.meta.autoArmed,false);
        assert.equal(r.api.isFullyArmed(),false);
        assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
        if (mode === 'auto') assert.equal(r.scheduled, 1);
        else r.noCalls();
        r.noForeignChanges();
    });
}
test('Korean kissing and vocal signals still accumulate across messages',()=>{
    const r=runtime({chat:[message('키스가 깊어졌다.'),message('흐응.',true)]});
    assert.equal(r.api.stealthWindowDetail().score,4);
    assert.equal(r.api.maybeStealthArm(),true);
});

for (let heat=0;heat<=10;heat++) test(`temperature mode starts at six: reported heat ${heat}`,()=>{
    const r=runtime({mode:'auto', chat:[message(`Current scene.<scene_state>{"heat":${heat}}</scene_state>`)]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,heat>=6);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),heat>=6);
    if(heat>=6) assert.equal(r.meta.armSource,'heat');
    r.noCalls();r.noForeignChanges();
});
for(const sensitivity of ['high','normal','low']) test(`local score cannot bypass temperature mode: ${sensitivity}`,()=>{
    const r=runtime({mode:'auto',sensitivity,autoRefine:true,chat:[
        message('She kissed deeply. She moaned.',true),
        message('She kissed deeply. She moaned.<scene_state>{"heat":4}</scene_state>'),
    ]});
    assert.ok(r.api.stealthWindowDetail().score>=7);
    assert.equal(r.api.maybeStealthArm(),false);
    r.api.handleIncomingMessage(1);
    assert.equal(r.api.isFullyArmed(),false);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    r.noCalls();r.noForeignChanges();
});
test('missing AI temperature does not fall back to local activation in auto mode',()=>{
    const r=runtime({mode:'auto',autoRefine:true,chat:[message('She kissed deeply. She moaned.')]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.api.isFullyArmed(),false);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    assert.equal(r.scheduled,1); // Enabled monitoring repair, not local activation.
});
test('ordinary conversation with low heat and custom matches stays in monitor mode',()=>{
    const r=runtime({mode:'auto',autoRefine:true,chat:[message('질투하며 문자를 보냈다. 어깨를 짚어 길을 비켜줬다.<scene_state>{"heat":2}</scene_state>')]});
    r.context.extensionSettings['ttotto-nsfw'].stealthKeywords='질투,문자,어깨';
    r.api.handleIncomingMessage(0);
    assert.equal(r.api.isFullyArmed(),false);
    r.noCalls();r.noForeignChanges();
});
test('low reported heat releases auto mode despite remaining local signals',()=>{
    const r=runtime({mode:'auto',armed:true,chat:[message('She kissed deeply. She moaned.<scene_state>{"heat":2}</scene_state>')]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,false);
    assert.equal(r.api.isFullyArmed(),false);
    // A low temperature hands ownership back in this same reply.
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    assert.equal(r.meta.autoArmed,false);
});
test('owner bridge consumes a completed heat report before a companion reads ownership',()=>{
    const r=runtime({mode:'auto',chat:[message('Current reply.<scene_state>{"heat":6}</scene_state>')]});
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),true);
    assert.equal(r.api.isFullyArmed(),true);
    assert.equal(r.context.chat[0].extra.ttottoNsfw.swipes['0'].state.heat,6);
    r.noForeignChanges();
});
test('same-response release leaves the companion SFW report intact',()=>{
    const tag='<sfw_scene>{"location":"Home","intensity":1}</sfw_scene>';
    const r=runtime({mode:'auto',armed:true,chat:[message('We returned home.<scene_state>{"heat":0}</scene_state>'+tag)]});
    r.api.handleIncomingMessage(0);
    assert.equal(r.api.isFullyArmed(),false);
    assert.ok(r.context.chat[0].mes.includes(tag));
    assert.ok(!r.context.chat[0].mes.includes('<scene_state>'));
    r.noForeignChanges();
});
test('owner bridge does not consume a report during main generation',()=>{
    const r=runtime({mode:'auto',chat:[message('Current reply.<scene_state>{"heat":6}</scene_state>')]});
    r.api.beginSceneGeneration('normal',true);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    assert.equal(r.api.isFullyArmed(),false);
    assert.ok(r.context.chat[0].mes.includes('<scene_state>'));
    r.noCalls();
});
test('low temperature releases an unfinished slow-burn session in auto mode',()=>{
    const r=runtime({mode:'auto',armed:true,chat:[message('They spoke quietly.<scene_state>{"heat":0}</scene_state>')]});
    r.context.extensionSettings['ttotto-nsfw'].slowBurnEnabled=true;
    r.meta.slowBurnSessionActive=true;
    r.meta.slowBurnStageOverride=1;
    r.meta.slowBurnLocked=true;
    r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,false);
    assert.equal(r.meta.slowBurnSessionActive,false);
    assert.equal(r.meta.slowBurnRecoveryPending,false);
    assert.equal(r.meta.bridgePending,false);
    assert.equal(r.meta.sfwImmediateHandoff,true);
    assert.equal(r.meta.slowBurnLocked,true); // Keep the user's setting for future sessions.
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),false);
    r.noCalls();
});

for (const change of ['none','body','swipe','new-reply','high','missing','manual','forced','generating']) {
    test(`stored low report reconciliation respects freshness and overrides: ${change}`,()=>{
        const heat = change === 'high' ? 7 : 0;
        const reply=message(`They discussed the next morning.<scene_state>{"heat":${heat}}</scene_state>`);
        const r=runtime({mode:'auto',chat:[reply]});
        r.api.handleIncomingMessage(0); // Save and strip the report.
        r.meta.autoArmed=true; r.meta.armSource='heat'; r.meta.bridgePending=true;
        r.meta.slowBurnSessionActive=true; r.meta.slowBurnRecoveryPending=true;
        r.context.extensionSettings['ttotto-nsfw'].slowBurnEnabled=true;
        if(change==='body') reply.mes+=' A correction.';
        if(change==='swipe') reply.swipe_id=1;
        if(change==='new-reply') r.context.chat.push(message('A new unreported reply.'));
        if(change==='missing') delete reply.extra;
        if(change==='manual') r.context.extensionSettings['ttotto-nsfw'].armMode='manual';
        if(change==='forced') r.meta.forceArmed=true;
        if(change==='generating') r.api.beginSceneGeneration('normal',true);
        assert.equal(r.env.ttottoNsfwSceneBridge.sync(),change!=='none');
        assert.equal(r.meta.autoArmed,change!=='none');
        if(change==='none') {
            assert.equal(r.meta.bridgePending,false);
            assert.equal(r.meta.slowBurnSessionActive,false);
        }
        r.noCalls();
    });
}

for (const heat of [7, 8]) test(`auto keeps ownership after a heat-${heat} reply is edited`,()=>{
    const body='The conversation continued with indirect wording.';
    const r=runtime({mode:'auto',chat:[message('Continue.',true),message(body+`<scene_state>{"heat":${heat}}</scene_state>`)]});
    r.api.handleIncomingMessage(1);
    assert.equal(r.meta.autoArmed,true);
    r.context.chat[1].mes=body+' A sentence was edited.';
    r.api.handleIncomingMessage(1);
    assert.equal(r.meta.autoArmed,true,'missing valid heat is not evidence of a scene ending');
    assert.equal(r.meta.sfwImmediateHandoff,false);
    assert.equal(r.env.ttottoNsfwSceneBridge.sync(),true);
    r.noCalls();
    // A subsequent matching low-temperature report still releases immediately.
    r.context.chat.push(message('Continue.',true),message('The conversation continued.<scene_state>{"heat":1}</scene_state>'));
    r.api.handleIncomingMessage(3);
    assert.equal(r.meta.autoArmed,false);
    assert.equal(r.meta.sfwImmediateHandoff,true);
});

test('auto does not infer a scene ending from an absent report and absent keywords',()=>{
    const r=runtime({mode:'auto',armed:true,chat:[message('Continue.',true),message('Indirect wording without a state report.')]});
    assert.equal(r.api.maybeStealthRelease(),false);
    assert.equal(r.meta.autoArmed,true);
    r.noCalls();
});

test('auto still permits an explicit routine transition without a new report',()=>{
    const r=runtime({mode:'auto',armed:true,chat:[message('An earlier reply.'),message('I showered with soap.',true)]});
    assert.equal(r.api.maybeStealthRelease(),true);
    assert.equal(r.meta.sfwImmediateHandoff,true);
});
