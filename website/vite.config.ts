import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allow importing ../design (shared tokens, fonts, theme.ts) during development.
  server: { fs: { allow: [".."] } },
});
