 The right way to do this in Yarn 4 is as a plugin that implements Go-like
 minimum-version floors at resolution time, not as a post-processing lockfile
 rewrite. The key reason is that Yarn’s own install pipeline already treats the
 lockfile as the result of dependency resolution, and plugins can participate in
 that pipeline through hooks. In particular, Yarn’s reduceDependency hook is
 called during resolution for each dependency edge and can return a different
 descriptor/range for Yarn to resolve; Yarn’s own catalog plugin uses that same
 hook to rewrite dependency ranges centrally. That is the exact extension point
 you want. ￼

Target behavior

You want to reproduce this Go property:

* declare a minimum version floor for a package name at the root,
* apply that floor across the whole dependency graph,
* only upgrade when the resolved version is below the floor,
* never downgrade if some branch already resolves higher,
* never “upgrade to latest” unless latest is the minimal candidate satisfying all constraints.

That maps cleanly to Yarn if the plugin rewrites only the lower-bound side of matching descriptors during resolution, then lets Yarn do its normal solving and lockfile generation. Yarn’s resolver is the component that turns descriptors such as webpack@^4.0.0 into actual locked packages, and the top-level yarn.lock is the authoritative lock for the full tree.  ￼

Core design

1) Add a custom root package.json section

Use a root-only field such as:

{
  "minVersions": {
    "lodash": "4.17.21",
    "minimatch": "9.0.5",
    "@babel/generator": "7.26.10"
  }
}

Keep it simple: package name → minimum allowed version. Do not support ranges in v1. The point is to encode a floor, not another override language. Yarn’s manifest already supports official root-only fields like resolutions, but since your behavior is different from resolutions, a separate custom section is cleaner and avoids semantic confusion.  ￼

2) Enforce it through reduceDependency

At each dependency edge:

* inspect the requested descriptor,
* if its package name is not in minVersions, leave it unchanged,
* if it is, compute the intersection of:
    * the original range requested by the parent,
    * a synthetic lower-bound range >= floor,
* if the original range already guarantees >= floor, leave it unchanged,
* otherwise replace the descriptor with the intersected range.

This is exactly the hook contract Yarn exposes: reduceDependency can replace the original dependency descriptor by a different range during resolution. Since multiple plugins run in order, this plugin should be explicit about how it composes with other range-rewriting plugins.  ￼

3) Let standard Yarn install do the rest

Do not mutate yarn.lock directly. Let yarn install regenerate whatever parts of the lockfile need to change. Yarn already updates the lockfile as part of install, and with --immutable it will fail if changes would be needed, which is exactly what teams typically want in CI after changing policy in package.json.  ￼

That gives you the operational model you asked for:

* edit package.json,
* run normal yarn install,
* only transitive packages that are below the configured floor are re-resolved,
* packages already higher stay untouched unless Yarn must re-resolve them for consistency.  ￼

Why this matches Go more closely than resolutions

Yarn resolutions is an override mechanism: it instructs Yarn to use a specific resolution instead of what the resolver would normally pick. That is closer to “pin/force this answer” than “establish a graph-wide minimum.” Your plugin should instead raise the minimum acceptable range and still let the resolver choose the lowest existing valid solution compatible with the rest of the graph. That is much closer to Go’s “minimum floor, but higher is fine.”  ￼

Exact algorithm

For each dependency descriptor name@range:

1. Look up floor = minVersions[name].
2. Parse the dependency protocol/range.
3. Only apply the rule to normal semver-based npm descriptors in v1.
4. Build effectiveRange = intersect(originalRange, >=floor).
5. Cases:
    * No floor configured → return original descriptor.
    * Original already implies >= floor → return original descriptor.
    * Intersection exists → return rewritten descriptor using the intersected range.
    * Intersection empty → fail the install with a clear error explaining:
        * parent package,
        * original range,
        * configured floor,
        * why they are incompatible.

This gives you the critical behavior you want: “upgrade just enough.” Because the plugin is not asking for latest, and Yarn’s resolver still resolves descriptors normally, you only get a later version if the existing lockfile entry is too low or some other branch already wants later. Yarn’s resolver is the system that computes those final locators from descriptors, so the plugin should change descriptors, not final locators.  ￼

Important semantic choices

A) Scope by package name, not by descriptor path

Start with package-name floors only:

"minVersions": {
  "ansi-regex": "6.0.1"
}

This means “every ansi-regex descriptor in the project must resolve to at least 6.0.1.” That is the closest analogue to Go’s per-module-path floor. Avoid path-qualified rules in v1. Yarn’s built-in resolutions supports path specificity, but that is a different tool and adds complexity you do not need for the first version.  ￼

B) Root-only policy

Only the top-level workspace should define minVersions. Ignore nested workspace declarations or fail if they exist. This keeps the policy global and deterministic, which matches your intended model better than allowing each workspace to set competing floors. Yarn already distinguishes root-only behaviors for some manifest features such as resolutions.  ￼

C) Support only npm semver descriptors in v1

Skip or reject:

* workspace:
* portal:
* file:
* link:
* patch:
* git or URL descriptors
* aliases, unless you explicitly normalize them

Yarn’s resolver/fetcher architecture is protocol-based, so keeping v1 to npm semver descriptors is the correct way to avoid protocol edge-case explosion.  ￼

Plugin structure

Commands

Build it as a normal Yarn plugin and ship:

* yarn min-versions check
* yarn min-versions explain <pkg>
* yarn min-versions sync (optional convenience wrapper for install/update-lockfile mode)

