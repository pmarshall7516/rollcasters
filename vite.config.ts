import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolveBuildProfile } from "./src/lib/desktop-profile";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const buildProfile = command === "build" ? resolveBuildProfile(mode, env) : undefined;
  const desktopBuild = Boolean(process.env.TAURI_ENV_PLATFORM);
  if (desktopBuild && !fs.existsSync(path.resolve("public/desktop-catalog/game-data/latest.json"))) {
    throw new Error("Desktop packaging requires a verified staged Catalog Release. Run npm run desktop:stage-catalog first.");
  }
  const embeddedCatalog = desktopBuild
    ? JSON.parse(fs.readFileSync(path.resolve("public/desktop-catalog/game-data/latest.json"), "utf8")) as { catalogVersion: string }
    : null;
  return {
  define: buildProfile ? {
    "import.meta.env.VITE_GAME_PROFILE": JSON.stringify(buildProfile.profile),
    "import.meta.env.VITE_GAME_ENVIRONMENT": JSON.stringify("production"),
      "import.meta.env.VITE_GAME_UPDATE_CHANNEL": JSON.stringify(buildProfile.channel),
      "import.meta.env.VITE_GAME_CLIENT_PROTOCOL_VERSION": JSON.stringify("1"),
      ...(embeddedCatalog ? { "import.meta.env.VITE_GAME_CATALOG_RELEASE_ID": JSON.stringify(embeddedCatalog.catalogVersion) } : {}),
    ...(desktopBuild ? {
      "import.meta.env.VITE_DESKTOP_BUILD": JSON.stringify("true"),
      "import.meta.env.VITE_GAME_CATALOG_BASE_URL": JSON.stringify("/desktop-catalog/game-data"),
      "import.meta.env.VITE_GAME_ASSET_BASE_URL": JSON.stringify("/desktop-catalog/game-assets"),
    } : {}),
  } : undefined,
  plugins: [react()],
  // The game does not use client-side HMR. Keeping the dev server from
  // injecting an HMR WebSocket avoids noisy/disconnected socket failures when
  // the app is opened through a forwarded or shared desktop port.
  server: {
    hmr: false,
    ...(env.VITE_LOCAL_CATALOG_DIR ? {
      fs: { allow: [process.cwd(), path.resolve(env.VITE_LOCAL_CATALOG_DIR)] },
    } : {}),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },
  };
});
