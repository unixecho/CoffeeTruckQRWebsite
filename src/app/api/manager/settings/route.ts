import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import { dbFailed, invalid, parseSettingsPatch } from "@/lib/validate";

/**
 * Update shop settings.
 *
 * `parseSettingsPatch` returns an allowlist of `{key, value}` writes — a key
 * the parser does not know about is not stored, so a client cannot invent a
 * setting and cannot reach one the storefront was never meant to read. The
 * public read policy in migration 002 is a second allowlist over the same
 * table, for the same reason.
 */
export async function PATCH(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseSettingsPatch(body);
  if (!parsed.ok) return invalid(parsed.error);

  if (parsed.value.length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  /* One upsert for the whole group. The settings screen saves a group at a
     time, and a partial save — the WhatsApp number stored but the Bit link
     not — is a worse outcome than the whole group failing and being retried. */
  const { error } = await db
    .from("app_settings")
    .upsert(
      parsed.value.map((write) => ({ key: write.key, value: write.value })),
      { onConflict: "key" }
    );

  if (error) return dbFailed("settings.update", error);

  await audit(db, owner, "update", "app_settings", null, {
    keys: parsed.value.map((write) => write.key),
  });

  return NextResponse.json({ ok: true, keys: parsed.value.map((write) => write.key) });
}
