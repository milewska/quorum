import { buildLoginRedirect } from "~/auth.server";
import type { Route } from "./+types/auth.login";

export async function loader({ request, context }: Route.LoaderArgs) {
  return buildLoginRedirect(request, context.cloudflare.env);
}
