import {miscUtils, semverUtils, structUtils, type Descriptor, type Locator, type Package, type Project} from '@yarnpkg/core';
import * as semver from 'semver';
import {MIN_VERSION_PROTOCOL} from './constants';
import {assertValidPolicy} from './policy';
import {describeDependencySupport, evaluateRangeFloor} from './range';
import type {DependencyPath, DependencyPathSearchResult, DependencyPathStep, EdgeAnalysis, FloorAnalysis, MinVersionsPolicy} from './types';

function compareLocators(left: Locator, right: Locator) {
  return structUtils.stringifyLocator(left).localeCompare(structUtils.stringifyLocator(right));
}

function compareDescriptors(left: Descriptor, right: Descriptor) {
  return structUtils.stringifyDescriptor(left).localeCompare(structUtils.stringifyDescriptor(right));
}

function comparePathSteps(left: DependencyPathStep, right: DependencyPathStep) {
  const parentOrder = compareLocators(left.parent, right.parent);
  if (parentOrder !== 0)
    return parentOrder;

  return compareDescriptors(left.dependency, right.dependency);
}

function summarizePackage(locator: Locator) {
  return structUtils.stringifyLocator(locator);
}

function summarizeEdge(parent: Locator, dependency: Descriptor) {
  return `${summarizePackage(parent)} -> ${structUtils.stringifyDescriptor(dependency)}`;
}

function getSingleParam(params: Record<string, string | Array<string>> | null, key: string) {
  const value = params?.[key];
  return typeof value === `string` ? value : null;
}

function sortPackages(packages: Iterable<Package>) {
  return miscUtils.sortMap([...packages], pkg => structUtils.stringifyLocator(pkg));
}

function sortEdges(edges: Array<EdgeAnalysis>) {
  return [...edges].sort((left, right) => {
    const parentOrder = compareLocators(left.parent, right.parent);
    if (parentOrder !== 0)
      return parentOrder;

    return compareDescriptors(left.dependency, right.dependency);
  });
}

function buildReverseDependencyGraph(project: Project) {
  const reverseGraph = new Map<string, Array<DependencyPathStep>>();

  for (const parent of sortPackages(project.storedPackages.values())) {
    for (const dependency of miscUtils.sortMap(parent.dependencies.values(), descriptor => structUtils.stringifyDescriptor(descriptor))) {
      const resolution = project.storedResolutions.get(dependency.descriptorHash);
      if (typeof resolution === `undefined`)
        continue;

      const child = project.storedPackages.get(resolution);
      if (typeof child === `undefined`)
        continue;

      const steps = reverseGraph.get(child.locatorHash) ?? [];
      steps.push({parent, dependency, child});
      reverseGraph.set(child.locatorHash, steps);
    }
  }

  for (const steps of reverseGraph.values())
    steps.sort(comparePathSteps);

  return reverseGraph;
}

export function createIntroducerPathFinder(project: Project, rootWorkspace: Locator) {
  const reverseGraph = buildReverseDependencyGraph(project);

  return (target: Locator, {maxPaths = 3, maxExpansions = 5000}: {maxPaths?: number; maxExpansions?: number} = {}): DependencyPathSearchResult => {
    const queue: Array<{
      locator: Locator;
      reversedSteps: Array<DependencyPathStep>;
      visited: Set<string>;
    }> = [{
      locator: target,
      reversedSteps: [],
      visited: new Set([target.locatorHash]),
    }];

    const paths: Array<DependencyPath> = [];
    const seenPaths = new Set<string>();
    let expansions = 0;

    while (queue.length > 0 && paths.length < maxPaths && expansions < maxExpansions) {
      const current = queue.shift();
      if (typeof current === `undefined`)
        break;

      expansions += 1;

      if (current.locator.locatorHash === rootWorkspace.locatorHash) {
        const steps = [...current.reversedSteps].reverse();
        const pathKey = steps.length === 0
          ? current.locator.locatorHash
          : steps.map(step => `${step.parent.locatorHash}:${step.dependency.descriptorHash}:${step.child.locatorHash}`).join(`|`);

        if (!seenPaths.has(pathKey)) {
          seenPaths.add(pathKey);
          paths.push({
            workspace: current.locator,
            steps,
          });
        }

        continue;
      }

      for (const step of reverseGraph.get(current.locator.locatorHash) ?? []) {
        if (current.visited.has(step.parent.locatorHash))
          continue;

        queue.push({
          locator: step.parent,
          reversedSteps: [...current.reversedSteps, step],
          visited: new Set(current.visited).add(step.parent.locatorHash),
        });
      }
    }

    return {
      paths,
      truncated: queue.length > 0,
    };
  };
}

