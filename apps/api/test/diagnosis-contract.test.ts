import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosisSchema, validateEvidenceReferences } from '../src/diagnosis/contract.js';

test('rejects a diagnosis that cites evidence outside its immutable bundle', () => {
  const permitted = 'a'.repeat(64);
  const diagnosis = diagnosisSchema.parse({
    visibleSummary: 'The pagination calculation excludes the final partial page after an exact boundary.',
    nextAction: 'EXECUTE_REPAIR',
    hypotheses: [
      {
        rank: 1,
        rootCause: 'The page count floors an inclusive item range, so the remaining item is never assigned to a page.',
        confidence: 0.93,
        falsifier: 'A calculation that rounds up would return three pages for twenty-one items at ten per page.',
        evidence: [{ artifactSha256: 'b'.repeat(64), excerpt: 'Expected values to be strictly equal: 2 !== 3' }]
      }
    ]
  });

  assert.throws(
    () => validateEvidenceReferences(diagnosis, new Set([permitted])),
    /outside its evidence bundle/
  );
});
