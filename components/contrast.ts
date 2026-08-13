/**
 * WCAG contrast maths.
 *
 * Exists so "check the colours are readable in both themes" is a test that
 * fails rather than a step someone is supposed to remember. Nobody re-checks
 * contrast by eye after changing a hex value, and this panel appears over
 * other people's pages in both light and dark.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses `#rgb` or `#rrggbb`. Returns null for anything else. */
export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');

  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((c) => Number.parseInt(c + c, 16));
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r: r!, g: g!, b: b! };
  }

  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }

  return null;
}

/** Relative luminance, per WCAG 2.1. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Convenience wrapper for two hex strings. */
export function contrastOf(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) throw new Error(`Unparseable colour: ${a} / ${b}`);
  return contrastRatio(first, second);
}

/**
 * Extracts custom-property values from a CSS block.
 *
 * The stylesheet stays the single source of truth for the palette — a copy of
 * the values in a test file would drift from the one that actually ships.
 */
export function extractTokens(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block?.[1]) return {};

  const tokens: Record<string, string> = {};
  for (const match of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}
