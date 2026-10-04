import { defineConfig } from 'vite';

// base relativo: funciona no GitHub Pages (em /<repositório>/) e servido
// pelo gravador local (em /).
export default defineConfig({
  base: './',
  // O Blockly sozinho já passa de 500 kB; é esperado.
  build: { chunkSizeWarningLimit: 1500 },
});
