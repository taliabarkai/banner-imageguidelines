// Daily job (see vercel.json "crons"): deletes phone previews older than 7 days.
import * as blob from "@vercel/blob";
import { makeStore } from "./_store.js";

const store = makeStore(blob);

export async function GET(request) {
  // When CRON_SECRET is set, Vercel's scheduler sends it; other callers are turned away.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await store.cleanup();
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
