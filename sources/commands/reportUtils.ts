import {MessageName, ReportError, StreamReport, type Configuration} from '@yarnpkg/core';
import {UsageError} from 'clipanion';
import type {Writable} from 'node:stream';

function normalizeError(error: unknown) {
  if (error instanceof ReportError) {
    return {
      name: error.reportCode,
      text: error.message,
    };
  }

  if (error instanceof UsageError) {
    return {
      name: MessageName.UNNAMED,
      text: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      name: MessageName.EXCEPTION,
      text: error.message,
    };
  }

  return {
    name: MessageName.EXCEPTION,
    text: String(error),
  };
}

export async function reportCommandError(configuration: Configuration, stdout: Writable, error: unknown) {
  const normalized = normalizeError(error);
  const report = await StreamReport.start({
    configuration,
    stdout,
    includeFooter: false,
  }, async report => {
    report.reportError(normalized.name, normalized.text);
  });

  return report.exitCode();
}
