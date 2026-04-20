# yarn-plugin-min-versions

A Yarn 4 plugin that enforces graph-wide minimum package versions during
resolution.

## What It Does

Add a root-only `minVersions` field to `package.json`:

```json
{
  "minVersions": {
    "lodash": "4.17.21",
    "minimatch": "9.0.5"
  }
}
```

Then import the built plugin bundle so Yarn copies it into your repository and
updates `.yarnrc.yml`:

```sh
yarn plugin import ./bundles/@yarnpkg/plugin-min-versions.js
```

On `yarn install`, the plugin:

- validates the root `minVersions` policy
- rewrites matching dependency edges during `reduceDependency`
- picks the lowest fresh npm candidate that satisfies the lifted floor
- reuses a higher locked version when one already exists and still satisfies the floor
- fails loudly when a parent range and the configured floor have an empty intersection

## Why The Plugin Includes A Resolver

The spec correctly identified `reduceDependency` as the place where policy must
be enforced, but official Yarn's npm semver resolver sorts candidates
highest-first. A plain range rewrite would therefore often upgrade farther than
necessary on a fresh resolution.

To preserve the intended "upgrade just enough" behavior, this plugin adds a
small resolver that only handles lifted edges:

- if a satisfying locked version already exists, it prefers that reusable higher version
- otherwise, it resolves the lowest fresh npm version that satisfies the lifted range

## Commands

The plugin ships two commands:

- `yarn min-versions check`
- `yarn min-versions explain <pkg>`

`check` validates the policy and verifies that the current install state
satisfies every configured floor.

`explain` shows the configured floor, the currently resolved package instances,
the dependency edges that are relevant to that package, and up to three
workspace ancestry paths that show how each transitive parent package is
introduced by the current install state. When the graph is dense, additional
paths may exist but not be shown.

## Supported Scope

This implementation intentionally keeps v1 narrow:

- root-only `minVersions`
- package-name to exact-version floors
- npm semver descriptors only
- hard failures for empty intersections
- warnings when root `resolutions` conflict with a configured floor

Not supported in v1:

- `workspace:`, `portal:`, `file:`, `link:`, `patch:`, git, and URL descriptors
- npm aliases
- workspace-specific floor overrides

## Build And Test

```sh
npm install
npm run build
npm test
```

The bundled plugin artifact is produced at:

`bundles/@yarnpkg/plugin-min-versions.js`

## GitHub Releases

This repository includes a GitHub Actions workflow that publishes a bundled
plugin asset when you push a tag matching `v*`.

The workflow:

- runs on tag pushes such as `v0.1.0`
- installs dependencies with `npm ci`
- builds and verifies the plugin with `npm test`
- uploads a release asset named `plugin-min-versions.js`

After the repository is public, consumers can install a released bundle with:

```sh
yarn plugin import https://github.com/<owner>/<repo>/releases/download/v0.1.0/plugin-min-versions.js
```

Yarn will download the asset, copy it into the project-local plugin directory,
and write the corresponding local `plugins:` entry into `.yarnrc.yml`. The
release asset URL is the supported remote installation source; the final
`.yarnrc.yml` entry remains a local file path managed by Yarn.
