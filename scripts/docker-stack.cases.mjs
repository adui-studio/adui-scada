import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manageDockerStack, validateDockerEnv } from "./docker-stack.mjs";

const env = [
  "SCADA_WEB_HOST=127.0.0.1",
  "SCADA_SERVER_HOST=127.0.0.1",
  "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
  "SCADA_REACT_PORT=18080",
  "SCADA_VUE_PORT=18081",
  "SCADA_LAB_POSTGRES_PORT=15433",
  "SCADA_LAB_REDIS_PORT=16379",
  "SCADA_LAB_KEYCLOAK_PORT=18443",
  "SCADA_DB_HOST=127.0.0.1",
  "SCADA_DB_PORT=15433",
  "SCADA_DB_NAME=adui_scada",
  "SCADA_DB_USER=adui_scada",
].join("\n") + "\n";

function mockDocker(options = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args.includes("config") && options.badConfig) return { status: 1, stdout: "" };
    if (args[0] === "ps" && options.legacy) return { status: 0, stdout: "old-id\n" };
    return { status: 0, stdout: "" };
  };
  return { run, calls };
}

void describe("ADui SCADA 全新单项目 Docker 安全测试", () => {
  void it("允许受控本机业务数据库 adui_scada", () => {
    assert.equal(validateDockerEnv(env), true);
  });

  void it("拒绝旧数据库、旧账号和旧数据库端口", () => {
    for (const invalid of [
      env.replace("SCADA_DB_NAME=adui_scada", "SCADA_DB_NAME=adui_scada_oidc_lab"),
      env.replace("SCADA_DB_USER=adui_scada", "SCADA_DB_USER=adui_scada_oidc_lab"),
      env.replace("SCADA_DB_PORT=15433", "SCADA_DB_PORT=15432"),
    ]) assert.throws(() => validateDockerEnv(invalid), /禁止连接历史数据库/);
  });

  void it("拒绝重复环境变量及冲突端口", () => {
    assert.throws(() => validateDockerEnv(env + "SCADA_DB_NAME=adui_scada\n"), /重复/);
    assert.throws(() => validateDockerEnv(env.replace("16379", "15433")), /端口/);
  });

  void it("拒绝公网监听及不安全 OIDC 模式", () => {
    assert.throws(
      () => validateDockerEnv(env.replace("SCADA_WEB_HOST=127.0.0.1", "SCADA_WEB_HOST=0.0.0.0")),
      /本机回环/,
    );
    assert.throws(
      () => validateDockerEnv(env.replace("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false", "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true")),
      /本机回环/,
    );
  });

  void it("正确的 Prisma URL 可使用且禁止远程或历史数据库", () => {
    const valid = env + "SCADA_DATABASE_URL=postgresql://adui_scada:sample@127.0.0.1:15433/adui_scada?schema=public\n";
    assert.equal(validateDockerEnv(valid), true);
    assert.throws(() => validateDockerEnv(valid.replace(":15433/", ":15432/")), /全新的本机/);
    assert.throws(() => validateDockerEnv(valid.replace("127.0.0.1:15433", "remote.example:15433")), /全新的本机/);
  });

  void it("预检不依赖任何旧存储卷，也不执行删除", () => {
    const { run, calls } = mockDocker();
    assert.match(manageDockerStack("plan", env, run), /全新安装预检通过/);
    assert.equal(calls.some((args) => args[0] === "volume"), false);
    assert.equal(calls.some((args) => args.includes("rm") || args.includes("down")), false);
  });

  void it("检测到残留旧容器时拒绝自动清理", () => {
    const { run, calls } = mockDocker({ legacy: true });
    assert.throws(() => manageDockerStack("up", env, run), /禁止自动清理/);
    assert.equal(calls.some((args) => args.includes("up")), false);
  });

  void it("Compose 无效时不启动服务", () => {
    const { run, calls } = mockDocker({ badConfig: true });
    assert.throws(() => manageDockerStack("up", env, run), /Docker 执行失败/);
    assert.equal(calls.some((args) => args.includes("up")), false);
  });

  void it("全新安装使用唯一项目及 Compose，不传入卷删除参数", () => {
    const { run, calls } = mockDocker();
    assert.match(manageDockerStack("up", env, run), /一个 PostgreSQL/);
    const args = calls.at(-1);
    assert.deepEqual(args.slice(-3), ["up", "--build", "-d"]);
    assert.equal(args[2], "adui-scada");
    assert.ok(args.includes("deploy/docker/compose.yaml"));
    assert.equal(args.includes("--remove-orphans"), false);
    assert.equal(args.includes("-v"), false);
  });

  void it("日常停止、状态及日志只管理 adui-scada", () => {
    for (const mode of ["down", "ps", "logs"]) {
      const { run, calls } = mockDocker();
      assert.match(manageDockerStack(mode, env, run), /执行完成/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.[2], "adui-scada");
      assert.equal(calls[0]?.includes("-v"), false);
    }
  });

  void it("不支持迁移、清空及其他危险操作", () => {
    const { run, calls } = mockDocker();
    for (const mode of ["migrate", "reset", "prune"]) {
      assert.throws(() => manageDockerStack(mode, env, run), /不支持/);
    }
    assert.equal(calls.length, 0);
  });

  void it("唯一 Compose 有七个服务且只有一个 PostgreSQL", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    assert.match(source, /^name: adui-scada$/m);
    for (const service of ["web-react", "web-vue", "server", "demo", "postgres", "redis", "keycloak"]) {
      assert.ok(source.includes(`  ${service}:\n`));
    }
    assert.doesNotMatch(source, /postgres-dev:|legacy-db|external: true/);
    assert.equal((source.match(/^  postgres:$/gm) ?? []).length, 1);
  });

  void it("新存储卷由项目自身创建，不引用旧物理卷", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    assert.match(source, /^  postgres-data:$/m);
    assert.match(source, /^  redis-data:$/m);
    assert.doesNotMatch(source, /adui-scada-oidc-lab_lab-|adui-scada-postgres-dev_/);
  });

  void it("Keycloak 数据库与业务数据库在同一 PostgreSQL 实例中隔离", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    assert.ok(source.includes("POSTGRES_DB: adui_scada"));
    assert.ok(source.includes("POSTGRES_USER: adui_scada"));
    assert.ok(source.includes("jdbc:postgresql://postgres:5432/adui_scada_keycloak"));
  });
});
