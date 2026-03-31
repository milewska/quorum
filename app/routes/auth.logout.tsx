import { signOut } from "@workos-inc/authkit-react-router";
import { configureAuth } from "~/auth.server";
import type { Route } from "./+types/auth.logout";

// No UI — this route only accepts POST (form action).
export async function action({ request, context }: Route.ActionArgs) {
  configureAuth(context.cloudflare.env);
  return signOut(request, { returnTo: "/" });
}

// GET requests fall through to a redirect to home.
export async function loader() {
  const { redirect } = await import("react-router");
  return redirect("/");
}
