import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Two pages: the dashboard, and the customer's voice-call page (link sent on WhatsApp).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        call: fileURLToPath(new URL('./call.html', import.meta.url)),
      },
      output: {
        // Libraries in their own files: they rarely change, so browsers keep them cached across
        // deploys and only our (smaller) app code is downloaded again.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase-vendor', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'icons-vendor', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'query-vendor', test: /node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    // In local dev, forward API and webhook calls to `npm run server` (port 3000).
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
    },
  },
})
