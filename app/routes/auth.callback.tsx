import { handleOAuthCallback } from "~/auth.server";
import type { Route } from "./+types/auth.callback";

export async function loader({ request, context }: Route.LoaderArgs) {
  return handleOAuthCallback(request, context.cloudflare.env);
}
