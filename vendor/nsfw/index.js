// 🔞또또NSFW — NSFW 장면 연속성 추적 + 직전 전개 반복 금지 + 진도 강제
// 또또(ttotto)의 자매 확장. ST API는 getContext(), 로컬 감지기는 이 파일에 포함해 별도 JS 파일을 요구하지 않는다.
// BEGIN LOCAL SCENE DETECTOR
const scoreScene = (() => {
// NSFW 로컬 감지기. API나 프롬프트를 호출하지 않는다.
// 신체 단어 하나가 아니라 가까운 행동 표현과 함께 있을 때 강한 신호로 센다.
const EN_BODY = String.raw`\b(?:breasts?|nipples?|clit(?:oris)?|pussy|cock|dick|penis|vulva|vagina|genitals?|outer\s+lips|bundle\s+of\s+nerves)\b`;
const EN_ORAL = String.raw`\b(?:lick(?:s|ed|ing)?|suck(?:s|ed|ing)?|lap(?:s|ped|ping)?|suction)\b`;
const EN_ORAL_MOTION = /\b(?:swirl(?:s|ed|ing)?|press(?:es|ed|ing)?|drag(?:s|ged|ging)?|circl(?:e|es|ed|ing)|flick(?:s|ed|ing)?|lick(?:s|ed|ing)?|suck(?:s|ed|ing)?|lap(?:s|ped|ping)?)\b/i;
const EN_HAND = String.raw`\b(?:finger(?:s|ed|ing)?|digits?|hands?)\b`;
const EN_INTIMATE = String.raw`\b(?:wetness|pussy|vagina|canal|clit(?:oris)?|nipples?|genitals?)\b`;
const EN_MOTION = /\b(?:sink(?:s|ing)?|sank|buried|insert(?:s|ed|ing)?|pump(?:s|ed|ing)?|stretch(?:es|ed|ing)?|rub(?:s|bed|bing)?|strok(?:e|es|ed|ing)|penetrat(?:e|es|ed|ing)|fuck(?:s|ed|ing)?)\b/i;
// 한국어에는 영문식 \b 경계가 통하지 않는다. 명사와 조사 경계를 확인하고
// '보지 말고/자지 않고' 같은 동사, '자지러지다/성기게' 같은 다른 단어를 제외한다.
function koreanNoun(words) {
    return String.raw`(?<![가-힣A-Za-z0-9_])(?:${words})(?=$|[^가-힣A-Za-z0-9_]|(?:을|를|이|가|은|는|에|엔|에서|에게|의|도|만|로|으로|와|과|랑|부터|까지|처럼|보다|조차|마저|마다){1,3}(?=$|[^가-힣A-Za-z0-9_]))`;
}
const KO_HOMOGRAPHS = String.raw`(?:보지|자지)(?!(?:는|도|만)?\s*(?:말|않|못|마(?:라|요)?(?:$|[\s.!?])))`;
const KO_BODY = koreanNoun(String.raw`가슴|유두|젖꼭지|성기|클리토리스|음핵|음순|${KO_HOMOGRAPHS}|애액|젖은\s*(?:구멍|속살)`);
// '빨리/빨간/빨래'를 빨다의 활용형으로 세지 않는다.
const KO_TOUCH = String.raw`(?:핥|빨(?=[아았고며면던듯다지]|$|[^가-힣])|빤(?=[다지듯]|$|[^가-힣])|빠는|애무|주무(?=[르른를름])|움켜|문지(?=[르른를름])|문질|쑤셔|쑤시|쑤셔대|비벼|비비|비볐|삽입|밀어\s*넣|박아\s*넣|잠겨|파묻|마디.{0,20}잠)`;
const KO_AMBIGUOUS_ACTION = /삽입|박아\s*넣|쑤셔|쑤시|밀어\s*넣|잠겨|파묻|사정/;
const KO_INTIMATE_CONTEXT = new RegExp(koreanNoun(String.raw`성기|클리토리스|음핵|음순|${KO_HOMOGRAPHS}|애액|질|항문|정액|발기|젖은\s*(?:구멍|속살)`)
    + String.raw`|성적\s*(?:쾌감|자극|접촉|흥분)|애무|자위|성교|오르가즘`, 'i');
const NEAR = String.raw`[^.!?。！？\n]{0,180}?`;
function nearby(left, right, span = NEAR) {
    return new RegExp(`(?:${left})${span}(?:${right})|(?:${right})${span}(?:${left})`, 'gi');
}

// 의복 마찰은 운동/세탁에도 등장한다. 같은 문단의 구체적인 성적 신체 반응이 있어야 인정한다.
const EN_GENITAL_RESPONSE = nearby(String.raw`\b(?:cock|dick|penis|erection)\b`,
    String.raw`\b(?:hard|stiff|rigid|erect|throb(?:s|bed|bing)?|aching|aroused)\b`);
const KO_GENITAL_RESPONSE = nearby(koreanNoun(String.raw`성기|자지(?!(?:는|도|만)?\s*(?:말|않|못))|발기`),
    String.raw`(?:발기|단단|팽팽|굳|빳빳|뻣뻣|욱신|발딱|꼿꼿)`, String.raw`[^.!?。！？\n]{0,80}?`);

// 노출/젖은 몸/탈의는 위생 장면에서도 흔하다. 신체+동사의 일치만으로
// 성적 행위라고 단정하지 않고, 일치한 행동의 문장 맥락을 확인한다.
const HYGIENE = /\b(?:shower(?:s|ed|ing)?|bath(?:s|ing)?|bathe[ds]?|wash(?:es|ed|ing)?|rins(?:e|es|ed|ing)|soap(?:y)?|shampoo(?:s|ed|ing)?|scrub(?:s|bed|bing)?|lather(?:s|ed|ing)?|towell?(?:ed|ing)?|clean(?:s|ed|ing)?|dry(?:ing)?\s+(?:off|herself|himself))\b|샤워|목욕|씻|헹[구궈]|비누|샴푸|세정|물기|때를\s*(?:밀|벗)|수건.{0,20}(?:닦|말리)/i;
const NONSEXUAL = /\b(?:pain|injur(?:y|ies|ed)|wound|bruise[ds]?|sore|fever|shiver(?:s|ed|ing)?|medical|examin(?:e|es|ed|ing)|bandage|breastfeed(?:s|ing)?|nurs(?:e|es|ed|ing)\s+(?:a|the|her)\s+baby)\b|통증|아파|아픈|부상|상처|멍든|진찰|검사|치료|수유/i;
const CLOTHES_CHANGE = /\bchang(?:e|es|ed|ing)\s+(?:(?:her|his|their)\s+)?(?:clothes|clothing|shirt|pants|underwear|outfit)\b|\bchang(?:e|es|ed|ing)\s+into\b|갈아입/i;
const SEXUAL_ACTION = /\b(?:lick(?:s|ed|ing)?|suck(?:s|ed|ing)?|fondl(?:e|es|ed|ing)|masturbat(?:e|es|ed|ing)|penetrat(?:e|es|ed|ing)|fuck(?:s|ed|ing)?|ejaculat(?:e|es|ed|ing)|orgasm(?:s|ed|ing)?|thrust(?:s|ed|ing)?)\b|핥|빨아|빨았|빨며|빨고|애무|자위|성교|사정(?:하|했|해|중)|오르가즘/i;
const SEXUAL_INTENT = /\b(?:sexually|sexual\s+(?:pleasure|stimulation|contact)|arous(?:e|ed|al)|lust(?:ful)?|masturbat(?:e|es|ed|ing)|fondl(?:e|es|ed|ing))\b|성적\s*(?:쾌감|자극|접촉|흥분)|애무|자위/i;
const NOT_AN_ACT = /\b(?:(?:did|does|do|is|was|were|will|would|could|had|has|have)\s+not|didn['’]t|doesn['’]t|don['’]t|wasn['’]t|isn['’]t|wouldn['’]t|couldn['’]t|never|without)\s+(?!(?:stop|ceas|pause|hesitat))|(?:하지|하지는|하지도|하지\s*않|핥지|빨지|문지르지|넣지|느끼지|삽입하지|사정하지).{0,12}(?:않|못)|(?:할|하려는)\s*(?:생각|계획)|\b(?:discuss(?:es|ed|ing)?|explain(?:s|ed|ing)?|definition|hypothetical)\b/i;
const ROMANTIC_KISS = /키스가\s*깊어|혀가\s*얽|\bkiss(?:es|ed|ing)?\s+(?:(?:him|her|them|me|you|each\s+other)\s+)?(?:deeply|hungrily)\b|\btongues?\s+(?:tangled|met)\b/gi;

function sentenceAt(source, start, end) {
    const before = source.slice(Math.max(0, start - 180), start).match(/[^.!?。！？\n;]*$/)[0];
    const after = source.slice(end, end + 180).match(/^[^.!?。！？\n;]*/)[0];
    return before + source.slice(start, end) + after;
}

function paragraphAt(source, start, end) {
    return source.slice(Math.max(0, start - 600), start).split(/\n\s*\n/).at(-1)
        + source.slice(start, end) + source.slice(end, end + 600).split(/\n\s*\n/)[0];
}

function hasCurrentKiss(text) {
    ROMANTIC_KISS.lastIndex = 0;
    const matches = [...text.matchAll(ROMANTIC_KISS)];
    return matches.some(match => {
        const sentence = sentenceAt(text, match.index, match.index + match[0].length);
        return !NOT_AN_ACT.test(sentence) && !NONSEXUAL.test(sentence);
    });
}


const RULES = [
    { label: '현재 명시적 행위', w: 4, re: /삽입(?:하|했|해|되|된|되는|중)|박아\s*넣|쑤셔\s*넣|사정(?:하|했|해|시키|하며|하는|하려)|오르가즘(?:에|을)\s*(?:도달|느끼)|질\s*(?:안|속)에\s*(?:넣|박)|\bmasturbat(?:e|es|ed|ing)\b|자위(?:를)?\s*(?:하|했|해|중)|\bpenetrat(?:e|es|ed|ing)\b|\bthrust(?:ed|ing|s)?\s+(?:inside|into|against)\b|\borgasm(?:s|ed|ing)\b|\bejaculat(?:e|es|ed|ing)\b|\bcame\s+(?:inside|over|on)\b|\bcoming\s+(?:inside|in\s+her|in\s+him)\b/gi },
    { label: '영어 구강 접촉', w: 4, re: nearby(EN_BODY, EN_ORAL) },
    { label: '영어 입·혀 접촉', w: 4, re: nearby(EN_BODY, String.raw`\b(?:tongue|mouth)\b`), require: EN_ORAL_MOTION },
    { label: '영어 직접 행동', w: 4, re: nearby(EN_BODY, String.raw`\b(?:fuck(?:s|ed|ing)?|thrust(?:s|ed|ing)?|insert(?:s|ed|ing)?|fondl(?:e|es|ed|ing))\b`) },
    { label: '영어 손 접촉', w: 4, re: nearby(EN_HAND, EN_INTIMATE), require: EN_MOTION },
    { label: '한국어 직접 접촉', w: 4, re: nearby(KO_BODY, KO_TOUCH, String.raw`[^.!?。！？\n]{0,80}?`) },
    { label: '영어 의복·골반 마찰과 성적 반응', w: 4,
        re: nearby(String.raw`\b(?:jeans|sweatpants|trousers|underwear|panties|boxers|crotch|groin|pelvis|hips?|lap)\b`,
            String.raw`\b(?:rub(?:s|bed|bing)?|grind(?:s|ing)?|ground|friction|press(?:es|ed|ing)?|rock(?:s|ed|ing)?)\b`),
        requireParagraph: EN_GENITAL_RESPONSE },
    { label: '한국어 의복·골반 마찰과 성적 반응', w: 4,
        re: nearby(String.raw`(?:청바지|트레이닝\s*(?:팬츠|바지)|바지|속옷|팬티|가랑이|아랫도리|사타구니|골반|치골)`,
            String.raw`(?:문질|문지|비비|비벼|마찰|밀착|눌러|누르|맞대|밀어붙)`, String.raw`[^.!?。！？\n]{0,80}?`),
        requireParagraph: KO_GENITAL_RESPONSE },
    { label: '신음 표기', w: 3, re: /하앙|흐응|아앙|흐읏|하아앙|응아|앗\s*…?\s*안|\bmoan(?:ed|ing|s)?\b|\bwhimper(?:ed|ing)?\b/gi },
    { label: '현재 탈의·밀착', w: 2, re: /(?:옷|속옷|팬티|브래지어|바지|치마)(?:을|를)?\s*(?:벗기|벗겨|내리)|\bgrind(?:s|ing)?\s+(?:against|on|into)\b|\bground\s+(?:against|on|into)\b|\bstraddl(?:e|es|ed|ing)\s+(?:her|him|them)\b/gi },
    { label: '성적 접촉 분위기', w: 1, re: /키스가\s*깊어|혀가\s*얽|목덜미에\s*입|귓불을\s*(?:물|빨|핥)|\bkiss(?:es|ed|ing)?\s+(?:(?:him|her|them|me|you|each\s+other)\s+)?(?:deeply|hungrily)\b|\btongues?\s+(?:tangled|met)\b|\bhands?\s+(?:slid|moved)\s+(?:under|between)\b/gi },
];

function scoreScene(text, customKeywords = '') {
    const source = String(text ?? '')
        .replace(/<(scene_state|sfw_scene)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(?:scene_state|sfw_scene)\b[^>]*>[\s\S]*$/gi, '')
        // 별개 행동을 한 쌍으로 연결하지 않는다. 샤워 뒤의 실제 성적 행동은 따로 검사한다.
        .replace(/\b(?:while|whereas|meanwhile|but\s+then)\b|하지만|그러나/gi, '\n');
    const hits = [];
    for (const { label, re, w, require, requireParagraph } of RULES) {
        re.lastIndex = 0;
        let match;
        let count = 0;
        while (count < 3 && (match = re.exec(source)) !== null) {
            const sentence = sentenceAt(source, match.index, re.lastIndex);
            if (NOT_AN_ACT.test(sentence)) continue;
            // '물건을 봉투에 쑤셔 넣다/카드를 삽입하다/못을 박아 넣다/사정하다'는
            // 동사만으로 성적 행위가 아니다. 그 행동의 문장 안에 별도 근거가 필요하다.
            if ((label === '현재 명시적 행위' || label === '한국어 직접 접촉')
                && KO_AMBIGUOUS_ACTION.test(match[0]) && !KO_INTIMATE_CONTEXT.test(sentence)) continue;
            if (NONSEXUAL.test(sentence) && !SEXUAL_ACTION.test(match[0])) continue;
            const paragraph = paragraphAt(source, match.index, re.lastIndex);
            const romanticContact = label === '성적 접촉 분위기' && hasCurrentKiss(match[0]);
            const romanticVoice = label === '신음 표기' && hasCurrentKiss(paragraph);
            if ((HYGIENE.test(sentence) || CLOTHES_CHANGE.test(sentence))
                && !SEXUAL_ACTION.test(match[0]) && !romanticContact && !romanticVoice) continue;
            // '샤워 중이다. 몸을 문질렀다.'처럼 위생 목적이 직전 문장에만 있어도 구분한다.
            // 실제 키스와 그에 이어진 신음은 위생 장면 안에서도 별도 신호로 인정한다.
            if ((HYGIENE.test(paragraph) || CLOTHES_CHANGE.test(paragraph))
                && !SEXUAL_ACTION.test(match[0]) && !SEXUAL_INTENT.test(sentence)
                && !romanticContact && !romanticVoice) continue;
            // 동사가 신체/도구보다 먼저 나오는 어순도 같은 문장 안에서 확인한다.
            if (require) {
                const before = source.slice(Math.max(0, match.index - 180), match.index).match(/[^.!?。！？\n]*$/)[0];
                const after = source.slice(re.lastIndex, re.lastIndex + 180).match(/^[^.!?。！？\n]*/)[0];
                if (!require.test(before + match[0] + after)) continue;
            }
            if (requireParagraph) {
                requireParagraph.lastIndex = 0;
                if (!requireParagraph.test(paragraphAt(source, match.index, re.lastIndex))) continue;
            }
            hits.push({ label, text: match[0], w });
            count++;
        }
    }
    const lower = source.toLocaleLowerCase();
    for (const keyword of String(customKeywords).split(',').map((word) => word.trim()).filter(Boolean)) {
        const needle = keyword.toLocaleLowerCase();
        for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + needle.length)) {
            const sentence = sentenceAt(source, index, index + keyword.length);
            if (!HYGIENE.test(sentence) && !CLOTHES_CHANGE.test(sentence) && !NONSEXUAL.test(sentence) && !NOT_AN_ACT.test(sentence)) {
                hits.push({ label: '커스텀', text: keyword, w: 3 });
                break;
            }
        }
    }
    const score = hits.reduce((sum, hit) => sum + hit.w, 0);
    return { score, hits, routineOnly: (HYGIENE.test(source) || CLOTHES_CHANGE.test(source)) && score === 0 };
}

return scoreScene;
})();
// END LOCAL SCENE DETECTOR
//
// 동작 개요 (하이브리드):
//  1) 매 생성마다 프롬프트에 "현재 장면 상태 + 최근 N턴 전개(반복 금지) + 상태 태그 갱신 지시"를 주입
//  2) AI 응답 끝의 <scene_state>{...}</scene_state> 태그를 파싱해 메시지 extra에 저장하고 본문에서 제거
//  3) 태그가 누락되면(또는 수동 버튼) 보조 AI 호출로 최근 대화를 분석해 상태를 보정

const MODULE_NAME = 'ttotto-nsfw';
// 설치된 폴더 이름이 무엇이든 동작하도록, 템플릿은 모듈 URL 기준으로 직접 불러온다.
const EXTENSION_BASE_URL = new URL('.', import.meta.url);
const PROMPT_KEY = 'ttotto_nsfw_continuity';
const CHAT_STATE_KEY = 'ttottoNsfw';
const MESSAGE_EXTRA_KEY = 'ttottoNsfw';
const LOG_PREFIX = '[🔞또또NSFW]';
const EXTENSION_VERSION = '0.13.26';
const CHAT_STATE_SCHEMA_VERSION = 1;
const ALLOWED_GENERATION_TYPES = new Set(['normal', 'regenerate', 'swipe', 'continue']);
const DEVELOPER_UNLOCK_TAPS = 7;
const DEVELOPER_TAP_RESET_MS = 5000;
const DEVELOPER_PASSWORD = '130918';
// setExtensionPrompt 안정 상수: IN_CHAT = 1, SYSTEM = 0 (또또와 동일한 이유로 직접 import 회피)
const PROMPT_POSITION_IN_CHAT = 1;
const PROMPT_ROLE_SYSTEM = 0;

