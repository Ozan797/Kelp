import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fetchRelease, releaseFromVersion } from "./src/release";

export default defineConfig(async ({ mode }) => {
  const handedOver = loadEnv(mode, ".", "KELP_").KELP_RELEASE_VERSION;
  const release = handedOver ? releaseFromVersion(handedOver) : await fetchRelease();
  return {
    plugins: [react()],
    server: { fs: { allow: [".."] } },
    define: { __KELP_RELEASE__: JSON.stringify(release) },
  };
});
