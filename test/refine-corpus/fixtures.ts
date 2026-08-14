import type { RefinementStyle } from '@/lib/refine';

/**
 * Rough prompts, with what each one is actually asking for recorded alongside.
 *
 * The detector has a labelled corpus and a numeric gate; refinement needs its
 * own bar or "is it any good" stays a matter of opinion. But prose quality
 * cannot be asserted, so what is recorded here is not a model answer — it is
 * the **intent**: the terms that must survive, and the specifics that must not
 * appear because the user never supplied them.
 *
 * Drafts are written the way people actually type them: lower case, no
 * punctuation, trailing thoughts. A corpus of well-formed prompts would prove
 * nothing, since well-formed prompts do not need refining.
 */

export interface RefineFixture {
  id: string;
  /** What the user typed. */
  draft: string;
  /** What they are asking for, in one line. For a human reading a failure. */
  intent: string;
  /**
   * Terms that must appear, in some form, in any acceptable rewrite.
   *
   * The subject of the request — losing one of these means the rewrite is
   * asking a different question, which is the failure that cannot be recovered
   * from because the user will not notice it.
   */
  mustKeep: readonly string[];
  /**
   * Inventions the gate must catch.
   *
   * Each is a plausible thing a model might invent for this draft, and each has
   * a shape a machine can recognise: a path, a version, a number, an
   * identifier, a product name.
   */
  mustNotInvent: readonly string[];
  /**
   * Inventions no mechanical check can catch.
   *
   * Ordinary lowercase English — "database", "index", "terraform" — is
   * indistinguishable from ordinary rewriting without knowing what the user
   * meant. Recorded rather than asserted, because pretending they are covered
   * would overstate what the gate does. These are what the diff is for: the
   * user reads the suggestion before it goes anywhere.
   */
  undetectable: readonly string[];
  /** Styles this draft is a fair test of. */
  styles: readonly RefinementStyle[];
}

export const REFINE_FIXTURES: readonly RefineFixture[] = [
  {
    id: 'vague-bug',
    draft: 'fix the login bug',
    intent: 'Asks for help fixing a bug in login. No code or file was given.',
    mustKeep: ['login', 'bug'],
    mustNotInvent: ['auth.ts', 'src/login.js', 'line 42', 'React', 'v2.1.0'],
    undetectable: ['session token', 'the password field'],
    styles: ['clear', 'technical'],
  },
  {
    id: 'rambling-feature',
    draft:
      'so i need to add a way for users to export their data, maybe csv or json, ' +
      'not sure which, and it should probably be async because there could be a lot ' +
      'of rows, anyway how would you do this',
    intent: 'Asks how to implement an async data export supporting CSV or JSON.',
    mustKeep: ['export', 'csv', 'json', 'async', 'rows'],
    mustNotInvent: ['PostgreSQL', 'S3', '10000', 'export.py'],
    undetectable: ['pandas', 'streaming'],
    styles: ['clear', 'concise', 'technical'],
  },
  {
    id: 'no-context-question',
    draft: 'why is it slow',
    intent: 'Asks why something is slow. Deliberately gives no subject.',
    mustKeep: ['slow'],
    mustNotInvent: ['PostgreSQL', 'React', 'Redis'],
    undetectable: ['database', 'query', 'index'],
    styles: ['clear'],
  },
  {
    id: 'padded-request',
    draft:
      'Hi there! I was wondering if you could possibly help me out with something, ' +
      'if it is not too much trouble. I would really like to understand how caching ' +
      'works in general, at a high level, if that makes sense. Thank you so much!',
    intent: 'Asks for a high-level explanation of caching, buried in politeness.',
    mustKeep: ['caching', 'understand', 'level'],
    mustNotInvent: ['Redis', 'TTL', 'CDN', 'LRU'],
    undetectable: ['memcached', 'invalidation'],
    styles: ['concise', 'beginner'],
  },
  {
    id: 'multi-part',
    draft:
      'review this function and tell me if the error handling is right and also ' +
      'whether the naming is consistent with the rest and if there is a simpler way',
    intent:
      'Asks for a review covering three things: error handling, naming consistency, ' +
      'and a simpler approach.',
    mustKeep: ['review', 'error', 'handling', 'naming', 'simpler'],
    mustNotInvent: ['TypeScript', 'try/catch', 'camelCase'],
    undetectable: ['eslint', 'promises'],
    styles: ['clear', 'detailed'],
  },
  {
    id: 'jargon-heavy',
    draft: 'explain event loop microtask queue vs macrotask and why my promise resolves late',
    intent:
      'Asks for an explanation of the event loop task queues and late promise resolution.',
    mustKeep: ['event', 'loop', 'microtask', 'promise'],
    mustNotInvent: ['Node.js', 'setTimeout', 'v8'],
    undetectable: ['libuv', 'browser'],
    styles: ['beginner', 'technical'],
  },
  {
    id: 'terse-imperative',
    draft: 'summarise this in bullets',
    intent: 'Asks for a bulleted summary of something pasted separately.',
    mustKeep: ['summar', 'bullet'],
    mustNotInvent: ['300 words', '12 bullet points'],
    undetectable: ['five', 'markdown table'],
    styles: ['clear', 'detailed'],
  },
  {
    id: 'with-secret',
    draft:
      'my deploy keeps failing with AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7 in the ' +
      'env, what should i check first',
    intent:
      'Asks what to check for a failing deploy. Contains a secret, so it also ' +
      'exercises the redact-then-refine ordering.',
    mustKeep: ['deploy', 'failing', 'check'],
    mustNotInvent: ['GitHub Actions', 'IAM', 'us-east-1'],
    undetectable: ['terraform', 'the build cache'],
    styles: ['clear', 'technical'],
  },
  {
    id: 'question-not-answer',
    draft: 'what is the difference between a mutex and a semaphore',
    intent:
      'Asks for a comparison. Already reasonably clear — a fair test of whether ' +
      'refinement knows when to leave something alone.',
    mustKeep: ['difference', 'mutex', 'semaphore'],
    mustNotInvent: ['C++', 'Java', 'POSIX'],
    undetectable: ['pthread', 'binary semaphore'],
    styles: ['clear', 'beginner'],
  },
  {
    id: 'constraint-bearing',
    draft:
      'write a function that does not use recursion and does not allocate, must be ' +
      'under 20 lines, to flatten a nested list',
    intent:
      'Asks for a flatten function under three explicit constraints. The negations ' +
      'are the point: dropping one inverts the request.',
    mustKeep: ['recursion', 'allocate', 'flatten', 'nested'],
    mustNotInvent: ['Python', 'O(n)', 'list.py'],
    undetectable: ['itertools', 'generators'],
    styles: ['clear', 'concise', 'technical'],
  },
];

