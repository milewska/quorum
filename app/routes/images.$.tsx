import type { Route } from "./+types/images.$";

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const key = params["*"];
  if (!key) throw new Response("Not Found", { status: 404 });

  const obj = await env.IMAGES.get(key);
  if (!obj) throw new Response("Not Found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(obj.body, { headers });
}
