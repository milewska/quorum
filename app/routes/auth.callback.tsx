import { authLoader } from "@workos-inc/authkit-react-router";
import { configureAuth } from "~/auth.server";
import { getDb } from "../../db";
import { users } from "../../db/schema";
import type { Route } from "./+types/auth.callback";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  configureAuth(env);

  const db = getDb(env);

  const handler = authLoader({
    returnPathname: "/",
    onSuccess: async ({ user }) => {
      const fullName =
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.email;

      await db
        .insert(users)
        .values({
          workosUserId: user.id,
          email: user.email,
          fullName,
          avatarUrl: user.profilePictureUrl ?? null,
        })
        .onConflictDoUpdate({
          target: users.workosUserId,
          set: {
            email: user.email,
            fullName,
            avatarUrl: user.profilePictureUrl ?? null,
          },
        });
    },
  });

  return handler(args);
}
