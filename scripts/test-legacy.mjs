import { mkdtempSync, readFileSync, writeFileSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run all upstream behavioral assertions on the adapted engine bodies, not on
// the untouched vendor implementation. Unified-only branches are integration tested.
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ttotto-regression-'));
let failed = false;
try {
    for (const kind of ['sfw', 'nsfw']) {
        cpSync(join(root, 'vendor', kind), join(temp, kind), { recursive: true });
        const source = readFileSync(join(root, 'engines', kind, 'index.js'), 'utf8');
        const body = source.split('// BEGIN ENGINE\n')[1].split('// END ENGINE')[0];
        writeFileSync(join(temp, kind, 'index.js'), 'const unifiedHost = null; const sharedRuntime = globalThis;\n' + body + '\nconst bootContext = getContext();');
    }
    for (const kind of ['sfw', 'nsfw']) {
        const tests = readdirSync(join(temp, kind, 'tests')).filter(name => name.endsWith('.mjs')).map(name => join(temp, kind, 'tests', name));
        const result = spawnSync(process.execPath, ['--test', ...tests], {
            env: { ...process.env, SFW_INDEX: join(temp, 'sfw/index.js'), NSFW_INDEX: join(temp, 'nsfw/index.js') }, stdio: 'inherit',
        });
        if (result.status !== 0) failed = true;
    }
} finally { rmSync(temp, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
