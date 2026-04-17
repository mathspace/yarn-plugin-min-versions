import {ReportError, MessageName, semverUtils, structUtils, type Project} from '@yarnpkg/core';
import type {MinVersionsPolicy, PolicyProblem} from './types';

const policyCache = new WeakMap<Project, MinVersionsPolicy>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value);
}

function makeProblem(level: PolicyProblem[`level`], message: string): PolicyProblem {
  return {level, message};
}

export function inspectPolicy(project: Project): MinVersionsPolicy {
  const cached = policyCache.get(project);
  if (typeof cached !== `undefined`)
    return cached;

  const problems: Array<PolicyProblem> = [];
  const floors = new Map();
  const rootWorkspace = project.topLevelWorkspace;
  const rawPolicy = rootWorkspace.manifest.raw.minVersions;

  for (const workspace of project.workspaces) {
    if (workspace === rootWorkspace)
      continue;
    if (typeof workspace.manifest.raw.minVersions !== `undefined`) {
      problems.push(makeProblem(
        `error`,
        `minVersions is root-only and cannot be declared in workspace ${workspace.relativeCwd || `.`}`,
      ));
    }
  }

  if (typeof rawPolicy !== `undefined`) {
    if (!isPlainObject(rawPolicy)) {
      problems.push(makeProblem(`error`, `minVersions must be an object mapping package names to exact versions`));
    } else {
      for (const [name, value] of Object.entries(rawPolicy)) {
        const ident = structUtils.tryParseIdent(name);
        if (ident === null) {
          problems.push(makeProblem(`error`, `minVersions key "${name}" is not a valid package name`));
          continue;
        }

        if (typeof value !== `string`) {
          problems.push(makeProblem(`error`, `minVersions.${name} must be a string exact version`));
          continue;
        }

        const cleaned = semverUtils.clean(value);
        if (cleaned === null || cleaned !== value) {
          problems.push(makeProblem(`error`, `minVersions.${name} must be an exact semver version, received "${value}"`));
          continue;
        }

        floors.set(ident.identHash, {
          ident,
          identString: structUtils.stringifyIdent(ident),
          version: cleaned,
          range: `>=${cleaned}`,
        });
      }
    }
  }

  for (const resolution of rootWorkspace.manifest.resolutions) {
    const floor = floors.get(structUtils.parseIdent(resolution.pattern.descriptor.fullName).identHash);
    if (typeof floor === `undefined`)
      continue;

    const parsed = structUtils.tryParseRange(resolution.reference);
    if (parsed === null)
      continue;

    if (parsed.source !== null)
      continue;

    if (parsed.protocol !== null && parsed.protocol !== `npm:`)
      continue;

    if (semverUtils.validRange(parsed.selector) === null)
      continue;

    const intersection = semverUtils.simplifyRanges([parsed.selector, floor.range]);
    if (intersection === null) {
      problems.push(makeProblem(
        `warning`,
        `minVersions.${floor.identString} conflicts with root resolution "${resolution.pattern.descriptor.fullName}" -> "${resolution.reference}"; resolutions take precedence`,
      ));
    }
  }

  const inspected = {project, floors, problems};
  policyCache.set(project, inspected);
  return inspected;
}

export function getFloor(project: Project, identHash: string) {
  return inspectPolicy(project).floors.get(identHash) ?? null;
}

export function getPolicyErrors(project: Project) {
  return inspectPolicy(project).problems.filter(problem => problem.level === `error`);
}

export function getPolicyWarnings(project: Project) {
  return inspectPolicy(project).problems.filter(problem => problem.level === `warning`);
}

export function assertValidPolicy(project: Project): MinVersionsPolicy {
  const policy = inspectPolicy(project);
  const errors = policy.problems.filter(problem => problem.level === `error`);
  if (errors.length > 0) {
    throw new ReportError(
      MessageName.INVALID_MANIFEST,
      `minVersions: invalid project policy\n${errors.map(error => `- ${error.message}`).join(`\n`)}`,
    );
  }

  return policy;
}
