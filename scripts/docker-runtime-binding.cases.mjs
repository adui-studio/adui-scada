import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseDockerDatabaseBinding, resolveDockerReadOnlyConfig, resolveDockerReadOnlyMode } from "../apps/server/src/database/docker-readonly-config.ts";
import { resolvePrisma8RuntimeUrl } from "../apps/server/src/database/prisma8-runtime-boundary.ts";
import { ensureDockerDatabaseBinding } from "./docker-runtime-binding.mjs";

const hash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const binding = { password: "a".repeat(43), systemIdentifier: "123456789", storageHash: hash };
const mode = {
  NODE_ENV: "production",
  SCADA_DOCKER_DB_READONLY: "true",
  SCADA_SERVER_HOST: "0.0.0.0",
  SCADA_OIDC_ENABLED: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
};
const failure = /Docker 正式只读数据库绑定/;

void describe("Docker 常驻原生只读数据库绑定", () => {
  void it("默认和显式关闭均不启用容器数据库模式", () => {
    assert.equal(resolveDockerReadOnlyMode({}), false);
    assert.equal(resolveDockerReadOnlyMode({ ...mode, SCADA_DOCKER_DB_READONLY: "false" }), false);
  });

  void it("仅固定生产镜像的本机容器只读模式可启用", () => {
    assert.equal(resolveDockerReadOnlyMode(mode), true);
    for (const change of [
      { SCADA_DOCKER_DB_READONLY: "1" },
      { NODE_ENV: "development" },
      { SCADA_SERVER_HOST: "127.0.0.1" },
      { SCADA_OIDC_ENABLED: "true" },
      { SCADA_LOCAL_DEMO_API_ENABLED: "true" },
      { SCADA_DATABASE_URL: "fixture" },
      { SCADA_OIDC_ENABLED: undefined },
    ]) {
      assert.throws(() => resolveDockerReadOnlyMode({ ...mode, ...change }), /必须与认证、模拟接口及宿主连接配置隔离/);
    }
  });

  void it("绑定只能构造现有固定容器只读 URL 与集群身份", () => {
    const config = resolveDockerReadOnlyConfig(JSON.stringify(binding), hash);
    assert.equal(config.readOnly, true);
    assert.equal(config.transport, "docker-readonly");
    assert.equal(config.expectedSystemIdentifier, binding.systemIdentifier);
    const url = new URL(resolvePrisma8RuntimeUrl(config));
    assert.equal(url.hostname, "postgres");
    assert.equal(url.port, "5432");
    assert.equal(url.username, "adui_scada");
    assert.equal(url.pathname, "/adui_scada");
    assert.equal(url.password, binding.password);
    const options = url.searchParams.get("options");
    assert.ok(options);
    assert.match(options, /default_transaction_read_only=on/);
    assert.throws(() => resolvePrisma8RuntimeUrl({ ...config, readOnly: false }), /仅允许已初始化的本机业务库/);
  });

  void it("拒绝其他存储指纹、非法秘密、集群及任意额外连接参数", () => {
    for (const input of [
      { ...binding, password: "invalid" },
      { ...binding, systemIdentifier: "0" },
      { ...binding, storageHash: "f".repeat(64) },
      { ...binding, readOnly: false },
      { ...binding, host: "remote.example" },
      { password: binding.password, storageHash: hash },
      [], null,
    ]) {
      assert.throws(() => parseDockerDatabaseBinding(JSON.stringify(input), hash), failure);
    }
    assert.throws(() => parseDockerDatabaseBinding("invalid", hash), failure);
    assert.throws(() => parseDockerDatabaseBinding("x".repeat(1025), hash), failure);
  });

  void it("首次仅写独立本机文件，相同绑定重复启动保持原文件", () => {
    const root = mkdtempSync(join(tmpdir(), "scada-binding-"));
    try {
      ensureDockerDatabaseBinding(root, binding, hash);
      const file = join(root, ".local", "docker-runtime", "server-database.json");
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), binding);
      const original = JSON.stringify(binding, null, 2) + "\n";
      writeFileSync(file, original);
      ensureDockerDatabaseBinding(root, binding, hash);
      assert.equal(readFileSync(file, "utf8"), original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("已有文件凭据或集群漂移时拒绝且不自动覆盖", () => {
    const root = mkdtempSync(join(tmpdir(), "scada-binding-"));
    try {
      ensureDockerDatabaseBinding(root, binding, hash);
      const file = join(root, ".local", "docker-runtime", "server-database.json");
      const original = readFileSync(file, "utf8");
      for (const change of [{ password: "b".repeat(43) }, { systemIdentifier: "987654321" }]) {
        assert.throws(() => ensureDockerDatabaseBinding(root, { ...binding, ...change }, hash), failure);
        assert.equal(readFileSync(file, "utf8"), original);
      }
      writeFileSync(file, "invalid");
      assert.throws(() => ensureDockerDatabaseBinding(root, binding, hash), failure);
      assert.equal(readFileSync(file, "utf8"), "invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("拒绝目录冒充绑定文件且保留现场", () => {
    const root = mkdtempSync(join(tmpdir(), "scada-binding-"));
    try {
      const file = join(root, ".local", "docker-runtime", "server-database.json");
      mkdirSync(file, { recursive: true });
      assert.throws(() => ensureDockerDatabaseBinding(root, binding, hash), failure);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
