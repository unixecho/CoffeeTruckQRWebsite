import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import { dbFailed, invalid, parseReorder, REORDER_TABLES } from "@/lib/validate";

/**
 * Persist a new display order.
 *
 * The manager sends the full list of ids in their new order and each gets its
 * index as `sort_order`. Sending the whole list rather than "move this one up"
 * means the result is the same however many times it is replayed, which
 * matters on a phone with a flaky tether where a tap can be sent twice.
 *
 * `REORDER_TABLES` is a literal map: the value side is what reaches PostgREST,
 * never the string the client sent.
 */
export async function POST(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseReorder(body);
  if (!parsed.ok) return invalid(parsed.error);

  const table = REORDER_TABLES[parsed.value.entity];

  /* One statement per row rather than a batch upsert. An upsert would need
     every NOT NULL column present — `name_he`, `price_agorot` and the rest —
     so the client would have to send whole rows just to reorder them, and any
     one of those fields would then be client-controlled on a path that is
     supposed to touch nothing but an integer.

     The lists here are a handful of rows on one screen, so the round trips are
     not worth trading that away for. */
  const results = await Promise.all(
    parsed.value.ids.map((id, index) =>
      db.from(table).update({ sort_order: index }).eq("id", id)
    )
  );

  const failure = results.find((result) => result.error)?.error;
  if (failure) return dbFailed("reorder", failure);

  await audit(db, owner, "update", parsed.value.entity, null, {
    reordered: parsed.value.ids.length,
  });

  return NextResponse.json({ ok: true, count: parsed.value.ids.length });
}
