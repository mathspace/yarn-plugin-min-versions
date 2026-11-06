import {execFileSync} from 'node:child_process';
import {describe, test} from 'vitest';

function runIsolated(source: string) {
  execFileSync(process.execPath, [`--max-old-space-size=128`, `--input-type=module`, `-e`, source], {
    cwd: process.cwd(),
    timeout: 10_000,
    stdio: `pipe`,
  });
}

describe(`minimatch security backport`, () => {
  for (const format of [`require`, `import`]) {
    test(`bounds preprocessing in the ${format} entry point`, () => {
      runIsolated(`
        import assert from 'node:assert/strict';
        import {createRequire} from 'node:module';
        const require = createRequire(import.meta.url);
        const {Minimatch} = ${format === `require` ? `require('minimatch')` : `await import('minimatch')`};
        const optimizationLevel = 2;

        // Large brace sets retain their matches without pairwise deduplication.
        const large = new Minimatch('{x,*}/{0..999}', {optimizationLevel});
        assert.equal(large.set.length, 2000);
        assert.equal(large.match('x/5'), true);
        assert.equal(large.match('y/999'), true);
        assert.equal(large.match('.y/5'), false);

        // Upstream's adversarial pattern must stop at the expansion budget.
        const pattern = Array(30).fill('**/../a/b').join('/');
        const bounded = new Minimatch(pattern, {optimizationLevel, braceExpandMax: 64});
        assert.equal(bounded.set.length, 64);

        const ordinary = new Minimatch('**/../a/b/**/../c/d', {optimizationLevel});
        assert.equal(ordinary.set.length, 4);
        assert.equal(ordinary.match('../a/b/../c/d'), true);
        assert.equal(ordinary.match('x/a/b/y/c/d'), true);
      `);
    });
  }

  test(`preserves glob, cleanup and TUF delegation matching`, () => {
    runIsolated(`
      import assert from 'node:assert/strict';
      import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
      import {tmpdir} from 'node:os';
      import path from 'node:path';
      import {createRequire} from 'node:module';
      const require = createRequire(import.meta.url);
      const root = mkdtempSync(path.join(tmpdir(), 'minimatch-compat-'));
      try {
        for (const name of ['a.json', 'b.json', 'c.tmp'])
          writeFileSync(path.join(root, name), '');
        for (const glob of [require('glob'), await import('glob')]) {
          assert.deepEqual(glob.globSync('*.json', {cwd: root}).sort(), ['a.json', 'b.json']);
          assert.deepEqual((await glob.glob('*.json', {cwd: root})).sort(), ['a.json', 'b.json']);
        }
        require('rimraf').rimrafSync(path.join(root, '*.tmp'), {glob: true});
        assert.equal(existsSync(path.join(root, 'c.tmp')), false);
        assert.equal(existsSync(path.join(root, 'a.json')), true);

        const {DelegatedRole} = require('@tufjs/models/dist/role.js');
        const role = new DelegatedRole({
          keyIDs: ['key'], threshold: 1, name: 'packages', terminating: false,
          paths: ['packages/*.tgz'],
        });
        assert.equal(role.isDelegatedPath('packages/example.tgz'), true);
        assert.equal(role.isDelegatedPath('other/example.tgz'), false);
        assert.equal(role.isDelegatedPath('packages/nested/example.tgz'), false);
      } finally {
        rmSync(root, {recursive: true, force: true});
      }
    `);
  });
});
