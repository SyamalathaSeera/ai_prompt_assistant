import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { PrivacyStatement, PRIVACY_CLAIMS } from './PrivacyStatement';

/**
 * The rendered privacy screen.
 *
 * `test/privacy-claims.test.ts` checks that the claims are TRUE. This file
 * checks that they are actually shown — a statement kept correct in a data
 * structure nobody renders would satisfy the first file and none of the point.
 */

let container: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('showing every claim', () => {
  it('renders one entry per claim', () => {
    render(<PrivacyStatement />, container);

    for (const claim of PRIVACY_CLAIMS) {
      const entry = $(`privacy-${claim.id}`);
      expect(entry, `claim "${claim.id}" is not rendered`).not.toBeNull();
      expect(entry?.textContent).toContain(claim.question);
      expect(entry?.textContent).toContain(claim.answer);
    }
  });

  it('leads with what is read and what is sent', () => {
    // The two questions someone actually has. Burying "we send nothing" below
    // a storage breakdown wastes the only sentence most people will read.
    expect(PRIVACY_CLAIMS[0]?.id).toBe('read');
    expect(PRIVACY_CLAIMS[1]?.id).toBe('sent');
  });
});

describe('the verification invitation', () => {
  it('gives steps concrete enough to follow', () => {
    render(<PrivacyStatement />, container);

    const verify = $('privacy-verify');
    expect(verify).not.toBeNull();

    const text = verify?.textContent ?? '';
    // A vague "you can verify this" is just another claim.
    expect(text).toContain('DevTools');
    expect(text).toContain('Network');
    expect(text).toMatch(/fetch\/xhr/i);
  });

  it('warns that the host page own requests will still appear', () => {
    /*
     * Without this, the first thing a user sees after following the
     * instructions is a busy Network tab, and the honest claim reads as a lie.
     * Omitted in compact mode, where the surrounding page already has context.
     */
    render(<PrivacyStatement />, container);
    expect($('privacy-verify')?.textContent).toContain('ChatGPT itself');

    render(<PrivacyStatement compact />, container);
    expect($('privacy-verify')?.textContent).not.toContain('ChatGPT itself');
  });
});

describe('the source link', () => {
  it('is not rendered while the repository is unconfirmed', () => {
    // A "read the source" link leading to a 404 reads as something to hide,
    // on the one screen whose entire job is credibility.
    render(<PrivacyStatement />, container);
    expect($('privacy-source')).toBeNull();
  });
});
