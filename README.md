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

Then import the built plugin bundle from `.yarnrc.yml`:

```yaml
plugins:
  - path: ./.yarn/plugins/@yarnpkg/plugin-min-versions.js
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
and the dependency edges that are relevant to that package.

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