const STATE_TAG_REGEX = /<scene_state\b[^>]*>([\s\S]*?)<\/scene_state>/gi;
const STATE_TAG_LOOSE_REGEX = /```(?:json)?\s*<scene_state\b[^>]*>[\s\S]*?<\/scene_state>\s*```/gi;
// 모델이 상태 태그를 닫은 직후 덧붙인 단독 확인 문구만 제거한다.
// 태그 앞의 본문이나 태그 뒤에 다른 서술이 하나라도 있으면 일치하지 않는다.
const STATE_TRAILING_ACK_REGEX = /(<\/scene_state>[ \t]*(?:\r?\n[ \t]*```)?)[ \t\r\n]+(?:no\s+changes?|unchanged)[ \t]*[.!]?[ \t]*$/i;

const PACE_INSTRUCTIONS = Object.freeze({
    hold: 'Maintain the current stage of the scene. Deepen sensation and reaction without jumping ahead.',
    slow: 'Move the scene forward to its next natural beat. Advance gradually — one meaningful step per response.',
    push: 'Actively escalate. Each response must clearly progress the scene beyond where the previous one ended.',
});

// 슬로우번 단계 — 행위 자체가 아니라 장면의 서사적 진행도를 추적한다.
const SLOW_BURN_STAGES = Object.freeze([
    null,
    { en: 'Tension and atmosphere', ko: '긴장과 분위기 형성' },
    { en: 'Approach through gaze, words, and proximity', ko: '시선·말·거리 좁히기' },
    { en: 'Initial light contact', ko: '가벼운 접촉' },
    { en: 'Deepening contact and reactions', ko: '접촉과 반응 심화' },
    { en: 'Explicit escalation', ko: '본격적인 전개' },
    { en: 'Peak or conclusion permitted', ko: '마무리 허용' },
]);

const SLOW_BURN_MIN_TURNS = Object.freeze({
    gentle: 1,
    slow: 2,
    verySlow: 3,
});
const SLOW_BURN_TARGET_MAX_TURNS = 20;
const SLOW_BURN_TARGET_MAX_LENGTH = 200;
const DIALOGUE_BEAT_WINDOW = 2;

// 장면 스타일 다이얼 — 무장 중에만 적용
const STYLE_LENGTH_INSTRUCTIONS = Object.freeze({
    tight: 'Length: keep the response tight — 2-3 short paragraphs. Every sentence must carry sensation, action, or reaction; cut filler narration. Leave room for the user to act.',
    normal: '',
    long: 'Length: write a full, unhurried response — take space to build each moment. Do not rush through beats; linger where it matters.',
});
const STYLE_BALANCE_INSTRUCTIONS = Object.freeze({
    dialogue: 'Balance: dialogue-forward. The character keeps talking through the scene — teasing, reacting, murmuring, demanding. Physical description supports the dialogue, not the other way around.',
    balanced: '',
    sensory: 'Balance: sensory-forward. Prioritize concrete physical sensation — touch, heat, breath, weight, sound. Keep dialogue sparse and purposeful.',
    internal: 'Balance: interiority-forward. Keep the character\'s inner voice present — thoughts, restraint, want, conflict — woven through the physical action.',
});

// 해제 브릿지 — 개입 해제 직후 딱 한 번, 장면을 자연스럽게 마무리시키는 지시
const BRIDGE_LINES = [
    '[Scene Wind-Down] The intimate scene has just concluded. This response is the wind-down: settle the afterglow naturally — calming breath, small gestures, quiet words, gentle humor if it fits the characters.',
    'Reflect what just happened in the characters\' mood and closeness. Do not restart or escalate the scene, and do not jump abruptly to unrelated everyday narration.',
];

// 실질적 무제한 — 잘림 방지용 안전 상한만 백만으로 걸어둔다
const SAFETY_LIMIT = 1000000;

// 온도 자동 무장 히스테리시스: 이 온도 이상이면 개입 시작, 이 온도 이하면 해제
const AUTO_ARM_ON = 6;
const AUTO_ARM_OFF = 2;

// 스텔스 모드 로컬 감지: 최근 메시지에서 NSFW 신호를 점수화 (주입·호출 없음)
const STEALTH_WINDOW = 2; // 현재 유저 행동과 그 직전 응답까지만 본다
const STEALTH_THRESHOLDS = Object.freeze({ high: 3, normal: 4, low: 7 });
const STEALTH_COLD_STREAK = 2; // 현재 행위 신호가 양쪽에서 사라지면 빠르게 SFW에 인계
const REFINE_MESSAGE_CHAR_LIMIT = 12000;
const REFINE_TOTAL_CHAR_LIMIT = 60000;

const HEAT_SCALE_LINES = Object.freeze([
    'HEAT SCALE (judge the scene facts at the END of the response, not isolated words or discussion):',
    'Heat measures current sexual activity, not romantic interest, emotional intensity, jealousy, possessiveness, banter, embarrassment, attractiveness, or narrative tension. Ordinary conversation, errands, texting, helpful/protective gestures, and incidental or practical touch stay at 0-1; attraction or flirting alone stays at 2 or below.',
    'Do not infer sexual activity from a genre label, NSFW permission, character preferences, OOC instructions, planning blocks, past activity, or a possible next scene. Rate only what is actually happening in the current scene. When evidence is ambiguous, use the lower supported heat; do not invent sexual intent.',
    'Ordinary bathing, showering, washing, drying, changing clothes, nudity, wet skin, or medical care are NONSEXUAL unless actual sexual contact is occurring. Never raise heat merely because bodies or intimate anatomy are described.',
    'Pain sounds, cold shivers, exertion, and embarrassment are not sexual arousal. Discussion, hypothetical/denied actions, or an earlier intimate scene are not current sexual activity.',
    '- 0-1: ordinary/nonsexual; 2: mild flirting or romantic charge without sustained sexual contact.',
    '- 3-4: actual romantic kissing or intentional intimate contact; ordinary proximity or supportive touch does not qualify.',
    '- 5: clearly sexual tension or developing intimacy, but sustained, unambiguous sexual touching/foreplay is not established yet; do not activate supervision.',
    '- 6: sustained, unambiguous sexual touching/foreplay is actually occurring in the current scene; this is the active-supervision threshold. Arousal alone or imagined/inferred desire is insufficient.',
    '- 7-8: sustained explicit sexual activity or intensifying stimulation; 9: climax is imminent; 10: peak/climax or immediate conclusion.',
]);
const DEFAULT_SETTINGS = Object.freeze({
    settingsSchemaVersion: 3,
    enabled: true,
    adultConfirmed: true,
    developerMode: false,
    dialogueBeatGuard: true, // 최근 대사 의도·기능 반복 방지 (0.13.0부터 일반 기능, 신규 설치 기본 켬)
    dialogueWindow: 2, // 대사 의도를 "또 하지 마" 목록에 올릴 최근 AI 답변 수 (1~6)
    // CardInject 연동: 캐시트 카테고리를 다음 전개 힌트의 참고 자료로 사용 (무장 중에만 주입)
    cardLinkEnabled: false,
    cardLinkSelected: {}, // { [캐릭터 키]: [카테고리 key, ...] }
    // 'stealth' = 로컬 감지, SFW에선 주입 제로(기본) / 'auto' = 온도 태그 감시 / 'manual' = 채팅 토글로 직접
    armMode: 'stealth',
    stealthSensitivity: 'normal', // 'high' | 'normal' | 'low'
    stealthKeywords: '', // 쉼표 구분 커스텀 감지 키워드 (각 3점)
    nextBeatHints: true,
    repeatWindow: 3,
    maxBannedActs: 15, // 반복 금지 목록 총량 상한 — 넘치면 오래된 것부터 제외
    paceMode: 'auto', // 'auto'(온도 연동) | 'hold' | 'slow' | 'push'
    slowBurnEnabled: false,
    slowBurnIntensity: 'slow', // 'gentle'(단계당 1턴) | 'slow'(2턴) | 'verySlow'(3턴)
    slowBurnUserOverride: true, // 사용자가 직접 다음 단계 행동을 시작하면 제한보다 우선
    globalBans: [], // 전역 하드 리밋 — 모든 채팅의 무장 장면에 절대 금지로 주입
    styleLength: 'normal', // 'tight' | 'normal' | 'long' — 무장 중 응답 길이
    styleBalance: 'balanced', // 'dialogue' | 'balanced' | 'sensory' | 'internal' — 무장 중 묘사 밸런스
    exitBridge: true, // 해제 직후 한 번, 장면 마무리 지시 주입
    diagnosticsEnabled: false,
    autoRefine: true,
    refineProfileId: '',
    refineVertexAuthMode: 'profile',
    refineMaxTokens: 3000,
    refineContextMessages: 8,
});

let runtimeActive = true;
let uiReady = false;
let initializationPromise = null;
let eventsRegistered = false;
let refineRunning = false;
let refineAbortController = null;
let refineTimer = null;
let popupOpen = false;
let settingsHomeParent = null;
let developerTapCount = 0;
let developerTapTimer = null;
const registeredEventHandlers = [];

// Opt-in, bounded, memory-only diagnostics. No message bodies, names, keys,
// profile identifiers, URLs, or raw error text are retained.
const DIAGNOSTIC_LIMIT = 400;
let diagnosticRows = [];
let diagnosticSequence = 0;
let diagnosticRequestSequence = 0;
let diagnosticEpoch = 0;
let diagnosticChatSequence = 0;
const diagnosticChats = new WeakMap();
let diagnosticFetchWrapper = null;
let diagnosticOriginalFetch = null;
// Response copies are read only while diagnostics are enabled. All exported
// records contain structure only; the original response/promise is untouched.
const DIAGNOSTIC_RESPONSE_BYTES = 1024 * 1024;
const diagnosticReaders = new Set();
const diagnosticResponseSlots = new Set();
let diagnosticBodies = new Map();
let diagnosticResponses = [];
function resetDiagnosticEvidence() {
    for (const reader of diagnosticReaders) { try { void reader.cancel().catch(() => {}); } catch {} }
    diagnosticReaders.clear(); diagnosticResponseSlots.clear(); diagnosticBodies.clear(); diagnosticResponses = [];
}
function diagnosticNsfwReport(text) {
    const blocks = [...String(text ?? '').matchAll(/<scene_state\b[^>]*>([\s\S]*?)<\/scene_state>/gi)];
    let heat = null;
    try {
        const raw = blocks.at(-1)?.[1];
        if (raw) {
            const parsed = parseStateJson(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
            if (typeof parsed.heat === 'number' && Number.isFinite(parsed.heat)) heat = parsed.heat;
        }
    } catch { /* No guessing on malformed reports. */ }
    return { nsfwHeatPresent: heat !== null, ...(heat !== null ? { nsfwHeat: heat } : {}) };
}
function diagnosticTextShape(text) {
    const state = parseStateFromText(text);
    return {
        chars: text.length, bodyChars: recordBody(text).length,
        openTag: /<scene_state\b/i.test(text), closeTag: /<\/scene_state\s*>/i.test(text),
        escapedTag: /&lt;scene_state\b/i.test(text), sfwTag: /<sfw_scene\b/i.test(text),
        parsed: Boolean(state), characters: Object.keys(state?.characters ?? {}).length,
        objects: Object.keys(state?.importantObjects ?? {}).length, nextCandidates: state?.next?.length ?? 0, ...diagnosticNsfwReport(text),
        missing: state ? stateCompletenessIssues(state) : ['state'],
    };
}
function diagnosticLink(message, index, text, chat = diagnosticScope()) {
    const body = recordBody(text);
    const candidates = diagnosticResponses.filter(r => r.chat === chat && Date.now() - r.at < 120000);
    const matches = candidates.filter(r => r.body === body);
    diagnosticRecord('response_message_link', {
        message: index, swipe: currentSwipeIndex(message), candidates: candidates.length, matches: matches.length,
        reason: matches.length === 1 ? 'exact_body_match' : matches.length ? 'ambiguous_body_match' : 'no_exact_body_match',
        ...(matches.length === 1 ? { requestId: matches[0].requestId, candidate: matches[0].candidate,
            serverTag: matches[0].tag, serverComplete: matches[0].complete } : {}),
    }, chat);
}
function diagnosticTrackBody(message, index, phase) {
    if (!diagnosticsEnabled() || !message || message.is_user || message.is_system) return;
    const text = String(message.mes ?? '');
    const swipe = currentSwipeIndex(message), chat = diagnosticScope();
    const previous = diagnosticBodies.get(message);
    if (!previous || previous.swipe !== swipe || previous.chat !== chat) {
        diagnosticRecord('body_checkpoint', { reason: phase, message: index, swipe, ...diagnosticTextShape(text) }, chat);
        diagnosticLink(message, index, text, chat);
    } else if (previous.text !== text) {
        const old = previous.text;
        let start = 0, endOld = old.length, endNew = text.length;
        while (start < Math.min(endOld, endNew) && old[start] === text[start]) start++;
        while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) { endOld--; endNew--; }
        const withoutSpace = s => s.replace(/\s/g, '');
        const withoutMarkup = s => withoutSpace(s.replace(/<[^>]*>/g, '').replace(/[*_`]/g, ''));
        diagnosticRecord('body_changed', {
            reason: phase, message: index, swipe, beforeChars: old.length, afterChars: text.length,
            removedChars: endOld - start, addedChars: endNew - start,
            sameSceneBody: recordBody(old) === recordBody(text),
            whitespaceOnly: withoutSpace(old) === withoutSpace(text),
            markupOnly: withoutMarkup(old) === withoutMarkup(text),
            oldOpenTag: /<scene_state\b/i.test(old), newOpenTag: /<scene_state\b/i.test(text),
        }, chat);
        diagnosticLink(message, index, text, chat);
    }
    // Short-lived bounded copies for change classification, never serialized.
    if (text.length <= 65536) {
        diagnosticBodies.delete(message);
        diagnosticBodies.set(message, { text, swipe, index, chat });
        if (diagnosticBodies.size > 12) diagnosticBodies.delete(diagnosticBodies.keys().next().value);
    } else {
        diagnosticBodies.delete(message);
        diagnosticRecord('body_checkpoint_skipped', { reason: 'size_limit', message: index, swipe }, chat);
    }
}
function diagnosticOutputParts(payload) {
    const rows = [];
    const contentText = content => typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter(p => !p?.thought && (p?.type === 'text' || p?.type === 'output_text' || !p?.type))
            .map(p => typeof p?.text === 'string' ? p.text : '').join('') : '';
    if (typeof payload === 'string') rows.push({ text: payload, candidate: 0 });
    else if (Array.isArray(payload?.choices)) payload.choices.forEach((c, i) => rows.push({
        text: contentText(c.message?.content ?? c.delta?.content ?? c.text), candidate: c.index ?? i, finish: c.finish_reason, refused: Boolean(c.message?.refusal),
    }));
    else if (Array.isArray(payload?.candidates)) payload.candidates.forEach((c, i) => rows.push({
        text: contentText(c.content?.parts), candidate: c.index ?? i, finish: c.finishReason,
    }));
    else if (Array.isArray(payload?.results)) payload.results.forEach((c, i) => rows.push({ text: contentText(c.text), candidate: i }));
    else if (Array.isArray(payload?.output)) rows.push({ text: payload.output.filter(p => p.type === 'message').map(p => contentText(p.content)).join(''), candidate: 0, finish: payload.status });
    else if (payload?.type === 'content_block_delta') rows.push({ text: payload.delta?.type === 'text_delta' ? contentText(payload.delta.text) : '', candidate: 0 });
    else if (payload?.type === 'content_block_start') rows.push({ text: payload.content_block?.type === 'text' ? contentText(payload.content_block.text) : '', candidate: 0 });
    else if (payload?.type === 'message_delta') rows.push({ text: '', candidate: 0, finish: payload.delta?.stop_reason });
    else if (typeof payload?.content === 'string' || Array.isArray(payload?.content)) rows.push({ text: contentText(payload.content), candidate: 0, finish: payload.stop_reason });
    else if (typeof payload?.text === 'string') rows.push({ text: payload.text, candidate: 0 });
    return rows;
}
async function diagnosticInspectResponse(response, info, requestId, chat, epoch) {
    const alive = () => diagnosticsEnabled() && epoch === diagnosticEpoch;
    const discard = () => { try { void response?.body?.cancel().catch(() => {}); } catch {} };
    if (!alive()) { discard(); return; }
    const record = (stage, data) => { if (alive()) diagnosticRecord(stage, { requestId, ...data }, chat); };
    if (!info?.reportInstruction) { discard(); record('server_response_skipped', { reason: info ? 'no_report_instruction' : 'request_unreadable' }); return; }
    let reader, timer;
    try {
        if (response && !response.ok) { discard(); record('server_response_unavailable', { reason: 'http_error', status: response.status }); return; }
        if (!response) { record('server_response_unavailable', { reason: 'clone_failed' }); return; }
        const copy = response;
        if (!copy.body?.getReader) { record('server_response_unavailable', { reason: 'unreadable_body' }); return; }
        reader = copy.body.getReader(); diagnosticReaders.add(reader);
        let timedOut = false;
        timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 45000);
        const decoder = new TextDecoder();
        let raw = '', bytes = 0, ended = false, limited = false;
        while (alive()) {
            const chunk = await reader.read();
            if (chunk.done) { ended = !timedOut; break; }
            bytes += chunk.value.byteLength;
            if (bytes > DIAGNOSTIC_RESPONSE_BYTES) { limited = true; break; }
            raw += decoder.decode(chunk.value, { stream: true });
        }
        if (!alive()) return;
        raw += decoder.decode();
        if (limited || timedOut) { record('server_response_unavailable', { reason: limited ? 'size_limit' : 'read_timeout', bytes }); return; }
        const stream = Boolean(info.stream) || /text\/event-stream/i.test(copy.headers.get('content-type') ?? '');
        let rows = [], complete = ended, malformed = false, terminated = false;
        if (stream) {
            const candidates = new Map();
            for (const event of raw.replace(/\r\n?/g, '\n').split(/\n\n/)) {
                const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                if (!data) continue;
                if (data === '[DONE]') { terminated = true; continue; }
                let payload; try { payload = JSON.parse(data); } catch { malformed = true; continue; }
                if (payload.type === 'message_stop') terminated = true;
                for (const part of diagnosticOutputParts(payload)) {
                    const key = Number(part.candidate) || 0;
                    const target = candidates.get(key) ?? { text: '', candidate: key };
                    target.text += part.text; if (part.finish) { target.finish = part.finish; terminated = true; }
                    candidates.set(key, target);
                }
            }
            rows = [...candidates.values()]; complete = ended && terminated && !malformed;
        } else {
            let payload;
            try { payload = JSON.parse(raw); } catch { record('server_response_unavailable', { reason: 'invalid_json', bytes }); return; }
            rows = diagnosticOutputParts(payload);
        }
        if (!rows.length) { record('server_response_unavailable', { reason: 'unsupported_response', stream, bytes }); return; }
        for (const row of rows) {
            const body = recordBody(row.text), shape = diagnosticTextShape(row.text);
            record('server_response_observed', { ...shape, candidate: Number(row.candidate) || 0, stream, complete, bytes,
                reason: !complete ? 'incomplete_stream' : row.refused || /^(?:content_filter|SAFETY|RECITATION)$/.test(row.finish ?? '') ? 'blocked_response' : !row.text ? 'empty_answer' : shape.parsed ? 'parsed_tag' : shape.openTag ? 'invalid_or_unclosed_tag' : shape.escapedTag ? 'escaped_tag' : 'missing_tag',
                tokenLimited: /^(?:length|max_tokens|MAX_TOKENS)$/.test(row.finish ?? ''),
                stopped: /^(?:stop|end_turn|stop_sequence|STOP|completed)$/.test(row.finish ?? ''),
            });
            // Bounded transient bodies allow exact matching, never stored in chat or exported.
            if (body.length <= 65536) diagnosticResponses.push({ chat, at: Date.now(), requestId, candidate: Number(row.candidate) || 0,
                body, tag: shape.openTag, complete });
            if (diagnosticResponses.length > 20) diagnosticResponses.shift();
        }
        for (const [message, entry] of diagnosticBodies) if (entry.chat === chat && entry.swipe === currentSwipeIndex(message)) diagnosticLink(message, entry.index, entry.text, chat);
    } catch { record('server_response_unavailable', { reason: 'read_failed' }); }
    finally {
        clearTimeout(timer);
        if (reader) { diagnosticReaders.delete(reader); try { void reader.cancel().catch(() => {}); } catch {} }
    }
}

