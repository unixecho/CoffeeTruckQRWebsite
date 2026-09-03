import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import {
  dbFailed,
  invalid,
  notFound,
  parseRuleCreate,
  SCOPE_TABLES,
} from "@/lib/validate";

export async function POST(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseRuleCreate(body);
  if (!parsed.ok) return invalid(parsed.error);

  /* `scope_id` is an untyped uuid — a rule can point at any of three tables,
     so no foreign key can hold it. Migration 001 has a trigger enforcing the
     target exists; checking here first turns that trigger's exception into a
     404 that names what was missing.

     SCOPE_TABLES is a literal map, and `scope` has already been narrowed to
     one of three string literals. The table name is never interpolated from
     anything a client sent. */
  const table = SCOPE_TABLES[parsed.value.scope];
  const { data: target } = await db
    .from(table)
    .select("id")
    .eq("id", parsed.value.scope_id)
    .maybeSingle();

  if (!target) return notFound(parsed.value.scope);

  const { data, error } = await db
    .from("pricing_rules")
    .insert(parsed.value)
    .select("id")
    .single();

  // A duplicate rung for the same scope surfaces as 23505 → 409 "duplicate",
  // which is what the deal editor shows as `duplicateQty`.
  if (error) return dbFailed("rules.create", error);

  await audit(db, owner, "create", "pricing_rule", data.id, {
    scope: parsed.value.scope,
    scope_id: parsed.value.scope_id,
    min_qty: parsed.value.min_qty,
    price_agorot: parsed.value.price_agorot,
  });

  return NextResponse.json({ ok: true, id: data.id });
}
