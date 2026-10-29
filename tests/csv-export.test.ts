import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCsvCell } from '../lib/csv.ts';

test('CSV export neutralizes formula-like text while preserving actual negative numbers', () => {
  for (const value of ['=HYPERLINK("https://example.com")', '+SUM(A1)', '-malicious-text', '@SUM(A1)', '  =1+1', '\tformula', '\rformula', '\nformula', '-100']) {
    assert.equal(safeCsvCell(value), `'${value}`);
  }
  assert.equal(safeCsvCell(-100), '-100');
  assert.equal(safeCsvCell(25), '25');
  assert.equal(safeCsvCell(0), '0');
  assert.equal(safeCsvCell('task_target, amount_cap'), 'task_target, amount_cap');
  assert.equal(safeCsvCell(null), '');
});