function diagnosticsEnabled() {
    return Boolean(runtimeActive && getContext().extensionSettings?.[MODULE_NAME]?.diagnosticsEnabled);
}
function diagnosticScope() {
    const metadata = getContext().chatMetadata;
    if (!metadata || typeof metadata !== 'object') return 0;
    if (!diagnosticChats.has(metadata)) diagnosticChats.set(metadata, ++diagnosticChatSequence);
    return diagnosticChats.get(metadata);
}
function diagnosticRecord(stage, data = {}, chat = diagnosticScope()) {
    if (!diagnosticsEnabled()) return;
    // Only call with structural values computed below, never API/user text.
    const values = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) values[key] = value;
        else if (key === 'reason' && /^[a-z_-]{1,48}$/.test(value)) values[key] = value;
        else if (key === 'missing' && Array.isArray(value)) values[key] = value.filter(v => ['state', 'location', 'characters', 'acts', 'heat', 'stage', 'next'].includes(v));
    }
    const previous = diagnosticRows.at(-1);
    if (previous?.stage === stage && previous.chat === chat && JSON.stringify(previous.data) === JSON.stringify(values)) {
        previous.repeats++;
        previous.lastAt = new Date().toISOString();
    } else {
        diagnosticRows.push({ seq: ++diagnosticSequence, at: new Date().toISOString(), chat, stage, data: values, repeats: 1 });
        if (diagnosticRows.length > DIAGNOSTIC_LIMIT) diagnosticRows.shift();
    }
    renderDiagnostics();
}
function diagnosticCache(message) {
    const snapshot = snapshotForMessage(message);
    return {
        saved: Boolean(snapshot?.state), cached: snapshotMatchesMessage(message, snapshot),
        bodyChars: recordBody(message?.mes).length,
        savedBodyChars: Number(String(snapshot?.messageSignature ?? '').split(':')[1] ?? -1),
        savedCharacters: Object.keys(snapshot?.state?.characters ?? {}).length,
        savedNextCandidates: snapshot?.state?.next?.length ?? 0,
        savedHeatPresent: snapshot?.state?.heat !== null && snapshot?.state?.heat !== undefined,
        ...(snapshot?.state?.heat !== null && snapshot?.state?.heat !== undefined ? { savedHeat: snapshot.state.heat } : {}),
    };
}
function diagnosticState() {
    const settings = getContext().extensionSettings?.[MODULE_NAME] ?? {};
    const meta = getContext().chatMetadata?.[CHAT_STATE_KEY] ?? {};
    const current = effectiveState();
    const heat = current.state?.heat;
    return { enabled: Boolean(settings.enabled), chatEnabled: Boolean(meta.enabled), adultConfirmed: Boolean(settings.adultConfirmed),
        autoRefine: Boolean(settings.autoRefine), modeAuto: settings.armMode === 'auto', modeStealth: settings.armMode === 'stealth', modeManual: settings.armMode === 'manual',
        autoArmed: Boolean(meta.autoArmed), armedByHeat: Boolean(meta.autoArmed && meta.armSource === 'heat'), armedLocally: Boolean(meta.autoArmed && meta.armSource === 'local'), forceArmed: Boolean(meta.forceArmed), bridgePending: Boolean(meta.bridgePending),
        slowBurnEnabled: Boolean(settings.slowBurnEnabled), slowBurnSessionActive: Boolean(meta.slowBurnSessionActive),
        slowBurnLocked: Boolean(meta.slowBurnLocked), slowBurnRecoveryPending: Boolean(meta.slowBurnRecoveryPending),
        currentHeatPresent: heat !== null && heat !== undefined,
        ...(heat !== null && heat !== undefined ? { currentHeat: heat } : {}),
        latestReportMissing: current.source === 'missing-report', latestBodyChanged: current.source === 'body-changed',
        refineRunning, pendingGenerations: generationEvents.length };
}
function diagnosticReport() {
    return JSON.stringify({ extension: MODULE_NAME, version: EXTENSION_VERSION, recording: diagnosticsEnabled(),
        note: 'Memory-only; no API keys or dialogue contents. request_observed means the fetch boundary, not proof of model receipt. server_response_observed describes a bounded response copy at the fetch boundary, not guaranteed provider-original output if another wrapper precedes this one. Response/message links require matching bodies; unmatched or ambiguous results are unconfirmed. No raw bodies are exported.',
        current: diagnosticState(), events: diagnosticRows }, null, 2);
}
function renderDiagnostics() {
    try {
        const box = document.getElementById('tns-diagnostic-log');
        if (box) box.value = diagnosticReport();
        const status = document.getElementById('tns-diagnostic-status');
        if (status) status.textContent = `${diagnosticsEnabled() ? '기록 중' : '기록 꺼짐'} · ${diagnosticRows.length}/${DIAGNOSTIC_LIMIT}건 · 새로고침하면 지워져요`;
    } catch { /* A missing/stale diagnostics panel must not affect generation. */ }
}
function clearDiagnostics() {
    diagnosticRows = [];
    diagnosticEpoch++;
    resetDiagnosticEvidence();
    renderDiagnostics();
}
function diagnosticResponse(message, index) {
    if (!diagnosticsEnabled()) return;
    diagnosticTrackBody(message, index, 'before_collection');
    const text = String(message.mes ?? '');
    const state = parseStateFromText(text);
    let reason = 'missing_tag';
    if (/<scene_state\b/i.test(text)) {
        reason = /<\/scene_state\s*>/i.test(text) ? 'invalid_tag' : 'unclosed_tag';
        if (state) reason = 'parsed_tag';
        else if (reason === 'invalid_tag') {
            const blocks = [...text.matchAll(STATE_TAG_REGEX)];
            const json = blocks.at(-1)?.[1] ?? '';
            try {
                const start = json.indexOf('{'), end = json.lastIndexOf('}');
                if (start < 0 || end <= start) throw new Error();
                parseStateJson(json.slice(start, end + 1));
                reason = 'empty_state';
            } catch { reason = 'invalid_json'; }
        }
    }
    diagnosticRecord('response_observed', {
        reason,
        message: index, swipe: currentSwipeIndex(message), chars: text.length,
        openTag: /<scene_state\b/i.test(text), closeTag: /<\/scene_state\s*>/i.test(text),
        escapedTag: /&lt;scene_state\b/i.test(text), sfwTag: /<sfw_scene\b/i.test(text),
        parsed: Boolean(state), ...diagnosticCache(message),
        characters: Object.keys(state?.characters ?? {}).length,
        objects: Object.keys(state?.importantObjects ?? {}).length, nextCandidates: state?.next?.length ?? 0, ...diagnosticNsfwReport(text),
        missing: state ? stateCompletenessIssues(state) : ['state'], ...diagnosticState(),
    });
}
function diagnosticInspectPayload(body, requestId, chat, epoch) {
    if (!diagnosticsEnabled() || epoch !== diagnosticEpoch) return;
    let payload;
    try { payload = typeof body === 'string' ? JSON.parse(body) : null; } catch { /* opaque body */ }
    if (!payload || typeof payload !== 'object') {
        diagnosticRecord('request_observed', { requestId, readable: false }, chat);
        return;
    }
    const parts = [];
    for (const message of Array.isArray(payload.messages) ? payload.messages : []) {
        if (typeof message?.content === 'string') parts.push(message.content);
        else if (Array.isArray(message?.content)) {
            for (const item of message.content) if (typeof item?.text === 'string') parts.push(item.text);
        }
    }
    if (typeof payload.prompt === 'string') parts.push(payload.prompt);
    const content = parts.join('\n');
    const monitor = content.includes('[Scene Monitor]');
    const fullReport = content.includes('STATE REPORT: End your response with exactly one state block') && content.includes('<scene_state>');
    const info = {
        requestId, readable: true, stream: Boolean(payload.stream),
        reportInstruction: (monitor || fullReport) && content.includes('<scene_state>'),
        nsfwMonitor: monitor, nsfwFullReport: fullReport,
        sfwReport: content.includes('<sfw_scene>'),
        messages: Array.isArray(payload.messages) ? payload.messages.length : 0,
    };
    diagnosticRecord('request_observed', info, chat);
    return info;
}
function stopDiagnosticFetch() {
    diagnosticEpoch++;
    resetDiagnosticEvidence();
    if (diagnosticFetchWrapper && globalThis.fetch === diagnosticFetchWrapper) {
        globalThis.fetch = diagnosticOriginalFetch;
        diagnosticFetchWrapper = null;
        diagnosticOriginalFetch = null;
    }
    // If another extension wrapped us, leave that wrapper intact. Ours is inert
    // while diagnostics are off, and can be reused when enabled again.
}
function syncDiagnosticFetch() {
    if (!diagnosticsEnabled()) { stopDiagnosticFetch(); return; }
    if (diagnosticFetchWrapper || typeof globalThis.fetch !== 'function') return;
    const original = globalThis.fetch;
    diagnosticOriginalFetch = original;
    diagnosticFetchWrapper = function (...args) {
        let observed = false, requestId, chat, epoch, requestInfo;
        try {
            if (diagnosticsEnabled()) {
                const [input, init] = args;
                const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input?.url, globalThis.location?.href);
                observed = url.origin === globalThis.location?.origin
                    && /^\/api\/backends\/(?:chat|text)-completions\/generate$/.test(url.pathname);
                if (observed) {
                    requestId = ++diagnosticRequestSequence;
                    chat = diagnosticScope(); epoch = diagnosticEpoch;
                    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) requestInfo = diagnosticInspectPayload(init.body, requestId, chat, epoch);
                    else if (typeof Request !== 'undefined' && input instanceof Request) {
                        // Clone before the request consumes its body; never await it.
                        requestInfo = input.clone().text().then(body => diagnosticInspectPayload(body, requestId, chat, epoch)).catch(() => null);
                    } else diagnosticInspectPayload(null, requestId, chat, epoch);
                }
            }
        } catch { /* diagnostics must never break generation */ }
        const result = Reflect.apply(original, this, args);
        if (observed && typeof result?.then === 'function') void result.then(response => {
            if (epoch === diagnosticEpoch) {
                diagnosticRecord('request_finished', { requestId, status: response.status, ok: response.ok }, chat);
                // Reserve a bounded slot and clone before the caller consumes it.
                if (diagnosticResponseSlots.size >= 4) {
                    diagnosticRecord('server_response_unavailable', { requestId, reason: 'reader_limit' }, chat);
                    return;
                }
                const slot = {}; diagnosticResponseSlots.add(slot);
                let copy = null;
                if (requestInfo?.reportInstruction || typeof requestInfo?.then === 'function') {
                    try { copy = response.clone(); } catch {}
                }
                void Promise.resolve(requestInfo).then(info => diagnosticInspectResponse(copy, info, requestId, chat, epoch))
                    .catch(() => {}).finally(() => diagnosticResponseSlots.delete(slot));
            }
        }, () => {
            if (epoch === diagnosticEpoch) diagnosticRecord('request_failed', { requestId }, chat);
        }).catch(() => {});
        return result;
    };
    globalThis.fetch = diagnosticFetchWrapper;
}
async function copyDiagnostics() {
    const report = diagnosticReport();
    try { await navigator.clipboard.writeText(report); toastr.success('진단 기록을 복사했어요.', '🔞또또NSFW'); }
    catch {
        const box = document.getElementById('tns-diagnostic-log');
        if (box) { box.value = report; box.focus(); box.select(); }
        toastr.info('아래 기록이 선택됐어요. 직접 복사하거나 파일로 내려받아 주세요.', '🔞또또NSFW');
    }
}
function downloadDiagnostics() {
    const url = URL.createObjectURL(new Blob([diagnosticReport()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `ttotto-nsfw-diagnostics-${Date.now()}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ───────────────────────── 컨텍스트/설정 ─────────────────────────

function getContext() {
    return SillyTavern.getContext();
}

function getEventTypes(context = getContext()) {
    return context.eventTypes ?? context.event_types ?? {};
}

// BEGIN STATE TAG DISPLAY GUARD
// 표시용 사본만 필터링한다. 채팅 원문·선택 스와이프·상태 수집에는 손대지 않는다.
const DISPLAY_RULE_ID = MODULE_NAME === 'ttotto-nsfw'
    ? 'c3d51f0b-6ad4-4aaa-8801-6ba5efec9a13' : '709b05fb-c531-40a8-8de7-206d2c4fc1ce';
const DISPLAY_STYLE_ID = `${MODULE_NAME}-state-tag-display-guard`;
const DISPLAY_TAG_NAMES = '(?:scene_state|sfw_scene)';
const DISPLAY_OPEN = '(?:<|&lt;)';
const DISPLAY_CLOSE = '(?:>|&gt;)';
const DISPLAY_PARTIAL_NAMES = ['scene_state', 'sfw_scene'].flatMap((name) =>
    Array.from({ length: name.length - 1 }, (_, i) => name.slice(0, i + 1))).join('|');
const DISPLAY_TAG_BODY = `${DISPLAY_OPEN}(${DISPLAY_TAG_NAMES})\\b[^>]*?${DISPLAY_CLOSE}[\\s\\S]*?(?:${DISPLAY_OPEN}\\/\\1\\s*${DISPLAY_CLOSE}|$)`
    + `|${DISPLAY_OPEN}\\/?${DISPLAY_TAG_NAMES}\\b[^>]*?(?:${DISPLAY_CLOSE}|$)`;
const DISPLAY_TAG_PATTERN = `(?:\\x60{3}(?:json)?[ \t]*(?:\\r?\\n)?[ \t]*)?(?:${DISPLAY_TAG_BODY}|${DISPLAY_OPEN}\\/?(?:${DISPLAY_PARTIAL_NAMES})$)(?:[ \t\\r\\n]*\\x60{3})?`;
const DISPLAY_TAG_REGEX = new RegExp(DISPLAY_TAG_PATTERN, 'gi');
let displayGuardActive = false;
let displayFormatterInstalled = null;
let displayObserver = null;

function stripStateTagsForDisplay(text) {
    // JSON 코드 블록 안의 태그도 같은 문자열 단계에서 숨긴다. 다른 코드 블록은 유지한다.
    return String(text ?? '').replace(DISPLAY_TAG_REGEX, '');
}

function displayFormattingHook(text, context = {}) {
    if (!displayGuardActive || context.isUser || context.isSystem || context.isReasoning) return text;
    return stripStateTagsForDisplay(text);
}

function removeOwnedDisplayRule() {
    const context = getContext();
    const scripts = context.extensionSettings?.regex;
    if (!Array.isArray(scripts)) return;
    const index = scripts.findIndex((script) => script?.id === DISPLAY_RULE_ID);
    if (index < 0) return;
    scripts.splice(index, 1);
    context.saveSettingsDebounced?.();
}

function ensureDisplayRule() {
    const context = getContext();
    const settings = context.extensionSettings;
    if (settings.regex !== undefined && !Array.isArray(settings.regex)) return;
    settings.regex ??= [];
    const rule = {
        id: DISPLAY_RULE_ID,
        scriptName: `${MODULE_NAME} · 상태 태그 숨김 (표시 전용)`,
        findRegex: `/${DISPLAY_TAG_PATTERN}/gi`, replaceString: '', trimStrings: [],
        placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
        runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    };
    const existing = settings.regex.find((script) => script?.id === DISPLAY_RULE_ID);
    if (existing && JSON.stringify(existing) === JSON.stringify(rule)) return;
    if (existing) Object.assign(existing, rule);
    else settings.regex.push(rule);
    context.saveSettingsDebounced?.();
}

function scrubRenderedStateTags(root) {
    if (!displayGuardActive || !root?.closest?.('#chat')) return;
    const messageElement = root.closest('.mes');
    if (!messageElement || messageElement.getAttribute('is_user') === 'true'
        || messageElement.getAttribute('is_system') === 'true') return;
    const walker = document.createTreeWalker(root, 4);
    const nodes = [];
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
        nodes.push({ node, start: text.length, end: text.length + node.data.length });
        text += node.data;
    }
    if (!text) return;
    const ranges = [...text.matchAll(DISPLAY_TAG_REGEX)].map((match) => [match.index, match.index + match[0].length]);
    // HTML 정화기가 알 수 없는 태그만 벗겨낸 경우, 원문에서 확인된 기계용 내용만 숨긴다.
    // 일반 JSON이나 대화 본문을 형태만 보고 삭제하지 않는다.
    const messageId = messageElement.getAttribute('mesid');
    const index = messageId == null || messageId.trim() === '' ? NaN : Number(messageId);
    const message = Number.isInteger(index) ? getContext().chat?.[index] : null;
    if (message && !message.is_user && !message.is_system) {
        const raw = String(message.mes ?? '');
        for (const match of raw.matchAll(/<(scene_state|sfw_scene)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|$)/gi)) {
            const payload = match[2].replace(new RegExp(`${DISPLAY_OPEN}\\/(?:${DISPLAY_TAG_NAMES}|${DISPLAY_PARTIAL_NAMES})$`, 'i'), '').trim();
            if (!payload) continue;
            const position = text.lastIndexOf(payload);
            if (position >= 0) ranges.push([position, position + payload.length]);
        }
    }
    // 겹치는 범위를 합치고 뒤에서부터 제거해 앞쪽 노드의 오프셋과 서식을 보존한다.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
        const last = merged.at(-1);
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push(range);
    }
    for (const [start, end] of merged.reverse()) {
        const first = nodes.find((item) => item.start <= start && item.end > start);
        const last = nodes.find((item) => item.start < end && item.end >= end);
        if (!first || !last || !first.node.isConnected || !last.node.isConnected) continue;
        const range = document.createRange();
        range.setStart(first.node, start - first.start);
        range.setEnd(last.node, end - last.start);
        range.deleteContents();
    }
}

function startDisplayObserver() {
    if (displayObserver || typeof MutationObserver !== 'function' || !document.documentElement) return;
    const style = document.createElement('style');
    style.id = DISPLAY_STYLE_ID;
    style.textContent = '#chat .mes:not([is_user="true"]):not([is_system="true"]) .mes_text scene_state, '
        + '#chat .mes:not([is_user="true"]):not([is_system="true"]) .mes_text sfw_scene { display:none !important; }';
    (document.head ?? document.documentElement).append(style);
    displayObserver = new MutationObserver((records) => {
        if (!displayGuardActive) return;
        const roots = new Set();
        const collect = (node, descendants = false) => {
            const element = node?.nodeType === 1 ? node : node?.parentElement;
            const root = element?.closest?.('#chat .mes_text');
            if (root) roots.add(root);
            if (descendants) element?.querySelectorAll?.('.mes_text').forEach((item) => {
                if (item.closest('#chat')) roots.add(item);
            });
        };
        for (const record of records) {
            collect(record.target);
            for (const node of record.addedNodes ?? []) collect(node, true);
        }
        roots.forEach(scrubRenderedStateTags);
    });
    // MutationObserver callbacks run at the microtask checkpoint before the browser paints.
    // 구버전·Regex 비활성·번역 확장의 직접 DOM 갱신에도 표시 노드만 정리한다.
    displayObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.querySelectorAll('#chat .mes_text').forEach(scrubRenderedStateTags);
}

function stopStateTagDisplayGuard() {
    displayGuardActive = false;
    displayObserver?.disconnect();
    displayObserver = null;
    document.getElementById(DISPLAY_STYLE_ID)?.remove();
    removeOwnedDisplayRule();
    // 포맷 훅은 모듈당 한 번만 등록한다. 비활성 중에는 원문을 그대로 반환한다.
}

function syncStateTagDisplayGuard() {
    displayGuardActive = Boolean(runtimeActive && getSettings().enabled);
    if (!displayGuardActive) { stopStateTagDisplayGuard(); return; }
    const formatter = getContext().messageFormatter;
    if (typeof formatter?.addHook === 'function' && formatter !== displayFormatterInstalled) {
        formatter.addHook(displayFormattingHook, { stage: 'beforeRegex', order: 0 });
        displayFormatterInstalled = formatter;
    }
    // 정식 버전에서는 표시 전용 Regex, 새 포맷터가 있는 버전에서는 훅도 함께 보호한다.
    // 사용자의 기존 Regex나 Regex 전체 사용 여부는 바꾸지 않는다.
    ensureDisplayRule();
    startDisplayObserver();
}
// END STATE TAG DISPLAY GUARD

function getSettings() {
    const context = getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = context.extensionSettings[MODULE_NAME];
    const previousSchemaVersion = Number(settings.settingsSchemaVersion) || 0;
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[key] === undefined) settings[key] = structuredClone(value);
    }
    // v2: UI 추천값과 실제 기본값을 자동으로 통일한다.
    if (previousSchemaVersion < 2 && settings.paceMode === 'slow') settings.paceMode = 'auto';
    // v3: 성인 확인은 신규 설치와 기존 설치 모두 최초 1회 기본 ON으로 전환한다.
    // 이후 사용자가 직접 끄면 스키마 버전이 유지되므로 다시 강제로 켜지지 않는다.
    if (previousSchemaVersion < 3) settings.adultConfirmed = true;
    settings.settingsSchemaVersion = 3;
    // 상태 JSON은 짧으므로 과도한 출력 상한을 제한해 보조 호출 비용을 줄인다.
    const refineTokens = Number(settings.refineMaxTokens);
    settings.refineMaxTokens = Number.isFinite(refineTokens)
        ? Math.min(4000, Math.max(1000, Math.round(refineTokens)))
        : DEFAULT_SETTINGS.refineMaxTokens;
    if (!Object.prototype.hasOwnProperty.call(SLOW_BURN_MIN_TURNS, settings.slowBurnIntensity)) settings.slowBurnIntensity = 'slow';
    const dialogueWindow = Number(settings.dialogueWindow);
    settings.dialogueWindow = Number.isFinite(dialogueWindow)
        ? Math.min(6, Math.max(1, Math.round(dialogueWindow)))
        : DIALOGUE_BEAT_WINDOW;
    if (!settings.cardLinkSelected || typeof settings.cardLinkSelected !== 'object' || Array.isArray(settings.cardLinkSelected)) {
        settings.cardLinkSelected = {};
    }
    if (previousSchemaVersion < 3 || settings.refineMaxTokens !== refineTokens) {
        context.saveSettingsDebounced?.();
    }
    return settings;
}

function saveSettings() {
    syncStateTagDisplayGuard();
    getContext().saveSettingsDebounced();
}

function setDeveloperMode(enabled) {
    const settings = getSettings();
    settings.developerMode = Boolean(enabled);

    if (!settings.developerMode) {
        const meta = getChatMeta(false);
        if (meta) {
            meta.slowBurnTargetActive = false;
            meta.slowBurnTargetCompleted = false;
            meta.slowBurnRecoveryPending = false;
            saveChatMeta();
        }
    }
    saveSettings();

    updateUi();
    toastr.success(
        settings.developerMode ? '개발자 모드를 활성화했어요.' : '개발자 모드를 해제했어요.',
        '🔞또또NSFW',
    );
}

function handleDeveloperTitleTap(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    developerTapCount += 1;
    clearTimeout(developerTapTimer);
    developerTapTimer = setTimeout(() => {
        developerTapCount = 0;
        developerTapTimer = null;
    }, DEVELOPER_TAP_RESET_MS);

    if (developerTapCount < DEVELOPER_UNLOCK_TAPS) return;

    developerTapCount = 0;
    clearTimeout(developerTapTimer);
    developerTapTimer = null;

    const entered = window.prompt('개발자 모드 비밀번호를 입력하세요.');
    if (entered === null) return;
    if (entered.trim() !== DEVELOPER_PASSWORD) {
        toastr.error('비밀번호가 올바르지 않아요.', '🔞또또NSFW');
        return;
    }
    setDeveloperMode(!getSettings().developerMode);
}

function getChatMeta(create = true) {
    const context = getContext();
    if (!context.chatMetadata || typeof context.chatMetadata !== 'object') return null;
    let needsSave = false;
    if (!context.chatMetadata[CHAT_STATE_KEY]) {
        if (!create) return null;
        context.chatMetadata[CHAT_STATE_KEY] = {
            chatSchemaVersion: CHAT_STATE_SCHEMA_VERSION,
            enabled: true,
            manualState: null,
            ignoredActs: [],
            autoArmed: false,
            sfwImmediateHandoff: false,
            slowBurnStageOverride: null,
            slowBurnLocked: false,
            slowBurnSessionActive: false,
            slowBurnSessionStartAssistantCount: null,
            slowBurnRecoveryPending: false,
            slowBurnTarget: '',
            slowBurnTargetTurns: 3,
            slowBurnTargetActive: false,
            slowBurnTargetCompleted: false,
            ignoredDialogueBeats: [],
        };
        needsSave = true;
    }
    const meta = context.chatMetadata[CHAT_STATE_KEY];
    const previousChatSchemaVersion = Number(meta.chatSchemaVersion) || 0;
    // 최초 업데이트 때만 기존 채팅의 사용 토글을 기본 ON으로 맞춘다.
    // 이후 사용자가 직접 끈 값은 chatSchemaVersion이 남아 그대로 보존된다.
    if (previousChatSchemaVersion < CHAT_STATE_SCHEMA_VERSION) {
        meta.enabled = true;
        meta.chatSchemaVersion = CHAT_STATE_SCHEMA_VERSION;
        needsSave = true;
    }
    if (!Array.isArray(meta.ignoredActs)) meta.ignoredActs = [];
    if (!Array.isArray(meta.ignoredDialogueBeats)) meta.ignoredDialogueBeats = [];
    if (!Array.isArray(meta.customBans)) meta.customBans = [];
    meta.sfwImmediateHandoff = Boolean(meta.sfwImmediateHandoff);
    if (typeof meta.slowBurnTarget !== 'string') meta.slowBurnTarget = '';
    meta.slowBurnTarget = sanitizeSlowBurnTarget(meta.slowBurnTarget);
    meta.slowBurnTargetTurns = clampSlowBurnTargetTurns(meta.slowBurnTargetTurns);
    meta.slowBurnTargetActive = Boolean(meta.slowBurnTargetActive && meta.slowBurnTarget);
    meta.slowBurnTargetCompleted = Boolean(meta.slowBurnTargetCompleted && meta.slowBurnTarget);
    if (needsSave) saveChatMeta();
    return meta;
}

function saveChatMeta() {
    const context = getContext();
    if (typeof context.saveMetadataDebounced === 'function') context.saveMetadataDebounced();
    else if (typeof context.saveMetadata === 'function') void context.saveMetadata();
}

// 감시 중: 이 채팅에서 확장이 동작할 조건이 다 켜져 있는 상태 (최소한 상태 태그는 수집)
function isSupervising() {
    const settings = getSettings();
    const meta = getChatMeta(false);
    return Boolean(runtimeActive && settings.enabled && settings.adultConfirmed && meta?.enabled);
}

// 완전 무장: 연속성·반복금지·진행 지시까지 전부 주입하는 상태
function isFullyArmed() {
    if (!isSupervising()) return false;
    const settings = getSettings();
    if (settings.armMode === 'manual') return true;
    return Boolean(getChatMeta(false)?.autoArmed);
}

// ───────────────────────── 스텔스 로컬 감지 ─────────────────────────

function nsfwScoreDetail(text) {
    return scoreScene(text, getSettings().stealthKeywords);
}

function nsfwScore(text) {
    return nsfwScoreDetail(text).score;
}

function stealthWindowDetail({ ignoreCooldown = false } = {}) {
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    // 해제 직후 직전 장면의 잔열로 곧바로 재무장하는 것 방지: 쿨다운 마커 이후 메시지만 스캔
    const storedFrom = Number(getChatMeta(false)?.stealthCooldownFrom ?? 0);
    // 메시지 삭제나 스와이프로 길이가 줄어든 채팅에 남은 마커는 무효화한다.
    const from = !ignoreCooldown && Number.isInteger(storedFrom) && storedFrom >= 0 && storedFrom <= chat.length ? storedFrom : 0;
    let recent = chat
        .map((message, index) => ({ message, index }))
        .filter(({ message, index }) => message && !message.is_system && index >= from)
        .slice(-STEALTH_WINDOW);
    // 명확한 일상 위생 장면으로 전환했으면 직전 메시지의 성적 점수를 이월하지 않는다.
    if (recent.length && nsfwScoreDetail(stripStateTag(recent.at(-1).message.mes)).routineOnly) recent = recent.slice(-1);
    const hits = [];
    let score = 0;
    for (const { message } of recent) {
        const detail = nsfwScoreDetail(stripStateTag(message.mes));
        score += detail.score;
        hits.push(...detail.hits);
    }
    return { score, hits };
}

function stealthWindowScore() {
    return stealthWindowDetail().score;
}

// 최근 k개 메시지가 전부 신호 0점인지 (해제 폴백용 — 쿨다운 마커와 무관하게 전체에서 봄)
function stealthColdStreak(k = STEALTH_COLD_STREAK) {
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    const recent = chat.filter((message) => message && !message.is_system).slice(-k);
    if (recent.some(isPendingAssistant)) return false;
    // 샤워·목욕으로 분명히 전환한 경우에는 이전 성적 답변 한 개 때문에 유지하지 않는다.
    if (recent.length && nsfwScoreDetail(stripStateTag(recent.at(-1).mes)).routineOnly) return true;
    if (recent.length < k) return false;
    return recent.every((message) => nsfwScore(stripStateTag(message.mes)) === 0);
}

// 새 스와이프의 빈 자리/생성 표시를 완성된 일상 답변으로 해석하지 않는다.
function isPendingAssistant(message) {
    return message && !message.is_user && !message.is_system
        && /^(?:\s|\.{3}|…)*$/.test(String(message.mes ?? ''));
}

let rewriteGeneration = null;
let generationEvents = [];
let lastCompletedAssistant = null;

function beginSceneGeneration(type, fromEvent = false, dryRun = false) {
    if (dryRun) return;
    const normalized = normalizeGenerationType(type);
    if (fromEvent) generationEvents.push(normalized);
    if (!ALLOWED_GENERATION_TYPES.has(normalized)) return;
    if (normalized !== 'swipe' && normalized !== 'regenerate') {
        rewriteGeneration = null;
        return;
    }
    // 생성 시작 시 담당만 보존한다. 이전 스와이프의 인물/행위 상태는 복사하지 않는다.
    const context = getContext();
    const removedReply = normalized === 'regenerate' && lastCompletedAssistant
        && lastCompletedAssistant.metadata === context.chatMetadata
        && !context.chat?.includes(lastCompletedAssistant.message);
    if (!holdsRewriteGeneration() && !removedReply) maybeStealthRelease();
    if (isFullyArmed()) rewriteGeneration = { metadata: context.chatMetadata };
}

function holdsRewriteGeneration() {
    return Boolean(rewriteGeneration
        && rewriteGeneration.metadata === getContext().chatMetadata && isFullyArmed());
}

function finishSceneGeneration(type) {
    const normalized = typeof type === 'string' ? normalizeGenerationType(type) : generationEvents.at(-1);
    const index = generationEvents.lastIndexOf(normalized);
    if (index >= 0) generationEvents.splice(index, 1);
    // 중첩된 보조 분석의 완료는 본 스와이프 생성의 담당을 풀지 않는다.
    if (normalized === 'quiet') return false;
    rewriteGeneration = null;
    return true;
}

function finishReceivedGeneration() {
    rewriteGeneration = null;
    generationEvents = generationEvents.filter((type) => type === 'quiet');
}

// 원탭 강제 무장/해제 — 스텔스 감지가 놓쳤을 때(은유적 장면 등)의 수동 오버라이드
function forceToggleArm() {
    const settings = getSettings();
    if (!settings.enabled || !settings.adultConfirmed) {
        toastr.warning('전체 사용과 성인 캐릭터 확인을 먼저 켜주세요.', '🔞또또NSFW');
        return;
    }
    const meta = getChatMeta();
    if (settings.armMode === 'manual') {
        const wasEnabled = Boolean(meta.enabled);
        meta.enabled = !wasEnabled;
        if (!meta.enabled) {
            meta.bridgePending = Boolean(settings.exitBridge);
            meta.sfwImmediateHandoff = false;
            resetSlowBurnSession(meta);
        } else {
            meta.bridgePending = false;
        }
        saveChatMeta();
        if (meta.enabled && settings.slowBurnEnabled) startSlowBurnSessionIfNeeded();
        toastr.info(meta.enabled ? '이 채팅에서 개입을 시작해요.' : '이 채팅에서 개입을 껐어요.', '🔞또또NSFW');
        updateUi();
        return;
    }
    if (!meta.enabled) meta.enabled = true; // 채팅 토글이 꺼져 있었으면 같이 켠다
    if (meta.autoArmed) {
        meta.autoArmed = false;
        meta.forceArmed = false;
        meta.bridgePending = Boolean(settings.exitBridge);
        meta.sfwImmediateHandoff = false;
        resetSlowBurnSession(meta);
        const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
        meta.stealthCooldownFrom = chat.length;
        meta.stealthCooldownReason = 'manual';
        toastr.info('개입을 해제하고 대기로 돌아가요.', '🔞또또NSFW');
    } else {
        meta.autoArmed = true;
        meta.armSource = 'manual';
        meta.forceArmed = true; // 강제 무장 중엔 "신호 없음"을 이유로 자동 해제하지 않음 (온도 해제는 유효)
        meta.sfwImmediateHandoff = false;
        toastr.info('지금부터 연속성 개입을 시작해요.', '🔞또또NSFW');
        if (settings.autoRefine) {
            clearTimeout(refineTimer);
            refineTimer = setTimeout(() => { void runRefine(); }, 300);
        }
    }
    saveChatMeta();
    updateUi();
}

// 단어 점수에 의한 시작은 스텔스 모드 전용. 온도 자동의 기준을 우회하지 않는다.
function maybeStealthArm() {
    const settings = getSettings();
    if (settings.armMode !== 'stealth' || !isSupervising()) return false;
    const meta = getChatMeta(false);
    if (!meta || meta.autoArmed) return false;
    const threshold = STEALTH_THRESHOLDS[settings.stealthSensitivity] ?? STEALTH_THRESHOLDS.normal;
    let score = stealthWindowScore();
    // 자동 해제의 오래된 마커는 현재 본문의 분명한 신호를 가리지 않는다.
    // 사용자가 직접 해제한 마커는 유지한다.
    if (score < threshold && meta.stealthCooldownReason !== 'manual') {
        score = stealthWindowDetail({ ignoreCooldown: true }).score;
    }
    diagnosticRecord('local_decision', { score, threshold, reason: score < threshold ? 'below_local_threshold' : 'armed_locally' });
    if (score < threshold) return false;
    meta.autoArmed = true;
    meta.armSource = 'local';
    meta.sfwImmediateHandoff = false;
    saveChatMeta();
    toastr.info(`NSFW 신호 감지 (점수 ${score}) — 연속성 개입을 시작해요.`, '🔞또또NSFW');
    if (settings.autoRefine) {
        scheduleAutoRefine();
    }
    updateUi();
    return true;
}

function recentReportedHeat() {
    const recent = (Array.isArray(getContext().chat) ? getContext().chat : [])
        .filter((message) => message && !message.is_system).slice(-STEALTH_WINDOW);
    if (recent.length && nsfwScoreDetail(stripStateTag(recent.at(-1).mes)).routineOnly) return null;
    const message = [...recent].reverse().find((entry) => !entry.is_user);
    if (!message || nsfwScoreDetail(stripStateTag(message.mes)).routineOnly) return null;
    const state = parseStateFromText(message.mes)
        ?? (snapshotMatchesMessage(message) ? snapshotForMessage(message)?.state : null);
    return state?.heat ?? null;
}

// 이미 현재 행동 신호가 사라진 장면은 다음 생성 전에 즉시 해제한다.
// 과거 신체 묘사만 남은 상태에서 불필요한 마무리 브릿지를 다시 넣지 않는다.
function maybeStealthRelease() {
    const settings = getSettings();
    const meta = getChatMeta(false);
    if (settings.armMode === 'manual' || !meta?.autoArmed || meta.forceArmed || holdsRewriteGeneration() || !stealthColdStreak()) return false;
    // 은유 때문에 단어 점수가 0이어도 현재 응답의 유효한 높은 온도 보고는 유지한다.
    // 최근 창 밖의 오래된 상태나 현재 스와이프와 맞지 않는 상태는 쓰지 않는다.
    const heat = recentReportedHeat();
    if (heat > AUTO_ARM_OFF) return false;
    // Temperature mode must not mistake an absent/invalid report for cold heat.
    // Lexical absence is only a fallback for stealth. Explicit routine changes
    // remain eligible for handoff, including a new user-authored transition.
    const latest = (Array.isArray(getContext().chat) ? getContext().chat : [])
        .filter((message) => message && !message.is_system).at(-1);
    const routineTransition = Boolean(latest && nsfwScoreDetail(stripStateTag(latest.mes)).routineOnly);
    if (settings.armMode === 'auto' && heat == null && !routineTransition) {
        diagnosticRecord('release_skipped', { reason: 'missing_current_heat', ...diagnosticState() });
        return false;
    }
    const prematureSlowBurnEnd = settings.slowBurnEnabled
        && meta.slowBurnSessionActive
        && !slowBurnProgress(settings).canConclude;
    if (prematureSlowBurnEnd) {
        meta.slowBurnRecoveryPending = true;
        meta.bridgePending = false;
        saveChatMeta();
        return false;
    }
    meta.autoArmed = false;
    meta.forceArmed = false;
    meta.bridgePending = false;
    meta.sfwImmediateHandoff = true;
    resetSlowBurnSession(meta);
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    meta.stealthCooldownFrom = chat.length;
    meta.stealthCooldownReason = 'scene-ended';
    saveChatMeta();
    diagnosticRecord('release_decision', { reason: 'current_scene_ended', routineTransition, reportedHeatPresent: heat != null, ...(heat != null ? { reportedHeat: heat } : {}), ...diagnosticState() });
    toastr.info('현재 성적 행동이 끝난 것을 감지해 또또SFW로 인계해요.', '🔞또또NSFW');
    if (uiReady) updateUi();
    return true;
}

// ───────────────────────── 상태 스냅샷 ─────────────────────────
// 값은 이중 언어로 저장: 주입은 영어(en), UI 표시는 한국어(ko).
// 태그에는 "English phrase || 한국어 구" 형식으로 오고, 구버전 데이터(단일 문자열)도 호환.

function toBi(value) {
    if (value && typeof value === 'object') {
        return { en: String(value.en ?? '').trim().slice(0, SAFETY_LIMIT), ko: String(value.ko ?? '').trim().slice(0, SAFETY_LIMIT) };
    }
    const raw = String(value ?? '').trim().slice(0, SAFETY_LIMIT);
    if (!raw) return { en: '', ko: '' };
    const parts = raw.split(/\s*\|\|\s*/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        return { en: parts[0].trim(), ko: parts.slice(1).join(' ').trim() };
    }
    return { en: raw, ko: raw };
}

function biText(bi, lang = 'ko') {
    if (!bi) return '';
    if (typeof bi === 'string') return bi;
    return bi[lang] || bi[lang === 'en' ? 'ko' : 'en'] || '';
}

function hasBi(bi) {
    return Boolean(biText(bi, 'en') || biText(bi, 'ko'));
}

function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const clean = {
        location: { en: '', ko: '' },
        characters: {},
        acts: [],
        dialogueBeats: [],
        dialogueReported: Object.prototype.hasOwnProperty.call(raw, 'dialogue_beats')
            || Object.prototype.hasOwnProperty.call(raw, 'dialogueBeats'),
        stage: null,
    };
    clean.location = toBi(raw.location);
    const characters = raw.characters && typeof raw.characters === 'object' ? raw.characters : {};
    for (const [name, info] of Object.entries(characters).slice(0, 64)) {
        if (!name || typeof info !== 'object' || info === null) continue;
        clean.characters[String(name).slice(0, SAFETY_LIMIT)] = {
            clothing: toBi(info.clothing ?? info.appearance),
            position: toBi(info.position),
            contact: toBi(info.contact ?? info.holding),
        };
    }
    const acts = Array.isArray(raw.acts) ? raw.acts : [];
    clean.acts = acts.map(toBi).filter(hasBi).slice(0, 64);
    const dialogueBeats = Array.isArray(raw.dialogue_beats)
        ? raw.dialogue_beats
        : Array.isArray(raw.dialogueBeats) ? raw.dialogueBeats : [];
    clean.dialogueBeats = dialogueBeats.map(toBi).filter(hasBi).slice(0, 4);
    const heat = raw.heat === null || raw.heat === undefined || String(raw.heat).trim() === '' ? NaN : Number(raw.heat);
    clean.heat = Number.isFinite(heat) ? Math.max(0, Math.min(10, Math.round(heat))) : null;
    const stage = raw.stage === null || raw.stage === undefined ? NaN : Number(raw.stage);
    clean.stage = Number.isFinite(stage) ? Math.max(1, Math.min(6, Math.round(stage))) : null;
    const next = Array.isArray(raw.next) ? raw.next : [];
    clean.next = next.map(toBi).filter(hasBi).slice(0, 8);
    const hasCharacters = Object.values(clean.characters).some((info) => hasBi(info.clothing) || hasBi(info.position) || hasBi(info.contact));
    if (!hasBi(clean.location) && !hasCharacters && !clean.acts.length && !clean.dialogueBeats.length && clean.heat === null && clean.stage === null && !clean.next.length) return null;
    return clean;
}

function stateCompletenessIssues(state, settings = getSettings()) {
    if (!state) return ['state'];
    const issues = [];
    if (!hasBi(state.location)) issues.push('location');
    const hasCharacterState = Object.values(state.characters ?? {}).some(
        (info) => hasBi(info.clothing) || hasBi(info.position) || hasBi(info.contact),
    );
    if (!hasCharacterState) issues.push('characters');
    if (!state.acts?.length) issues.push('acts');
    if (state.heat === null || state.heat === undefined) issues.push('heat');
    if (settings.slowBurnEnabled && (state.stage === null || state.stage === undefined)) issues.push('stage');
    if (settings.nextBeatHints && !state.next?.length) issues.push('next');
    return issues;
}

// 모델이 JSON 문자열 안에 실제 줄바꿈/탭을 넣은 경우에만 표기를 복구한다.
// 값·따옴표·키·잘린 구조는 추측해서 변경하지 않는다. 정상 JSON은 그대로 파싱한다.
function parseStateJson(text) {
    const source = String(text ?? '');
    try {
        return JSON.parse(source);
    } catch (originalError) {
        let inString = false;
        let escaped = false;
        let repaired = '';
        let changed = false;
        for (const char of source) {
            const code = char.charCodeAt(0);
            if (inString && code < 0x20) {
                // 직전의 역슬래시는 이미 출력했으므로 겹치지 않게 한다.
                repaired += (escaped ? '' : '\\') + `u${code.toString(16).padStart(4, '0')}`;
                escaped = false;
                changed = true;
                continue;
            }
            repaired += char;
            if (!inString) {
                if (char === '"') inString = true;
            } else if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
        }
        if (!changed) throw originalError;
        return JSON.parse(repaired);
    }
}

function parseStateFromText(text, regex = STATE_TAG_REGEX) {
    const source = String(text ?? '');
    let lastJson = null;
    for (const match of source.matchAll(regex)) {
        lastJson = match[1];
    }
    if (!lastJson) return null;
    const start = lastJson.indexOf('{');
    const end = lastJson.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return sanitizeState(parseStateJson(lastJson.slice(start, end + 1)));
    } catch {
        return null;
    }
}

function stripStateTag(text) {
    const source = String(text ?? '');
    const withoutTrailingAck = source.replace(STATE_TRAILING_ACK_REGEX, '$1');
    const cleaned = withoutTrailingAck
        .replace(STATE_TAG_LOOSE_REGEX, '')
        .replace(STATE_TAG_REGEX, '')
        // 스트리밍 중 잘렸거나 모델이 닫는 태그를 누락한 경우에도 기계용 내용이 본문에 노출되지 않게 제거한다.
        .replace(/```(?:json)?\s*<scene_state\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<scene_state\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<\/scene_state>\s*```/gi, '')
        .replace(/<\/scene_state>/gi, '');
    return cleaned
        .replace(/\n{3,}$/g, '\n')
        .replace(/[ \t]+$/g, '')
        .trimEnd();
}

// 현재 답변의 다른 확장 형식만 호환한다. 과거 SFW 스냅샷은 가져오지 않는다.
function parseCompatibleSfwState(text) {
    const state = parseStateFromText(text, /<sfw_scene\b[^>]*>([\s\S]*?)<\/sfw_scene>/gi);
    if (!state) return null;
    // SFW 서사 강도/단계는 NSFW 온도/단계와 의미가 다르다.
    state.heat = null;
    state.stage = null;
    return state;
}

function stripCompatibleSfwTag(text) {
    return String(text ?? '')
        .replace(/<sfw_scene\b[^>]*>[\s\S]*?<\/sfw_scene>/gi, '')
        .replace(/<sfw_scene\b[^>]*>[\s\S]*$/gi, '')
        .trimEnd();
}

// Compare narrative bodies independently of either extension's machine report.
// Keep substantive edits significant; normalize only known report wrappers,
// line endings, trailing spaces, and the established appended-translation marker.
function canonicalSceneBody(text) {
    const clean = String(text ?? '')
        .replace(/(<\/(?:scene_state|sfw_scene)>[ \t]*(?:\r?\n[ \t]*```)?)[ \t\r\n]+(?:no\s+changes?|unchanged)[ \t]*[.!]?[ \t]*$/i, '$1')
        .replace(/```(?:json)?\s*<(scene_state|sfw_scene)\b[^>]*>[\s\S]*?<\/\1>\s*```/gi, '')
        .replace(/<(scene_state|sfw_scene)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/```(?:json)?\s*<(?:scene_state|sfw_scene)\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<(?:scene_state|sfw_scene)\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<\/(?:scene_state|sfw_scene)>\s*```/gi, '')
        .replace(/<\/(?:scene_state|sfw_scene)>/gi, '');
    const marker = clean.search(/\r?\n\s*번역문\s*\r?\n/i);
    return (marker >= 0 ? clean.slice(0, marker) : clean)
        .replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
}

