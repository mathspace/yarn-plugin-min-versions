import type {Descriptor, Ident, Locator, Package, Project} from '@yarnpkg/core';

export type PolicyProblemLevel = `error` | `warning`;

export type PolicyProblem = {
  level: PolicyProblemLevel;
  message: string;
};

export type MinVersionFloor = {
  ident: Ident;
  identString: string;
  version: string;
  range: string;
};

export type MinVersionsPolicy = {
  project: Project;
  floors: Map<string, MinVersionFloor>;
  problems: Array<PolicyProblem>;
};

export type SupportedDependencyRange = {
  protocol: string | null;
  source: string | null;
  selector: string;
  params: Record<string, string | Array<string>> | null;
};

export type RangeEvaluation =
  | {
      status: `unchanged`;
      effectiveRange: string;
    }
  | {
      status: `rewritten`;
      effectiveRange: string;
    }
  | {
      status: `conflict`;
    };

export type UnsupportedDependency = {
  status: `unsupported`;
  reason: string;
};

export type SupportedDependency = {
  status: `supported`;
  range: SupportedDependencyRange;
};

export type DependencySupport = SupportedDependency | UnsupportedDependency;

export type EdgeAnalysisStatus =
  | `satisfied`
  | `covered-by-higher-resolution`
  | `rewrite-needed`
  | `conflict`
  | `unsupported`
  | `missing-resolution`
  | `unresolved-version`;

export type EdgeAnalysis = {
  parent: Locator;
  dependency: Descriptor;
  floor: MinVersionFloor;
  status: EdgeAnalysisStatus;
  currentResolution: Package | null;
  effectiveRange: string | null;
  detail: string;
};

export type DependencyPathStep = {
  parent: Locator;
  dependency: Descriptor;
  child: Locator;
};

export type DependencyPath = {
  workspace: Locator;
  steps: Array<DependencyPathStep>;
};

export type DependencyPathSearchResult = {
  paths: Array<DependencyPath>;
  truncated: boolean;
};

export type FloorAnalysis = {
  floor: MinVersionFloor;
  matchingPackages: Array<Package>;
  edges: Array<EdgeAnalysis>;
};
