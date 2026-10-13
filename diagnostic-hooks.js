import { diagnosticWriteTrace } from './diagnostics.js';

// Capture these before installing hooks. Diagnostic bookkeeping must never hook itself.
const define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
const apply = Reflect.apply;

export function createDiagnosticHooks(host) {
    let active = false, generation = 0, busy = false, parents = [];
    const patches = [], unavailable = new Set();
    const attempt = fn => { try { return fn(); } catch { return undefined; } };
    const live = () => active && Boolean(attempt(host.live));
    function cause(kind, trace) { return [{ kind, writeTrace: trace }, ...parents].slice(0, 4); }
    function within(chain, fn, self, args) {
        const previous = parents, token = generation; parents = chain;
        try { return apply(fn, self, args); } finally { parents = token === generation ? previous : []; }
    }
    function patch(target, key, label, wrap, setter = false) {
        if (!target) { unavailable.add(label); return; }
        const original = descriptor(target, key);
        const prior = setter ? original?.set : original?.value;
        if (!original?.configurable || typeof prior !== 'function') { unavailable.add(label); return; }
        const token = generation;
        const enabled = () => token === generation && live();
        const replacement = wrap(prior, enabled);
        try {
            define(target, key, { ...original, [setter ? 'set' : 'value']: replacement });
            patches.push({ target, key, label, original, replacement, setter });
        } catch { unavailable.add(label); }
    }
    function domWrapper(label) {
        return (original, enabled) => function (...args) {
            // No argument values, HTML, selector strings, or DOM nodes enter the report.
            const observe = !busy && enabled() && attempt(() => host.domRelevant(this));
            if (!observe) return apply(original, this, args);
            const trace = diagnosticWriteTrace(new Error().stack);
            const before = attempt(host.domSnapshot);
            busy = true;
            try { return apply(original, this, args); }
            finally {
                busy = false;
                attempt(() => host.domOperation(label, before, trace, parents));
            }
        };
    }
    function installDom() {
        const methods = {
            Node: ['appendChild', 'insertBefore', 'replaceChild', 'removeChild', 'normalize'],
            Element: ['append', 'prepend', 'replaceChildren', 'replaceWith', 'remove', 'before', 'after', 'insertAdjacentHTML', 'insertAdjacentText', 'insertAdjacentElement', 'setAttribute', 'removeAttribute', 'toggleAttribute'],
            CharacterData: ['appendData', 'deleteData', 'insertData', 'replaceData', 'replaceWith', 'remove', 'before', 'after'],
            Range: ['deleteContents', 'extractContents', 'insertNode', 'surroundContents'],
        };
        const setters = { Node: ['textContent', 'nodeValue'], Element: ['innerHTML', 'outerHTML'], HTMLElement: ['innerText', 'outerText'], CharacterData: ['data'] };
        for (const [name, keys] of Object.entries(methods)) for (const key of keys)
            patch(globalThis[name]?.prototype, key, `${name}.${key}`, domWrapper(`${name}.${key}`));
        for (const [name, keys] of Object.entries(setters)) for (const key of keys)
            patch(globalThis[name]?.prototype, key, `${name}.${key}`, domWrapper(`${name}.${key}`), true);
    }
    function installDescriptors() {
        for (const [target, key, label] of [[Object, 'defineProperty', 'Object.defineProperty'], [Object, 'defineProperties', 'Object.defineProperties'], [Reflect, 'defineProperty', 'Reflect.defineProperty'], [Reflect, 'deleteProperty', 'Reflect.deleteProperty']]) {
            patch(target, key, label, (original, enabled) => function (...args) {
                let fields;
                if (!busy && enabled()) fields = attempt(() => {
                    const allowed = host.targetFields(args[0]);
                    if (!allowed.length) return [];
                    // Do not coerce user objects or invoke descriptor getters a second time.
                    const keys = key === 'defineProperties' ? Object.getOwnPropertyNames(args[1])
                        : ['string', 'number'].includes(typeof args[1]) ? [String(args[1])] : [];
                    return keys.filter(name => allowed.includes(name));
                });
                if (!fields?.length) return apply(original, this, args);
                const trace = diagnosticWriteTrace(new Error().stack);
                const before = fields.map(name => descriptor(args[0], name));
                busy = true;
                try { return apply(original, this, args); }
                finally {
                    busy = false;
                    attempt(() => {
                        const changed = fields.filter((name, i) => {
                            const next = descriptor(args[0], name), prev = before[i];
                            return !next !== !prev || next && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].some(k => !Object.is(next[k], prev[k]));
                        });
                        if (changed.length) host.descriptorOperation(label, args[0], changed, trace, parents);
                    });
                }
            });
        }
    }
    function installScheduling() {
        for (const key of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask']) {
            patch(globalThis, key, key, (original, enabled) => function (callback, ...args) {
                if (!enabled() || typeof callback !== 'function') return apply(original, this, [callback, ...args]);
                const chain = cause(key, diagnosticWriteTrace(new Error().stack));
                const token = generation;
                const wrapped = function (...values) {
                    if (token !== generation || !enabled()) return apply(callback, this, values);
                    return within(chain, callback, this, values);
                };
                // Keep native return handles, callback receiver/arguments, cancellation and throws.
                return apply(original, this, [wrapped, ...args]);
            });
        }
    }
    function installArrays() {
        for (const key of ['splice', 'push', 'pop', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin']) {
            patch(Array.prototype, key, `Array.${key}`, (original, enabled) => function (...args) {
                if (busy || !attempt(() => host.arrayRelevant(this)) || !enabled()) return apply(original, this, args);
                const trace = diagnosticWriteTrace(new Error().stack), beforeLength = this.length;
                // Do not block slot setters: they provide more precise replacement evidence.
                try { return apply(original, this, args); }
                finally { attempt(() => host.arrayOperation(key, beforeLength, this.length, trace, parents)); }
            });
        }
    }
    function installEvents() {
        const raw = host.raw(), source = raw.eventSource;
        if (!source) return;
        const types = raw.eventTypes ?? raw.event_types ?? {};
        for (const key of ['emit', 'emitAndWait']) {
            // Patch only this emitter instance, without rewriting its listener lists or promises.
            const own = descriptor(source, key);
            if (!own && typeof source[key] === 'function') {
                const value = source[key];
                try { define(source, key, { value, writable: true, configurable: true }); }
                catch { unavailable.add(`eventSource.${key}`); continue; }
            }
            const before = patches.length;
            patch(source, key, `eventSource.${key}`, (original, enabled) => function (...args) {
                const name = enabled() && Object.keys(types).find(name => types[name] === args[0] && /^[A-Z][A-Z_]{0,63}$/.test(name));
                if (!name) return apply(original, this, args);
                const trace = diagnosticWriteTrace(new Error().stack);
                attempt(() => host.eventOperation(name, trace, parents));
                return within(cause(`event:${name}`, trace), original, this, args);
            });
            if (!own) {
                if (patches.length > before) patches.at(-1).original = null;
                else delete source[key];
            }
        }
    }
    function installConsole() {
        for (const key of ['error', 'warn']) patch(globalThis.console, key, `console.${key}`, (original, enabled) => function (...args) {
            if (!busy && enabled()) {
                const trace = diagnosticWriteTrace(new Error().stack);
                busy = true;
                attempt(() => {
                    const error = args.slice(0, 4).find(value => value instanceof Error);
                    const errorTrace = error && typeof error.stack === 'string' ? diagnosticWriteTrace(error.stack, 0) : [];
                    host.consoleOperation(key, trace, parents, errorTrace);
                });
                busy = false;
            }
            return apply(original, this, args);
        });
    }
    function start() {
        if (active) return;
        active = true; generation++; unavailable.clear();
        installDom(); installDescriptors(); installScheduling(); installEvents(); installConsole(); installArrays();
    }
    function stop() {
        active = false; generation++; parents = [];
        for (const entry of patches.reverse()) attempt(() => {
            const current = descriptor(entry.target, entry.key);
            // A later extension's wrapper must never be overwritten by our cleanup.
            if ((entry.setter ? current?.set : current?.value) !== entry.replacement) return;
            if (entry.original) define(entry.target, entry.key, entry.original);
            else delete entry.target[entry.key];
        });
        patches.length = 0;
    }
    function status() {
        const installed = [], displaced = [];
        for (const entry of patches) {
            const current = attempt(() => descriptor(entry.target, entry.key));
            ((entry.setter ? current?.set : current?.value) === entry.replacement ? installed : displaced).push(entry.label);
        }
        return { active, installed, displaced, unavailable: [...unavailable] };
    }
    return { start, stop, status, parents: () => parents };
}
