import {BaseCommand} from '@yarnpkg/cli';
import {Configuration, Project, structUtils} from '@yarnpkg/core';
import {Command, Option, UsageError} from 'clipanion';
import {assertValidPolicy, inspectPolicy} from '../policy';
import {analyzeProject, createIntroducerPathFinder} from '../report';
import {reportCommandError} from './reportUtils';

function formatIntroducerLocator(locator: import('@yarnpkg/core').Locator) {
  return structUtils.stringifyLocator(structUtils.ensureDevirtualizedLocator(locator));
}

function formatIntroducerPath(path: import('../types').DependencyPath) {
  return [
    formatIntroducerLocator(path.workspace),
    ...path.steps.map(step => formatIntroducerLocator(step.child)),
  ].join(` -> `);
}

export default class MinVersionsExplainCommand extends BaseCommand {
  static override paths = [
    [`min-versions`, `explain`],
  ];

  static override usage = Command.Usage({
    category: `Min-versions commands`,
    description: `explain how a configured minimum-version floor applies to the current project`,
    details: `
      This command prints the configured floor for a package, the currently
      resolved package instances, each dependency edge that is relevant to
      enforcing the floor, and up to three ancestry paths from the current
      workspace through the install state to each transitive parent package.
      When the graph is dense, additional paths may exist but not be shown.
    `,
    examples: [[
      `Explain how the lodash floor applies to the current graph`,
      `$0 min-versions explain lodash`,
    ]],
  });

  packageName = Option.String();

  override async execute() {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins);
    let project: Project;
    let workspace: import('@yarnpkg/core').Workspace | null = null;

    try {
      ({project, workspace} = await Project.find(configuration, this.context.cwd));
      await project.restoreInstallState();
    } catch (error) {
      return await reportCommandError(configuration, this.context.stdout, error);
    }

    const policy = inspectPolicy(project);
    const errors = policy.problems.filter(problem => problem.level === `error`);
    if (errors.length > 0) {
      throw new UsageError(errors.map(error => error.message).join(`\n`));
    }

    const ident = structUtils.tryParseIdent(this.packageName);
    if (ident === null)
      throw new UsageError(`Expected a valid package name, received "${this.packageName}"`);

    const floor = assertValidPolicy(project).floors.get(ident.identHash);
    if (typeof floor === `undefined`)
      throw new UsageError(`No minVersions floor is configured for ${structUtils.stringifyIdent(ident)}`);

    const analysis = analyzeProject(project).find(entry => entry.floor.ident.identHash === ident.identHash);
    if (typeof analysis === `undefined`)
      throw new UsageError(`No analysis data was available for ${structUtils.stringifyIdent(ident)}`);

    const currentWorkspace = workspace ?? project.topLevelWorkspace;
    const findIntroducerPaths = createIntroducerPathFinder(project, currentWorkspace.anchoredLocator);
    const lines = [
      `${analysis.floor.identString} >=${analysis.floor.version}`,
      ``,
      `Resolved packages:`,
    ];

    if (analysis.matchingPackages.length === 0) {
      lines.push(`- none in the current install state`);
    } else {
      for (const pkg of analysis.matchingPackages) {
        lines.push(`- ${structUtils.stringifyLocator(pkg)}${pkg.version === null ? `` : ` (version ${pkg.version})`}`);
      }
    }

    lines.push(``);
    lines.push(`Dependency edges:`);

    if (analysis.edges.length === 0) {
      lines.push(`- no current dependency edge references this package`);
    } else {
      for (const edge of analysis.edges) {
        const nextRange = edge.effectiveRange === null ? `` : `; effective range ${edge.effectiveRange}`;
        const currentResolution = edge.currentResolution === null ? `` : `; current resolution ${structUtils.stringifyLocator(edge.currentResolution)}`;
        lines.push(`- [${edge.status}] ${structUtils.stringifyLocator(edge.parent)} -> ${structUtils.stringifyDescriptor(edge.dependency)}${nextRange}${currentResolution}`);

        const pathSearch = findIntroducerPaths(edge.parent);
        const introducerPaths = pathSearch.paths.filter(path => path.steps.length > 0);
        if (introducerPaths.length > 0) {
          lines.push(`  introduced by:`);
          for (const path of introducerPaths)
            lines.push(`  - ${formatIntroducerPath(path)}`);

          if (pathSearch.truncated)
            lines.push(`  - additional introduction paths may exist but were not shown`);
        } else if (pathSearch.truncated) {
          lines.push(`  introduction paths may exist but were not shown`);
        }
      }
    }

    this.context.stdout.write(`${lines.join(`\n`)}\n`);
  }
}
