import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manageUnifiedDocker, parseUnifiedEnv } from "./docker-all-dev.mjs";

const env = [
  "SCADA_WEB_HOST=127.0.0.1",
  "SCADA_SERVER_HOST=127.0.0.1",
  "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
  "SCADA_REACT_PORT=18080",
  "SCADA_VUE_PORT=18081",
  "SCADA_LAB_POSTGRES_PORT=15433",
  "SCADA_LAB_REDIS_PORT=16379",
  "SCADA_LAB_KEYCLOAK_PORT=18443",
].join("\n");

function fakeDocker(options = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "volume" && options.missingVolume) return { status: 1, stdout: "" };
    if (args.at(-2) === "config" && options.invalidConfig) return { status: 1, stdout: "" };
    if (args[0] === "ps" && options.oldProject && args.includes(`label=com.docker.compose.project=${options.oldProject}`)) {
      return { status: 0, stdout: "legacy-container-id\n" };
    }
    if (args.at(-1) === "down" && options.downFailed) return { status: 1, stdout: "" };
    return { status: 0, stdout: "" };
  };
  return { calls, run };
}

void describe("ADui SCADA 单 Compose 项目迁移安全检查", () => {
  void it("本地正常端口可通过检查", () => {
    assert.doesNotThrow(() => parseUnifiedEnv(env));
  });

  void it("拒绝重复、非法和端口冲突配置", () => {
    assert.throws(() => parseUnifiedEnv(`${env}\nSCADA_REACT_PORT=19000`), /重复变量/);
    assert.throws(() => parseUnifiedEnv(env.replace("18443", "65536")), /端口无效/);
    assert.throws(() => parseUnifiedEnv(env.replace("15433", "16379")), /端口无效或存在冲突/);
  });

  void it("拒绝公网监听与不安全 OIDC 模式", () => {
    assert.throws(() => parseUnifiedEnv(env.replace("SCADA_WEB_HOST=127.0.0.1", "SCADA_WEB_HOST=0.0.0.0")), /本机回环/);
    assert.throws(() => parseUnifiedEnv(env.replace("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false", "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true")), /本机回环/);
  });

  void it("迁移预览只读，不会停止容器", () => {
    const docker = fakeDocker({ oldProject: "adui-scada-oidc-lab" });
    assert.match(manageUnifiedDocker("plan", env, docker.run), /可显式执行/);
    assert.equal(docker.calls.filter((args) => args.at(-1) === "down").length, 0);
    assert.equal(docker.calls.filter((args) => args[0] === "volume").length, 3);
  });

  void it("旧项目存在时普通启动直接拒绝，避免两个 PostgreSQL 同时挂卷", () => {
    const docker = fakeDocker({ oldProject: "adui-scada-oidc-lab" });
    assert.throws(() => manageUnifiedDocker("up", env, docker.run), /先执行 docker:all:migrate/);
    assert.equal(docker.calls.some((args) => args.includes("up")), false);
  });

  void it("迁移显式停止原三组 Compose，且永不调用 down -v", () => {
    const docker = fakeDocker({ oldProject: "adui-scada-oidc-lab" });
    assert.match(manageUnifiedDocker("migrate", env, docker.run), /原数据卷继续复用/);
    const downs = docker.calls.filter((args) => args.at(-1) === "down");
    assert.equal(downs.length, 3);
    assert.deepEqual(downs.map((args) => args[2]), [
      "adui-scada-v01-demo", "adui-scada-postgres-dev", "adui-scada-oidc-lab",
    ]);
    assert.equal(docker.calls.some((args) => args.includes("-v") || args.includes("volume") && args.includes("rm")), false);
    assert.equal(docker.calls.at(-1)?.slice(-3).join(" "), "up --build -d");
  });

  void it("缺少持久化卷时拒绝迁移且不停止任何旧容器", () => {
    const docker = fakeDocker({ missingVolume: true });
    assert.throws(() => manageUnifiedDocker("migrate", env, docker.run), /原 Docker 数据卷不存在/);
    assert.equal(docker.calls.some((args) => args.at(-1) === "down"), false);
  });

  void it("Compose 配置错误时提前拒绝迁移，避免先停止旧服务", () => {
    const docker = fakeDocker({ invalidConfig: true });
    assert.throws(() => manageUnifiedDocker("migrate", env, docker.run), /Docker 操作失败/);
    assert.equal(docker.calls.some((args) => args.at(-1) === "down"), false);
  });

  void it("老服务停止失败后不会继续启动新服务", () => {
    const docker = fakeDocker({ downFailed: true });
    assert.throws(() => manageUnifiedDocker("migrate", env, docker.run), /Docker 操作失败/);
    assert.equal(docker.calls.some((args) => args.includes("up")), false);
  });

  void it("完成迁移后启动统一项目并开启原开发库 Profile", () => {
    const docker = fakeDocker();
    assert.match(manageUnifiedDocker("up", env, docker.run), /统一 Docker 项目已启动/);
    assert.equal(docker.calls.at(-1)?.includes("--profile"), true);
    assert.equal(docker.calls.at(-1)?.includes("legacy-db"), true);
    assert.equal(docker.calls.at(-1)?.includes("adui-scada"), true);
  });

  void it("状态、日志与停止只影响新的统一项目", () => {
    for (const mode of ["down", "ps", "logs"]) {
      const docker = fakeDocker();
      assert.match(manageUnifiedDocker(mode, env, docker.run), /命令已执行/);
      assert.equal(docker.calls.length, 1);
      assert.equal(docker.calls[0]?.[2], "adui-scada");
      assert.equal(docker.calls[0]?.includes("-v"), false);
    }
  });

  void it("未知执行动作直接拒绝", () => {
    const docker = fakeDocker();
    assert.throws(() => manageUnifiedDocker("reset", env, docker.run), /不支持的统一/);
    assert.equal(docker.calls.length, 0);
  });

  void it("Compose 保留原 PostgreSQL、Redis 命名卷并精确分离服务", () => {
    const file = fileURLToPath(new URL("../deploy/docker/compose.all.dev.yaml", import.meta.url));
    const compose = readFileSync(file, "utf8");
    for (const name of [
      "adui-scada-oidc-lab_lab-postgres-data",
      "adui-scada-oidc-lab_lab-redis-data",
      "adui-scada-postgres-dev_scada-postgres-data",
    ]) {
      assert.ok(compose.includes(`name: ${name}`));
    }
    assert.ok(compose.includes("jdbc:postgresql://postgres-lab:5432/adui_scada_keycloak_lab"));
    assert.ok(compose.includes('profiles: ["legacy-db"]'));
    assert.ok(compose.includes("name: adui-scada\n"));
  });
});
