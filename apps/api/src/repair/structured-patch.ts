import { readFile } from 'node:fs/promises';
import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { RepairPolicy } from './policy.js';
import { assertPatchWithinPolicy } from './policy.js';

export type StructuredEdit = {
  path: string;
  expectedText: string;
  replacementText: string;
};

/**
 * Converts model-authored, exact text replacements into a canonical unified diff.
 * The model never controls hunk locations or git metadata; each source fragment must
 * be present exactly once in the immutable checkout before a sandbox sees a patch.
 */
export async function compileStructuredPatch(
  workspacePath: string,
  edits: readonly StructuredEdit[],
  policy: RepairPolicy
): Promise<string> {
  if (edits.length === 0 || edits.length > policy.repairBudget.maxChangedFiles) {
    throw new Error('Structured repair edit count is outside the repair budget');
  }
  const root = await realpath(workspacePath);
  const seen = new Set<string>();
  const patches: string[] = [];

  for (const edit of edits) {
    if (!isSafePath(edit.path) || seen.has(edit.path)) {
      throw new Error('Structured repair contains an invalid or duplicate path');
    }
    seen.add(edit.path);
    if (edit.expectedText.length === 0 || edit.expectedText.length > 24_000 || edit.replacementText.length > 32_000) {
      throw new Error('Structured repair replacement exceeds its safety limit');
    }
    const candidate = resolve(root, edit.path);
    const resolved = await realpath(candidate);
    if (relative(root, resolved).startsWith('..')) {
      throw new Error('Structured repair resolved outside its checkout');
    }
    const metadata = await lstat(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Structured repair may only change regular files');
    }
    const source = await readFile(resolved, 'utf8');
    const matches = countOccurrences(source, edit.expectedText);
    if (matches !== 1) {
      throw new Error(`Structured repair expected text must occur exactly once in ${edit.path}`);
    }
    const updated = source.replace(edit.expectedText, edit.replacementText);
    patches.push(fullFilePatch(edit.path, source, updated));
  }

  // A unified diff must begin the next file header immediately after the prior hunk.
  // An unprefixed blank separator is interpreted as malformed hunk context by git apply.
  const patch = patches.join('');
  assertPatchWithinPolicy(patch, policy);
  return patch;
}

function fullFilePatch(path: string, before: string, after: string): string {
  const original = lines(before, true);
  const updated = lines(after, false);
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${original.length} +1,${updated.length} @@`,
    ...original.map((line) => `-${line}`),
    ...updated.map((line) => `+${line}`)
  ].join('\n') + '\n';
}

function lines(value: string, preserveTrailingBlankLines: boolean): string[] {
  const normalized = value.replace(/\r\n/g, '\n');
  const withoutTerminalNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  // The old hunk must account for every physical source line; the new hunk removes redundant blank EOF lines
  // so strict git apply does not reject a standalone '+' line as trailing whitespace.
  const canonical = preserveTrailingBlankLines
    ? withoutTerminalNewline
    : withoutTerminalNewline.replace(/\n+$/, '');
  return canonical.length === 0 ? [] : canonical.split('\n');
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let position = 0;
  while (true) {
    const next = value.indexOf(needle, position);
    if (next === -1) return count;
    count += 1;
    position = next + needle.length;
  }
}

function isSafePath(path: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(path) && !path.startsWith('/') && !path.includes('..');
}
