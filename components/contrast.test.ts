import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastOf, extractTokens, luminance, parseHex } from './contrast';

/**
 * Contrast is asserted against the shipped stylesheet, not a copy.
 *
 * A palette duplicated into a test drifts from the one users actually see, and
 * the test then certifies colours nobody has. This reads the real file.
 */
const CSS = readFileSync(
  resolve(__dirname, '../entrypoints/content/style.css'),
  'utf8',
);

const light = extractTokens(CSS, '[data-theme]');
const dark = extractTokens(CSS, "[data-theme='dark']");

/** WCAG AA: 4.5:1 for body text. */
const AA_TEXT = 4.5;
/** WCAG AA: 3:1 for large text, icons, and UI component boundaries. */
const AA_LARGE = 3;

describe('colour maths', () => {
  it('parses both hex forms', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#1a1a1a')).toEqual({ r: 26, g: 26, b: 26 });
  });

  it('rejects nonsense', () => {
    expect(parseHex('rebeccapurple')).toBeNull();
    expect(parseHex('#12')).toBeNull();
  });

  it('computes known luminances', () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it('computes the canonical extremes', () => {
    expect(contrastOf('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastOf('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('token extraction', () => {
  it('finds both theme blocks in the shipped stylesheet', () => {
    expect(Object.keys(light).length).toBeGreaterThan(5);
    expect(Object.keys(dark).length).toBeGreaterThan(5);
  });

  it('defines the same tokens in both themes', () => {
    // A token present in one theme and missing in the other renders as an
    // unresolved var() — invisible text, and only in one theme, which is
    // exactly the kind of bug that ships.
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme meets WCAG AA', (_name, tokens) => {
  it('body text on the dialog background', () => {
    expect(contrastOf(tokens['--apa-fg']!, tokens['--apa-bg']!)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('muted text on the dialog background', () => {
    // Muted text carries real information here — "nothing has been sent yet"
    // is the most reassuring line in the dialog. It has to be readable.
    expect(
      contrastOf(tokens['--apa-muted']!, tokens['--apa-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('body text on the inset surface', () => {
    expect(
      contrastOf(tokens['--apa-fg']!, tokens['--apa-surface']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('danger text on the danger background', () => {
    expect(
      contrastOf(tokens['--apa-danger']!, tokens['--apa-danger-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('warning text on the warning background', () => {
    expect(
      contrastOf(tokens['--apa-warn']!, tokens['--apa-warn-bg']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('primary button label on its own background', () => {
    expect(
      contrastOf(tokens['--apa-accent-fg']!, tokens['--apa-accent']!),
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('control labels on the accent hover tint', () => {
    // The Improve button and the style menu tint their background on hover.
    // The label keeps its normal colour, so this is the pair a user reads
    // while the pointer is on the control — which is most of the time they
    // are looking at it.
    expect(
      contrastOf(tokens['--apa-fg']!, tokens['--apa-accent-soft']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('muted descriptions on the accent hover tint', () => {
    // The style menu describes each option in muted text, and hovering a row
    // is exactly when someone is reading that description. This is the
    // tightest pair in the palette; see the token's own note.
    expect(
      contrastOf(tokens['--apa-muted']!, tokens['--apa-accent-soft']!),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('borders are distinguishable from the surface they separate', () => {
    // Below this the dialog has no visible edge against the page behind it.
    expect(contrastOf(tokens['--apa-border']!, tokens['--apa-bg']!)).toBeGreaterThan(1.1);
  });
});
