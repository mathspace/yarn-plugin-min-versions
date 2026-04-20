import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {afterEach, describe, expect, test} from 'vitest';
import {MockRegistry} from './helpers/mockRegistry';

const repoRoot = process.cwd();
const yarnBin = path.join(repoRoot, `node_modules`, `@yarnpkg`, `cli-dist`, `bin`, `yarn.js`);
const pluginBundle = path.join(repoRoot, `bundles`, `@yarnpkg`, `plugin-min-versions.js`);

const packageFixtures = [
  {
    name: `dep`,
    versions: [
      {version: `1.0.0`},
      {version: `1.1.0`},
      {version: `1.5.0`},
      {version: `1.9.0`},
      {version: `2.0.0`},
    ],
  },
  {
    name: `foo`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          dep: `^1.0.0`,
        },
      },
    ],
  },
  {
    name: `foo-tilde`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          dep: `~1.0.0`,
        },
      },
    ],
  },
  {
    name: `bar`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          dep: `^1.5.0`,
        },
      },
    ],
  },
  {
    name: `mid`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          foo: `1.0.0`,
        },
      },
    ],
  },
  {
    name: `alt-mid`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          foo: `1.0.0`,
        },
      },
    ],
  },
  {
    name: `extra-mid`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          foo: `1.0.0`,
        },
      },
    ],
  },
  {
    name: `last-mid`,
    versions: [
      {
        version: `1.0.0`,
        dependencies: {
          foo: `1.0.0`,
        },
      },
    ],
  },
  {
    name: `peer-host`,
    versions: [
      {version: `1.0.0`},
    ],
  },
  {
    name: `peer-dep`,
    versions: [
      {
        version: `1.0.0`,
        peerDependencies: {
          'peer-host': `*`,
        },
      },
      {
        version: `1.1.0`,
        peerDependencies: {
          'peer-host': `*`,
        },
      },
    ],
  },
];

const tempRoots: Array<string> = [];

async function createProject(registry: MockRegistry, packageJson: Record<string, unknown>) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `yarn-plugin-min-versions-`));
  tempRoots.push(tempRoot);

  await writeFile(path.join(tempRoot, `package.json`), `${JSON.stringify({
    name: `fixture-project`,
    version: `1.0.0`,
    private: true,
    packageManager: `yarn@4.14.1`,
    ...packageJson,
  }, null, 2)}\n`);

  await writeFile(path.join(tempRoot, `.yarnrc.yml`), [
    `nodeLinker: node-modules`,
    `enableGlobalCache: false`,
    `cacheFolder: "./.yarn/cache"`,
    `globalFolder: "./.yarn/global"`,
    `npmRegistryServer: "${registry.url}"`,
    `unsafeHttpWhitelist:`,
    `  - "127.0.0.1"`,
    `plugins:`,
    `  - path: "${pluginBundle}"`,
    ``,
  ].join(`\n`));

  return tempRoot;
}

async function writeWorkspacePackage(root: string, relativePath: string, packageJson: Record<string, unknown>) {
  const workspaceDir = path.join(root, relativePath);
  await mkdir(workspaceDir, {recursive: true});
  await writeFile(path.join(workspaceDir, `package.json`), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function runYarn(projectCwd: string, args: Array<string>) {
  return await new Promise<{code: number; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, [yarnBin, ...args], {
      cwd: projectCwd,
      env: {
        ...process.env,
        FORCE_COLOR: `0`,
        YARN_ENABLE_TELEMETRY: `0`,
        YARN_ENABLE_IMMUTABLE_INSTALLS: `0`,
      },
      stdio: [`ignore`, `pipe`, `pipe`],
    });

    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];

    child.stdout.on(`data`, chunk => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on(`data`, chunk => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on(`error`, reject);
    child.on(`close`, code => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString(`utf8`),
        stderr: Buffer.concat(stderr).toString(`utf8`),
      });
    });
  });
}

async function readInstalledVersion(projectCwd: string, packageName: string) {
  const packageJson = await readFile(path.join(projectCwd, `node_modules`, packageName, `package.json`), `utf8`);
  return JSON.parse(packageJson).version as string;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async tempRoot => {
    await rm(tempRoot, {recursive: true, force: true});
  }));
});

