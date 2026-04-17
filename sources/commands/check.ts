import {BaseCommand} from '@yarnpkg/cli';
import {Configuration, MessageName, Project, StreamReport} from '@yarnpkg/core';
import {Command} from 'clipanion';
import {getPolicyWarnings, inspectPolicy} from '../policy';
import {analyzeProject} from '../report';
import {reportCommandError} from './reportUtils';

const failingStatuses = new Set([
  `rewrite-needed`,
  `conflict`,
  `unsupported`,
  `missing-resolution`,
  `unresolved-version`,
]);

export default class MinVersionsCheckCommand extends BaseCommand {
  static override paths = [
    [`min-versions`, `check`],
  ];

  static override usage = Command.Usage({
    category: `Min-versions commands`,
    description: `check that the current project satisfies all configured minimum-version floors`,
    details: `
      This command validates the root \`minVersions\` policy, inspects the current
      install state, and exits with a non-zero code if any configured floor is
      currently violated or cannot be enforced.
    `,
    examples: [[
      `Check the current lockfile against the configured floors`,
      `$0 min-versions check`,
    ]],
  });

  override async execute() {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins);
    let project: Project;

    try {
      ({project} = await Project.find(configuration, this.context.cwd));
      await project.restoreInstallState();
    } catch (error) {
      return await reportCommandError(configuration, this.context.stdout, error);
    }

    const policy = inspectPolicy(project);
    const report = await StreamReport.start({
      configuration,
      stdout: this.context.stdout,
      includeFooter: false,
    }, async report => {
      for (const warning of getPolicyWarnings(project)) {
        report.reportWarning(MessageName.UNNAMED, `minVersions: ${warning.message}`);
      }

      const errors = policy.problems.filter(problem => problem.level === `error`);
      for (const error of errors) {
        report.reportError(MessageName.INVALID_MANIFEST, `minVersions: ${error.message}`);
      }

      if (policy.floors.size === 0) {
        report.reportInfo(MessageName.UNNAMED, `No minVersions policy is configured`);
        return;
      }

      for (const analysis of analyzeProject(project)) {
        for (const edge of analysis.edges) {
          if (failingStatuses.has(edge.status)) {
            report.reportError(MessageName.RESOLUTION_FAILED, edge.detail);
          }
        }
      }

      if (!report.hasErrors()) {
        report.reportInfo(
          MessageName.UNNAMED,
          `All ${policy.floors.size} minVersions floor${policy.floors.size === 1 ? ` is` : `s are`} currently satisfied`,
        );
      }
    });

    return report.exitCode();
  }
}
