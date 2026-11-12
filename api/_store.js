// Phone previews kept in Vercel Blob.
// Each preview lives under previews/<id>/: state.json (the layout) plus one file per image.
// The id is random and lives in the designer's browser, so a new preview from the same
// browser and brand replaces the last one. Anything not touched for KEEP_DAYS is deleted
// by the daily cleanup job.

export const KEEP_DAYS = 7;
const ID = /^[a-z0-9]{24}$/;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMG = 4 * 1024 * 1024;
const MAX_STATE = 1024 * 1024;
const ROOT = "previews/";

export class InputError extends Error {}

const dir = (id) => `${ROOT}${id}/`;
const imgPath = (id, ref) => `${dir(id)}img-${ref}`;
const statePath = (id) => `${dir(id)}state.json`;

export const checkId = (id) => {
  if (!ID.test(id || "")) throw new InputError("bad id");
  return id;
};
export const checkRef = (ref) => {
  if (!REF.test(ref || "")) throw new InputError("bad image ref");
  return ref;
};

// The store's read-write token: BLOB_READ_WRITE_TOKEN, or the same token under a custom prefix
// (Vercel lets you rename it when connecting a store).
export const findToken = () => process.env.BLOB_READ_WRITE_TOKEN
  || Object.entries(process.env).find(([k, v]) => /READ_WRITE_TOKEN$/.test(k) && String(v).startsWith("vercel_blob_rw_"))?.[1]
  || null;

export function makeStore(blob) {
  const auth = () => { const token = findToken(); return token ? { token } : {}; };
  // Works with a public or a private store: the access type is found on the first write.
  let access = process.env.BLOB_ACCESS || null;
  const other = (a) => (a === "public" ? "private" : "public");

  const put = async (path, body, contentType) => {
    const opts = (a) => ({ ...auth(), access: a, contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    if (access) return blob.put(path, body, opts(access));
    try {
      const res = await blob.put(path, body, opts("public"));
      access = "public";
      return res;
    } catch (err) {
      const res = await blob.put(path, body, opts("private"));
      access = "private";
      return res;
    }
  };

  const read = async (path) => {
    for (const a of access ? [access, other(access)] : ["public", "private"]) {
      try {
        const res = await blob.get(path, { ...auth(), access: a, useCache: false });
        if (res === null) return null;
        if (res.statusCode === 200) { access = a; return res; }
      } catch (err) { /* try the other access type */ }
    }
    return null;
  };

  const listAll = async (prefix) => {
    const out = [];
    let cursor;
    do {
      const page = await blob.list({ ...auth(), prefix, cursor, limit: 1000 });
      out.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  };

  return {
    async saveImage(id, ref, contentType, bytes) {
      checkId(id); checkRef(ref);
      const type = String(contentType || "").split(";")[0].trim();
      if (!IMG_TYPES.has(type)) throw new InputError("unsupported image type");
      if (!bytes || !bytes.byteLength) throw new InputError("empty image");
      if (bytes.byteLength > MAX_IMG) throw new InputError("image too large");
      await put(imgPath(id, ref), bytes, type);
    },

    async saveState(id, state) {
      checkId(id);
      if (!state || typeof state !== "object" || !Array.isArray(state.page) || typeof state.cfg !== "object" || !state.cfg) throw new InputError("bad layout");
      const images = Array.isArray(state.images) ? state.images.filter((r) => REF.test(r)) : [];
      const json = JSON.stringify({ ...state, images, savedAt: Date.now() });
      if (json.length > MAX_STATE) throw new InputError("layout too large");
      await put(statePath(id), json, "application/json");
      // Drop images from earlier previews that this one no longer uses.
      const keep = new Set([statePath(id), ...images.map((r) => imgPath(id, r))]);
      const stale = (await listAll(dir(id))).filter((b) => !keep.has(b.pathname)).map((b) => b.url);
      if (stale.length) await blob.del(stale, auth());
    },

    async getState(id) {
      checkId(id);
      const res = await read(statePath(id));
      if (!res) return null;
      return JSON.parse(await new Response(res.stream).text());
    },

    async getImage(id, ref) {
      checkId(id); checkRef(ref);
      const res = await read(imgPath(id, ref));
      if (!res) return null;
      return { stream: res.stream, contentType: res.blob.contentType || "image/jpeg" };
    },

    // Delete every preview whose newest file is older than KEEP_DAYS.
    async cleanup(now = Date.now()) {
      const cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
      const groups = new Map();
      for (const b of await listAll(ROOT)) {
        const id = b.pathname.slice(ROOT.length).split("/")[0];
        const g = groups.get(id) || { newest: 0, urls: [] };
        g.newest = Math.max(g.newest, new Date(b.uploadedAt).getTime());
        g.urls.push(b.url);
        groups.set(id, g);
      }
      let removed = 0;
      for (const g of groups.values()) {
        if (g.newest < cutoff) { await blob.del(g.urls, auth()); removed += 1; }
      }
      return { previews: groups.size, removed };
    },
  };
}