function recordBody(text) {
    return canonicalSceneBody(text);
}

function messageStateSignature(message) {
    return signatureForBody(message, recordBody(message?.mes));
}

function legacyMessageStateSignature(message) {
    return signatureForBody(message, stripCompatibleSfwTag(stripStateTag(message?.mes)));
}

function signatureForBody(message, text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${currentSwipeIndex(message)}:${text.length}:${(hash >>> 0).toString(36)}`;
}

function mergeCurrentReports(primary, compatible) {
    if (!primary) return compatible;
    if (!compatible) return primary;
    const merged = structuredClone(primary);
    if (!hasBi(merged.location)) merged.location = compatible.location;
    for (const [name, fields] of Object.entries(compatible.characters)) {
        if (!merged.characters[name]) merged.characters[name] = fields;
        else for (const field of ['clothing', 'position', 'contact']) {
            if (!hasBi(merged.characters[name][field])) merged.characters[name][field] = fields[field];
        }
    }
    for (const field of ['acts', 'dialogueBeats', 'next']) {
        if (!merged[field]?.length) merged[field] = compatible[field];
    }
    merged.dialogueReported ||= compatible.dialogueReported;
    return merged;
}

function getMessageStore(message, create = true) {
    if (!message) return null;
    if (!message.extra || typeof message.extra !== 'object') {
        if (!create) return null;
        message.extra = {};
    }
    if (!message.extra[MESSAGE_EXTRA_KEY]) {
        if (!create) return null;
        message.extra[MESSAGE_EXTRA_KEY] = { swipes: {} };
    }
    const store = message.extra[MESSAGE_EXTRA_KEY];
    if (!store.swipes || typeof store.swipes !== 'object') store.swipes = {};
    return store;
}

function currentSwipeIndex(message) {
    return Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
}

function snapshotForMessage(message) {
    const store = getMessageStore(message, false);
    if (!store) return null;
    return store.swipes[String(currentSwipeIndex(message))] ?? null;
}

// AI 메시지에서 상태 태그를 추출·저장하고 본문에서 제거. 변경 여부를 반환.
function harvestMessage(message) {
    if (!message || message.is_user || message.is_system) return { changed: false, found: false, state: null };
    const swipeIndex = currentSwipeIndex(message);
    let changed = false;
    let found = false;

    const direct = parseStateFromText(message.mes);
    const compatible = isFullyArmed() ? parseCompatibleSfwState(message.mes) : null;
    const signature = messageStateSignature(message);
    const previous = snapshotForMessage(message);
    // 두 수신 훅 순서가 바뀌어도 같은 답변의 직접 보고를 우선한다.
    const primary = direct ?? (snapshotMatchesMessage(message, previous) ? previous.state : null);
    const state = compatible ? mergeCurrentReports(primary, compatible) : direct;
    if (state) {
        const store = getMessageStore(message);
        store.swipes[String(swipeIndex)] = { state, at: Date.now(), messageSignature: signature, signatureVersion: 2 };
        found = true;
    }
    // SFW must be able to harvest its own report after a same-response release.
    // Read compatible facts above, but strip only our own tag.
    const clean = (text) => stripStateTag(text);
    const strippedMes = clean(message.mes);
    if (strippedMes !== message.mes) {
        message.mes = strippedMes;
        changed = true;
    }
    if (Array.isArray(message.swipes) && typeof message.swipes[swipeIndex] === 'string') {
        const strippedSwipe = clean(message.swipes[swipeIndex]);
        if (strippedSwipe !== message.swipes[swipeIndex]) {
            message.swipes[swipeIndex] = strippedSwipe;
            changed = true;
        }
    }
    if (!found) {
        found = snapshotMatchesMessage(message);
    }
    return { changed, found, state };
}

function assistantMessages() {
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    return chat.filter((message) => message && !message.is_user && !message.is_system);
}

function snapshotMatchesMessage(message, snapshot = snapshotForMessage(message)) {
    return Boolean(snapshot?.state && (snapshot.messageSignature === messageStateSignature(message)
        || (snapshot.signatureVersion !== 2 && snapshot.messageSignature === legacyMessageStateSignature(message))));
}

function currentStateTarget(message = assistantMessages().at(-1)) {
    if (!message || isPendingAssistant(message)) return null;
    return { index: getContext().chat.indexOf(message), swipe: currentSwipeIndex(message), signature: messageStateSignature(message) };
}

function manualMatchesLatest(manual, message, snapshot) {
    const target = currentStateTarget(message);
    if (!manual?.state || !target) return false;
    if (manual.target) return manual.target.index === target.index && manual.target.swipe === target.swipe
        && manual.target.signature === target.signature;
    // Old AI repairs already have a matching message snapshot; unbound manual
    // records cannot silently override a newer reply or a different swipe.
    return manual.source === 'ai-refine' && snapshotMatchesMessage(message, snapshot)
        && manual.at === snapshot.at;
}

// Current scene facts belong to the latest selected reply, never an older one.
function effectiveState() {
    const meta = getChatMeta(false);
    const message = assistantMessages().at(-1);
    if (!message || isPendingAssistant(message)) return { state: null, source: 'none' };
    const snapshot = snapshotForMessage(message);
    const valid = snapshotMatchesMessage(message, snapshot);
    const manual = meta?.manualState;
    if (manualMatchesLatest(manual, message, snapshot)
        && (!valid || Number(manual.at ?? 0) >= Number(snapshot.at ?? 0))) {
        return { state: manual.state, source: manual.source ?? 'manual' };
    }
    if (valid) return { state: snapshot.state, source: 'tag' };
    return { state: null, source: snapshot?.state ? 'body-changed' : 'missing-report' };
}

function stateForDisplay() {
    const current = effectiveState();
    if (current.source !== 'body-changed') return current;
    return { state: snapshotForMessage(assistantMessages().at(-1))?.state ?? null, source: 'body-changed' };
}

function ignoredActSet() {
    const meta = getChatMeta(false);
    return new Set((meta?.ignoredActs ?? []).map((act) => String(act).toLocaleLowerCase()));
}

function isActIgnored(act, ignored) {
    return ignored.has(biText(act, 'en').toLocaleLowerCase()) || ignored.has(biText(act, 'ko').toLocaleLowerCase());
}

function ignoredDialogueBeatSet() {
    const meta = getChatMeta(false);
    return new Set((meta?.ignoredDialogueBeats ?? []).map((beat) => String(beat).toLocaleLowerCase()));
}

function isDialogueBeatIgnored(beat, ignored) {
    return ignored.has(biText(beat, 'en').toLocaleLowerCase()) || ignored.has(biText(beat, 'ko').toLocaleLowerCase());
}

const ACT_STOP_WORDS = new Set([
    'a', 'an', 'the', 'to', 'of', 'and', 'with', 'her', 'his', 'their', 'she', 'he', 'they',
    '그', '그녀', '그의', '그녀의', '서로', '에게', '으로', '에서', '하다', '한다', '하며',
]);

function normalizeActText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/\b(kissing|kissed|kisses)\b/g, 'kiss')
        .replace(/\b(touching|touched|touches)\b/g, 'touch')
        .replace(/\b(licking|licked|licks)\b/g, 'lick')
        .replace(/\b(holding|held|holds)\b/g, 'hold')
        .replace(/\b(pulling|pulled|pulls)\b/g, 'pull')
        .replace(/\b(pressing|pressed|presses)\b/g, 'press')
        .replace(/\b(caressing|caressed|caresses)\b/g, 'caress')
        .replace(/입(?:을|술을)?\s*(?:맞추\S*|맞대\S*)|입맞춤/g, '키스')
        .replace(/끌어안\S*|껴안\S*/g, '포옹')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((token) => token && !ACT_STOP_WORDS.has(token))
        .join(' ');
}

function actVariants(act) {
    return [...new Set([biText(act, 'en'), biText(act, 'ko')].map(normalizeActText).filter(Boolean))];
}

function normalizedTextsSimilar(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    if (Math.min(left.length, right.length) >= 8 && (left.includes(right) || right.includes(left))) return true;
    const leftTokens = new Set(left.split(' '));
    const rightTokens = new Set(right.split(' '));
    const smaller = Math.min(leftTokens.size, rightTokens.size);
    if (smaller < 2) return false;
    const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return overlap / smaller >= 0.72;
}

function actsAreSimilar(left, right) {
    return actVariants(left).some((a) => actVariants(right).some((b) => normalizedTextsSimilar(a, b)));
}

function actMatchesPlainBan(act, ban) {
    const normalizedBan = normalizeActText(ban);
    if (!normalizedBan) return false;
    return actVariants(act).some((variant) => normalizedTextsSimilar(variant, normalizedBan));
}

// 최근 N턴의 전개(행위) 목록 — 오래된 것 → 최신 순.
// 총량이 maxBannedActs를 넘으면 오래된 것부터 잘라서 주입문 비대화를 막는다.
function recentActs(windowSize) {
    const ignored = ignoredActSet();
    const limit = Math.max(1, Number(windowSize) || DEFAULT_SETTINGS.repeatWindow);
    const messages = assistantMessages().slice(-limit);
    const rows = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const snapshot = snapshotForMessage(messages[i]);
        if (!snapshot?.state?.acts?.length || !snapshotMatchesMessage(messages[i], snapshot)) continue;
        const acts = snapshot.state.acts.filter((act) => !isActIgnored(act, ignored));
        if (acts.length) rows.unshift({ turnsAgo: messages.length - i, acts });
    }
    // 중복 제거 (같은 전개가 여러 턴에 반복 기록된 경우 최신 것만)
    const seenActs = [];
    for (let i = rows.length - 1; i >= 0; i--) {
        rows[i].acts = rows[i].acts.filter((act) => {
            if (seenActs.some((seen) => actsAreSimilar(act, seen))) return false;
            seenActs.push(act);
            return true;
        });
    }
    // 총량 상한: 오래된 것부터 제거
    const max = Math.max(3, Number(getSettings().maxBannedActs) || DEFAULT_SETTINGS.maxBannedActs);
    let total = rows.reduce((sum, row) => sum + row.acts.length, 0);
    while (total > max && rows.length) {
        const first = rows[0];
        const drop = Math.min(first.acts.length, total - max);
        first.acts = first.acts.slice(drop);
        total -= drop;
        if (!first.acts.length) rows.shift();
    }
    return rows.filter((row) => row.acts.length);
}

// 실험실: 최근 2개의 AI 답변에서 사용한 대사의 목적·기능. 같은 의도는 최신 항목만 남긴다.
function recentDialogueBeats(windowSize = Number(getSettings().dialogueWindow) || DIALOGUE_BEAT_WINDOW) {
    const ignored = ignoredDialogueBeatSet();
    const messages = assistantMessages().slice(-Math.max(1, windowSize));
    const rows = [];
    for (const message of messages) {
        const snapshot = snapshotForMessage(message);
        if (!snapshot?.state?.dialogueBeats?.length || !snapshotMatchesMessage(message, snapshot)) continue;
        const beats = snapshot.state.dialogueBeats.filter((beat) => !isDialogueBeatIgnored(beat, ignored));
        if (beats.length) rows.push({ beats });
    }
    const seen = [];
    for (let i = rows.length - 1; i >= 0; i--) {
        rows[i].beats = rows[i].beats.filter((beat) => {
            if (seen.some((item) => actsAreSimilar(beat, item))) return false;
            seen.push(beat);
            return true;
        });
    }
    return rows.filter((row) => row.beats.length);
}

// ───────────────────────── CardInject 연동 ─────────────────────────
// CardInject가 캐릭터별로 저장한 카테고리(extensionSettings.cardinject.perChar[캐릭터키].categories)를
// 읽기 전용으로 참조한다. CardInject 쪽 코드는 건드리지 않는다.
// 용도: 다음 전개 힌트를 만들 때 캐릭터 시트의 성향·취향 카테고리를 참고 자료로 쓴다.
// 같은 카테고리를 CardInject에서 꺼두면(enabled 해제) 이 확장이 "무장 중에만" 주입하게 된다.
const CARD_LINK_STORE_KEY = 'cardinject';
const CARD_LINK_CHAR_LIMIT = 2500; // 참고 자료 총량 상한 (주입문 비대화 방지)
const CARD_LINK_HINT_RE = /kink|fetish|preference|sexual|nsfw|성향|취향|선호|성적|섹|플레이/i;

// 지금 채팅의 캐릭터들 (그룹 채팅이면 멤버 전체). CardInject와 같은 키 규칙: avatar 우선, 없으면 name.
function activeCharacterEntries() {
    const context = getContext();
    const characters = Array.isArray(context.characters) ? context.characters : [];
    const entries = [];
    const push = (char) => {
        if (!char) return;
        const key = char.avatar || char.name;
        if (!key || entries.some((entry) => entry.key === key)) return;
        entries.push({ key: String(key), name: String(char.name || key) });
    };
    const groupId = context.groupId;
    if (groupId !== null && groupId !== undefined && groupId !== '') {
        const group = (Array.isArray(context.groups) ? context.groups : []).find((item) => String(item?.id) === String(groupId));
        for (const member of group?.members ?? []) push(characters.find((char) => char?.avatar === member));
    } else {
        const id = Number(context.characterId);
        if (Number.isInteger(id)) push(characters[id]);
    }
    return entries;
}

// CardInject에 저장된 카테고리 목록 (내용이 있는 것만)
function cardLinkOptions() {
    const store = getContext().extensionSettings?.[CARD_LINK_STORE_KEY];
    if (!store || typeof store !== 'object' || !store.perChar || typeof store.perChar !== 'object') {
        return { available: false, rows: [] };
    }
    const rows = [];
    for (const entry of activeCharacterEntries()) {
        const categories = store.perChar[entry.key]?.categories;
        if (!Array.isArray(categories)) continue;
        for (const category of categories) {
            const content = String(category?.content ?? '').trim();
            if (!category?.key || !content) continue;
            const name = String(category.name || category.key);
            rows.push({
                charKey: entry.key,
                charName: entry.name,
                catKey: String(category.key),
                name,
                content,
                ciEnabled: Boolean(category.enabled),
                likely: CARD_LINK_HINT_RE.test(name),
            });
        }
    }
    return { available: true, rows };
}

// CardInject 내용에는 {{char}}/{{user}} 매크로가 그대로 들어 있으므로 주입 전에 풀어준다.
function resolveCardMacros(text, charName) {
    const context = getContext();
    const userName = String(context.name1 ?? 'User');
    let out = String(text ?? '');
    try {
        if (typeof context.substituteParams === 'function') out = context.substituteParams(out, userName, charName);
    } catch (error) {
        console.debug(`${LOG_PREFIX} 매크로 치환 생략`, error);
    }
    return out
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName);
}

// 선택된 카테고리를 "- 이름 — 카테고리: 내용" 줄 목록으로. 총량 상한을 넘으면 잘라낸다.
function cardLinkPreferenceText() {
    const settings = getSettings();
    if (!settings.cardLinkEnabled) return '';
    const selected = settings.cardLinkSelected ?? {};
    const { rows } = cardLinkOptions();
    const lines = [];
    let total = 0;
    for (const row of rows) {
        if (!Array.isArray(selected[row.charKey]) || !selected[row.charKey].includes(row.catKey)) continue;
        const body = resolveCardMacros(row.content, row.charName).replace(/\s*\n\s*/g, ' ').trim();
        if (!body) continue;
        let line = `- ${row.charName} — ${row.name}: ${body}`;
        const remaining = CARD_LINK_CHAR_LIMIT - total;
        if (remaining <= 40) break;
        if (line.length > remaining) line = `${line.slice(0, remaining - 1)}…`;
        lines.push(line);
        total += line.length + 1;
    }
    return lines.join('\n');
}

function buildCardPreferenceLines() {
    const text = cardLinkPreferenceText();
    if (!text) return [];
    return [
        'CHARACTER PREFERENCES (from the character sheet — inspiration for choosing what happens next, not a checklist. Never force them, and never contradict the current scene state, hard limits, or user-banned items):',
        text,
    ];
}

// ───────────────────────── 주입문 생성 ─────────────────────────

function buildStateLines(state) {
    const lines = [];
    if (hasBi(state.location)) lines.push(`- Location: ${biText(state.location, 'en')}`);
    for (const [name, info] of Object.entries(state.characters)) {
        const parts = [];
        if (hasBi(info.clothing)) parts.push(`clothing: ${biText(info.clothing, 'en')}`);
        if (hasBi(info.position)) parts.push(`position/posture: ${biText(info.position, 'en')}`);
        if (hasBi(info.contact)) parts.push(`physical contact: ${biText(info.contact, 'en')}`);
        if (parts.length) lines.push(`- ${name} — ${parts.join('; ')}`);
    }
    return lines;
}

// 최신 스냅샷의 다음 전개 후보 (반복 금지 목록·무시 목록과 겹치는 건 제외)
function nextBeatCandidates() {
    const ignored = ignoredActSet();
    const { state } = effectiveState();
    if (!state?.next?.length) return [];
    const settings = getSettings();
    const bannedActs = recentActs(Number(settings.repeatWindow) || DEFAULT_SETTINGS.repeatWindow)
        .flatMap((row) => row.acts);
    const customBans = [
        ...(getChatMeta(false)?.customBans ?? []),
        ...(getSettings().globalBans ?? []),
    ].map(String).filter(Boolean);
    const accepted = [];
    for (const beat of state.next) {
        if (isActIgnored(beat, ignored)) continue;
        if (customBans.some((ban) => actMatchesPlainBan(beat, ban))) continue;
        if (bannedActs.some((act) => actsAreSimilar(beat, act))) continue;
        if (accepted.some((candidate) => actsAreSimilar(beat, candidate))) continue;
        accepted.push(beat);
    }
    return accepted;
}

// 진행 속도 결정 — 'auto'면 온도 곡선이 지휘: 달아오르는 중(~7)엔 전진, 절정 직전(8~9)엔 가속, 정점(10)엔 유지·심화
function resolvePace(settings, state) {
    if (settings.paceMode !== 'auto') {
        return PACE_INSTRUCTIONS[settings.paceMode] ?? PACE_INSTRUCTIONS.slow;
    }
    const heat = Number(state?.heat);
    if (!Number.isFinite(heat)) return PACE_INSTRUCTIONS.slow;
    if (heat >= 10) return PACE_INSTRUCTIONS.hold;
    if (heat >= 8) return PACE_INSTRUCTIONS.push;
    return PACE_INSTRUCTIONS.slow;
}

function stageFromState(state) {
    const reported = state?.stage === null || state?.stage === undefined ? NaN : Number(state.stage);
    if (Number.isFinite(reported)) return Math.max(1, Math.min(6, Math.round(reported)));
    const heat = Number(state?.heat);
    if (!Number.isFinite(heat)) return 1;
    if (heat >= 10) return 6;
    if (heat >= 8) return 5;
    if (heat >= 7) return 4;
    if (heat >= 5) return 3;
    if (heat >= 3) return 2;
    return 1;
}

function slowBurnStageInfo() {
    const meta = getChatMeta(false);
    const override = Number(meta?.slowBurnStageOverride);
    if (Number.isFinite(override) && override >= 1 && override <= 6) {
        return { stage: Math.round(override), source: 'manual' };
    }
    const { state } = effectiveState();
    if (state?.stage !== null && state?.stage !== undefined && Number.isFinite(Number(state.stage))) {
        return { stage: stageFromState(state), source: 'reported' };
    }
    if (state?.heat !== null && state?.heat !== undefined && Number.isFinite(Number(state.heat))) {
        return { stage: stageFromState(state), source: 'heat' };
    }
    return { stage: 1, source: 'default' };
}

function sanitizeSlowBurnTarget(value) {
    return String(value ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, SLOW_BURN_TARGET_MAX_LENGTH);
}

function clampSlowBurnTargetTurns(value) {
    return Math.max(1, Math.min(SLOW_BURN_TARGET_MAX_TURNS, Math.round(Number(value) || 3)));
}

function resetSlowBurnSession(meta = getChatMeta(false)) {
    if (!meta) return;
    meta.slowBurnSessionActive = false;
    meta.slowBurnSessionStartAssistantCount = null;
    meta.slowBurnRecoveryPending = false;
    meta.slowBurnTargetActive = false;
}

function startSlowBurnSessionIfNeeded() {
    const settings = getSettings();
    const meta = getChatMeta(false);
    if (!settings.slowBurnEnabled || !meta || !isFullyArmed() || meta.slowBurnSessionActive) return false;
    meta.slowBurnSessionActive = true;
    meta.slowBurnSessionStartAssistantCount = assistantMessages().length;
    meta.slowBurnRecoveryPending = false;
    saveChatMeta();
    return true;
}

function slowBurnSessionStartCount() {
    const meta = getChatMeta(false);
    const count = Number(meta?.slowBurnSessionStartAssistantCount);
    if (meta?.slowBurnSessionActive && Number.isInteger(count) && count >= 0) return count;
    return assistantMessages().length;
}

function slowBurnTargetProgress() {
    const meta = getChatMeta(false);
    const developerMode = Boolean(getSettings().developerMode);
    const target = sanitizeSlowBurnTarget(meta?.slowBurnTarget);
    const requiredTurns = clampSlowBurnTargetTurns(meta?.slowBurnTargetTurns);
    const completedTurns = meta?.slowBurnSessionActive
        ? Math.max(0, assistantMessages().length - slowBurnSessionStartCount())
        : 0;
    const active = Boolean(developerMode && meta?.slowBurnTargetActive && target && meta?.slowBurnSessionActive);
    return {
        target,
        requiredTurns,
        completedTurns,
        remaining: active ? Math.max(0, requiredTurns - completedTurns) : 0,
        active,
        completed: Boolean(meta?.slowBurnTargetCompleted && target),
    };
}

function consecutiveSlowBurnTurns(stage, startCount = slowBurnSessionStartCount()) {
    let turns = 0;
    const messages = assistantMessages().slice(Math.max(0, startCount));
    for (let i = messages.length - 1; i >= 0; i--) {
        const snapshot = snapshotForMessage(messages[i]);
        if (!snapshot?.state) break;
        if (stageFromState(snapshot.state) !== stage) break;
        turns++;
    }
    return turns;
}

function slowBurnProgress(settings = getSettings()) {
    const { stage, source } = slowBurnStageInfo();
    const requiredTurns = SLOW_BURN_MIN_TURNS[settings.slowBurnIntensity] ?? SLOW_BURN_MIN_TURNS.slow;
    const startCount = slowBurnSessionStartCount();
    const sessionTurns = Math.max(0, assistantMessages().length - startCount);
    const turns = consecutiveSlowBurnTurns(stage, startCount);
    const meta = getChatMeta(false);
    const locked = Boolean(meta?.slowBurnLocked);
    const sessionRemaining = Math.max(0, requiredTurns - sessionTurns);
    const stageRemaining = Math.max(0, requiredTurns - turns);
    const canAdvance = !locked && stage < 6 && sessionRemaining === 0 && stageRemaining === 0;
    const target = slowBurnTargetProgress();
    const targetLocked = target.active && target.remaining > 0;
    const canConclude = !targetLocked && !locked && stage === 6 && sessionRemaining === 0 && stageRemaining === 0;
    return {
        stage,
        source,
        turns,
        sessionTurns,
        requiredTurns,
        sessionRemaining,
        stageRemaining,
        locked,
        canConclude,
        recoveryPending: Boolean(meta?.slowBurnRecoveryPending),
        target,
        maxStage: canAdvance ? Math.min(6, stage + 1) : stage,
    };
}

function buildTargetSlowBurnLines() {
    const progress = slowBurnTargetProgress();
    const targetLabel = JSON.stringify(progress.target);
    const responseNumber = Math.min(progress.requiredTurns, progress.completedTurns + 1);
    return [
        '[MANDATORY USER-TARGET SLOW-BURN LOCK — highest-priority scene rule]',
        `USER TARGET SCENE: ${targetLabel}. This is a direct scene requirement, not a suggestion, possible next beat, topic, metaphor, or optional preference.`,
        `EXACT RUN: ${progress.completedTurns}/${progress.requiredTurns} assistant responses completed. The response you are writing now is ${responseNumber}/${progress.requiredTurns}.`,
        `IMMEDIATE START: from the first paragraph of this response, the CHARACTER must begin or actively continue ${targetLabel} on-page. Do not delay it with setup, anticipation, unrelated dialogue, a different act, or a transition toward it.`,
        `Make ${targetLabel} the active, dominant, physically enacted scene throughout this entire response. Do not merely mention, discuss, promise, imagine, approach, summarize, or postpone it.`,
        'LANGUAGE RULE: the target may be written in Korean or another language. Understand its meaning directly before writing; never ignore it, quote it back, or treat it as unclear merely because the surrounding directive is English.',
        `The first through ${progress.requiredTurns}th responses ALL belong fully to ${targetLabel}. Even response ${progress.requiredTurns}/${progress.requiredTurns} must remain inside the target scene through its ending; only the following response may transition away.`,
        'ABSOLUTE HOLD: do not leave, replace, resolve, wind down, fade out, time-skip, cut to aftermath, fall asleep, separate, or move to a different scene while this target run is active. End on an open beat that can continue naturally.',
        'REPETITION EXCEPTION: the target scene itself is REQUIRED and is never prohibited by the recent-beat repetition list. Only exact micro-actions and wording should vary. Keep the target continuous while adding fresh dialogue, reactions, sensations, pacing, and emotional shifts.',
        `There are ${progress.remaining} target response(s), including this one, still required. Earlier chat messages, swipes, regenerations, and Continue expansions do not satisfy this count.`,
        'PRIORITY: if continuity, recent-beat avoidance, pacing, a suggested next beat, stage guidance, character hesitation, or any lower-priority instruction conflicts with immediately enacting and maintaining this target, this USER-TARGET LOCK wins. Preserve established physical facts while changing only what is necessary through explicit on-page actions. Hard safety limits and an explicit refusal from the USER still always apply.',
        'In the hidden state report, set "stage" to the stage actually reached at the END of the response (integer 1-6).',
    ];
}

// 상태 보고 지시 뒤에 한 번 더 배치해, 긴 연속성 프롬프트 속에서 목표가 묻히지 않게 한다.
function buildTargetFinalEnforcementLines() {
    const progress = slowBurnTargetProgress();
    if (!progress.active) return [];
    const targetLabel = JSON.stringify(progress.target);
    const responseNumber = Math.min(progress.requiredTurns, progress.completedTurns + 1);
    return [
        '[FINAL TARGET ENFORCEMENT — obey before writing the prose]',
        `RESPONSE ${responseNumber}/${progress.requiredTurns}: enact ${targetLabel} immediately from the first paragraph and keep it as the main on-page action through the final paragraph.`,
        `Do not substitute a related act, remain in preparation, ask permission again when consent is already established in context, or end before ${targetLabel} is actively happening.`,
        'The target itself overrides the recent-beat repetition ban; vary only its specific movements, dialogue, reactions, and sensory details.',
        'Before finishing, silently verify: (1) the target happened on-page, (2) it remained the dominant scene, and (3) the ending stays open for the next required target response. If any answer is no, revise the prose before returning it.',
    ];
}

function buildSlowBurnLines(settings) {
    if (slowBurnTargetProgress().active) return buildTargetSlowBurnLines();
    const progress = slowBurnProgress(settings);
    const current = SLOW_BURN_STAGES[progress.stage];
    const maximum = SLOW_BURN_STAGES[progress.maxStage];
    const lines = [
        '[MANDATORY SLOW-BURN LOCK — highest-priority scene progression rule]',
        `SLOW-BURN SESSION: ${progress.sessionTurns}/${progress.requiredTurns} CHARACTER responses completed since this mode was activated.`,
        `CURRENT STAGE ${progress.stage}/6: ${current.en}.`,
        `MAXIMUM CHARACTER-INITIATED STAGE THIS RESPONSE: ${progress.maxStage}/6 (${maximum.en}).`,
        'HARD RULE: Advance by at most one stage per response. Never begin and complete a new stage in the same response. Add one meaningful new beat while giving the current beat room to breathe.',
        'Slow burn means fresh tension, dialogue, reaction, and sensory detail — not repeating the same action, freezing the scene, padding, or rephrasing what already happened.',
        'Do not skip ahead, summarize omitted progression, fade to black, jump forward in time, cut to an aftermath, or move to a new scene.',
    ];
    if (progress.recoveryPending) {
        lines.push('PREMATURE-END RECOVERY: the previous response attempted to end or cool down the scene before the slow-burn lock was satisfied. Do not accept that ending as final and do not continue into aftermath. Resume from the last active beat, preserving continuity, and keep the scene open.');
    }
    if (!progress.canConclude) {
        lines.push('ABSOLUTE NO-CONCLUSION LOCK: Do NOT climax, finish, conclude, wind down, separate, fall asleep, cut away, or transition to aftercare/aftermath in this response. End on an open active beat that requires another turn. This rule applies even at stage 6.');
    }
    if (progress.sessionRemaining > 0) {
        lines.push(`The scene must remain active for at least ${progress.sessionRemaining} more CHARACTER response(s). This count started when slow-burn was turned on; earlier chat messages do not count.`);
    }
    if (progress.locked) {
        lines.push('STAGE LOCKED BY USER: remain within the current stage until the lock is released. Deepen it without escalating or regressing.');
    } else if (progress.stageRemaining > 0) {
        lines.push(`Remain in the current stage for at least ${progress.stageRemaining} more CHARACTER response(s) before entering the next stage.`);
    } else if (progress.stage < 6) {
        lines.push('You may enter the next stage if it follows naturally, but you are not required to do so.');
    } else if (progress.canConclude) {
        lines.push('The minimum session and final-stage residence are both satisfied. A conclusion is now permitted if it follows naturally, but it is not required.');
    } else {
        lines.push('Remain in the final stage without concluding until the no-conclusion lock is released.');
    }
    if (settings.slowBurnUserOverride) {
        lines.push('USER-LED STAGE OVERRIDE: if the USER explicitly initiates a later-stage action, follow that action naturally. This may bypass only the stage cap. It NEVER bypasses the minimum-response count or the ABSOLUTE NO-CONCLUSION LOCK. Mere passive reaction is not an override.');
    }
    const overrideNote = settings.slowBurnUserOverride ? ', except that an explicit USER-led action may raise the stage without permitting conclusion' : '';
    lines.push(`In the hidden state report, set "stage" to the stage actually reached at the END of the response (integer 1-6; current cap ${progress.maxStage}${overrideNote}).`);
    return lines;
}

const STATE_REPORT_LINES = [
    'STATE REPORT: End your response with exactly one state block in this format (single line, valid JSON). It is machine-read and hidden from the reader — include it every time:',
    '<scene_state>{"_status":"updated","location":"short English phrase || 짧은 한국어 구","characters":{"이름":{"clothing":"current clothing state, English || 한국어","position":"current posture/position, English || 한국어","contact":"current physical contact, English || 한국어"}},"acts":["2-4 significant new beats in this response, each \'English || 한국어\'"],"heat":0,"next":["2-3 fresh beats the scene could move to next, each \'English || 한국어\'"]}</scene_state>',
    'Every string value must be a bilingual pair: concise English first, then " || ", then natural Korean. Use the same character names as in the chat.',
    '"acts" rules: list ONLY substantive beats — physical/romantic/emotional developments that matter for repetition control. Skip mundane logistics (snacks, drinks, blankets, remote controls, small housekeeping actions). 2-4 items maximum, only what is NEW in this response.',
    ...HEAT_SCALE_LINES,
    'Update every field to reflect the situation at the END of your response. "next" must not repeat anything from "acts".',
    'The optional top-level "_status" field is the ONLY place for a change acknowledgement: use "no_change" there if you need to signal that tracked state did not change; otherwise use "updated". All real state fields must still repeat their complete current values.',
    'Never use placeholders such as "no change", "no changes", "unchanged", or "same" in location, character state, acts, heat, or next. Never output any acknowledgement, status note, or meta-comment outside the <scene_state> block.',
];

const SLOW_BURN_STATE_REPORT_LINES = [
    'STATE REPORT: End your response with exactly one state block in this format (single line, valid JSON). It is machine-read and hidden from the reader — include it every time:',
    '<scene_state>{"_status":"updated","location":"short English phrase || 짧은 한국어 구","characters":{"이름":{"clothing":"current clothing state, English || 한국어","position":"current posture/position, English || 한국어","contact":"current physical contact, English || 한국어"}},"acts":["2-4 significant new beats in this response, each \'English || 한국어\'"],"heat":0,"stage":1,"next":["2-3 fresh beats the scene could move to next, each \'English || 한국어\'"]}</scene_state>',
    'Every string value must be a bilingual pair: concise English first, then " || ", then natural Korean. Use the same character names as in the chat.',
    '"acts" rules: list ONLY substantive beats — physical/romantic/emotional developments that matter for repetition control. Skip mundane logistics (snacks, drinks, blankets, remote controls, small housekeeping actions). 2-4 items maximum, only what is NEW in this response.',
    ...HEAT_SCALE_LINES,
    '"stage" is the slow-burn progression stage as an integer from 1 to 6. Update every field to reflect the situation at the END of your response. "next" must not repeat anything from "acts".',
    'The optional top-level "_status" field is the ONLY place for a change acknowledgement: use "no_change" there if you need to signal that tracked state did not change; otherwise use "updated". All real state fields must still repeat their complete current values.',
    'Never use placeholders such as "no change", "no changes", "unchanged", or "same" in location, character state, acts, heat, stage, or next. Never output any acknowledgement, status note, or meta-comment outside the <scene_state> block.',
];

function stateReportLines(slowBurnEnabled, dialogueGuard, nextGuidance = '') {
    const lines = [...(slowBurnEnabled ? SLOW_BURN_STATE_REPORT_LINES : STATE_REPORT_LINES)];
    lines.push(
        'This is a FULL STATE REPORT, not the temperature-only monitor. Always report location, every present character\'s clothing/position/contact, new acts, actual heat, and next beats. A heat-only object is incomplete.',
        'The example heat value 0 is a format placeholder. Calculate heat from the actual END of the response; do not copy the example value. If prior recorded fields are missing, reconstruct them from the latest roleplay prose without inventing facts.',
    );
    if (nextGuidance) lines.push(nextGuidance);
    if (!dialogueGuard) return lines;
    lines[1] = lines[1].replace(
        ',"acts":',
        ',"dialogue_beats":["0-3 dialogue intents from spoken lines, each \'English || 한국어\'"],"acts":',
    );
    lines.splice(4, 0,
        '"dialogue_beats" rules: list 0-3 conversational purposes used by the CHARACTER in this response, not quotations or surface wording. Examples: asks whether the partner likes it, begs for more, repeats an ownership claim, praises the same quality, provokes a reaction, or asks permission. Use [] when there is no spoken dialogue.',
    );
    return lines;
}

// 감시 모드 전용 초경량 주입 — 장면 온도 한 줄만 요청 (SFW 장면에는 개입하지 않음)
const MONITOR_REPORT_LINES = [
    '[Scene Monitor] Write the response normally, then append exactly one machine-readable state line in this format. It is hidden from the reader:',
    '<scene_state>{"_status":"updated","heat":0}</scene_state>',
    ...HEAT_SCALE_LINES,
    'The example heat value 0 is a format placeholder. Replace it with the actual end-of-response scene heat; never copy 0 unchanged into a sexual scene.',
    'Report "heat" factually. If you need to signal no change, use only the optional top-level "_status":"no_change" inside <scene_state>; otherwise use "updated". Never put a change acknowledgement or any other machine-status text outside the tag.',
];

function buildInjection() {
    const settings = getSettings();
    const { state } = effectiveState();
    const targetActive = slowBurnTargetProgress().active;
    const dialogueGuard = Boolean(settings.dialogueBeatGuard);

    // 무장 전: 해제 브릿지가 걸려 있으면 마무리 지시를 한 번 주입.
    // 그 외엔 스텔스 모드는 아무것도 주입하지 않고, 온도 감시 모드는 온도 한 줄만 요청
    if (!isFullyArmed()) {
        const parts = [];
        if (settings.exitBridge && getChatMeta(false)?.bridgePending) parts.push(...BRIDGE_LINES);
        if (settings.armMode !== 'stealth') parts.push(...MONITOR_REPORT_LINES);
        return parts.join('\n');
    }

    const actRows = recentActs(Number(settings.repeatWindow) || DEFAULT_SETTINGS.repeatWindow);
    const pace = resolvePace(settings, state);

    const sections = ['[Scene Continuity Directive]'];

    const stateLines = state ? buildStateLines(state) : [];
    if (stateLines.length) {
        sections.push(
            'CURRENT SCENE STATE (established facts — never contradict them):',
            ...stateLines,
            'Clothing that has been removed stays removed. Positions, locations, and contact only change through explicit on-page actions in your response. Never silently reset or teleport anything.',
        );
    } else {
        sections.push('No location/character state has been recorded yet. Derive the current state from the latest roleplay prose, preserve those established facts, and report the complete state in the block below. A temperature-only record is not a full scene state.');
    }

    const customBans = (getChatMeta(false)?.customBans ?? []).filter(Boolean);
    const globalBans = (settings.globalBans ?? []).filter(Boolean);
    if (globalBans.length) {
        sections.push('', `HARD LIMITS (absolute — never do, suggest, or depict these under any circumstances): ${globalBans.join(', ')}`);
    }
    if (actRows.length || customBans.length) {
        sections.push('');
        if (actRows.length) {
            sections.push(
                targetActive
                    ? `ALREADY HAPPENED in the last ${actRows.length} response(s) — avoid copying these exact micro-beats, but NEVER use this list to avoid, delay, or replace the active USER TARGET SCENE:`
                    : `ALREADY HAPPENED in the last ${actRows.length} response(s) — do NOT repeat these beats, actions, or their near-identical variations:`,
                ...actRows.map((row) => `- ${row.acts.map((act) => biText(act, 'en')).join(', ')}`),
            );
        }
        if (customBans.length) {
            sections.push(`USER-BANNED (permanent for this chat — never do these): ${customBans.join(', ')}`);
        }
        sections.push(targetActive
            ? 'Continue the required target scene while making its exact micro-actions, wording, reactions, and sensory details new.'
            : 'Repeating a listed beat with different wording still counts as repetition. Bring something new.');
    }

    if (dialogueGuard) {
        const dialogueRows = recentDialogueBeats();
        if (dialogueRows.length) {
            sections.push(
                '',
                `DIALOGUE INTENTS ALREADY USED in the last ${dialogueRows.length} CHARACTER response(s) — do not repeat the same conversational function merely by paraphrasing it:`,
                ...dialogueRows.map((row) => `- ${row.beats.map((beat) => biText(beat, 'en')).join(', ')}`),
                'Keep the character voice, but give the spoken dialogue a genuinely new purpose or advance what is being said. Do not repeat the same pleasure-check, plea, praise, taunt, ownership claim, permission request, or reaction request in different words.',
                'EXCEPTIONS: a direct answer to the USER, a necessary consent or safety clarification, and a deliberately meaningful refrain/catchphrase may be used when context truly requires it.',
                targetActive ? 'This guard must never be used to avoid, delay, or replace the active USER TARGET SCENE.' : '',
            );
        }
    }

    if (settings.nextBeatHints && !targetActive) {
        const preferenceLines = buildCardPreferenceLines();
        if (preferenceLines.length) sections.push('', ...preferenceLines);
        const beats = nextBeatCandidates();
        if (beats.length) {
            sections.push(
                '',
                `SUGGESTED NEXT BEATS (pick one, or do something even better — never fall back to a banned beat): ${beats.map((beat) => biText(beat, 'en')).join(' / ')}`,
            );
            if (settings.slowBurnEnabled) sections.push('These suggestions are subordinate to the mandatory slow-burn stage cap and no-conclusion lock. Ignore any suggestion that would skip, finish, or wind down the scene too early.');
        }
    }

    if (settings.slowBurnEnabled) sections.push('', ...buildSlowBurnLines(settings));
    else sections.push('', `PACING: ${pace}`);

    const styleParts = [
        STYLE_LENGTH_INSTRUCTIONS[settings.styleLength] ?? '',
        STYLE_BALANCE_INSTRUCTIONS[settings.styleBalance] ?? '',
    ].filter(Boolean);
    if (styleParts.length) sections.push('', ...styleParts);

    const nextGuidance = settings.nextBeatHints && !targetActive && cardLinkPreferenceText()
        ? '"next" rule: draw the candidates from the CHARACTER PREFERENCES above when they fit the current scene and stage. Keep them fresh — never repeat "acts" or anything already banned.'
        : '';
    sections.push('', ...stateReportLines(settings.slowBurnEnabled, dialogueGuard, nextGuidance));

    // 가장 마지막 지시가 목표 실행 명령이 되도록 다시 고정한다.
    if (targetActive) sections.push('', ...buildTargetFinalEnforcementLines());

    return sections.join('\n');
}

function clearInjectedPrompt() {
    try {
        getContext().setExtensionPrompt(PROMPT_KEY, '', PROMPT_POSITION_IN_CHAT, 0, false, PROMPT_ROLE_SYSTEM);
    } catch (error) {
        console.debug(`${LOG_PREFIX} 주입문 초기화 생략`, error);
    }
}

// 일반 전송은 ST 버전에 따라 type이 undefined/빈 문자열로 전달된다.
function normalizeGenerationType(type) {
    if (type === undefined || type === null) return 'normal';
    if (typeof type !== 'string') return 'unknown';
    return type.trim().toLowerCase() || 'normal';
}

// SFW가 먼저 실행되더라도 NSFW 감지/해제를 끝낸 뒤 같은 담당 상태를 읽는다.
// 자체 판단으로 NSFW 설정을 변경하거나 보조 AI를 별도로 호출하지 않는다.
let sceneBridgeSyncing = false;
globalThis.ttottoNsfwSceneBridge = Object.freeze({
    beginGeneration(type) { if (runtimeActive) beginSceneGeneration(type); },
    collect(message) {
        const index = getContext().chat?.indexOf(message) ?? -1;
        if (index < 0 || !runtimeActive || !isFullyArmed()) return;
        handleIncomingMessage(index);
    },
    sync() {
        if (!runtimeActive) return false;
        const settings = getSettings();
        const meta = getChatMeta();
        if (!runtimeActive || !settings.enabled || !settings.adultConfirmed || !meta) return false;
        if (meta.enabled) {
            // SFW can receive the completed response first. Consume the current
            // report before returning ownership; never infer ownership from SFW scores.
            const message = assistantMessages().at(-1);
            if (!sceneBridgeSyncing && message && !isPendingAssistant(message)
                && !holdsRewriteGeneration()
                && !generationEvents.some((type) => ALLOWED_GENERATION_TYPES.has(type))
                && parseStateFromText(message.mes)) {
                sceneBridgeSyncing = true;
                try { handleIncomingMessage(getContext().chat.indexOf(message)); }
                finally { sceneBridgeSyncing = false; }
            }
            reconcileReportedRelease();
            maybeStealthRelease();
            maybeStealthArm();
        }
        return Boolean((meta.enabled && (settings.armMode === 'manual' || meta.autoArmed))
            || (settings.exitBridge && meta.bridgePending));
    },
});

globalThis.ttottoNsfwGenerationInterceptor = async function ttottoNsfwGenerationInterceptor(_chat, _contextSize, _abort, type) {
    // 숨은 생성이 시작됐다는 이유만으로 앞서 등록한 상태 지시를 지우지 않는다.
    // quiet에서는 새 주입·상태 변경·브릿지 소모도 하지 않고 기존 등록을 그대로 둔다.
    const generationType = normalizeGenerationType(type);
    if (generationType === 'quiet') return;
    prepareSceneInjection({ generationType });
};

// 생성 시작 시 등록하고 인터셉터에서 최신 유저 입력으로 다시 확인한다.
// 미리 준비한 해제 브릿지는 실제 인터셉터 호출 때만 소모한다.
function prepareSceneInjection({ generationType, consumeBridge = true } = {}) {
    clearInjectedPrompt();
    if (!runtimeActive) return;
    try {
        if (!ALLOWED_GENERATION_TYPES.has(generationType)) { diagnosticRecord('injection_skipped', { reason: 'generation_type' }); return; }
        reconcileReportedRelease();
        beginSceneGeneration(generationType);
        const settings = getSettings();
        const meta = getChatMeta();
        // 채팅 토글로 수동 해제한 뒤에는 감시 자체가 꺼져도 다음 생성 한 번의 브릿지만 통과시킨다.
        const bridgeOnly = Boolean(
            runtimeActive
            && settings.enabled
            && settings.adultConfirmed
            && settings.exitBridge
            && meta?.bridgePending
            && !isSupervising(),
        );
        if (bridgeOnly) {
            const prompt = BRIDGE_LINES.join('\n');
            getContext().setExtensionPrompt(PROMPT_KEY, prompt, PROMPT_POSITION_IN_CHAT, 0, false, PROMPT_ROLE_SYSTEM);
            if (consumeBridge) {
                meta.bridgePending = false;
                saveChatMeta();
            }
            diagnosticRecord('injection_registered', { reason: 'bridge_only', chars: prompt.length, reportInstruction: false });
            console.debug(`${LOG_PREFIX} 수동 해제 브릿지 주입 (${prompt.length}자)`);
            return;
        }
        if (!isSupervising()) { diagnosticRecord('injection_skipped', { reason: 'not_supervising', ...diagnosticState() }); return; }
        maybeStealthRelease(); // 유저가 이미 일상 장면으로 전환했다면 이번 생성부터 바로 해제
        maybeStealthArm(); // 방금 보낸 유저 메시지까지 반영해 생성 직전에 감지
        if (settings.slowBurnEnabled && isFullyArmed()) startSlowBurnSessionIfNeeded();
        const prompt = buildInjection();
        if (!prompt) { diagnosticRecord('injection_skipped', { reason: 'stealth_waiting', ...diagnosticState() }); return; }
        diagnosticRecord('injection_registered', { reason: isFullyArmed() ? 'active' : 'monitor_or_bridge', chars: prompt.length, reportInstruction: prompt.includes('<scene_state>'), ...diagnosticState() });
        getContext().setExtensionPrompt(PROMPT_KEY, prompt, PROMPT_POSITION_IN_CHAT, 0, false, PROMPT_ROLE_SYSTEM);
        // 해제 브릿지는 딱 한 번만: 이번 생성에 실렸으면 플래그를 끈다 (미리보기는 소모하지 않음)
        if (consumeBridge && meta?.bridgePending && !isFullyArmed()) {
            meta.bridgePending = false;
            saveChatMeta();
        }
        console.debug(`${LOG_PREFIX} 장면 연속성 지침 주입 (${prompt.length}자)`);
    } catch (error) {
        clearInjectedPrompt();
        console.error(`${LOG_PREFIX} 생성 전 주입 실패 — 본 채팅 생성은 계속합니다.`, error);
    }
}

function onGenerationStarted(type, _options, dryRun) {
    if (dryRun) return;
    diagnosticRecord('generation_started', { reason: normalizeGenerationType(type), ...diagnosticState() });
    if (ALLOWED_GENERATION_TYPES.has(normalizeGenerationType(type))) reconcileReportedRelease();
    beginSceneGeneration(type, true);
    const generationType = normalizeGenerationType(type);
    if (ALLOWED_GENERATION_TYPES.has(generationType)) {
        prepareSceneInjection({ generationType, consumeBridge: false });
    } else if (generationType === 'impersonate') {
        clearInjectedPrompt();
    }
}

// ───────────────────────── 보조 AI 보정 (하이브리드 폴백) ─────────────────────────

function buildRefineInput() {
    const settings = getSettings();
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    const recent = chat
        .filter((message) => message && !message.is_system)
        .slice(-Math.max(2, Number(settings.refineContextMessages) || DEFAULT_SETTINGS.refineContextMessages));
    const rows = [];
    let totalChars = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
        const message = recent[i];
        const role = message.is_user ? 'USER' : 'CHARACTER';
        const name = String(message.name ?? '');
        const label = `[${role} | ${name}]`;
        let messageText = stripStateTag(message.mes);
        if (messageText.length > REFINE_MESSAGE_CHAR_LIMIT) {
            messageText = `…${messageText.slice(-(REFINE_MESSAGE_CHAR_LIMIT - 1))}`;
        }
        const remaining = REFINE_TOTAL_CHAR_LIMIT - totalChars - label.length - 1;
        if (remaining <= 1) break;
        if (messageText.length > remaining) messageText = `…${messageText.slice(-(remaining - 1))}`;
        const row = `${label}\n${messageText}`;
        rows.unshift(row);
        totalChars += row.length + 2;
    }
    return rows.join('\n\n');
}

function refinePromptMessages() {
    const settings = getSettings();
    const slowBurnEnabled = settings.slowBurnEnabled;
    const dialogueGuard = Boolean(settings.dialogueBeatGuard);
    const stageSchema = slowBurnEnabled ? ',"stage":1' : '';
    const dialogueSchema = dialogueGuard ? ',"dialogue_beats":["0-3 dialogue intents from the final CHARACTER message, each \'English || 한국어\'"]' : '';
    const preferenceText = settings.cardLinkEnabled && settings.nextBeatHints ? cardLinkPreferenceText() : '';
    const preferenceRule = preferenceText
        ? '\n- "next" should draw on the CHARACTER PREFERENCES given in the user message where they fit the current scene; they are inspiration only, never a checklist.'
        : '';
    const stageRule = slowBurnEnabled
        ? '\n- "stage" is the scene\'s slow-burn progression as an integer: 1 tension/atmosphere, 2 gaze/words/proximity, 3 initial light contact, 4 deepening contact/reactions, 5 explicit escalation, 6 peak or conclusion permitted.'
        : '';
    const system = `You are a scene-state tracker for an adult fiction roleplay log. All characters are adults. Read the log excerpt and return ONLY a JSON object, no markdown, no commentary.

Schema:
{"location":"short English phrase || 짧은 한국어 구","characters":{"name":{"clothing":"current clothing state, English || 한국어","position":"current posture/position, English || 한국어","contact":"current physical contact, English || 한국어"}}${dialogueSchema},"acts":["2-4 significant beats from the most recent CHARACTER message only, each 'English || 한국어'"],"heat":0${stageSchema},"next":["2-3 fresh beats the scene could move to next, each 'English || 한국어'"]}

Rules:
- Every string value is a bilingual pair: concise English first, then " || ", then natural Korean.
- Describe the state at the END of the log, factually and concisely. Note removed or displaced clothing explicitly.
- "acts" must cover only the final CHARACTER message. List ONLY substantive beats (physical/romantic/emotional developments); skip mundane logistics like snacks, drinks, blankets, or remote controls.
${dialogueGuard ? '- "dialogue_beats" must list 0-3 conversational intents/functions from spoken CHARACTER dialogue in the final CHARACTER message only. Describe the purpose, not exact wording or quotations. Use [] if there is no spoken dialogue.\n' : ''}${HEAT_SCALE_LINES.join('\n')}${stageRule}
- "next" must not repeat anything already listed in "acts".${preferenceRule}
- Include every present character. Use the exact names from the log.
- If something is unknown, use an empty string. Return the JSON object only.`;
    const user = `${preferenceText ? `CHARACTER PREFERENCES (reference for "next" only):\n${preferenceText}\n\n` : ''}Log excerpt (oldest first):\n\n${buildRefineInput()}`;
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

// 백엔드가 토큰 상한 값을 거부한 오류인지 (Gemini: "supported range is from 1 to 65537" 등)
function isTokenLimitError(error) {
    return /max_?output_?tokens|max_tokens|maxOutputTokens|supported range|output token/i.test(String(error?.message ?? error ?? ''));
}

function refineProfileOverrides(context, service, profileId, settings) {
    const mode = settings.refineVertexAuthMode;
    if (!['express', 'full'].includes(mode)) return {};
    const profile = typeof service.getProfile === 'function'
        ? service.getProfile(profileId)
        : context.extensionSettings?.connectionManager?.profiles?.find((item) => item.id === profileId);
    const api = typeof service.validateProfile === 'function'
        ? service.validateProfile(profile) : context.CONNECT_API_MAP?.[profile?.api];
    if (!api) throw new Error('보정 프로필의 API 종류를 확인할 수 없어요. 연결 프로필을 다시 선택해 주세요.');
    // Override only this analysis request. Never change the shared preset,
    // active connection, secret selection, or another provider's payload.
    return api.source === 'vertexai' ? { vertexai_auth_mode: mode } : {};
}

async function requestRefine(signal) {
    const context = getContext();
    const settings = getSettings();
    const prompt = refinePromptMessages();
    const maxTokens = Number(settings.refineMaxTokens) || DEFAULT_SETTINGS.refineMaxTokens;
    const profileId = String(settings.refineProfileId ?? '').trim();

    // 상한을 거부하는 백엔드를 만나면 더 작은 값으로 자동 재시도
    const ladder = [...new Set([maxTokens, 2000, 1000]
        .filter((value) => Number(value) > 0 && Number(value) <= maxTokens))]
        .sort((left, right) => right - left);
    let lastError;
    for (const tokens of ladder) {
        try {
            if (profileId) {
                const service = context.ConnectionManagerRequestService;
                if (!service || typeof service.sendRequest !== 'function') {
                    throw new Error('Connection Profiles 서비스를 사용할 수 없습니다.');
                }
                const overrides = refineProfileOverrides(context, service, profileId, settings);
                const result = await service.sendRequest(profileId, prompt, tokens, { stream: false, signal, extractData: true }, overrides);
                if (typeof result === 'string') return result;
                if (result && typeof result.content === 'string') return result.content;
                throw new Error('보정 분석 연결 프로필이 텍스트를 반환하지 않았습니다.');
            }
            if (typeof context.generateRaw !== 'function') {
                throw new Error('현재 연결을 통한 백그라운드 생성을 사용할 수 없습니다.');
            }
            return await context.generateRaw({ prompt, responseLength: tokens, trimNames: false, signal });
        } catch (error) {
            lastError = error;
            if (error?.name === 'AbortError' || !isTokenLimitError(error)) throw error;
            console.warn(`${LOG_PREFIX} 토큰 상한 ${tokens}이(가) 거부됨 — 더 작은 값으로 재시도합니다.`);
        }
    }
    throw lastError;
}

function parseRefineResponse(text) {
    const clean = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('보정 분석 응답에 JSON 객체가 없습니다.');
    const state = sanitizeState(JSON.parse(clean.slice(start, end + 1)));
    if (!state) throw new Error('보정 분석 결과가 비어 있습니다.');
    const missing = stateCompletenessIssues(state);
    if (missing.length) throw new Error(`보정 분석 결과에 필수 상태가 없습니다: ${missing.join(', ')}`);
    return state;
}

let refineFailure = null;
let queuedRefineTarget = null;
let lastAutoRefineTarget = null;

function sameRefineTarget(left, right) {
    return Boolean(left && right && left.metadata === right.metadata && left.message === right.message
        && left.swipe === right.swipe && left.text === right.text);
}

function autoRefineNeeded() {
    if (!isSupervising()) return false;
    const settings = getSettings();
    const message = assistantMessages().at(-1);
    if (!message || isPendingAssistant(message)) return false;
    const state = effectiveState().state;
    if (isFullyArmed()) return stateCompletenessIssues(state, settings).length > 0;
    // Stealth has no reporting contract while idle. Temperature monitoring does.
    return settings.armMode === 'auto' && (state?.heat === null || state?.heat === undefined);
}

function captureRefineTarget() {
    const context = getContext();
    const message = assistantMessages().at(-1);
    return message ? { metadata: context.chatMetadata, message, swipe: currentSwipeIndex(message), text: recordBody(message.mes) } : null;
}

function awaitRefineResponse(signal) {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            const error = new Error('Scene analysis cancelled');
            error.name = 'AbortError';
            reject(error);
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(() => {
            if (signal.aborted) { onAbort(); return; }
            return requestRefine(signal);
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

async function runRefine({ manual = false } = {}) {
    const settings = getSettings();
    if (!runtimeActive || !settings.enabled || !getChatMeta(false)?.enabled) return false;
    if (!manual && (!settings.autoRefine || !autoRefineNeeded())) return false;
    if (generationEvents.some((type) => ALLOWED_GENERATION_TYPES.has(type)) || holdsRewriteGeneration()) return false;
    if (refineRunning) {
        if (!manual) queuedRefineTarget = captureRefineTarget();
        return false;
    }
    if (!settings.adultConfirmed) {
        if (manual) toastr.warning('설정에서 성인 캐릭터 확인에 먼저 체크해주세요.', '🔞또또NSFW');
        return false;
    }
    if (assistantMessages().length < 1) {
        if (manual) toastr.info('분석할 AI 응답이 아직 없어요.', '🔞또또NSFW');
        return false;
    }

    const captured = captureRefineTarget();
    if (!captured || isPendingAssistant(captured.message)) return false;
    if (!manual && sameRefineTarget(captured, lastAutoRefineTarget)) return false;
    clearTimeout(refineTimer);
    refineTimer = null;
    queuedRefineTarget = null;
    lastAutoRefineTarget = captured;
    diagnosticRecord('refine_started', { manual, message: getContext().chat.indexOf(captured.message), swipe: captured.swipe });
    refineRunning = true;
    refineFailure = null;
    const context = getContext();
    const target = assistantMessages().at(-1);
    const targetSwipe = currentSwipeIndex(target);
    const targetText = recordBody(target.mes);
    const metadata = context.chatMetadata;
    refineAbortController?.abort();
    refineAbortController = new AbortController();
    updateUi();

    try {
        const response = await awaitRefineResponse(refineAbortController.signal);
        // 보정 호출 중 스와이프/채팅/본문이 바뀌면 이전 장면을 새 답변에 덮어쓰지 않는다.
        if (refineAbortController?.signal.aborted || !runtimeActive || !isSupervising()
            || getContext().chatMetadata !== metadata || !getContext().chat?.includes(target)
            || assistantMessages().at(-1) !== target
            || currentSwipeIndex(target) !== targetSwipe || recordBody(target.mes) !== targetText) { diagnosticRecord('refine_discarded', { reason: 'target_changed_or_disabled' }); return false; }
        const state = parseRefineResponse(response);
        diagnosticRecord('refine_parsed', { characters: Object.keys(state.characters).length, heatPresent: state.heat !== null, heat: state.heat });
        const meta = getChatMeta();
        const refinedAt = Date.now();
        // 보정 결과를 최신 AI 메시지의 현재 스와이프에도 붙여야 반복 목록과 슬로우번 체류 턴이 정상 계산된다.
        if (target) {
            const store = getMessageStore(target);
            store.swipes[String(targetSwipe)] = { state, at: refinedAt, messageSignature: messageStateSignature(target), signatureVersion: 2 };
            persistChat();
        }
        meta.manualState = { state, at: refinedAt, source: 'ai-refine', target: currentStateTarget() };
        applyReportedHeat(state, target);
        if (settings.armMode !== 'manual') maybeStealthRelease();
        saveChatMeta();
        diagnosticRecord('refine_saved', { message: getContext().chat.indexOf(target), swipe: targetSwipe, ...diagnosticCache(target), ...diagnosticState() });
        if (manual) toastr.success('보조 AI가 장면 상태를 다시 잡았어요.', '🔞또또NSFW');
        return true;
    } catch (error) {
        diagnosticRecord('refine_failed', { reason: error?.name === 'AbortError' ? 'aborted' : 'request_or_parse_failed' });
        if (error?.name === 'AbortError') return false;
        refineFailure = { metadata, message: String(error?.message ?? error).slice(0, 180) };
        console.error(`${LOG_PREFIX} 보정 분석 실패`, error);
        if (manual) toastr.error(`보정 분석 실패: ${error?.message ?? error}`, '🔞또또NSFW');
        return false;
    } finally {
        refineRunning = false;
        refineAbortController = null;
        const queued = queuedRefineTarget;
        queuedRefineTarget = null;
        if (queued?.metadata === getContext().chatMetadata
            && (queued.message !== target || queued.swipe !== targetSwipe || queued.text !== targetText)) scheduleAutoRefine();
        if (runtimeActive) updateUi();
    }
}

function scheduleAutoRefine() {
    if (!getSettings().autoRefine || !autoRefineNeeded()) { diagnosticRecord('refine_skipped', { reason: !getSettings().autoRefine ? 'auto_refine_off' : 'not_needed', ...diagnosticState() }); return; }
    if (generationEvents.some((type) => ALLOWED_GENERATION_TYPES.has(type))) return;
    const target = captureRefineTarget();
    if (!target || sameRefineTarget(target, lastAutoRefineTarget)) { diagnosticRecord('refine_skipped', { reason: 'same_target_or_absent' }); return; }
    if (refineRunning) { queuedRefineTarget = target; return; }
    if (refineTimer && sameRefineTarget(target, queuedRefineTarget)) return;
    clearTimeout(refineTimer);
    queuedRefineTarget = target;
    diagnosticRecord('refine_scheduled', { message: getContext().chat.indexOf(target.message), swipe: target.swipe });
    refineTimer = setTimeout(() => {
        refineTimer = null;
        const queued = queuedRefineTarget;
        queuedRefineTarget = null;
        if (sameRefineTarget(queued, captureRefineTarget())) void runRefine();
        else scheduleAutoRefine();
    }, 900);
}

// Some translation/render wrappers change the message without an edit event.
// Observe only the latest completed reply, with no model call of its own.
let messageObserverTimer = null;
let lastObservedMessage = null;
function observeLatestMessage() {
    if (!runtimeActive || !isSupervising() || holdsRewriteGeneration()
        || generationEvents.some((type) => ALLOWED_GENERATION_TYPES.has(type))) return;
    const message = assistantMessages().at(-1);
    if (!message || isPendingAssistant(message)) return;
    const target = { metadata: getContext().chatMetadata, message,
        swipe: currentSwipeIndex(message), text: String(message.mes ?? '') };
    if (sameRefineTarget(target, lastObservedMessage)) return;
    lastObservedMessage = target;
    handleIncomingMessage(getContext().chat.indexOf(message));
}

function startMessageObserver() {
    if (messageObserverTimer) return;
    lastObservedMessage = null;
    observeLatestMessage();
    messageObserverTimer = setInterval(observeLatestMessage, 800);
}

function stopMessageObserver() {
    if (messageObserverTimer) clearInterval(messageObserverTimer);
    messageObserverTimer = null;
    lastObservedMessage = null;
}

// ───────────────────────── 메시지 이벤트 처리 ─────────────────────────

function messageByIndex(index) {
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    const numeric = Number(index);
    if (Number.isInteger(numeric) && chat[numeric]) return chat[numeric];
    return chat.length ? chat[chat.length - 1] : null;
}

function rerenderMessage(index, message) {
    const context = getContext();
    try {
        if (typeof context.updateMessageBlock === 'function') context.updateMessageBlock(Number(index), message);
    } catch (error) {
        console.debug(`${LOG_PREFIX} 메시지 재렌더 생략`, error);
    }
}

function persistChat() {
    const context = getContext();
    try {
        if (typeof context.saveChatDebounced === 'function') context.saveChatDebounced();
        else if (typeof context.saveChat === 'function') void context.saveChat();
    } catch (error) {
        console.debug(`${LOG_PREFIX} 채팅 저장 생략`, error);
    }
}

// Repair an already-stored low-temperature state after reload/update. Only the
// latest selected, body-matching report can release ownership; never replay an
// old high report to activate the extension or interrupt an in-flight reply.
function reconcileReportedRelease() {
    const settings = getSettings();
    const meta = getChatMeta(false);
    if (settings.armMode !== 'auto' || !meta?.autoArmed || meta.forceArmed
        || holdsRewriteGeneration() || generationEvents.some((type) => ALLOWED_GENERATION_TYPES.has(type))) return;
    const state = effectiveState().state;
    if (state?.heat == null || state.heat > AUTO_ARM_OFF) return;
    applyReportedHeat(state, assistantMessages().at(-1));
}

// Apply the same temperature decision to collected and repaired reports.
function applyReportedHeat(state, message) {
    if (message !== assistantMessages().at(-1)) { diagnosticRecord('heat_decision', { reason: 'historical_report' }); return; }
    if (!isSupervising()) { diagnosticRecord('heat_decision', { reason: 'not_supervising' }); return; }
    const wasArmed = Boolean(getChatMeta(false)?.autoArmed);
    const settings = getSettings();
    const meta = getChatMeta(false);
    const hasCurrentNsfwSignal = settings.armMode === 'stealth'
        && stealthWindowDetail({ ignoreCooldown: true }).score >= STEALTH_THRESHOLDS.normal;
    // 온도 자동의 낮은 보고는 슬로우번 진행도보다 우선한다. 수동 모드는 유지.
    if (state?.heat !== null && state?.heat !== undefined && settings.armMode !== 'manual') {
        if (!meta.autoArmed && state.heat >= AUTO_ARM_ON
            && !nsfwScoreDetail(stripStateTag(message.mes)).routineOnly) {
            meta.autoArmed = true;
            meta.armSource = 'heat';
            meta.sfwImmediateHandoff = false;
            saveChatMeta();
            toastr.info(`장면 온도 ${state.heat}/10 — 연속성 개입을 시작해요.`, '🔞또또NSFW');
            // 감시 모드에서는 온도만 수집했으므로, 무장 직후 보조 AI로 전체 상태를 백필
            if (settings.autoRefine) scheduleAutoRefine();
        } else if (meta.autoArmed && state.heat <= AUTO_ARM_OFF && !hasCurrentNsfwSignal) {
            const prematureSlowBurnEnd = settings.armMode !== 'auto' && settings.slowBurnEnabled
                && meta.slowBurnSessionActive
                && !slowBurnProgress(settings).canConclude;
            if (prematureSlowBurnEnd) {
                const firstDetection = !meta.slowBurnRecoveryPending;
                meta.slowBurnRecoveryPending = true;
                meta.autoArmed = true;
                meta.bridgePending = false;
                saveChatMeta();
                if (firstDetection) toastr.warning('최소 턴 전에 장면 종료를 감지했어요. 개입을 유지하고 다음 응답에서 장면을 이어가게 해요.', '🔞또또NSFW');
            } else {
                meta.autoArmed = false;
                meta.forceArmed = false;
                // Temperature mode must not keep SFW suspended for another
                // reply because historical wording still has a local score.
                const sceneEnded = settings.armMode === 'auto' || stealthColdStreak();
                meta.bridgePending = Boolean(settings.exitBridge && !sceneEnded);
                meta.sfwImmediateHandoff = sceneEnded;
                resetSlowBurnSession(meta);
                if (settings.armMode === 'stealth') {
                    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
                    meta.stealthCooldownFrom = chat.length; // 이후 메시지부터 다시 감지
                    meta.stealthCooldownReason = 'heat';
                }
                saveChatMeta();
                toastr.info(`장면 온도 ${state.heat}/10 — 개입을 해제하고 대기로 돌아가요.`, '🔞또또NSFW');
            }
        } else if (state.heat > AUTO_ARM_OFF && meta.slowBurnRecoveryPending) {
            meta.slowBurnRecoveryPending = false;
            saveChatMeta();
        }
    }
    const heat = state?.heat;
    const reason = settings.armMode === 'manual' ? 'manual_mode'
        : heat === null || heat === undefined ? (snapshotMatchesMessage(message) && snapshotForMessage(message)?.state?.heat != null ? 'cached_report_no_new_decision' : 'missing_heat')
        : !wasArmed && meta.autoArmed ? 'armed_by_heat'
        : wasArmed && !meta.autoArmed ? 'disarmed_by_heat'
        : !wasArmed && heat >= AUTO_ARM_ON ? 'routine_suppressed'
        : !wasArmed ? 'below_on_threshold'
        : heat <= AUTO_ARM_OFF ? 'protected_or_local_signal' : 'remains_active';
    diagnosticRecord('heat_decision', { reason, message: getContext().chat.indexOf(message), swipe: currentSwipeIndex(message),
        reportedHeatPresent: heat !== null && heat !== undefined,
        ...(heat !== null && heat !== undefined ? { reportedHeat: heat } : {}),
        wasArmed, nowArmed: Boolean(meta.autoArmed), onThreshold: AUTO_ARM_ON, offThreshold: AUTO_ARM_OFF });
}

function handleIncomingMessage(index) {
    if (!runtimeActive) return;
    const settings = getSettings();
    if (!settings.enabled || !settings.adultConfirmed) { diagnosticRecord('collection_skipped', { reason: 'disabled_or_unconfirmed' }); return; }
    const meta = getChatMeta(false);
    if (!meta?.enabled) { diagnosticRecord('collection_skipped', { reason: 'chat_disabled' }); return; }

    const message = messageByIndex(index);
    if (!message || message.is_user || message.is_system) return;
    if (isPendingAssistant(message) || holdsRewriteGeneration() || generationEvents.some((type) => ALLOWED_GENERATION_TYPES.has(type))) { diagnosticRecord('collection_skipped', { reason: 'pending_generation' }); return; }
    index = getContext().chat.indexOf(message);
    diagnosticResponse(message, index);
    lastCompletedAssistant = { metadata: getContext().chatMetadata, message };

    // 첫 감지 답변도 올바른 담당으로 수집한다. 본문을 지우기 전에 판단한다.
    maybeStealthArm();
    const { changed, found, state } = harvestMessage(message);
    diagnosticRecord('collection_result', { message: index, swipe: currentSwipeIndex(message), found, wrote: Boolean(state), stripped: changed, ...diagnosticCache(message) });
    if (found) {
        if (!stateCompletenessIssues(state ?? snapshotForMessage(message)?.state, settings).length) refineFailure = null;
        // 새 스냅샷이 수동 보정보다 최신이므로 수동 보정은 자연히 밀려남
        if (meta.manualState && Number(meta.manualState.at ?? 0) < Date.now()) meta.manualState = null;
        saveChatMeta();
    }
    const targetProgress = slowBurnTargetProgress();
    if (targetProgress.active && targetProgress.completedTurns >= targetProgress.requiredTurns) {
        meta.slowBurnTargetActive = false;
        meta.slowBurnTargetCompleted = true;
        meta.slowBurnRecoveryPending = false;
        saveChatMeta();
        toastr.success(`“${targetProgress.target}” ${targetProgress.requiredTurns}회 진행을 채웠어요. 다음 AI 답변부터는 전환할 수 있어요.`, '🔞또또NSFW');
    }
    // 스텔스만 본문 점수로 시작/유지한다. 온도 자동은 AI의 온도 보고를 따른다.
    maybeStealthArm();
    applyReportedHeat(state, message);
    // 온도 자동은 유효한 낮은 보고 또는 명확한 일상 전환으로만 해제한다.
    // 단어 부재만으로 해제하는 폴백은 스텔스 모드에 한정한다.
    if (settings.armMode !== 'manual') maybeStealthRelease();
    if (changed) {
        rerenderMessage(index, message);
        persistChat();
    }
    diagnosticTrackBody(message, index, 'after_collection');
    if (snapshotForMessage(message)?.state && !snapshotMatchesMessage(message)) diagnosticRecord('cache_invalidated', { reason: 'body_signature_mismatch', message: index, ...diagnosticCache(message) });
    const completenessState = state ?? snapshotForMessage(message)?.state ?? null;
    const completenessIssues = found ? stateCompletenessIssues(completenessState, settings) : [];
    if (!found || completenessIssues.length) {
        const reason = found ? `상태 태그 불완전 (${completenessIssues.join(', ')})` : '상태 태그 누락';
        console.debug(`${LOG_PREFIX} ${reason} — 보조 AI 보정 ${settings.autoRefine ? '예약' : '비활성'}`);
        scheduleAutoRefine();
    }
    updateUi();
}

// ───────────────────────── UI ─────────────────────────

function element(id) {
    return document.getElementById(id);
}

let activeUiTab = 'state';
function setTab(tab) {
    activeUiTab = tab;
    const box = element('tns-popup-box');
    if (box) box.style.setProperty('max-width', tab === 'diagnostics' ? '860px' : '460px', 'important');
    document.querySelectorAll('#ttotto-nsfw-settings [data-tns-tab]').forEach((button) => {
        const active = button.dataset.tnsTab === tab;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    // hidden 속성만으로는 팝업/테마 CSS와 충돌할 수 있어 인라인 스타일로도 강제한다
    const panels = { state: element('tns-panel-state'), diagnostics: element('tns-panel-diagnostics'), settings: element('tns-panel-settings') };
    for (const [name, panel] of Object.entries(panels)) {
        if (!panel) continue;
        const active = name === tab;
        panel.hidden = !active;
        if (active) panel.style.removeProperty('display');
        else panel.style.setProperty('display', 'none', 'important');
    }
}

function populateProfiles() {
    if (!uiReady) return;
    const select = element('tns-refine-profile');
    const settings = getSettings();
    const currentValue = String(settings.refineProfileId ?? '');
    select.replaceChildren();
    const current = document.createElement('option');
    current.value = '';
    current.textContent = '현재 연결 사용';
    select.append(current);
    try {
        const service = getContext().ConnectionManagerRequestService;
        const profiles = typeof service?.getSupportedProfiles === 'function' ? service.getSupportedProfiles() : [];
        for (const profile of profiles ?? []) {
            if (!profile?.id) continue;
            const option = document.createElement('option');
            option.value = String(profile.id);
            option.textContent = String(profile.name || profile.id);
            select.append(option);
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} 연결 프로필 목록을 불러오지 못했습니다.`, error);
    }
    if (currentValue && ![...select.options].some((option) => option.value === currentValue)) {
        const missing = document.createElement('option');
        missing.value = currentValue;
        missing.textContent = '저장된 연결 프로필을 찾을 수 없음';
        select.append(missing);
    }
    select.value = currentValue;
}

