import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({build:{rollupOptions:{input:{
  main:fileURLToPath(new URL('./index.html',import.meta.url)),
  briefcase:fileURLToPath(new URL('./briefcase-review.html',import.meta.url)),
}}}});
