import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Keep an unreadable payload so a parser fix starts from real bytes, not a guess. */
export async function dumpResponse(body: string, filename: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-drift-'));
  const file = path.join(dir, filename);
  await writeFile(file, body, 'utf8');
  return file;
}
