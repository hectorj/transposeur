import fs from 'node:fs/promises';
import path from 'node:path';

/** Is `name` an executable file somewhere on PATH? */
async function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      await fs.access(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

/**
 * Fails early, and legibly, when a command the script shells out to is not on
 * PATH — which is what happens whenever one of these is run outside
 * `nix develop`. Node's own error for that is a bare spawn ENOENT, thrown deep
 * in child_process with no hint about the cause.
 */
export async function requireTools(...names) {
  const found = await Promise.all(names.map(onPath));
  const missing = names.filter((_, i) => !found[i]);
  if (!missing.length) return;

  const plural = missing.length > 1;
  console.error(
    `\nMissing ${plural ? 'commands' : 'command'}: ${missing.join(', ')}\n\n` +
      `${plural ? 'They are' : 'It is'} provided by the dev shell. Run:\n\n` +
      `    nix develop --command npm run <script>\n\n` +
      `or enter the shell once with \`nix develop\` and run npm as usual.\n`
  );
  process.exit(1);
}
