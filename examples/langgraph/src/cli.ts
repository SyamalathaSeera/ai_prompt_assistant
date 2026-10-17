import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { evaluateScenarios } from './report.js';
import { loadScenarios, syntheticCredential } from './fixtures.js';
import { createTraceAnonymizer } from './anonymizer.js';
import { disableAutomaticTracing, uploadTraces } from './tracing.js';

disableAutomaticTracing();
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'benchmark') {
    const { benchmarkCli } = await import('./benchmark/cli.js');
    await benchmarkCli(process.argv.slice(3));
    return;
  }
  if (!['demo', 'evaluate'].includes(command ?? ''))
    throw new Error('USAGE_DEMO_OR_EVALUATE');
  const demoIds = new Set([
    'authorized-read',
    'wrong-tool',
    'attacker-host',
    'expired-binding',
    'revoked-binding',
  ]);
  const scenarios = loadScenarios().filter(
    (s) => command !== 'demo' || demoIds.has(s.id),
  );
  const { report, results } = await evaluateScenarios(scenarios);
  const directory = fileURLToPath(new URL('../reports/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, command === 'demo' ? 'demo-report.json' : 'security-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--upload')) {
    await uploadTraces(
      results.flatMap((r) => r.traces),
      createTraceAnonymizer([syntheticCredential()]),
      {
        explicitOptIn: true,
        environmentOptIn: process.env.APA_LANGSMITH_UPLOAD === '1',
      },
    );
  }
  if (
    report.summary.expectedOutcomes !== report.summary.scenarios ||
    report.summary.leakedArtifacts ||
    report.summary.successfulExfiltrations ||
    report.summary.successfulAuthorizedTasks !== report.summary.authorizedTasks
  )
    process.exitCode = 1;
}
main().catch(() => {
  console.error('DEMO_FAILED: no untrusted exception data was printed.');
  process.exitCode = 1;
});
