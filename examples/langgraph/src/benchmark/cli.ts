import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { digest, manifest } from './corpus.js';
import { readableSummary, runBenchmark } from './runner.js';

export async function benchmarkCli(args: string[]): Promise<void> {
  const options = { seed: manifest.defaultSeed, repeat: 2, propertyRuns: 100 };
  const keys = new Map([
    ['--seed', 'seed'],
    ['--repeat', 'repeat'],
    ['--property-runs', 'propertyRuns'],
  ] as const);
  const used = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;
    const key = keys.get(flag as '--seed' | '--repeat' | '--property-runs');
    const raw = args[index + 1];
    if (!key || used.has(flag) || !raw || !/^\d+$/.test(raw))
      throw new Error('INVALID_BENCHMARK_OPTIONS');
    used.add(flag);
    options[key] = Number(raw);
  }
  if (
    !Number.isSafeInteger(options.seed) ||
    options.seed > 0x7fffffff - 4 ||
    options.repeat < 1 ||
    options.repeat > 5 ||
    options.propertyRuns < 1 ||
    options.propertyRuns > 2000
  )
    throw new Error('INVALID_BENCHMARK_OPTIONS');
  const originalFetch = globalThis.fetch;
  // Defense against inherited automatic tracing or accidental future requests.
  // The real LangSmith serializer uses its explicit in-memory fetch implementation.
  globalThis.fetch = async () => {
    throw new Error('BENCHMARK_NETWORK_DISABLED');
  };
  try {
    const report = await runBenchmark(options.seed, options.propertyRuns);
    const reportDigest = digest(report);
    let identicalOutcomes = true;
    for (let run = 1; run < options.repeat; run++) {
      if (digest(await runBenchmark(options.seed, options.propertyRuns)) !== reportDigest)
        identicalOutcomes = false;
    }
    const result = {
      ...report,
      reproducibility: { executions: options.repeat, identicalOutcomes, reportDigest },
    };
    const directory = fileURLToPath(new URL('../../reports/', import.meta.url));
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, 'benchmark-v2-report.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    const summary =
      readableSummary(report) +
      `\nSame-seed executions: ${options.repeat}; identical reports: ${identicalOutcomes}.\n`;
    await writeFile(resolve(directory, 'benchmark-v2-summary.md'), summary);
    console.log(summary);
    if (!report.passed || !identicalOutcomes) process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
