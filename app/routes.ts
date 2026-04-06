import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),

  // Auth
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),

  // Events
  route("events", "routes/events._index.tsx"),
  route("events/new", "routes/events.new.tsx"),
  route("events/:id", "routes/events.$id.tsx"),
  route("events/:id/edit", "routes/events.$id.edit.tsx"),
  route("events/:id/manage", "routes/events.$id.manage.tsx"),
  route("events/:id/manage/export", "routes/events.$id.manage.export.tsx"),

  // User profiles
  route("users/:id", "routes/users.$id.tsx"),

  // Dashboard
  route("dashboard", "routes/dashboard.tsx"),

  // R2 image proxy
  route("images/*", "routes/images.$.tsx"),
] satisfies RouteConfig;
