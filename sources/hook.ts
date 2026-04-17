import {MessageName, ReportError, structUtils, type Descriptor, type Project} from '@yarnpkg/core';
import {MIN_VERSION_PROTOCOL} from './constants';
import {assertValidPolicy, getFloor, inspectPolicy} from './policy';
import {describeDependencySupport, evaluateRangeFloor} from './range';

function formatUnsupportedMessage(project: Project, parent: import('@yarnpkg/core').Locator, dependency: Descriptor, reason: string) {
  return `minVersions: cannot enforce ${structUtils.stringifyIdent(dependency)} on edge ${structUtils.stringifyLocator(parent)} -> ${structUtils.stringifyDescriptor(dependency)} because ${reason}`;
}

function formatConflictMessage(project: Project, parent: import('@yarnpkg/core').Locator, dependency: Descriptor, floorVersion: string) {
  return `minVersions: cannot enforce ${structUtils.stringifyIdent(dependency)} >=${floorVersion} for dependency edge ${structUtils.stringifyLocator(parent)} -> ${structUtils.stringifyDescriptor(dependency)}; intersection is empty`;
}

export function validateProjectPolicy(project: Project, report: {reportWarning: (name: MessageName, text: string) => void; reportError: (name: MessageName, text: string) => void;}) {
  const policy = inspectPolicy(project);

  for (const problem of policy.problems) {
    if (problem.level === `warning`) {
      report.reportWarning(MessageName.UNNAMED, `minVersions: ${problem.message}`);
    } else {
      report.reportError(MessageName.INVALID_MANIFEST, `minVersions: ${problem.message}`);
    }
  }
}

export async function reduceDependencyFloor(
  dependency: Descriptor,
  project: Project,
  parent: import('@yarnpkg/core').Locator,
  _initialDependency: Descriptor,
  {resolver, resolveOptions}: {resolver: import('@yarnpkg/core').Resolver; resolveOptions: import('@yarnpkg/core').ResolveOptions},
) {
  assertValidPolicy(project);

  const floor = getFloor(project, dependency.identHash);
  if (floor === null)
    return dependency;

  const support = describeDependencySupport(dependency);
  if (support.status === `unsupported`) {
    throw new ReportError(MessageName.RESOLUTION_FAILED, formatUnsupportedMessage(project, parent, dependency, support.reason));
  }

  const evaluation = evaluateRangeFloor(support.range.selector, floor);
  if (evaluation.status === `conflict`) {
    throw new ReportError(MessageName.RESOLUTION_FAILED, formatConflictMessage(project, parent, dependency, floor.version));
  }

  if (evaluation.status === `unchanged`)
    return dependency;

  const nextDescriptor = structUtils.makeDescriptor(dependency, structUtils.makeRange({
    protocol: MIN_VERSION_PROTOCOL,
    source: null,
    selector: evaluation.effectiveRange,
    params: {
      floor: floor.version,
      original: support.range.selector,
    },
  }));

  if (!resolver.supportsDescriptor(nextDescriptor, resolveOptions))
    return nextDescriptor;

  return resolver.bindDescriptor(nextDescriptor, parent, resolveOptions);
}
