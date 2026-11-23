// Shared edit links: anyone with /s/<id> can open the template and save changes back to it.
// GET  /api/share?id=ID              -> the saved template (JSON, includes its version `ver`)
// GET  /api/share?id=ID&img=REF      -> one image
// POST /api/share?id=ID&ref=REF      -> upload one image (body = image bytes, 4MB max)
// POST /api/share?id=ID              -> save { state, base } where base is the version the editor
//                                       started from (null overwrites). 409 { ver } if someone
//                                       saved a newer version first.
import * as blob from "@vercel/blob";
import { makeStore, SHARES } from "./_store.js";
import { handleGet, handlePost } from "./_share.js";

const storeFor = (request) => makeStore(blob, { root: SHARES, oidcToken: request.headers.get("x-vercel-oidc-token") || undefined });

export const GET = (request) => handleGet(request, storeFor(request));
export const POST = (request) => handlePost(request, storeFor(request));
