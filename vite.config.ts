import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import * as dotenv from "dotenv";

dotenv.config({ path: "./backend/.env" });

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
