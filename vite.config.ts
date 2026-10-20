import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ root: 'src/ui', base: './', plugins: [vue()], build: { outDir: '../../dist/ui', emptyOutDir: true } });
