import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('react-dom') || id.includes('react-router')) return 'vendor-react'
            if (id.includes('lightweight-charts')) return 'vendor-charts'
            if (id.includes('@radix-ui') || id.includes('lucide-react')) return 'vendor-ui'
            if (id.includes('socket.io-client') || id.includes('axios')) return 'vendor-network'
            return 'vendor'
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:5001',
          changeOrigin: true,
          secure: false
        },
        '/socket.io': {
          target: env.VITE_API_URL || 'http://localhost:5001',
          changeOrigin: true,
          ws: true
        }
      },
      hmr: {
        port: 5173
      }
    }
  }
})
