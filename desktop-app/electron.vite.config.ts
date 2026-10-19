import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string }

export default defineConfig({
  main: {
    // hyparquet is ESM-only; bundle it into the CJS worker instead of
    // requiring it at runtime.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['hyparquet', 'hyparquet-compressors']
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'onnx-inference.worker': resolve(
            __dirname,
            'src/main/workers/onnx-inference.worker.ts'
          ),
          'overture-dealers.worker': resolve(
            __dirname,
            'src/main/workers/overture-dealers.worker.ts'
          )
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Shown in the sidebar footer; always the package.json version.
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
