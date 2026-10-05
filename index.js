import { createRuntime } from './runtime.js';
import { createUi } from './ui.js';

let runtime, starting = null, enabled = true, warned = false, appReady = false;
const ui = createUi(() => runtime);
function hasLegacyRuntime() {
    return Boolean(globalThis.ttottoSfwGenerationInterceptor || globalThis.ttottoNsfwGenerationInterceptor);
}
async function start() {
    if (!enabled || !appReady || !document.body) return;
    if (hasLegacyRuntime()) {
        if (!warned) {
            warned = true;
            toastr.warning('기존 또또SFW·또또NSFW를 확장 관리에서 끄고 새로고침해 주세요. 설정과 기록은 통합판으로 복사돼요.', '또또(N)SFW');
        }
        return;
    }
    if (starting) return starting;
    runtime ??= createRuntime(() => SillyTavern.getContext(), { onUi: () => ui.refresh(), open: kind => ui.open(kind) });
    starting = runtime.start().then(() => { if (enabled) ui.ensureButton(); }).catch(error => {
        runtime.stop();
        console.error('[또또(N)SFW] 초기화 실패', error);
        toastr.error('통합판 초기화에 실패했어요. 새로고침 후 다시 확인해 주세요.', '또또(N)SFW');
    }).finally(() => { starting = null; });
    return starting;
}
globalThis.ttottoUnifiedGenerationInterceptor = async (...args) => {
    if (enabled) await runtime?.intercept(...args);
};
export function onEnable() { enabled = true; return start(); }
export function onActivate() { enabled = true; return start(); }
export function onDisable() { enabled = false; runtime?.stop(); ui.dispose(); }
export function onClean() { enabled = false; runtime?.clean(); ui.dispose(); }

const context = SillyTavern.getContext();
const events = context.eventTypes ?? context.event_types ?? {};
// APP_READY is replayed by Silly's event source for late installation/enabling.
// DOMContentLoaded and APP_INITIALIZED precede chat restoration.
context.eventSource.on(events.APP_READY, () => { appReady = true; return start(); });
