// Request handling for shared edit links, kept apart from the Blob wiring so it can be tested
// with an in-memory store. See share.js for the routes.
import { InputError, ConflictError } from "./_store.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (err) => {
  if (err instanceof ConflictError) return json({ error: "conflict", ver: err.ver }, 409);
  if (err instanceof InputError) return json({ error: err.message }, 400);
  return json({ error: "server error" }, 500);
};

export async function handleGet(request, store) {
  const q = new URL(request.url).searchParams;
  try {
    if (q.has("img")) {
      const img = await store.getImage(q.get("id"), q.get("img"));
      if (!img) return json({ error: "not found" }, 404);
      // An image never changes under its ref (a new upload gets a new ref), so it can be cached.
      return new Response(img.stream, { headers: { "content-type": img.contentType, "cache-control": "public, max-age=86400, immutable" } });
    }
    const state = await store.getState(q.get("id"));
    if (!state) return json({ error: "not found" }, 404);
    return json(state);
  } catch (err) {
    return fail(err);
  }
}

export async function handlePost(request, store) {
  const q = new URL(request.url).searchParams;
  try {
    if (q.has("ref")) {
      await store.saveImage(q.get("id"), q.get("ref"), request.headers.get("content-type"), new Uint8Array(await request.arrayBuffer()));
      return json({ ok: true });
    }
    let body;
    try { body = await request.json(); } catch (err) { throw new InputError("bad json"); }
    if (!body || typeof body !== "object") throw new InputError("bad json");
    const ver = await store.saveVersioned(q.get("id"), body.state, body.base ?? null);
    return json({ ok: true, ver });
  } catch (err) {
    return fail(err);
  }
}
