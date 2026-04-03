import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

let gitHash = "dev";
try {
  gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  // not a git repo or git not available
}

export default defineConfig({
  plugins: [
    cloudflareDevProxy({
      getLoadContext({ context }) {
        return { cloudflare: context.cloudflare };
      },
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
  ssr: {
    target: "webworker",
    noExternal: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT_HASH__: JSON.stringify(gitHash),
  },
});
