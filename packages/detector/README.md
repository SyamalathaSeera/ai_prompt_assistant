# Detector facade

This package re-exports `lib/detector` without moving or copying its TypeScript
source/rules. The browser extension keeps importing the existing source directly.
`npm run build:security` bundles a standalone ESM entry and emits declarations
including their referenced detector types. Consumers need no browser, WXT, DOM,
storage, network, Node builtin or runtime package dependency.

The facade preserves the existing precision-oriented detector behavior, including
its suppressions; absence of findings is not proof that text contains no secrets.
Use explicit credential binding for known secrets in Agent Security Core.

See the [repository overview](../../README.md), [Agent Security Core](../agent-security/README.md),
and [LangGraph demonstration](../../examples/langgraph/README.md) for the two consumers
and their distinct security boundaries.
