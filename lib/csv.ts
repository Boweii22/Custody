/** Keep untrusted text out of spreadsheet formula evaluation without changing numeric data. */
export function safeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value);
  return /^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}
