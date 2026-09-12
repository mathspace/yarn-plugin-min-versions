# yarn-plugin-min-versions threat model

## Overview

This Yarn plugin applies root package.json minVersions floors while resolving dependencies, adds a custom npm-compatible resolver, and provides check/explain commands over the restored install state. It validates policy names and exact versions, rejects policy declarations in child workspaces, intersects supported dependency ranges, and throws on incompatible or unsupported covered edges. Root resolutions take precedence and conflicting ones produce warnings. A tag-triggered GitHub workflow builds/tests the bundled plugin and uploads a mutable release asset. The plugin is executable code inside the consuming package manager.

| Component | Source |
| --- | --- |
| Plugin hooks and commands | sources/index.ts:7 |
| Policy precedence | sources/policy.ts:19 |
| Dependency floor application | sources/hook.ts:26 |
| npm resolver delegation | sources/minimalResolver.ts:81 |
| Release publication | .github/workflows/release.yml:31 |

| Deployment or workflow | Resource or capability | Configuration and precedence | Safe effective value or location | Readers, writers, or recipients | Enforcing control | Evidence or unknowns |
| --- | --- | --- | --- | --- | --- | --- |
| Install | Minimum policy | Top-level workspace manifest.raw.minVersions; child declarations error; resolutions override | &lt;project root&gt;/package.json minVersions exact-version map | Root maintainer and Yarn plugin runtime | Type/package/version validation; explicit precedence warning | sources/policy.ts:21 |
| Resolution | Package candidate selection | Covered edge range intersected with floor; min protocol delegates to npm resolver | Existing satisfying locators reused, otherwise ascending candidate versions of effective range | Configured npm registry through Yarn; project dependency graph | Unsupported/conflicting edges fail; Yarn owns fetch/auth/integrity | sources/minimalResolver.ts:87 |
| Check/explain | Compliance report | Configuration/Project find from cwd; restoreInstallState; analyze edges | stdout report and nonzero check status for failing edge states | Developer or CI gate | Unsupported/missing/unresolved states are failures; no configured policy is reported explicitly | sources/commands/check.ts:8 |
| Release | Published executable bundle | push v* tag; npm ci and npm test; copy generated bundle; gh release upload --clobber | plugin-min-versions.js asset on named GitHub release | Tag maintainer, workflow token, plugin consumers | Pinned checkout/setup action commits; contents:write publication token | .github/workflows/release.yml:34 |

## Threat Model, Trust Boundaries, and Assumptions

Protect dependency-selection integrity, accurate policy reporting, consuming workspace/CI authority, and release-asset authenticity. Root policy authors are trusted to select floors and explicit resolutions. Dependency metadata, supported semver ranges, and existing lock/install state are lower-trust inputs the plugin interprets. A floor is not a vulnerability scanner or package authenticity proof: a malicious package above the minimum can still execute wherever the consumer normally permits it. Registry access, package integrity, install scripts and credential use remain Yarn/consumer controls. A dependency author should not be able to bypass a configured floor through an unsupported protocol while receiving a successful compliance check.

This model uses the repository’s own source and generic host/caller obligations. No private deployment facts, observed exploitation, or inferred tenant relationships are included. Source review establishes the operations below; it does not establish every dependency’s implementation or the permissions of an actual installation. The operator must distinguish a deliberately granted capability from a lower-trust input gaining a new one.

Consumers must authenticate the plugin bundle and maintain root policy; no particular downstream CI or registry privilege is assumed. Policy root-only enforcement and root-resolution precedence are distinct controls; resolutions are not silently treated as subordinate to floors. Release upload uses --clobber, so tag identity alone does not prove an immutable asset digest.

## Attack Surface, Mitigations, and Attacker Stories

These are prioritized hypotheses for investigation, not validated findings. Priority reflects plausible capability gain; each prerequisite must hold before assigning a deployment-specific severity.

| Priority | Scenario and capability gain | Prerequisites | Impact | Existing controls | Mitigation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | A release/build input is compromised and a malicious plugin bundle executes in consumers’ package managers. | Attacker crosses accepted tag, dependency, workflow or release-asset boundary. | Consumer filesystem/CI compromise. | Pinned action commits, npm ci and npm test; token publication is confined to workflow context. | Protect release tags and validate bundle digest/provenance before importing; avoid mutable unverified asset URLs. | .github/workflows/release.yml:25 |
| P1 conditional | A crafted dependency descriptor or install state escapes the declared floor while check reports success. | Actual mismatch between reducer, custom resolver and report semantics. | Installation of a prohibited dependency version; security impact depends on that package. | Root validation, supported-protocol gate, range intersection and failing status reporting. | Validate any candidate across install and check using the real Yarn versions and lock state. | sources/hook.ts:39 |
| P2 | A consumer assumes a root resolution below the floor is impossible and ignores a conflict warning. | Trusted root resolution overrides policy; downstream process ignores check results. | Intended dependency-floor guarantee is not applied as expected. | Resolution precedence is explicitly reported as warning; check evaluates current graph. | Document and enforce CI check exit status; review root resolution overrides as policy changes. | sources/policy.ts:85 |
| P2 | A large dependency graph makes analysis or ancestry reporting expensive. | Attacker can supply a large accepted graph; shared CI resource constraints. | Check latency or denial of service. | Introducer search defaults to three paths and 5000 expansions. | Preserve search bounds and measure representative graph cost before claiming scalability guarantees. | sources/report.ts:79 |

## Severity Calibration (Critical, High, Medium, Low)

Critical requires demonstrated widespread malicious plugin distribution or privileged consumer compromise, not merely write permission in a release job.

High fits a verified floor bypass enabling a known consequential vulnerable dependency or malicious release execution.

Medium fits a reliable compliance false positive or shared-CI resource exhaustion without stronger downstream evidence.

Low fits honest unsupported-protocol rejection or a warning about an intentional root override. Choosing the oldest satisfying version is the resolver’s declared behavior, not automatic insecurity.

Confidence in the source-described data flow is separate from confidence in exploitability. A finding requires a concrete lower-trust entry, an effective control failure, and a consequential new capability. Host compromise assumed at the outset, deliberate operator authority, and self-only errors do not supply that missing evidence.

Repository: github.com/mathspace/yarn-plugin-min-versions

Version: ad1ab012feabbb688b1faa1410402c6786fd54ce