/**
 * Suggestions labelled by whether they should be accepted.
 *
 * These measure the **gate**, not the model: they are what an on-device model
 * plausibly returns, written by hand so that both the good and the bad cases
 * exist in quantity. A gate that accepted everything would pass a corpus of
 * good outputs alone and catch nothing in the wild.
 *
 * Real model outputs are a beta question. This is the same honesty as the
 * detector corpus: the number is real, the sample is ours.
 */
export interface GradedSuggestion {
  fixtureId: string;
  style: RefinementStyle;
  /**
   * What the model returns.
   *
   * `{{PLACEHOLDER}}` is substituted with the placeholder the detector actually
   * produced, and `{{MANGLED}}` with a damaged version of it. Hard-coding the
   * token here would make the corpus fail the day a rule's label changes, for a
   * reason that has nothing to do with quality.
   */
  suggestion: string;
  /** Whether the gate must accept it. */
  acceptable: boolean;
  /** Why, for a human reading a failure. */
  note: string;
}

export const GRADED_SUGGESTIONS: readonly GradedSuggestion[] = [
  // ---- Should be accepted -------------------------------------------------
  {
    fixtureId: 'vague-bug',
    style: 'clear',
    suggestion: 'Help me diagnose and fix a bug in the login flow. What should I check?',
    acceptable: true,
    note: 'Keeps the subject, adds no specifics.',
  },
  {
    fixtureId: 'rambling-feature',
    style: 'concise',
    suggestion:
      'How should I implement an async data export for users, supporting CSV or ' +
      'JSON, that handles a large number of rows?',
    acceptable: true,
    note: 'Shorter, every requirement intact.',
  },
  {
    fixtureId: 'padded-request',
    style: 'concise',
    suggestion: 'Explain at a high level how caching works. I want to understand the basics.',
    acceptable: true,
    note: 'Politeness removed, request unchanged.',
  },
  {
    fixtureId: 'multi-part',
    style: 'detailed',
    suggestion:
      'Review this function and cover three things: whether the error handling is ' +
      'correct, whether the naming is consistent with the surrounding code, and ' +
      'whether there is a simpler way to write it.',
    acceptable: true,
    note: 'Expands structure without adding requirements.',
  },
  {
    fixtureId: 'constraint-bearing',
    style: 'technical',
    suggestion:
      'Goal: flatten a nested list. Constraints: no recursion, no allocation, under ' +
      'twenty lines. Provide the function.',
    acceptable: true,
    note: 'All three constraints survive, including the negations.',
  },
  {
    fixtureId: 'jargon-heavy',
    style: 'beginner',
    suggestion:
      'Explain the event loop and the difference between the microtask and macrotask ' +
      'queues, assuming no prior knowledge, and why a promise might resolve later ' +
      'than expected.',
    acceptable: true,
    note: 'Longer, but expansion is what this style is for.',
  },
  {
    fixtureId: 'with-secret',
    style: 'clear',
    suggestion:
      'My deploy keeps failing with {{PLACEHOLDER}} set in the environment. What ' +
      'should I check first?',
    acceptable: true,
    note: 'Placeholder carried through untouched.',
  },
  {
    fixtureId: 'terse-imperative',
    style: 'clear',
    suggestion: 'Summarise the text below as a short bulleted list.',
    acceptable: true,
    note: 'A very short draft may grow proportionally a lot and still be right.',
  },
  {
    fixtureId: 'question-not-answer',
    style: 'clear',
    suggestion:
      'What is the difference between a mutex and a semaphore, and when would I use ' +
      'each?',
    acceptable: true,
    note: 'Light touch on something already clear.',
  },

  // ---- Should be refused --------------------------------------------------
  {
    fixtureId: 'vague-bug',
    style: 'clear',
    suggestion:
      "Here's an improved version of your prompt: Help me diagnose and fix the bug " +
      'in the login flow.',
    acceptable: true,
    note: 'A preamble in a shape we strip is cleaned, not refused.',
  },
  {
    fixtureId: 'vague-bug',
    style: 'clear',
    suggestion:
      'Sure, I have rewritten it for you — Help me diagnose and fix the bug in the ' +
      'login flow.',
    acceptable: false,
    note: 'A preamble we cannot strip would be sent as if the user typed it.',
  },
  {
    fixtureId: 'vague-bug',
    style: 'technical',
    suggestion:
      'Goal: fix the authentication bug in src/auth/login.ts at line 42. Context: ' +
      'the React frontend calls the session endpoint.',
    acceptable: false,
    note: 'Invents a file, a line number, and a framework.',
  },
  {
    fixtureId: 'no-context-question',
    style: 'clear',
    suggestion:
      'Why is my PostgreSQL query slow? I suspect a missing index on the users table.',
    acceptable: false,
    note: 'Invents the entire subject the draft deliberately withheld.',
  },
  {
    fixtureId: 'rambling-feature',
    style: 'concise',
    suggestion: 'How do I export data?',
    acceptable: false,
    note: 'Drops CSV, JSON, async, and the volume concern.',
  },
  {
    fixtureId: 'constraint-bearing',
    style: 'concise',
    suggestion: 'Write a function to flatten a nested list.',
    acceptable: false,
    note: 'Drops all three constraints, inverting the request.',
  },
  {
    fixtureId: 'padded-request',
    style: 'concise',
    suggestion:
      'Caching stores copies of data closer to where it is needed so that repeated ' +
      'requests do not have to be recomputed. There are several layers: browser ' +
      'caches, CDN caches, application caches such as Redis or memcached, and ' +
      'database query caches. Each has its own eviction policy, commonly LRU, and a ' +
      'TTL after which an entry is considered stale. The hard part of caching is ' +
      'invalidation, which is why the saying goes that it is one of the two hard ' +
      'problems in computer science.',
    acceptable: false,
    note: 'Answered the prompt instead of rewriting it.',
  },
  {
    fixtureId: 'with-secret',
    style: 'clear',
    suggestion:
      'My deploy keeps failing with {{MANGLED}} in the environment. What should I ' +
      'check first?',
    acceptable: false,
    note: 'Mangled the placeholder, which would break re-hydration.',
  },
  {
    fixtureId: 'multi-part',
    style: 'clear',
    suggestion: '```\nReview this function for errors.\n```',
    acceptable: false,
    note: 'Markdown fence, and two of the three requests dropped.',
  },
  {
    fixtureId: 'jargon-heavy',
    style: 'technical',
    suggestion:
      'Explain how libuv schedules callbacks in Node.js v18 and why setTimeout(0) ' +
      'fires after process.nextTick.',
    acceptable: false,
    note: 'Invents a runtime, a version, and specific APIs.',
  },
  {
    fixtureId: 'terse-imperative',
    style: 'detailed',
    suggestion: 'Summarise the following text in exactly five bullet points of 300 words.',
    acceptable: false,
    note: 'Invents a count and a length the user never asked for.',
  },
];
