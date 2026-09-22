/**
 * 注意：本文件刻意不使用 `import { defineConfig } from 'vite'`。
 * 无外部 import 的纯对象配置可避免 Vite 加载 config 时的外部依赖路径解析，
 * 在受限环境（如无法 spawn 子进程的沙箱）下也能正常 dev / build。
 * @type {import('vite').UserConfig}
 */
export default {
  // publicDir 指向 textures：所有贴图可通过根路径 URL 直接访问（dev 与 build 均生效），
  // 无需移动/复制用户现有的 textures 目录。
  publicDir: 'textures',
  server: {
    open: true,
    host: '127.0.0.1',
  },
  build: {
    chunkSizeWarningLimit: 1024,
  },
};
