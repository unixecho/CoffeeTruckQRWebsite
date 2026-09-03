import { register } from "node:module";

/* ==========================================================================
   Making `node --test` resolve the imports this codebase actually writes

   Loaded by `npm test` via `--import`. It exists because of one mismatch:

   `--experimental-strip-types` runs TypeScript by deleting the types and
   handing the rest to Node's ESM loader, which does **no** extension
   resolution. So `import { parseShekels } from "../money"` — the import every
   file in `src/` writes, and the one the bundler expects — is a module-not-
   found under the test runner.

   The two alternatives were both worse:

   - **Write `.ts` on every runtime import in app code.** It works, and it puts
     a test-runner detail into security-critical modules where the next person
     reasonably wonders what it means. A convention that exists only to satisfy
     a tool should live with the tool.
   - **Don't test those modules.** Which is how the Grow adapter, the payload
     redactor and the frame-origin allowlist would have shipped unexercised.

   Type-only imports need none of this: they are erased before Node sees them,
   which is why `pricing.ts` has always been testable without it.
   ========================================================================== */

register("./test-resolver-hook.mjs", import.meta.url);
