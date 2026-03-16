import { redirect } from "react-router";
import { getSignInUrl } from "@workos-inc/authkit-react-router";
import { configureAuth } from "~/auth.server";
import type { Route } from "./+types/auth.login";

export async function loader({ context }: Route.LoaderArgs) {
  configureAuth(context.cloudflare.env);
  const url = await getSignInUrl();
  return redirect(url);
}