Yarn plugins can add CLI commands and are dynamically linked with the running Yarn process, so this fits naturally into the ecosystem. Bootstrap from the official plugin template via yarn builder new plugin.  ￼

Hooks

Use:

* reduceDependency as the main enforcement mechanism,
* optionally afterAllInstalled to emit a report of which packages were lifted by policy. Yarn documents that plugins can react to lifecycle hooks, and afterAllInstalled is triggered after Project#install completes.  ￼

Internal modules

Split the plugin into:

* policy.ts — parse and validate root minVersions
* range.ts — semver range normalization/intersection logic
* hook.ts — reduceDependency implementation
* commands/check.ts
* commands/explain.ts
* report.ts — collects rewrites for human-readable diagnostics

Concrete resolution strategy

To get true “just enough” behavior, the plugin should not emulate yarn dedupe, because Yarn’s documented dedupe strategy is currently highest, which upgrades toward the highest reusable version and is explicitly not a minimal-floor algorithm. Your plugin should avoid dedupe-based implementation entirely.  ￼

Instead:

* keep existing descriptors if they already satisfy policy,
* only rewrite descriptors that fall below the floor,
* leave Yarn’s ordinary resolution/lockfile reuse logic to preserve as much of the existing lockfile as possible.

This is the only design that stays aligned with your “don’t touch later packages, don’t upgrade to latest” requirement.  ￼

Failure model

When a package cannot be lifted to the configured minimum without violating a parent constraint, fail hard with something like:

minVersions: cannot enforce chalk >=5.2.0 for dependency edge parent@1.4.0 -> chalk@^4.1.0; intersection is empty.

That is the correct behavior. Go would also fail semantically if the graph cannot satisfy the requested floor within the same module line. Your plugin should not silently replace ^4.1.0 with ^5.2.0, because that would exceed the parent’s declared major compatibility expectation.

Compatibility rules

With resolutions

Define precedence explicitly:

* default: resolutions wins, because it is an explicit override already understood by Yarn,
* plugin emits a warning if minVersions[name] conflicts with a root resolutions entry.

This is the least surprising model because Yarn documents resolutions as the mechanism that forces specific resolutions.  ￼

With catalogs

Catalogs also rewrite dependency ranges through reduceDependency. Because Yarn runs multiple reduceDependency hooks in definition order, order matters. You should choose and document one of these:

* catalogs first, then min-versions,
* or min-versions first, then catalogs.

I would choose catalogs first, min-versions second. That lets the catalog define the baseline requested range and your plugin then raise it only if it is below policy. This is the closest analogue to “developer intent first, security floor after.”  ￼

Example behavior

Given:

{
  "dependencies": {
    "foo": "^1.0.0"
  },
  "minVersions": {
    "bar": "2.3.4"
  }
}

Assume foo depends on bar@^2.0.0.

The plugin rewrites bar@^2.0.0 to the effective intersected range “>=2.3.4 within the original compatibility envelope.” Yarn then re-resolves that descriptor and updates yarn.lock only if the locked bar was below 2.3.4. If some other branch already had bar@2.5.0, nothing should be downgraded or separately changed for policy reasons. This follows directly from the descriptor-rewrite design plus Yarn’s normal install/lockfile flow.  ￼

Rollout plan

Phase 1: Narrow, correct MVP

Implement only:

* root minVersions
* npm semver dependencies
* package-name floors
* reduceDependency
* yarn min-versions check

Goal: correctness and determinism. No fancy selector language.

Phase 2: Diagnostics

Add:

* yarn min-versions explain <pkg>
* install summary of rewritten edges
* conflict reporting with parent chain context

Phase 3: Policy ergonomics

Add:

* optional allowlist / denylist by workspace
* optional “warn” mode for adoption
* machine-readable JSON output for CI

Phase 4: Broader protocol support

Only after the core behavior is stable, consider aliases and nonstandard protocols.

Test matrix

You need fixture projects for at least these cases:

1. No-op: existing lockfile already satisfies all floors.
2. Simple lift: one transitive dep below floor gets upgraded.
3. Already higher: another branch already resolves later; plugin makes no extra change.
4. Empty intersection: parent range incompatible with floor; install fails.
5. Major boundary: floor crosses major; install fails unless the original parent range allowed it.
6. Multiple parents: two different parents to same package; only effective lower bound changes.
7. Catalog interaction: catalog-defined range then floor enforcement.
8. Resolution interaction: root resolutions conflict detection.
9. Immutable CI: changing minVersions causes yarn install --immutable to fail until lockfile is updated. Yarn documents that immutable installs abort if the lockfile would change.  ￼

Recommended implementation decision

The single most important decision is this:

Implement the feature as descriptor-floor rewriting in reduceDependency, not as lockfile surgery and not as a dedupe strategy.

That gives you:

* native Yarn behavior,
* lockfile updates through standard install,
* minimal changes,
* compatibility with existing Yarn architecture,
* semantics closest to Go’s minimum-floor model.  ￼

My blunt assessment

This is very feasible as a Yarn plugin.

The hard part is not the hook. The hard part is getting the range-intersection semantics exactly right so that:

* it behaves predictably across ^, ~, exact versions, prereleases, and aliases,
* it fails loudly on impossible constraints,
* it composes cleanly with catalogs and resolutions.

If you want the next step, I’ll turn this into a concrete technical spec with:

* package.json schema,
* hook pseudocode,
* precedence rules,
* error taxonomy,
* and the exact acceptance tests.
