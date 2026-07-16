const secretPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?:api[_-]?key|token|password)\s*[=:]\s*[^\s'"`]{8,}/gi
];

export function redactLogText(value: string): string {
  return secretPatterns.reduce((redacted, pattern) => redacted.replace(pattern, '[REDACTED]'), value);
}