export function analyzeProject(project: Project): Array<FloorAnalysis> {
  const policy = assertValidPolicy(project);
  const floors = [...policy.floors.values()].sort((left, right) => left.identString.localeCompare(right.identString));

  return floors.map(floor => {
    const matchingPackages = sortPackages(
      [...project.storedPackages.values()].filter(pkg => pkg.identHash === floor.ident.identHash),
    );
    const edges: Array<EdgeAnalysis> = [];

    for (const parent of sortPackages(project.storedPackages.values())) {
      for (const dependency of miscUtils.sortMap(parent.dependencies.values(), descriptor => structUtils.stringifyDescriptor(descriptor))) {
        if (dependency.identHash !== floor.ident.identHash)
          continue;

        const support = describeDependencySupport(dependency);
        if (support.status === `unsupported`) {
          edges.push({
            parent,
            dependency,
            floor,
            status: `unsupported`,
            currentResolution: null,
            effectiveRange: null,
            detail: `${summarizeEdge(parent, dependency)} uses an unsupported descriptor: ${support.reason}`,
          });
          continue;
        }

        const evaluation = evaluateRangeFloor(support.range.selector, floor);
        if (evaluation.status === `conflict`) {
          edges.push({
            parent,
            dependency,
            floor,
            status: `conflict`,
            currentResolution: null,
            effectiveRange: null,
            detail: `${summarizeEdge(parent, dependency)} cannot be intersected with ${floor.range}`,
          });
          continue;
        }

        const resolution = project.storedResolutions.get(dependency.descriptorHash);
        if (typeof resolution === `undefined`) {
          edges.push({
            parent,
            dependency,
            floor,
            status: `missing-resolution`,
            currentResolution: null,
            effectiveRange: evaluation.effectiveRange,
            detail: `${summarizeEdge(parent, dependency)} has no current resolution; run yarn install to compute one`,
          });
          continue;
        }

        const currentResolution = project.storedPackages.get(resolution) ?? null;
        if (currentResolution === null || !semverUtils.satisfiesWithPrereleases(currentResolution.version, floor.range)) {
          edges.push({
            parent,
            dependency,
            floor,
            status: currentResolution === null ? `missing-resolution` : `rewrite-needed`,
            currentResolution,
            effectiveRange: evaluation.effectiveRange,
            detail: currentResolution === null
              ? `${summarizeEdge(parent, dependency)} points at a missing package resolution`
              : `${summarizeEdge(parent, dependency)} currently resolves to ${summarizePackage(currentResolution)}, which is below ${floor.range}`,
          });
          continue;
        }

        let status: EdgeAnalysis[`status`] = evaluation.status === `unchanged`
          ? `satisfied`
          : `covered-by-higher-resolution`;

        if (support.range.protocol === MIN_VERSION_PROTOCOL && evaluation.status === `unchanged`) {
          const originalSelector = getSingleParam(support.range.params, `original`);
          const originalEvaluation = originalSelector === null
            ? null
            : evaluateRangeFloor(originalSelector, floor);
          const minimalVersion = semver.minVersion(support.range.selector);

          if (
            originalEvaluation?.status === `rewritten` &&
            currentResolution.version !== null &&
            minimalVersion !== null &&
            semver.gt(currentResolution.version, minimalVersion.version)
          ) {
            status = `covered-by-higher-resolution`;
          }
        }

        edges.push({
          parent,
          dependency,
          floor,
          status,
          currentResolution,
          effectiveRange: evaluation.effectiveRange,
          detail: status === `satisfied`
            ? `${summarizeEdge(parent, dependency)} already guarantees ${floor.range}`
            : `${summarizeEdge(parent, dependency)} would be rewritten to ${evaluation.effectiveRange}, but the current resolution ${summarizePackage(currentResolution)} already satisfies the floor`,
        });
      }
    }

    return {
      floor,
      matchingPackages,
      edges: sortEdges(edges),
    };
  });
}

export function summarizePolicy(policy: MinVersionsPolicy) {
  return [...policy.floors.values()].sort((left, right) => left.identString.localeCompare(right.identString));
}
