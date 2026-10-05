import { mkdtempSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run upstream feature assertions on the compatibility build, before retired
// controllers are removed. Production core behavior is separately integration tested.
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ttotto-regression-'));
let failed = false;
try {
    for (const kind of ['sfw', 'nsfw']) {
        cpSync(join(root, 'vendor', kind), join(temp, kind), { recursive: true });
    }
    const build = spawnSync('python3', [join(root, 'scripts/build.py'), '--legacy-dir', temp], { stdio: 'inherit' });
    if (build.status !== 0) throw new Error('Compatibility build failed');
    for (const kind of ['sfw', 'nsfw']) {
        const tests = readdirSync(join(temp, kind, 'tests')).filter(name => name.endsWith('.mjs')).map(name => join(temp, kind, 'tests', name));
        const result = spawnSync(process.execPath, ['--test', ...tests], {
            env: { ...process.env, SFW_INDEX: join(temp, 'sfw/index.js'), NSFW_INDEX: join(temp, 'nsfw/index.js') }, stdio: 'inherit',
        });
        if (result.status !== 0) failed = true;
    }
} finally { rmSync(temp, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
