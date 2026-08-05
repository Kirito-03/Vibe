import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    assetsInclude: ['**/*.svg', '**/*.csv'],
    server: {
      host: '0.0.0.0',
      port: 5173,
      watch: {
        usePolling: true,
        interval: 1000,
      },
      proxy: {
        '/api': {
          // Si VITE_BACKEND_URL está en .env.local lo usa (ej. IP de WSL2 si es necesario)
          // Si corre en Docker usará http://backend:3000 si se sobreescribe
          // Fallback por defecto: http://127.0.0.1:3000 (funciona en Windows gracias a docker-compose.override.yml)
          target: env.VITE_BACKEND_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (_err, _req, res) => {
              if (res && !res.headersSent) {
                (res as any).writeHead(502, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({ error: 'Backend no disponible. Verifica los contenedores Docker y el proxy.' }));
              }
            });
            proxy.on('proxyReq', (_proxyReq, req) => {
              if (env.DEV) {
                console.log(`[proxy] ${req.method} ${req.url}`);
              }
            });
          }
        }
      }
    }
  };
});
