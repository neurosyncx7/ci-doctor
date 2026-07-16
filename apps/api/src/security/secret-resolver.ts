import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const secretNames = [
  'DATABASE_URL',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
  'ARTIFACT_ENCRYPTION_KEY_BASE64',
  'OPENAI_API_KEY'
] as const;

export function resolveSecrets(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved = { ...environment };
  const production = environment.NODE_ENV === 'production';
  const directory = environment.SECRET_FILE_DIRECTORY ?? '/run/secrets';

  for (const name of secretNames) {
    const filePaths = [join(directory, name.toLowerCase()), join(directory, `${name.toLowerCase()}.txt`)];
    const filePath = filePaths.find((candidate) => existsSync(candidate));
    if (filePath) {
      resolved[name] = readFileSync(filePath, 'utf8').trim();
      continue;
    }
    if (production && environment[name]) {
      throw new Error(`${name} must be injected as a mounted secret file in production`);
    }
  }
  return resolved;
}
