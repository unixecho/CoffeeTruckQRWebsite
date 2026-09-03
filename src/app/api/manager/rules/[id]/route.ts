import { NextResponse } from "next/server";
import { openWrite, openBare, audit } from "@/lib/route";
import { dbFailed, invalid, notFound, parseRulePatch } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  /* `parseRulePatch` will not move a rule's scope. Re-pointing a live deal at
     a different subclass changes what every cart in progress costs, and the
     honest way to do that is to end one deal and start another — which is
     also what leaves a readable audit trail. */
  const parsed = parseRulePatch(body);
  if (!parsed.ok) return invalid(parsed.error);

  if (Object.keys(parsed.value).length === 0) {
    return NextResponse.json({ ok: true, id, unchanged: true });
  }

  const { data, error } = await db
    .from("pricing_rules")
    .update(parsed.value)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return dbFailed("rules.update", error);
  if (!data) return notFound("pricing_rule");

  await audit(db, owner, "update", "pricing_rule", id, parsed.value);

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openBare(request);
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  const { data: existing } = await db
    .from("pricing_rules")
    .select("scope, scope_id, min_qty, price_agorot")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return notFound("pricing_rule");

  const { error } = await db.from("pricing_rules").delete().eq("id", id);
  if (error) return dbFailed("rules.delete", error);

  await audit(db, owner, "delete", "pricing_rule", id, existing);

  return NextResponse.json({ ok: true, id });
}