function applyManualEdit(mutator) {
    const meta = getChatMeta();
    const { state } = effectiveState();
    const base = state ? structuredClone(state) : { location: '', characters: {}, acts: [] };
    mutator(base);
    meta.manualState = { state: sanitizeState(base) ?? base, at: Date.now(), source: 'manual', target: currentStateTarget() };
    saveChatMeta();
    updateUi();
}

function renderSlowBurnPanel(settings) {
    const card = element('tns-slow-burn-card');
    const developerMode = Boolean(settings.developerMode);
    card.hidden = !settings.slowBurnEnabled && !developerMode;
    if (card.hidden) return;

    const stageHead = card.querySelector('.tns-slow-burn-head');
    const stageControls = card.querySelector('.tns-slow-burn-controls');
    if (stageHead) stageHead.hidden = !settings.slowBurnEnabled;
    if (stageControls) stageControls.hidden = !settings.slowBurnEnabled;

    const progress = slowBurnProgress(settings);
    const targetProgress = progress.target;
    const targetInput = element('tns-slow-burn-target');
    const targetTurnsInput = element('tns-slow-burn-target-turns');
    element('tns-slow-burn-target-box').hidden = !developerMode;
    element('tns-slow-burn-target-note').hidden = !developerMode;
    if (document.activeElement !== targetInput) targetInput.value = targetProgress.target;
    if (document.activeElement !== targetTurnsInput) targetTurnsInput.value = String(targetProgress.requiredTurns);
    targetInput.disabled = targetProgress.active;
    targetTurnsInput.disabled = targetProgress.active;
    const targetBox = targetInput.closest('.tns-slow-burn-target-box');
    targetBox?.classList.toggle('is-active', targetProgress.active);
    element('tns-slow-burn-target-start').textContent = targetProgress.active ? '↻ 처음부터 다시' : '🔥 목표 시작';
    element('tns-slow-burn-target-stop').disabled = !targetProgress.active;
    element('tns-slow-burn-target-status').textContent = targetProgress.active
        ? `“${targetProgress.target}” · ${Math.min(targetProgress.completedTurns, targetProgress.requiredTurns)}/${targetProgress.requiredTurns}회 진행 중 · 다음 AI 답변도 이 장면을 유지`
        : targetProgress.completed
            ? `“${targetProgress.target}” · ${targetProgress.requiredTurns}/${targetProgress.requiredTurns}회 완료 · 다음 AI 답변부터 전환 가능`
            : targetProgress.target
                ? `“${targetProgress.target}”을(를) ${targetProgress.requiredTurns}회 진행할 준비가 됐어요.`
                : '장면과 횟수를 정하면 다음 AI 답변부터 정확히 그 횟수만큼 유지해요.';
    const stage = SLOW_BURN_STAGES[progress.stage];
    const sourceLabel = {
        manual: '수동 선택',
        reported: 'AI 단계 감지',
        heat: '온도에서 감지',
        default: '초기 단계',
    }[progress.source] ?? '자동 감지';

    element('tns-slow-burn-stage').textContent = `${progress.stage}단계 · ${stage.ko}`;
    const sessionText = `활성화 후 ${Math.min(progress.sessionTurns, progress.requiredTurns)}/${progress.requiredTurns}턴`;
    const stageText = `현재 단계 ${Math.min(progress.turns, progress.requiredTurns)}/${progress.requiredTurns}턴`;
    element('tns-slow-burn-progress').textContent = progress.locked
        ? `${sessionText} · ${stageText} · 단계 고정 중`
        : progress.recoveryPending
            ? `${sessionText} · 조기 종료 감지, 장면 이어가기 대기`
            : `${sessionText} · ${stageText}`;
    element('tns-slow-burn-source').textContent = sourceLabel;
    element('tns-slow-burn-lock').textContent = progress.locked ? '🔓 고정 해제' : '🔒 단계 고정';
    element('tns-slow-burn-prev').disabled = progress.stage <= 1;
    element('tns-slow-burn-next').disabled = progress.stage >= 6;
    element('tns-slow-burn-auto').disabled = progress.source !== 'manual' && !progress.locked;
}

