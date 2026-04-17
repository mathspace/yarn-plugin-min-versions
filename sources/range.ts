import {semverUtils, structUtils, type Descriptor} from '@yarnpkg/core';
import * as semver from 'semver';
import {MIN_VERSION_PROTOCOL} from './constants';
import type {DependencySupport, MinVersionFloor, RangeEvaluation, SupportedDependencyRange} from './types';

function makeSupportedRange(range: SupportedDependencyRange): DependencySupport {
  return {
    status: `supported`,
    range,
  };
}

export function describeDependencySupport(dependency: Descriptor): DependencySupport {
  const parsed = structUtils.parseRange(dependency.range);

  if (parsed.protocol !== null && parsed.protocol !== `npm:`) {
    if (parsed.protocol !== MIN_VERSION_PROTOCOL) {
      return {
        status: `unsupported`,
        reason: `protocol ${parsed.protocol} is not supported in v1`,
      };
    }
  }

  if (parsed.source !== null) {
    return {
      status: `unsupported`,
      reason: `ranges with an explicit source are not supported in v1`,
    };
  }

  if (parsed.protocol === `npm:` && parsed.selector.includes(`@`) && structUtils.tryParseDescriptor(parsed.selector) !== null) {
    return {
      status: `unsupported`,
      reason: `npm aliases are not supported in v1`,
    };
  }

  if (parsed.protocol === MIN_VERSION_PROTOCOL) {
    const floor = parsed.params?.floor;
    if (typeof floor !== `string` || semverUtils.clean(floor) !== floor) {
      return {
        status: `unsupported`,
        reason: `min protocol descriptors must carry an exact floor parameter`,
      };
    }
  }

  if (semverUtils.validRange(parsed.selector) === null) {
    return {
      status: `unsupported`,
      reason: `range "${parsed.selector}" is not a semver range`,
    };
  }

  return makeSupportedRange({
    protocol: parsed.protocol,
    source: parsed.source,
    selector: parsed.selector,
    params: parsed.params as SupportedDependencyRange[`params`],
  });
}

export function evaluateRangeFloor(selector: string, floor: MinVersionFloor): RangeEvaluation {
  if (semver.subset(selector, floor.range)) {
    return {
      status: `unchanged`,
      effectiveRange: selector,
    };
  }

  const effectiveRange = semverUtils.simplifyRanges([selector, floor.range]);
  if (effectiveRange === null) {
    return {status: `conflict`};
  }

  return {
    status: effectiveRange === selector ? `unchanged` : `rewritten`,
    effectiveRange,
  };
}

export function applyEffectiveRange(dependency: Descriptor, range: SupportedDependencyRange, effectiveRange: string): Descriptor {
  return structUtils.makeDescriptor(dependency, structUtils.makeRange({
    protocol: range.protocol,
    source: range.source,
    selector: effectiveRange,
    params: range.params,
  }));
}