describe(`yarn-plugin-min-versions`, () => {
  test(`picks the lowest fresh candidate that satisfies a lifted floor`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          foo: `1.0.0`,
        },
        minVersions: {
          dep: `1.1.0`,
        },
      });

      const install = await runYarn(project, [`install`]);
      expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(await readInstalledVersion(project, `dep`)).toBe(`1.1.0`);
    } finally {
      await registry.stop();
    }
  });

  test(`install is a no-op when the lockfile already satisfies the configured floors`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          foo: `1.0.0`,
        },
        minVersions: {
          dep: `1.1.0`,
        },
      });

      const firstInstall = await runYarn(project, [`install`]);
      expect(firstInstall.code, `${firstInstall.stdout}\n${firstInstall.stderr}`).toBe(0);

      const immutableInstall = await runYarn(project, [`install`, `--immutable`]);
      expect(immutableInstall.code, `${immutableInstall.stdout}\n${immutableInstall.stderr}`).toBe(0);
      expect(await readInstalledVersion(project, `dep`)).toBe(`1.1.0`);
    } finally {
      await registry.stop();
    }
  });

  test(`check succeeds and explain reports covered-by-higher-resolution when another branch already resolves higher`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          foo: `1.0.0`,
          bar: `1.0.0`,
        },
      });

      const initialInstall = await runYarn(project, [`install`]);
      expect(initialInstall.code, `${initialInstall.stdout}\n${initialInstall.stderr}`).toBe(0);
      expect(await readInstalledVersion(project, `dep`)).toBe(`1.9.0`);

      await writeFile(path.join(project, `package.json`), `${JSON.stringify({
        name: `fixture-project`,
        version: `1.0.0`,
        private: true,
        packageManager: `yarn@4.14.1`,
        dependencies: {
          foo: `1.0.0`,
          bar: `1.0.0`,
        },
        minVersions: {
          dep: `1.1.0`,
        },
      }, null, 2)}\n`);

      const install = await runYarn(project, [`install`]);
      expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(await readInstalledVersion(project, `dep`)).toBe(`1.9.0`);

      const check = await runYarn(project, [`min-versions`, `check`]);
      expect(check.code, `${check.stdout}\n${check.stderr}`).toBe(0);
      expect(check.stdout).toContain(`All 1 minVersions floor is currently satisfied`);

      const explain = await runYarn(project, [`min-versions`, `explain`, `dep`]);
      expect(explain.code, `${explain.stdout}\n${explain.stderr}`).toBe(0);
      expect(explain.stdout).toContain(`[covered-by-higher-resolution]`);
      expect(explain.stdout).toContain(`current resolution dep@npm:1.9.0`);
    } finally {
      await registry.stop();
    }
  });

  test(`check supports virtualized descriptors created by peer dependencies`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          'peer-dep': `^1.0.0`,
          'peer-host': `1.0.0`,
        },
        minVersions: {
          'peer-dep': `1.1.0`,
        },
      });

      const install = await runYarn(project, [`install`]);
      expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(await readInstalledVersion(project, `peer-dep`)).toBe(`1.1.0`);

      const check = await runYarn(project, [`min-versions`, `check`]);
      expect(check.code, `${check.stdout}\n${check.stderr}`).toBe(0);
      expect(check.stdout).toContain(`All 1 minVersions floor is currently satisfied`);
      expect(check.stdout).not.toContain(`unsupported descriptor`);

      const explain = await runYarn(project, [`min-versions`, `explain`, `peer-dep`]);
      expect(explain.code, `${explain.stdout}\n${explain.stderr}`).toBe(0);
      expect(explain.stdout).toContain(`peer-dep@virtual:`);
      expect(explain.stdout).toContain(`[satisfied]`);
    } finally {
      await registry.stop();
    }
  });

  test(`explain shows the workspace introduction path for transitive conflicts`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          mid: `1.0.0`,
        },
      });

      const initialInstall = await runYarn(project, [`install`]);
      expect(initialInstall.code, `${initialInstall.stdout}\n${initialInstall.stderr}`).toBe(0);

      await writeFile(path.join(project, `package.json`), `${JSON.stringify({
        name: `fixture-project`,
        version: `1.0.0`,
        private: true,
        packageManager: `yarn@4.14.1`,
        dependencies: {
          mid: `1.0.0`,
        },
        minVersions: {
          dep: `2.0.0`,
        },
      }, null, 2)}\n`);

      const explain = await runYarn(project, [`min-versions`, `explain`, `dep`]);
      expect(explain.code, `${explain.stdout}\n${explain.stderr}`).toBe(0);
      expect(explain.stdout).toContain(`- [conflict] foo@npm:1.0.0`);
      expect(explain.stdout).toContain(`-> dep@npm:^1.0.0`);
      expect(explain.stdout).toContain(`  introduced by:`);
      expect(explain.stdout).toContain(`  - fixture-project@workspace:. -> mid@npm:1.0.0`);
      expect(explain.stdout).toContain(`-> foo@npm:1.0.0`);
    } finally {
      await registry.stop();
    }
  });

  test(`explain reports when additional introduction paths are omitted`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          'alt-mid': `1.0.0`,
          'extra-mid': `1.0.0`,
          'last-mid': `1.0.0`,
          mid: `1.0.0`,
        },
      });

      const initialInstall = await runYarn(project, [`install`]);
      expect(initialInstall.code, `${initialInstall.stdout}\n${initialInstall.stderr}`).toBe(0);

      await writeFile(path.join(project, `package.json`), `${JSON.stringify({
        name: `fixture-project`,
        version: `1.0.0`,
        private: true,
        packageManager: `yarn@4.14.1`,
        dependencies: {
          'alt-mid': `1.0.0`,
          'extra-mid': `1.0.0`,
          'last-mid': `1.0.0`,
          mid: `1.0.0`,
        },
        minVersions: {
          dep: `2.0.0`,
        },
      }, null, 2)}\n`);

      const explain = await runYarn(project, [`min-versions`, `explain`, `dep`]);
      expect(explain.code, `${explain.stdout}\n${explain.stderr}`).toBe(0);
      expect(explain.stdout).toContain(`  - fixture-project@workspace:. -> alt-mid@npm:1.0.0`);
      expect(explain.stdout).toContain(`  - fixture-project@workspace:. -> extra-mid@npm:1.0.0`);
      expect(explain.stdout).toContain(`  - fixture-project@workspace:. -> last-mid@npm:1.0.0`);
      expect(explain.stdout).toContain(`  - additional introduction paths may exist but were not shown`);
    } finally {
      await registry.stop();
    }
  });

  test(`explain follows workspace-to-workspace ancestry back to the current workspace`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        private: true,
        workspaces: [`packages/*`],
        dependencies: {
          app: `workspace:*`,
        },
      });

      await writeWorkspacePackage(project, `packages/app`, {
        name: `app`,
        version: `1.0.0`,
        dependencies: {
          shared: `workspace:*`,
        },
      });

      await writeWorkspacePackage(project, `packages/shared`, {
        name: `shared`,
        version: `1.0.0`,
        dependencies: {
          foo: `1.0.0`,
        },
      });

      const initialInstall = await runYarn(project, [`install`]);
      expect(initialInstall.code, `${initialInstall.stdout}\n${initialInstall.stderr}`).toBe(0);

      await writeFile(path.join(project, `package.json`), `${JSON.stringify({
        name: `fixture-project`,
        version: `1.0.0`,
        private: true,
        packageManager: `yarn@4.14.1`,
        workspaces: [`packages/*`],
        dependencies: {
          app: `workspace:*`,
        },
        minVersions: {
          dep: `2.0.0`,
        },
      }, null, 2)}\n`);

      const explain = await runYarn(project, [`min-versions`, `explain`, `dep`]);
      expect(explain.code, `${explain.stdout}\n${explain.stderr}`).toBe(0);
      expect(explain.stdout).toContain(`  - fixture-project@workspace:. -> app@workspace:packages/app -> shared@workspace:packages/shared`);
      expect(explain.stdout).toContain(`-> foo@npm:1.0.0`);

      const nestedExplain = await runYarn(path.join(project, `packages`, `app`), [`min-versions`, `explain`, `dep`]);
      expect(nestedExplain.code, `${nestedExplain.stdout}\n${nestedExplain.stderr}`).toBe(0);
      expect(nestedExplain.stdout).toContain(`  - app@workspace:packages/app -> shared@workspace:packages/shared -> foo@npm:1.0.0`);
      expect(nestedExplain.stdout).not.toContain(`fixture-project@workspace:. -> app@workspace:packages/app -> shared@workspace:packages/shared -> foo@npm:1.0.0`);
    } finally {
      await registry.stop();
    }
  });

  test(`install fails when the parent range and floor have an empty intersection`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          'foo-tilde': `1.0.0`,
        },
        minVersions: {
          dep: `1.1.0`,
        },
      });

      const install = await runYarn(project, [`install`]);
      expect(install.code).not.toBe(0);
      expect(`${install.stdout}\n${install.stderr}`).toContain(`intersection is empty`);
    } finally {
      await registry.stop();
    }
  });

  test(`check reports incompatible floors without an internal stacktrace`, async () => {
    const registry = new MockRegistry(packageFixtures);
    await registry.start();
    try {
      const project = await createProject(registry, {
        dependencies: {
          'foo-tilde': `1.0.0`,
        },
      });

      const initialInstall = await runYarn(project, [`install`]);
      expect(initialInstall.code, `${initialInstall.stdout}\n${initialInstall.stderr}`).toBe(0);

      await writeFile(path.join(project, `package.json`), `${JSON.stringify({
        name: `fixture-project`,
        version: `1.0.0`,
        private: true,
        packageManager: `yarn@4.14.1`,
        dependencies: {
          'foo-tilde': `1.0.0`,
        },
        minVersions: {
          dep: `1.1.0`,
        },
      }, null, 2)}\n`);

      const check = await runYarn(project, [`min-versions`, `check`]);
      expect(check.code).not.toBe(0);
      expect(check.stdout).toContain(`cannot be intersected with >=1.1.0`);
      expect(check.stdout).not.toContain(`Internal Error:`);
      expect(check.stdout).not.toContain(`plugin-min-versions.js:`);
    } finally {
      await registry.stop();
    }
  });
});