function renderCardLinkPanel(settings) {
    const box = element('tns-card-link-box');
    if (!box) return;
    box.hidden = !settings.cardLinkEnabled;
    element('tns-card-link').checked = Boolean(settings.cardLinkEnabled);
    if (!settings.cardLinkEnabled) return;

    const list = element('tns-card-link-list');
    const note = element('tns-card-link-note');
    list.replaceChildren();

    const { available, rows } = cardLinkOptions();
    if (!available) {
        note.textContent = 'CardInject 데이터를 찾지 못했어요. CardInject를 설치하고 이 캐릭터의 캐시트를 분석한 뒤 새로고침해주세요.';
        return;
    }
    if (!rows.length) {
        note.textContent = '이 채팅 캐릭터에 저장된 CardInject 카테고리가 없어요. CardInject에서 분석하거나 직접 칸을 추가한 뒤 새로고침해주세요.';
        return;
    }

    const selected = settings.cardLinkSelected ?? {};
    let duplicated = 0;
    let picked = 0;
    for (const row of rows) {
        const isSelected = Array.isArray(selected[row.charKey]) && selected[row.charKey].includes(row.catKey);
        if (isSelected) {
            picked++;
            if (row.ciEnabled) duplicated++;
        }
        const label = document.createElement('label');
        label.className = 'tns-setting-row tns-card-link-row';
        const text = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = `${row.charName} · ${row.name}${row.likely ? ' ★' : ''}`;
        const meta = document.createElement('small');
        meta.textContent = `${row.content.length}자 · CardInject에서 ${row.ciEnabled ? '켜져 있음' : '꺼져 있음'}`;
        text.append(title, meta);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = isSelected;
        input.addEventListener('change', () => {
            const current = getSettings();
            const chosen = new Set(Array.isArray(current.cardLinkSelected[row.charKey]) ? current.cardLinkSelected[row.charKey] : []);
            if (input.checked) chosen.add(row.catKey);
            else chosen.delete(row.catKey);
            current.cardLinkSelected[row.charKey] = [...chosen];
            saveSettings();
            updateUi();
        });
        label.append(text, input);
        list.append(label);
    }
    note.textContent = duplicated
        ? `⚠️ 고른 ${picked}개 중 ${duplicated}개가 CardInject에서도 켜져 있어서 프롬프트에 두 번 들어가요. CardInject에서 그 카테고리를 끄면 개입 중일 때만 주입돼요. (★ = 이름이 성향·취향 관련처럼 보이는 카테고리)`
        : `고른 ${picked}개는 개입 중일 때만 주입돼요. (★ = 이름이 성향·취향 관련처럼 보이는 카테고리)`;
}

