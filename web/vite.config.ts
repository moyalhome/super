import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE is "/super/" on GitHub Pages, "/" locally.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
});
