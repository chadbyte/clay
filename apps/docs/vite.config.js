import { defineConfig } from "vite";
import vinext from "vinext";
import { nitro } from "nitro/vite";

var plugins = [vinext()];
if (process.env.NITRO_PRESET === "vercel") {
  plugins.push(nitro());
}

export default defineConfig({
  plugins: plugins
});
