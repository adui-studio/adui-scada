import { defineConfig } from "vite-plus";

// 单独运行真实数据库测试，禁止并入无需 PostgreSQL 的通用质量链。
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.db-spec.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
