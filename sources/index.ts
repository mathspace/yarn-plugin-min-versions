import {type Plugin} from '@yarnpkg/core';
import MinVersionsCheckCommand from './commands/check';
import MinVersionsExplainCommand from './commands/explain';
import {reduceDependencyFloor, validateProjectPolicy} from './hook';
import {MinimalNpmResolver} from './minimalResolver';

const plugin: Plugin = {
  hooks: {
    reduceDependency: reduceDependencyFloor,
    validateProject: validateProjectPolicy,
  },
  resolvers: [
    MinimalNpmResolver,
  ],
  commands: [
    MinVersionsCheckCommand,
    MinVersionsExplainCommand,
  ],
};

export default plugin;
