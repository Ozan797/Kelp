import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fetchRelease } from "./src/release";

export default defineConfig(async () => ({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  define: { __KELP_RELEASE__: JSON.stringify(await fetchRelease()) },
}));
