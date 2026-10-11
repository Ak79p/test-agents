// File-backed catalogue store shared by the web server and the CLI (scripts/case.mjs).
// Writes are atomic (temp file + rename); the previous version is kept as catalogue.backup.json.

import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DATA_FILE = fileURLToPath(new URL('../data/catalogue.json', import.meta.url));
const BACKUP_FILE = fileURLToPath(new URL('../data/catalogue.backup.json', import.meta.url));

export async function readCatalogue() {
  return JSON.parse(await readFile(DATA_FILE, 'utf8'));
}

let writeQueue = Promise.resolve();

/** Serialised read-modify-write: `mutator(doc)` changes the fresh document and returns a result. */
export function mutateCatalogue(mutator) {
  const run = writeQueue.then(async () => {
    const doc = await readCatalogue();
    const result = await mutator(doc);
    doc.updatedAt = new Date().toISOString();
    const tmp = `${DATA_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    await copyFile(DATA_FILE, BACKUP_FILE);
    await rename(tmp, DATA_FILE);
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
}
