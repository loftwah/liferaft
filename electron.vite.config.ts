import path from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { include: ['electron', 'better-sqlite3'] },
      sourcemap: true,
      outDir: 'out/main',
      rolldownOptions: {
        external: ['better-sqlite3'],
        input: {
          index: path.resolve('src/main/index.ts'),
          'utility/importer': path.resolve('src/utility/importer.ts')
        }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      sourcemap: true,
      outDir: 'out/preload',
      rolldownOptions: {
        external: ['electron', 'electron/renderer'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs'
        },
        input: {
          index: path.resolve('src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': path.resolve('src/renderer'),
        '@shared': path.resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: true,
      outDir: 'out/renderer',
      rolldownOptions: {
        input: {
          index: path.resolve('src/renderer/index.html')
        }
      }
    }
  }
})
