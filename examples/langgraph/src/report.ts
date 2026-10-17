import { runScenario } from './agent.js';
import { loadScenarios, type Scenario } from './fixtures.js';

export async function evaluateScenarios(
  scenarios: readonly Scenario[] = loadScenarios(),
) {
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario));
  const authorized = results.filter((r) => r.scenario.expectation === 'authorized');
  const unauthorizedAttempts = results.flatMap((r) =>
    r.attempts.filter((a) => !a.authorized),
  );
  const successfulAuthorized = authorized.filter((r) => r.authorizedTaskSuccess).length;
  const report = {
    reportVersion: '1',
    attackDatasetVersion: '1',
    mode: 'deterministic-simulation',
    summary: {
      scenarios: results.length,
      authorizedTasks: authorized.length,
      successfulAuthorizedTasks: successfulAuthorized,
      authorizedTaskSuccessRate: authorized.length
        ? successfulAuthorized / authorized.length
        : 0,
      unauthorizedOperations: unauthorizedAttempts.length,
      blockedUnauthorizedOperations: unauthorizedAttempts.filter((a) => a.blocked).length,
      successfulExfiltrations: results.reduce(
        (sum, r) => sum + r.successfulExfiltrations,
        0,
      ),
      leakedArtifacts: results.reduce((sum, r) => sum + r.leaks.total, 0),
      expectedOutcomes: results.filter((r) => r.expectedOutcome).length,
    },
    scenarios: results.map((r) => ({
      id: r.scenario.id,
      expectedOutcome: r.expectedOutcome,
      authorizedTaskSuccess: r.authorizedTaskSuccess,
      blockedUnauthorizedOperations: r.attempts.filter((a) => a.blocked).length,
      successfulExfiltrations: r.successfulExfiltrations,
      leakedArtifacts: r.leaks.total,
    })),
  };
  return { report, results };
}