function renderStatePanel() {
    const { state, source } = stateForDisplay();
    const current = effectiveState();
    const settings = getSettings();
    const armMeta = getChatMeta(false);
    renderSlowBurnPanel(settings);
    renderCardLinkPanel(settings);
    const sourceLabel = { 'body-changed': '저장 후 본문 변경 · 최신 온도 미확인 · 상태 다시 분석으로 복구 (추가 AI 호출)', 'missing-report': '최신 보고 누락 · 상태 다시 분석으로 복구 (추가 AI 호출)', tag: '응답 태그에서 추적됨', 'ai-refine': '보조 AI 보정 결과', manual: '수동 수정됨', none: '아직 기록 없음' }[source] ?? source;
    const incomplete = isFullyArmed() && stateCompletenessIssues(state, settings).length > 0;
    element('tns-state-source').textContent = refineRunning ? '보조 AI 분석 중…'
        : refineFailure?.metadata === getContext().chatMetadata ? `상태 보정 실패: ${refineFailure.message}`
        : ['missing-report', 'body-changed'].includes(source) ? sourceLabel
        : isSupervising() && settings.armMode === 'auto' && !isFullyArmed()
            ? (armMeta?.bridgePending ? '일상 복귀 중 · 종료 브릿지 대기' : '온도 감시 중 · NSFW 개입·장면 수집 대기')
        : incomplete ? `전체 장면 기록 미완성 · ${settings.autoRefine ? '자동 보정 사용 중' : '자동 보정 꺼짐'}`
        : sourceLabel;

    const heatBadge = element('tns-heat');
    const heat = current.state?.heat;
    heatBadge.hidden = !assistantMessages().length;
    heatBadge.textContent = heat !== null && heat !== undefined
        ? `🌡️ 성적 온도 ${heat}/10${armMeta?.autoArmed && armMeta.armSource === 'local' ? ' · 본문 감지' : ''}`
        : '🌡️ 최신 온도 미확인';
    heatBadge.title = '최신 답변과 일치하는 온도 보고만 표시합니다. 누락은 0이 아닙니다.';
    heatBadge.classList.toggle('is-hot', heat !== null && heat !== undefined && heat >= AUTO_ARM_ON);

    const locationInput = element('tns-state-location');
    if (document.activeElement !== locationInput) locationInput.value = biText(state?.location);

    const list = element('tns-char-list');
    list.replaceChildren();
    const characters = state?.characters ?? {};
    for (const [name, info] of Object.entries(characters)) {
        const row = document.createElement('div');
        row.className = 'tns-char-row';
        const title = document.createElement('strong');
        title.textContent = name;
        row.append(title);
        for (const [field, label] of [['clothing', '복장'], ['position', '자세·위치'], ['contact', '접촉']]) {
            const wrap = document.createElement('label');
            wrap.className = 'tns-char-field';
            const caption = document.createElement('span');
            caption.textContent = label;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'text_pole';
            input.value = biText(info[field]);
            input.addEventListener('change', () => {
                applyManualEdit((draft) => {
                    if (!draft.characters[name]) draft.characters[name] = { clothing: '', position: '', contact: '' };
                    draft.characters[name][field] = input.value;
                });
            });
            wrap.append(caption, input);
            row.append(wrap);
        }
        list.append(row);
    }
    element('tns-char-empty').hidden = Object.keys(characters).length > 0;

    const actsList = element('tns-acts-list');
    actsList.replaceChildren();
    const rows = recentActs(Number(settings.repeatWindow) || DEFAULT_SETTINGS.repeatWindow);
    for (const row of rows) {
        for (const act of row.acts) {
            const chip = document.createElement('span');
            chip.className = 'tns-act-chip';
            const text = document.createElement('span');
            text.textContent = biText(act);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.title = '이 항목은 반복 금지에서 제외';
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                const meta = getChatMeta();
                for (const key of [biText(act, 'en'), biText(act, 'ko')]) {
                    if (key && !meta.ignoredActs.includes(key)) meta.ignoredActs.push(key);
                }
                saveChatMeta();
                updateUi();
            });
            chip.append(text, remove);
            actsList.append(chip);
        }
    }
    element('tns-acts-empty').hidden = rows.length > 0;
    element('tns-acts-summary').textContent = `최근 ${settings.repeatWindow}턴 기준`;

    // 개발자 실험실: 최근 대사 의도 목록
    const dialogueSection = element('tns-dialogue-section');
    const dialogueEnabled = Boolean(settings.dialogueBeatGuard);
    const dialogueSummary = element('tns-dialogue-summary');
    if (dialogueSummary) dialogueSummary.textContent = `최근 ${settings.dialogueWindow}개의 AI 답변에서 이미 사용한 대사의 목적이에요.`;
    dialogueSection.hidden = !dialogueEnabled;
    const dialogueList = element('tns-dialogue-list');
    dialogueList.replaceChildren();
    const dialogueRows = dialogueEnabled ? recentDialogueBeats() : [];
    for (const row of dialogueRows) {
        for (const beat of row.beats) {
            const chip = document.createElement('span');
            chip.className = 'tns-act-chip';
            const text = document.createElement('span');
            text.textContent = biText(beat);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.title = '이 대사 의도는 반복 금지에서 제외';
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                const meta = getChatMeta();
                for (const key of [biText(beat, 'en'), biText(beat, 'ko')]) {
                    if (key && !meta.ignoredDialogueBeats.includes(key)) meta.ignoredDialogueBeats.push(key);
                }
                saveChatMeta();
                updateUi();
            });
            chip.append(text, remove);
            dialogueList.append(chip);
        }
    }
    element('tns-dialogue-empty').hidden = dialogueRows.length > 0;

    // 다음 전개 후보
    const nextList = element('tns-next-list');
    nextList.replaceChildren();
    const targetActive = slowBurnTargetProgress().active;
    const beats = settings.nextBeatHints && !targetActive ? nextBeatCandidates() : [];
    for (const beat of beats) {
        const chip = document.createElement('span');
        chip.className = 'tns-act-chip tns-next-chip';
        const text = document.createElement('span');
        text.textContent = biText(beat);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.title = '이 후보는 제안에서 제외';
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            const meta = getChatMeta();
            for (const key of [biText(beat, 'en'), biText(beat, 'ko')]) {
                if (key && !meta.ignoredActs.includes(key)) meta.ignoredActs.push(key);
            }
            saveChatMeta();
            updateUi();
        });
        chip.append(text, remove);
        nextList.append(chip);
    }
    const nextSection = element('tns-next-section');
    nextSection.hidden = !settings.nextBeatHints || targetActive;
    element('tns-next-empty').hidden = !settings.nextBeatHints || targetActive || beats.length > 0;

    // 수동 금지 목록
    const customList = element('tns-custom-ban-list');
    customList.replaceChildren();
    const meta = getChatMeta(false);
    for (const ban of meta?.customBans ?? []) {
        const chip = document.createElement('span');
        chip.className = 'tns-act-chip tns-custom-chip';
        const text = document.createElement('span');
        text.textContent = ban;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.title = '금지 해제';
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            const chatMeta = getChatMeta();
            chatMeta.customBans = chatMeta.customBans.filter((item) => item !== ban);
            saveChatMeta();
            updateUi();
        });
        chip.append(text, remove);
        customList.append(chip);
    }

    // 전역 하드 리밋 목록
    const globalList = element('tns-global-ban-list');
    globalList.replaceChildren();
    for (const ban of settings.globalBans ?? []) {
        const chip = document.createElement('span');
        chip.className = 'tns-act-chip tns-custom-chip';
        const text = document.createElement('span');
        text.textContent = ban;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.title = '하드 리밋 해제';
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            const current = getSettings();
            current.globalBans = (current.globalBans ?? []).filter((item) => item !== ban);
            saveSettings();
            updateUi();
        });
        chip.append(text, remove);
        globalList.append(chip);
    }

    // 스텔스 감지 점수 뷰어
    const scoreBox = element('tns-score-box');
    if (settings.armMode === 'stealth' && isSupervising()) {
        scoreBox.hidden = false;
        const { score, hits } = stealthWindowDetail();
        const threshold = STEALTH_THRESHOLDS[settings.stealthSensitivity] ?? STEALTH_THRESHOLDS.normal;
        element('tns-score-value').textContent = `${score} / 기준 ${threshold}`;
        const hitsList = element('tns-score-hits');
        hitsList.replaceChildren();
        const seenHits = new Set();
        for (const hit of hits) {
            const key = `${hit.label}:${hit.text.toLocaleLowerCase()}`;
            if (seenHits.has(key)) continue;
            seenHits.add(key);
            if (seenHits.size > 12) break;
            const chip = document.createElement('span');
            chip.className = 'tns-act-chip tns-hit-chip';
            chip.textContent = `${hit.text} (${hit.label} +${hit.w})`;
            hitsList.append(chip);
        }
        element('tns-score-note').hidden = hits.length > 0;
    } else {
        scoreBox.hidden = true;
    }
}

// ───────────────────────── 주입문 크기 표시 (글자 수 + 토큰 수) ─────────────────────────
// 토큰 수는 ST에 지금 설정된 토크나이저로 세고, 못 세면 대략치(약)로 보여준다.
let promptTokenSeq = 0;
let promptTokenCache = { text: null, label: '' };

function estimateTokens(text) {
    let ascii = 0;
    let other = 0;
    for (const char of String(text ?? '')) {
        if (char.charCodeAt(0) < 128) ascii++;
        else other++;
    }
    return Math.ceil(ascii / 4 + other * 1.5);
}

async function countPromptTokens(text) {
    const context = getContext();
    const counter = context.getTokenCountAsync ?? context.getTokenCount;
    if (typeof counter === 'function') {
        try {
            const value = Number(await counter.call(context, text));
            if (Number.isFinite(value) && value >= 0) return { count: Math.round(value), exact: true };
        } catch (error) {
            console.debug(`${LOG_PREFIX} 토큰 계산 실패 — 대략치로 표시`, error);
        }
    }
    return { count: estimateTokens(text), exact: false };
}

function refreshPromptSize(prompt) {
    const sizeElement = element('tns-prompt-size');
    if (!sizeElement) return;
    const chars = String(prompt ?? '').length;
    if (!chars) {
        promptTokenSeq++;
        sizeElement.textContent = '0자 · 0토큰';
        return;
    }
    const charLabel = `${chars.toLocaleString()}자`;
    if (promptTokenCache.text === prompt) {
        sizeElement.textContent = `${charLabel} · ${promptTokenCache.label}`;
        return;
    }
    // 정확한 값이 오기 전까지는 대략치를 먼저 보여줘서 깜빡이지 않게 한다.
    sizeElement.textContent = `${charLabel} · 약 ${estimateTokens(prompt).toLocaleString()}토큰`;
    const seq = ++promptTokenSeq;
    void countPromptTokens(prompt).then(({ count, exact }) => {
        if (seq !== promptTokenSeq) return;
        const label = `${exact ? '' : '약 '}${count.toLocaleString()}토큰`;
        promptTokenCache = { text: prompt, label };
        const current = element('tns-prompt-size');
        if (current) current.textContent = `${charLabel} · ${label}`;
    });
}

function updateUi() {
    syncDiagnosticFetch();
    if (!uiReady) return;
    try {
        const settings = getSettings();
        // 새 채팅도 설정 화면을 여는 즉시 기본 사용 상태를 생성·저장한다.
        const meta = getChatMeta();

        const popupDeveloperTitle = element('tns-popup-developer-title');
        if (popupDeveloperTitle) {
            popupDeveloperTitle.textContent = settings.developerMode ? '🔞 또또NSFW 🧪' : '🔞 또또NSFW';
        }

        element('tns-diagnostics-enabled').checked = Boolean(settings.diagnosticsEnabled);
        renderDiagnostics();
        element('tns-enabled').checked = Boolean(settings.enabled);
        element('tns-adult-confirmed').checked = Boolean(settings.adultConfirmed);
        element('tns-chat-enabled').checked = Boolean(meta?.enabled);
        element('tns-repeat-window').value = String(settings.repeatWindow);
        element('tns-repeat-window-value').textContent = `${settings.repeatWindow}턴`;
        element('tns-max-banned').value = String(settings.maxBannedActs);
        element('tns-max-banned-value').textContent = `${settings.maxBannedActs}개`;
        element('tns-pace-mode').value = String(settings.paceMode);
        element('tns-pace-mode').disabled = Boolean(settings.slowBurnEnabled);
        element('tns-pace-mode-note').textContent = settings.slowBurnEnabled
            ? '슬로우번이 켜져 있어 현재는 단계별 진행 제한이 대신 적용돼요.'
            : '슬로우번을 켜면 이 설정 대신 단계별 진행 제한이 적용돼요.';
        element('tns-slow-burn-enabled').checked = Boolean(settings.slowBurnEnabled);
        element('tns-slow-burn-intensity').value = String(settings.slowBurnIntensity);
        element('tns-slow-burn-intensity').disabled = !settings.slowBurnEnabled;
        element('tns-slow-burn-user-override').checked = Boolean(settings.slowBurnUserOverride);
        element('tns-slow-burn-user-override').disabled = !settings.slowBurnEnabled;
        element('tns-style-length').value = String(settings.styleLength);
        element('tns-style-balance').value = String(settings.styleBalance);
        element('tns-exit-bridge').checked = Boolean(settings.exitBridge);
        element('tns-arm-mode').value = String(settings.armMode);
        element('tns-stealth-sensitivity').value = String(settings.stealthSensitivity);
        element('tns-stealth-sensitivity').disabled = settings.armMode !== 'stealth';
        const keywordsInput = element('tns-stealth-keywords');
        if (document.activeElement !== keywordsInput) keywordsInput.value = String(settings.stealthKeywords ?? '');
        keywordsInput.disabled = settings.armMode !== 'stealth';
        element('tns-next-hints').checked = Boolean(settings.nextBeatHints);
        element('tns-dialogue-guard').checked = Boolean(settings.dialogueBeatGuard);
        element('tns-dialogue-window').value = String(settings.dialogueWindow);
        element('tns-dialogue-window').disabled = !settings.dialogueBeatGuard;
        element('tns-dialogue-window-value').textContent = `${settings.dialogueWindow}개`;
        element('tns-auto-refine').checked = Boolean(settings.autoRefine);
        const authSelect = element('tns-refine-vertex-auth');
        if (authSelect) {
            authSelect.value = ['express', 'full'].includes(settings.refineVertexAuthMode) ? settings.refineVertexAuthMode : 'profile';
            authSelect.disabled = !String(settings.refineProfileId ?? '').trim();
        }

        element('tns-adult-warning').hidden = Boolean(settings.adultConfirmed);

        const armed = isSupervising();
        const heat = effectiveState().state?.heat;
        const heatText = meta?.autoArmed && meta.armSource === 'local'
            ? ' (본문 신호 감지)'
            : heat !== null && heat !== undefined ? ` (온도 ${heat}/10)` : ' (최신 온도 미확인)';
        element('tns-header-status').textContent = !settings.enabled
            ? '꺼져 있어요'
            : !settings.adultConfirmed
                ? '성인 캐릭터 확인이 필요해요'
                : !meta?.enabled
                    ? '이 채팅에서는 쉬는 중'
                    : refineRunning
                        ? '보조 AI 분석 중…'
                        : settings.armMode === 'stealth'
                            ? (meta?.autoArmed ? `개입 중이에요${heatText}` : '조용히 대기 중이에요 (주입 없음)')
                            : settings.armMode === 'auto'
                                ? (meta?.autoArmed ? `개입 중이에요${heatText}` : `온도를 감시하는 중이에요${heatText}`)
                                : '장면을 지켜보는 중이에요';

        element('tns-refine').disabled = refineRunning;
        element('tns-refine-label').textContent = ['missing-report', 'body-changed'].includes(effectiveState().source)
            ? '누락·변경 상태 복구' : '상태 다시 분석';
        element('tns-refine').title = '선택한 보정 연결로 최신 답변을 분석합니다. 추가 AI 호출 비용이 발생합니다.';
        element('tns-force-arm-label').textContent = isFullyArmed() ? '개입 해제' : '지금 개입';
        renderStatePanel();

        const preview = element('tns-prompt-preview');
        if (!preview.hidden) {
            const prompt = armed ? buildInjection() : '';
            element('tns-prompt-text').textContent = prompt || '(지금은 주입할 내용이 없어요)';
            refreshPromptSize(prompt);
        }
    } catch (error) {
        console.error(`${LOG_PREFIX} UI 갱신 실패`, error);
    }
}

