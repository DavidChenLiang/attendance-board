import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import commonjs from 'vite-plugin-commonjs'

// 考勤看板 React 版：逻辑层复用根目录 attendance-logic.js（UMD / CommonJS）。
// 用 vite-plugin-commonjs 把该本地文件按 CJS 处理并导出为 default，供 React 以 `import L from ...` 使用；
// 同时该文件仍可被 vanilla 版 <script> 与 Node require() 复用，回归测试不受影响。
// 注：曾尝试 @rollup/plugin-commonjs，但其在 Vite 5 dev 下无法解析虚拟 helper
//     \u0000commonjsHelpers.js（已移除，勿再引入）。
export default defineConfig({
  plugins: [
    react(),
    commonjs(),
  ],
  server: { port: 5173, open: false },
})
