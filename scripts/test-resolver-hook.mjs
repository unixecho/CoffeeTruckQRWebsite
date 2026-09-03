import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolve hook for `node --test`. See `test-resolver.mjs` for why it exists.
 *
 * Two rewrites, both narrow:
 *
 *   "../money"      -> "../money.ts"      when that file exists
 *   "@/lib/money"   -> "<repo>/src/lib/money.ts"
 *
 * Anything already carrying an extension, and anything that is not a relative
 * or aliased specifier, is passed straight through — so a bare package name
 * still resolves through node_modules exactly as it would in production, and a
 * missing file still fails as a missing file rather than being silently
 * rewritten into something else.
 */

const EXTENSIONS = [".ts", ".tsx"];
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

/** The repo root: this file lives in <root>/scripts/. */
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function firstExisting(basePath) {
  for (const extension of EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  // A directory import — "./payments" meaning "./payments/index.ts". Not a
  // pattern this codebase uses, but resolving it costs one more check and
  // avoids a baffling failure if somebody adds one.
  for (const extension of EXTENSIONS) {
    const candidate = resolvePath(basePath, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (!HAS_EXTENSION.test(specifier)) {
    let basePath = null;

    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      basePath = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    } else if (specifier.startsWith("@/")) {
      // Mirrors the `paths` mapping in tsconfig.json.
      basePath = resolvePath(ROOT, "src", specifier.slice(2));
    }

    if (basePath) {
      const found = firstExisting(basePath);
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
  }

  return nextResolve(specifier, context);
}