function bindSetting(id, key, parser = (value) => value, after = null) {
    element(id).addEventListener('change', () => {
        const target = element(id);
        const value = target.type === 'checkbox' ? target.checked : target.value;
        const settings = getSettings();
        settings[key] = parser(value);
        saveSettings();
        if (!settings.enabled) clearInjectedPrompt();
        if (typeof after === 'function') after(settings);
        updateUi();
    });
}

function bindUi() {
    bindSetting('tns-diagnostics-enabled', 'diagnosticsEnabled', Boolean, () => {
        diagnosticRecord('recording_started', diagnosticState());
        renderDiagnostics();
    });
    element('tns-diagnostic-copy').addEventListener('click', () => { void copyDiagnostics(); });
    element('tns-diagnostic-download').addEventListener('click', downloadDiagnostics);
    element('tns-diagnostic-clear').addEventListener('click', clearDiagnostics);

    // 탭 클릭은 루트 위임으로 — 패널이 팝업으로 이동해도, 어떤 환경에서도 확실히 잡힌다
    const root = document.getElementById('ttotto-nsfw-settings');
    element('tns-developer-title').addEventListener('click', handleDeveloperTitleTap);
    root.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-tns-tab]');
        if (button && root.contains(button)) {
            event.preventDefault();
            event.stopPropagation();
            setTab(button.dataset.tnsTab);
        }
    });

    const syncSlowBurnSession = (settings) => {
        const meta = getChatMeta(false);
        if (!meta) return;
        resetSlowBurnSession(meta);
        saveChatMeta();
        if (settings.enabled && settings.adultConfirmed && settings.slowBurnEnabled && isFullyArmed()) startSlowBurnSessionIfNeeded();
    };
    bindSetting('tns-enabled', 'enabled', Boolean, syncSlowBurnSession);
    bindSetting('tns-adult-confirmed', 'adultConfirmed', Boolean, syncSlowBurnSession);
    bindSetting('tns-arm-mode', 'armMode', String, (settings) => {
        // 수동으로 전환하면 자동 무장 상태는 리셋 (스텔스↔온도 자동 전환은 유지)
        if (settings.armMode === 'manual') {
            const meta = getChatMeta(false);
            if (meta) {
                meta.autoArmed = false;
                resetSlowBurnSession(meta);
                saveChatMeta();
            }
        }
    });
    bindSetting('tns-stealth-sensitivity', 'stealthSensitivity', String);
    bindSetting('tns-stealth-keywords', 'stealthKeywords', String);
    bindSetting('tns-next-hints', 'nextBeatHints', Boolean);
    bindSetting('tns-dialogue-guard', 'dialogueBeatGuard', Boolean);
    bindSetting('tns-card-link', 'cardLinkEnabled', Boolean);
    element('tns-card-link-refresh').addEventListener('click', () => {
        updateUi();
        toastr.info('CardInject 카테고리 목록을 다시 읽었어요.', '🔞또또NSFW');
    });
    const dialogueSlider = element('tns-dialogue-window');
    dialogueSlider.addEventListener('input', () => {
        element('tns-dialogue-window-value').textContent = `${dialogueSlider.value}개`;
    });
    dialogueSlider.addEventListener('change', () => {
        const settings = getSettings();
        settings.dialogueWindow = Math.min(6, Math.max(1, Number(dialogueSlider.value) || DIALOGUE_BEAT_WINDOW));
        saveSettings();
        updateUi();
    });
    bindSetting('tns-pace-mode', 'paceMode', String);
    bindSetting('tns-slow-burn-enabled', 'slowBurnEnabled', Boolean, (settings) => {
        const meta = getChatMeta(false);
        if (!meta) return;
        resetSlowBurnSession(meta);
        saveChatMeta();
        if (settings.slowBurnEnabled && isFullyArmed()) startSlowBurnSessionIfNeeded();
    });
    bindSetting('tns-slow-burn-intensity', 'slowBurnIntensity', String);
    bindSetting('tns-slow-burn-user-override', 'slowBurnUserOverride', Boolean);
    bindSetting('tns-style-length', 'styleLength', String);
    bindSetting('tns-style-balance', 'styleBalance', String);
    bindSetting('tns-exit-bridge', 'exitBridge', Boolean);
    bindSetting('tns-auto-refine', 'autoRefine', Boolean);
    bindSetting('tns-refine-profile', 'refineProfileId', String);
    bindSetting('tns-refine-vertex-auth', 'refineVertexAuthMode', String);

    const slider = element('tns-repeat-window');
    slider.addEventListener('input', () => {
        element('tns-repeat-window-value').textContent = `${slider.value}턴`;
    });
    slider.addEventListener('change', () => {
        const settings = getSettings();
        settings.repeatWindow = Math.min(10, Math.max(1, Number(slider.value) || DEFAULT_SETTINGS.repeatWindow));
        saveSettings();
        updateUi();
    });

    const maxBannedSlider = element('tns-max-banned');
    maxBannedSlider.addEventListener('input', () => {
        element('tns-max-banned-value').textContent = `${maxBannedSlider.value}개`;
    });
    maxBannedSlider.addEventListener('change', () => {
        const settings = getSettings();
        settings.maxBannedActs = Math.min(30, Math.max(5, Number(maxBannedSlider.value) || DEFAULT_SETTINGS.maxBannedActs));
        saveSettings();
        updateUi();
    });

    element('tns-chat-enabled').addEventListener('change', () => {
        const meta = getChatMeta();
        const wasEnabled = Boolean(meta.enabled);
        meta.enabled = element('tns-chat-enabled').checked;
        if (wasEnabled && !meta.enabled) {
            meta.bridgePending = Boolean(getSettings().exitBridge);
            meta.autoArmed = false;
            meta.forceArmed = false;
            const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
            meta.stealthCooldownFrom = chat.length;
        } else if (meta.enabled) {
            meta.bridgePending = false;
        }
        resetSlowBurnSession(meta);
        saveChatMeta();
        if (!meta.enabled) clearInjectedPrompt();
        else if (getSettings().slowBurnEnabled && isFullyArmed()) startSlowBurnSessionIfNeeded();
        updateUi();
    });

    element('tns-state-location').addEventListener('change', () => {
        applyManualEdit((draft) => { draft.location = element('tns-state-location').value; });
    });

    element('tns-refine').addEventListener('click', () => { void runRefine({ manual: true }); });
    element('tns-force-arm').addEventListener('click', forceToggleArm);

    const saveSlowBurnTargetDraft = () => {
        if (!getSettings().developerMode) return;
        const meta = getChatMeta();
        meta.slowBurnTarget = sanitizeSlowBurnTarget(element('tns-slow-burn-target').value);
        meta.slowBurnTargetTurns = clampSlowBurnTargetTurns(element('tns-slow-burn-target-turns').value);
        meta.slowBurnTargetCompleted = false;
        saveChatMeta();
        updateUi();
    };
    element('tns-slow-burn-target').addEventListener('change', saveSlowBurnTargetDraft);
    element('tns-slow-burn-target-turns').addEventListener('change', saveSlowBurnTargetDraft);
    element('tns-slow-burn-target').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            element('tns-slow-burn-target-start').click();
        }
    });
    element('tns-slow-burn-target-start').addEventListener('click', () => {
        const settings = getSettings();
        if (!settings.developerMode) return;
        const target = sanitizeSlowBurnTarget(element('tns-slow-burn-target').value);
        const turns = clampSlowBurnTargetTurns(element('tns-slow-burn-target-turns').value);
        if (!target) {
            toastr.warning('보고 싶은 장면을 먼저 입력해주세요. 예: 키스', '🔞또또NSFW');
            element('tns-slow-burn-target').focus();
            return;
        }
        if (!settings.enabled || !settings.adultConfirmed) {
            toastr.warning('전체 사용과 성인 캐릭터 확인을 먼저 켜주세요.', '🔞또또NSFW');
            return;
        }
        if (!settings.slowBurnEnabled) {
            settings.slowBurnEnabled = true;
            saveSettings();
        }
        const meta = getChatMeta();
        resetSlowBurnSession(meta);
        meta.enabled = true;
        meta.bridgePending = false;
        meta.slowBurnTarget = target;
        meta.slowBurnTargetTurns = turns;
        meta.slowBurnTargetActive = true;
        meta.slowBurnTargetCompleted = false;
        if (settings.armMode !== 'manual') {
            meta.autoArmed = true;
            meta.forceArmed = true;
        }
        saveChatMeta();
        startSlowBurnSessionIfNeeded();
        toastr.success(`“${target}” 장면을 다음 AI 답변부터 ${turns}회 유지해요.`, '🔞또또NSFW');
        updateUi();
    });
    element('tns-slow-burn-target-stop').addEventListener('click', () => {
        if (!getSettings().developerMode) return;
        const meta = getChatMeta();
        meta.slowBurnTargetActive = false;
        meta.slowBurnTargetCompleted = false;
        meta.slowBurnRecoveryPending = false;
        saveChatMeta();
        toastr.info('목표 장면 진행을 중지했어요. 기본 슬로우번은 계속 적용돼요.', '🔞또또NSFW');
        updateUi();
    });

    const setSlowBurnStage = (offset) => {
        const meta = getChatMeta();
        const current = slowBurnStageInfo().stage;
        meta.slowBurnStageOverride = Math.max(1, Math.min(6, current + offset));
        saveChatMeta();
        updateUi();
    };
    element('tns-slow-burn-prev').addEventListener('click', () => setSlowBurnStage(-1));
    element('tns-slow-burn-next').addEventListener('click', () => setSlowBurnStage(1));
    element('tns-slow-burn-lock').addEventListener('click', () => {
        const meta = getChatMeta();
        if (meta.slowBurnLocked) {
            meta.slowBurnLocked = false;
            meta.slowBurnStageOverride = null;
        } else {
            meta.slowBurnStageOverride = slowBurnStageInfo().stage;
            meta.slowBurnLocked = true;
        }
        saveChatMeta();
        updateUi();
    });
    element('tns-slow-burn-auto').addEventListener('click', () => {
        const meta = getChatMeta();
        meta.slowBurnStageOverride = null;
        meta.slowBurnLocked = false;
        resetSlowBurnSession(meta);
        saveChatMeta();
        updateUi();
    });

    const addGlobalBan = () => {
        const input = element('tns-global-ban-input');
        const value = input.value.trim();
        if (!value) return;
        const settings = getSettings();
        if (!Array.isArray(settings.globalBans)) settings.globalBans = [];
        if (!settings.globalBans.includes(value)) settings.globalBans.push(value);
        input.value = '';
        saveSettings();
        updateUi();
    };
    element('tns-global-ban-add').addEventListener('click', addGlobalBan);
    element('tns-global-ban-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); addGlobalBan(); }
    });

    const addCustomBan = () => {
        const input = element('tns-custom-ban-input');
        const value = input.value.trim();
        if (!value) return;
        const meta = getChatMeta();
        if (!meta.customBans.includes(value)) meta.customBans.push(value);
        input.value = '';
        saveChatMeta();
        updateUi();
    };
    element('tns-custom-ban-add').addEventListener('click', addCustomBan);
    element('tns-custom-ban-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); addCustomBan(); }
    });

    element('tns-clear-state').addEventListener('click', () => {
        const meta = getChatMeta();
        meta.manualState = null;
        meta.ignoredActs = [];
        meta.ignoredDialogueBeats = [];
        meta.slowBurnStageOverride = null;
        meta.slowBurnLocked = false;
        for (const message of assistantMessages()) {
            const store = getMessageStore(message, false);
            if (store) delete message.extra[MESSAGE_EXTRA_KEY];
        }
        saveChatMeta();
        persistChat();
        toastr.info('이 채팅의 장면 기록을 비웠어요.', '🔞또또NSFW');
        updateUi();
    });

    element('tns-toggle-preview').addEventListener('click', () => {
        const preview = element('tns-prompt-preview');
        preview.hidden = !preview.hidden;
        element('tns-toggle-preview').textContent = preview.hidden ? '주입문 보기' : '주입문 접기';
        updateUi();
    });
}

// ───────────────────────── 팝업 (완드 메뉴 빠른 접근) ─────────────────────────
// 설정 패널 DOM을 통째로 팝업으로 옮겼다가 닫을 때 되돌린다 — 모든 기능·바인딩이 그대로 동작.
// 모바일 우선: 중앙 고정과 가로 스크롤 차단을 열 때마다 인라인 !important로 강제한다.
// (MovingUI의 transform 및 실리태번 테마의 전역 CSS 오버라이드 대응)

const TNS_OVERLAY_BASE_CSS = [
    'position:fixed !important', 'top:0 !important', 'left:0 !important', 'right:0 !important',
    'bottom:0 !important', 'width:100vw !important', 'height:100vh !important', 'margin:0 !important',
    'padding:16px !important', 'box-sizing:border-box !important', 'z-index:99990 !important',
    'background-color:rgba(12,12,16,0.55) !important', 'align-items:center !important',
    'justify-content:center !important', 'transform:none !important', '-webkit-transform:none !important',
].join('; ');

const TNS_POPUP_BOX_CSS = [
    'box-sizing:border-box !important', 'width:100% !important', 'min-width:0 !important',
    'max-width:460px !important', 'max-height:88vh !important', 'display:flex !important',
    'flex-direction:column !important', 'position:relative !important', 'z-index:99991 !important',
    'border-radius:14px !important', 'overflow:hidden !important', 'margin:0 auto !important',
    'transform:none !important', 'background-color:var(--SmartThemeBlurTintColor, #1b1b22) !important',
    'color:var(--SmartThemeBodyColor, #ddd) !important',
    'border:1px solid rgba(128,128,128,0.35) !important',
    'box-shadow:0 16px 40px rgba(0,0,0,0.4) !important',
].join('; ');

function buildPopupShell() {
    if (document.getElementById('tns-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'tns-overlay';
    overlay.className = 'tns-overlay';
    overlay.innerHTML = [
        '<div id="tns-popup-box" class="tns-popup">',
        '  <div class="tns-popup-header">',
        '    <strong id="tns-popup-developer-title">🔞 또또NSFW</strong>',
        '    <button id="tns-popup-close" class="menu_button" type="button" title="닫기">✕</button>',
        '  </div>',
        '  <div id="tns-popup-body" class="tns-popup-body"></div>',
        '</div>',
    ].join('\n');
    // MovingUI가 body에 transform을 걸어 fixed가 깨지는 문제: 오버레이 자체에 transform 리셋으로 대응 (킨크 추출기와 동일)
    document.body.append(overlay);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePopup();
    });
    overlay.querySelector('#tns-popup-close').addEventListener('click', closePopup);
    overlay.querySelector('#tns-popup-developer-title').addEventListener('click', handleDeveloperTitleTap);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && popupOpen) closePopup();
    });
}

function openPopup() {
    if (!uiReady) {
        toastr.warning('설정 패널이 아직 준비되지 않았어요. 잠시 후 다시 열어주세요.', '🔞또또NSFW');
        return;
    }
    buildPopupShell();
    const panel = document.getElementById('ttotto-nsfw-settings');
    const overlay = document.getElementById('tns-overlay');
    const box = document.getElementById('tns-popup-box');
    if (!panel || !overlay || !box) return;
    settingsHomeParent = ensureSettingsHome();
    document.getElementById('tns-popup-body').append(panel);
    panel.classList.add('tns-in-popup');
    panel.hidden = false;
    // 드로어가 접혀 있었어도 팝업에서는 무조건 펼침 (인라인 강제)
    const drawerContent = panel.querySelector('.inline-drawer-content');
    if (drawerContent) drawerContent.style.setProperty('display', 'block', 'important');
    overlay.style.cssText = `display:flex !important; ${TNS_OVERLAY_BASE_CSS}`;
    box.style.cssText = TNS_POPUP_BOX_CSS;
    setTab(activeUiTab);
    const header = box.querySelector('.tns-popup-header');
    if (header) header.style.cssText = 'display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; padding:10px 14px !important; border-bottom:1px solid rgba(128,128,128,0.25) !important; flex-shrink:0 !important;';
    const body = document.getElementById('tns-popup-body');
    if (body) body.style.cssText = 'box-sizing:border-box !important; width:100% !important; min-width:0 !important; max-width:100% !important; overflow-y:auto !important; overflow-x:hidden !important; overscroll-behavior-x:none !important; touch-action:pan-y !important; padding:8px 14px 14px !important; -webkit-overflow-scrolling:touch;';
    popupOpen = true;
    updateUi();
}

function closePopup() {
    const overlay = document.getElementById('tns-overlay');
    const panel = document.getElementById('ttotto-nsfw-settings');
    if (overlay) overlay.style.cssText = `display:none !important; ${TNS_OVERLAY_BASE_CSS}`;
    if (panel) {
        panel.hidden = true;
        settingsHomeParent = ensureSettingsHome();
        panel.classList.remove('tns-in-popup');
        const drawerContent = panel.querySelector('.inline-drawer-content');
        if (drawerContent) drawerContent.style.removeProperty('display');
        settingsHomeParent.append(panel);
    }
    popupOpen = false;
}

function addWandButton() {
    if (document.getElementById('tns-wand-button')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        console.warn(`${LOG_PREFIX} #extensionsMenu를 찾지 못했습니다 — ST 버전에 따라 셀렉터 조정이 필요할 수 있어요.`);
        return;
    }
    const item = document.createElement('div');
    item.id = 'tns-wand-button';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<span class="extensionsMenuExtensionButton" aria-hidden="true">🔞</span><span>또또NSFW</span>';
    item.addEventListener('click', () => {
        menu.style.display = 'none';
        openPopup();
    });
    menu.append(item);
}

function removeWandButton() {
    document.getElementById('tns-wand-button')?.remove();
}

async function loadSettingsHtml() {
    const response = await fetch(new URL('settings.html', EXTENSION_BASE_URL));
    if (!response.ok) throw new Error(`settings.html 로드 실패 (HTTP ${response.status})`);
    return response.text();
}

// Keep settings outside SillyTavern's extension tab, even with stale CSS.
function ensureSettingsHome() {
    let home = document.getElementById('tns-settings-home');
    if (!home) {
        home = document.createElement('div');
        home.id = 'tns-settings-home';
        home.hidden = true;
        home.style.setProperty('display', 'none', 'important');
        document.body.append(home);
    }
    return home;
}

async function initializeUi() {
    syncStateTagDisplayGuard();
    if (uiReady && document.getElementById('ttotto-nsfw-settings')) {
        addWandButton();
        updateUi();
        return;
    }
    const container = ensureSettingsHome();
    settingsHomeParent = container;
    if (!document.getElementById('ttotto-nsfw-settings')) {
        const html = await loadSettingsHtml();
        if (!runtimeActive) return;
        container.insertAdjacentHTML('beforeend', html);
    }
    const required = [
        'tns-enabled',
        'tns-adult-confirmed',
        'tns-chat-enabled',
        'tns-repeat-window',
        'tns-pace-mode',
        'tns-slow-burn-enabled',
        'tns-slow-burn-stage',
        'tns-refine',
        'tns-state-location',
        'tns-dialogue-window',
        'tns-card-link',
        'tns-card-link-list',
    ];
    const missing = required.filter((id) => !document.getElementById(id));
    if (missing.length) throw new Error(`설정 패널 요소 누락: ${missing.join(', ')}`);
    uiReady = true;
    bindUi();
    populateProfiles();
    setTab('state');
    addWandButton();
    updateUi();
}

// ───────────────────────── 이벤트 등록/수명주기 ─────────────────────────

function registerEvents() {
    syncStateTagDisplayGuard();
    syncDiagnosticFetch();
    if (eventsRegistered) return;
    const context = getContext();
    const events = getEventTypes(context);
    const listen = (name, handler) => {
        const event = events[name];
        if (!event) return;
        context.eventSource.on(event, handler);
        registeredEventHandlers.push({ event, handler });
    };

    listen('GENERATION_STARTED', onGenerationStarted);
    listen('MESSAGE_RECEIVED', (index) => {
        diagnosticRecord('message_received', { message: Number(index) });
        diagnosticTrackBody(messageByIndex(index), Number(index), 'message_received');
        finishReceivedGeneration();
        handleIncomingMessage(index);
    });
    // 스와이프 보험: ST 버전에 따라 스와이프 생성 후 MESSAGE_RECEIVED가 안 오는 경우를 이중으로 잡는다
    listen('GENERATION_ENDED', (type) => {
        diagnosticRecord('generation_ended');
        if (finishSceneGeneration(type)) handleIncomingMessage();
    });
    listen('GENERATION_STOPPED', () => {
        diagnosticRecord('generation_stopped');
        rewriteGeneration = null;
        generationEvents = [];
        handleIncomingMessage();
    });
    listen('CHARACTER_MESSAGE_RENDERED', (index) => { diagnosticRecord('message_rendered', { message: Number(index) }); handleIncomingMessage(index); });
    listen('MESSAGE_SWIPED', (index) => { diagnosticRecord('message_swiped', { message: Number(index) }); handleIncomingMessage(index); });
    listen('MESSAGE_EDITED', (index) => { diagnosticRecord('message_edited', { message: Number(index) }); diagnosticTrackBody(messageByIndex(index), Number(index), 'message_edited'); handleIncomingMessage(index); });
    listen('MESSAGE_DELETED', () => updateUi());
    listen('CHAT_CHANGED', () => {
        resetDiagnosticEvidence();
        diagnosticRecord('chat_changed');
        lastObservedMessage = null;
        queuedRefineTarget = null;
        lastAutoRefineTarget = null;
        refineFailure = null;
        rewriteGeneration = null;
        generationEvents = [];
        lastCompletedAssistant = null;
        clearTimeout(refineTimer);
        refineAbortController?.abort();
        clearInjectedPrompt();
        populateProfiles();
        reconcileReportedRelease();
        maybeStealthRelease();
        updateUi();
    });
    listen('CHAT_CREATED', () => updateUi());
    listen('CONNECTION_PROFILE_LOADED', populateProfiles);
    eventsRegistered = true;
}

function unregisterEvents() {
    if (!eventsRegistered) return;
    const eventSource = getContext().eventSource;
    for (const { event, handler } of registeredEventHandlers.splice(0)) {
        if (typeof eventSource.removeListener === 'function') eventSource.removeListener(event, handler);
        else if (typeof eventSource.off === 'function') eventSource.off(event, handler);
    }
    eventsRegistered = false;
}

async function initialize() {
    if (!runtimeActive) return;
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        getSettings();
        reconcileReportedRelease();
        maybeStealthRelease();
        registerEvents();
        await initializeUi();
        startMessageObserver();
        console.log(`${LOG_PREFIX} v${EXTENSION_VERSION} 로드 완료`);

    })();
    try { await initializationPromise; }
    finally { initializationPromise = null; }
}

function requestInitialize() {
    if (!runtimeActive) return;
    // APP_READY가 이미 끝난 뒤 설치/활성화되어도 현재 DOM으로 초기화한다.
    if (!document.body) return;
    void initialize().catch((error) => {
        console.error(`${LOG_PREFIX} 초기화 실패`, error);
        toastr.error(`초기화 실패: ${error?.message ?? error}`, "🔞또또NSFW");
    });
}

export function onActivate() {
    runtimeActive = true;
    getSettings();
    registerEvents();
    requestInitialize();
}

export function onEnable() {
    runtimeActive = true;
    registerEvents();
    maybeStealthRelease();
    if (uiReady) addWandButton();
    requestInitialize();
}

export function onDisable() {
    runtimeActive = false;
    stopMessageObserver();
    stopDiagnosticFetch();
    stopStateTagDisplayGuard();
    queuedRefineTarget = null;
    refineFailure = null;
    rewriteGeneration = null;
    generationEvents = [];
    lastCompletedAssistant = null;
    clearTimeout(refineTimer);
    refineAbortController?.abort();
    closePopup();
    removeWandButton();
    unregisterEvents();
    const meta = getChatMeta(false);
    if (meta) {
        resetSlowBurnSession(meta);
        saveChatMeta();
    }
    clearInjectedPrompt();
}

export function onClean() {
    onDisable();
    stopDiagnosticFetch();
    clearDiagnostics();
    stopStateTagDisplayGuard();
    closePopup();
    removeWandButton();
    document.getElementById('tns-overlay')?.remove();
    const context = getContext();
    delete context.extensionSettings[MODULE_NAME];
    if (context.chatMetadata && typeof context.chatMetadata === 'object') {
        delete context.chatMetadata[CHAT_STATE_KEY];
        saveChatMeta();
    }
    context.saveSettingsDebounced();
    clearInjectedPrompt();
}

const bootContext = getContext();
syncStateTagDisplayGuard();
const bootEvents = getEventTypes(bootContext);
// 이벤트가 아직 발생하지 않은 초기 로드와 이미 발생한 늦은 로드를 모두 처리한다.
for (const event of new Set([bootEvents.APP_INITIALIZED, bootEvents.APP_READY].filter(Boolean))) {
    bootContext.eventSource.on(event, requestInitialize);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', requestInitialize, { once: true });
} else {
    requestInitialize();
}
