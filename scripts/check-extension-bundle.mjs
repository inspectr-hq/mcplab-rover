import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Script } from 'node:vm';

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? javascriptFiles(path)
        : Promise.resolve(path.endsWith('.js') ? [path] : []);
    })
  );
  return nested.flat();
}

for (const path of await javascriptFiles('dist')) {
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch (error) {
    const detail = String(error.stderr ?? error.message);
    const syntaxError = detail.match(/SyntaxError: [^\n]+/)?.[0] ?? detail.slice(-500);
    throw new Error(`${path}: ${syntaxError}`);
  }
}

const contentScript = await readFile('dist/content.js', 'utf8');
try {
  new Script(contentScript, { filename: 'dist/content.js' });
} catch (error) {
  throw new Error(`dist/content.js must be a classic script: ${error.message}`);
}
