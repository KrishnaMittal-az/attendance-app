import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tailwind only regenerates its CSS when a file it has already scanned changes. When Claude writes
// App.tsx before the component it imports, the new component's classes would stay unstyled in the
// live preview until the next edit. Re-run the CSS whenever a source file is created.
const refreshCssOnNewFiles: Plugin = {
  name: "kagaz:refresh-css-on-new-files",
  apply: "serve",
  hotUpdate({ type, file, modules }) {
    if (type !== "create" || !/\.[cm]?[jt]sx?$/.test(file)) return;
    const css = [...this.environment.moduleGraph.idToModuleMap.values()].filter((m) =>
      m.file?.endsWith(".css"),
    );
    return [...modules, ...css];
  },
};

// Live preview for Kagaz → App, shown inside an <iframe> on the stage screen (localhost:3000).
export default defineConfig({
  plugins: [react(), tailwindcss(), refreshCssOnNewFiles],
  clearScreen: false,
  server: {
    host: "localhost", // never listen on the LAN
    port: 5173,
    strictPort: true,
  },
});
