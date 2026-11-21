const MAX_DIGITS = 9;

/** Keeps digits only, so a pasted "42,000 lb" reads as 42000. */
export function parseWholeNumber(text: string): number | null {
  const digits = text
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_DIGITS);
  return digits === '' ? null : Number(digits);
}
