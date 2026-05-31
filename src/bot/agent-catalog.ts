import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default location of the standard-team agent definitions. */
export function agentsDir(): string {
  return join(homedir(), '.claude', 'agents');
}

/** Strip a leading YAML frontmatter block (--- ... ---); trim the rest. */
export function stripFrontmatter(md: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return (m ? md.slice(m[0].length) : md).trim();
}

/** Agent names (filenames without .md). Empty array if the dir is absent. */
export async function listAgents(dir: string = agentsDir()): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Read <name>.md, strip frontmatter, return the persona body. undefined if missing. */
export async function readAgentPersona(
  name: string,
  dir: string = agentsDir(),
): Promise<string | undefined> {
  try {
    const text = await readFile(join(dir, `${name}.md`), 'utf8');
    return stripFrontmatter(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
