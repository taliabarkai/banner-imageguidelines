// GET  /api/preview?ping=1            -> { ready } (is Blob storage connected?)
// GET  /api/preview?id=ID              -> the saved layout (JSON)
// GET  /api/preview?id=ID&img=REF      -> one image
// POST /api/preview?id=ID&ref=REF      -> upload one image (body = image bytes)
// POST /api/preview?id=ID              -> save the layout (body = JSON) and drop unused images
import * as blob from "@vercel/blob";
import { makeStore, InputError, findToken } from "./_store.js";

const store = makeStore(blob);
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (err) => (err instanceof InputError ? json({ error: err.message }, 400) : json({ error: "server error" }, 500));

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.has("ping")) {
    // Which Blob connection settings this deployment has (names only, never values).
    const env = { token: Boolean(findToken()), storeId: Boolean(process.env.BLOB_STORE_ID), oidc: Boolean(process.env.VERCEL_OIDC_TOKEN || request.headers.get("x-vercel-oidc-token")) };
    return json({ ready: env.token || (env.storeId && env.oidc), ...env });
  }
  try {
    if (q.has("img")) {
      const img = await store.getImage(q.get("id"), q.get("img"));
      if (!img) return json({ error: "not found" }, 404);
      return new Response(img.stream, { headers: { "content-type": img.contentType, "cache-control": "public, max-age=300" } });
    }
    const state = await store.getState(q.get("id"));
    if (!state) return json({ error: "not found" }, 404);
    return json(state);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request) {
  const q = new URL(request.url).searchParams;
  try {
    if (q.has("ref")) {
      await store.saveImage(q.get("id"), q.get("ref"), request.headers.get("content-type"), new Uint8Array(await request.arrayBuffer()));
      return json({ ok: true });
    }
    let state;
    try { state = await request.json(); } catch (err) { throw new InputError("bad json"); }
    await store.saveState(q.get("id"), state);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
