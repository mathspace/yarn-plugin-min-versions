import {MessageName, ReportError, semverUtils, structUtils, type Descriptor, type Locator, type MinimalResolveOptions, type Package, type ResolveOptions, type Resolver} from '@yarnpkg/core';
import {NpmSemverResolver} from '@yarnpkg/plugin-npm';
import {MIN_VERSION_PROTOCOL} from './constants';

type MinimalDescriptorData = {
  selector: string;
  floor: string;
};

function getStringParam(value: string | Array<string> | undefined): string | null {
  if (typeof value === `string`)
    return value;

  return null;
}

function parseMinimalDescriptor(descriptor: Descriptor): MinimalDescriptorData | null {
  const parsed = structUtils.tryParseRange(descriptor.range);
  if (parsed === null)
    return null;

  if (parsed.protocol !== MIN_VERSION_PROTOCOL || parsed.source !== null)
    return null;

  if (semverUtils.validRange(parsed.selector) === null)
    return null;

  const floor = getStringParam(parsed.params?.floor);
  if (floor === null)
    return null;

  const cleanedFloor = semverUtils.clean(floor);
  if (cleanedFloor === null || cleanedFloor !== floor)
    return null;

  return {
    selector: parsed.selector,
    floor: cleanedFloor,
  };
}

function makeUnderlyingDescriptor(descriptor: Descriptor, selector: string) {
  return structUtils.makeDescriptor(descriptor, `npm:${selector}`);
}

function compareLocatorVersionsAscending(left: Locator, right: Locator) {
  const leftSelector = structUtils.parseRange(left.reference).selector;
  const rightSelector = structUtils.parseRange(right.reference).selector;
  const leftVersion = new semverUtils.SemVer(leftSelector);
  const rightVersion = new semverUtils.SemVer(rightSelector);
  const order = leftVersion.compare(rightVersion);
  if (order !== 0)
    return order;

  return structUtils.stringifyLocator(left).localeCompare(structUtils.stringifyLocator(right));
}

export class MinimalNpmResolver implements Resolver {
  private readonly delegate = new NpmSemverResolver();

  supportsDescriptor(descriptor: Descriptor, _opts: MinimalResolveOptions) {
    return parseMinimalDescriptor(descriptor) !== null;
  }

  supportsLocator(locator: Locator, opts: MinimalResolveOptions) {
    return this.delegate.supportsLocator(locator, opts);
  }

  shouldPersistResolution(locator: Locator, opts: MinimalResolveOptions) {
    return this.delegate.shouldPersistResolution(locator, opts);
  }

  bindDescriptor(descriptor: Descriptor, _fromLocator: Locator, _opts: MinimalResolveOptions) {
    return descriptor;
  }

  getResolutionDependencies(_descriptor: Descriptor, _opts: MinimalResolveOptions) {
    return {};
  }

  async getCandidates(descriptor: Descriptor, dependencies: Record<string, Package>, opts: ResolveOptions) {
    const parsed = parseMinimalDescriptor(descriptor);
    if (parsed === null) {
      throw new ReportError(MessageName.RESOLVER_NOT_FOUND, `${structUtils.stringifyDescriptor(descriptor)} is not a valid minVersions descriptor`);
    }

    const underlyingDescriptor = makeUnderlyingDescriptor(descriptor, parsed.selector);
    const reusableLocators = [...opts.project.originalPackages.values()].filter(locator => {
      return locator.identHash === descriptor.identHash && this.delegate.supportsLocator(locator, opts);
    });

    if (reusableLocators.length > 0) {
      const satisfying = await this.delegate.getSatisfying(underlyingDescriptor, dependencies, reusableLocators, opts);
      if (satisfying.locators.length > 0)
        return satisfying.locators;
    }

    const candidates = await this.delegate.getCandidates(underlyingDescriptor, dependencies, opts);
    return [...candidates].sort(compareLocatorVersionsAscending);
  }

  async getSatisfying(descriptor: Descriptor, dependencies: Record<string, Package>, locators: Array<Locator>, opts: ResolveOptions) {
    const parsed = parseMinimalDescriptor(descriptor);
    if (parsed === null) {
      throw new ReportError(MessageName.RESOLVER_NOT_FOUND, `${structUtils.stringifyDescriptor(descriptor)} is not a valid minVersions descriptor`);
    }

    const underlyingDescriptor = makeUnderlyingDescriptor(descriptor, parsed.selector);
    const satisfying = await this.delegate.getSatisfying(underlyingDescriptor, dependencies, locators, opts);
    return {
      ...satisfying,
      locators: [...satisfying.locators].sort(compareLocatorVersionsAscending),
      sorted: true,
    };
  }

  async resolve(locator: Locator, opts: ResolveOptions) {
    return this.delegate.resolve(locator, opts);
  }
}
