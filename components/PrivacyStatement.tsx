/**
 * What this extension does with what you type.
 *
 * Installing a tool that reads everything you type into an AI chat is a trust
 * decision, and it is made in about four seconds on a store listing. This is
 * the screen that has to survive that.
 *
 * Two rules shape it:
 *
 * **Claims live here as data, in one place.** The welcome page and the options
 * page render the same array. Two copies of a privacy statement is two
 * statements, and the one nobody edited becomes a lie the first time behaviour
 * changes. `components/privacy.test.ts` checks each claim against the built
 * manifest and the source — so a claim that stops being true fails the build
 * rather than the user.
 *
 * **It invites verification instead of asking for trust.** Anyone can open
 * DevTools and watch the Network tab stay empty. A tool that tells you how to
 * check it is worth more than one that promises harder, and this product can
 * afford the invitation: `test/no-network.test.ts` audits the bundle for
 * transport and the end-to-end suite watches a real browser make no requests.
 */

export interface PrivacyClaim {
  id: string;
  question: string;
  answer: string;
}

/**
 * Deliberately plain language, and deliberately short.
 *
 * No legal boilerplate on this screen. A privacy policy is a separate document
 * with a different job; this one has to be *read*, and nobody reads a wall of
 * defined terms. Every answer is something a person could check.
 */
export const PRIVACY_CLAIMS: readonly PrivacyClaim[] = [
  {
    id: 'read',
    question: 'What it reads',
    answer:
      'The text in the message box on the AI chat sites you have enabled, while you type or paste. Not your browsing history, not other tabs, not the rest of the page.',
  },
  {
    id: 'sent',
    question: 'What it sends',
    answer:
      'Nothing. There is no server, no account, no analytics, and no crash reporting. The extension contains no code capable of making a network request.',
  },
  {
    id: 'stored',
    question: 'What it stores on this device',
    answer:
      'Your settings, a count of how many secrets were caught, and any values you allowlisted — those as one-way hashes, never as text. Real values are held in memory only, so replies can be restored, and are gone when you close the browser.',
  },
  {
    id: 'ai',
    question: 'Where the AI features run',
    answer:
      "On your machine, using the model built into Chrome. Improving a prompt or working out what it refers to never leaves this device, and your text is redacted before the model sees it either way.",
  },
  {
    id: 'access',
    question: 'What it can reach',
    answer:
      'ChatGPT only, until you say otherwise. Claude and Gemini are switched off and ask for permission at the moment you turn them on — so the install screen names one site instead of four.',
  },
];

/**
 * The source repository.
 *
 * `null` until the repository is confirmed public. A dead link on the screen
 * whose entire job is credibility would do more damage than no link at all —
 * "here is the source" leading to a 404 reads as something to hide.
 */
export const SOURCE_URL: string | null = null;

interface Props {
  /** Heading level, so the section fits whatever page it lands in. */
  headingId?: string;
  compact?: boolean;
}

export function PrivacyStatement({ headingId, compact = false }: Props) {
  return (
    <div data-testid="privacy-statement">
      <dl className="grid gap-3">
        {PRIVACY_CLAIMS.map((claim) => (
          <div key={claim.id} data-testid={`privacy-${claim.id}`}>
            <dt className="text-sm font-medium">{claim.question}</dt>
            <dd className="mt-0.5 text-sm" style={{ color: 'var(--apa-muted)' }}>
              {claim.answer}
            </dd>
          </div>
        ))}
      </dl>

      {/*
        The invitation. Concrete enough to actually follow — a vague "you can
        verify this" is just another claim.
      */}
      <div
        data-testid="privacy-verify"
        id={headingId}
        className="mt-4 rounded-lg border p-3"
        style={{ borderColor: 'var(--apa-border)', background: 'var(--apa-surface)' }}
      >
        <p className="text-sm font-medium">Do not take our word for it</p>
        <ol
          className="mt-2 grid list-decimal gap-1 pl-4 text-sm"
          style={{ color: 'var(--apa-muted)' }}
        >
          <li>Open ChatGPT and press F12 to open DevTools.</li>
          <li>Go to the Network tab and filter by Fetch/XHR.</li>
          <li>Type something with a password or an API key in it.</li>
          <li>
            Watch the extension catch it, and watch the Network tab stay empty while
            it does.
          </li>
        </ol>

        {!compact && (
          <p className="mt-2 text-xs" style={{ color: 'var(--apa-muted)' }}>
            Requests ChatGPT itself makes will still appear. Nothing in that list will
            come from this extension.
          </p>
        )}
      </div>

      {SOURCE_URL !== null && (
        <p className="mt-3 text-sm">
          <a
            data-testid="privacy-source"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: 'var(--apa-accent)' }}
          >
            Read the source code
          </a>
        </p>
      )}
    </div>
  );
}
