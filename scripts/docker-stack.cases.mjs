import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manageDockerStack, validateDockerEnv } from "./docker-stack.mjs";

const env =
  [
    "SCADA_WEB_HOST=127.0.0.1",
    "SCADA_SERVER_HOST=127.0.0.1",
    "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
    "SCADA_REACT_PORT=18080",
    "SCADA_VUE_PORT=18081",
    "SCADA_LAB_POSTGRES_PORT=15432",
    "SCADA_LAB_REDIS_PORT=16379",
    "SCADA_LAB_KEYCLOAK_PORT=18443",
    "SCADA_DB_HOST=127.0.0.1",
    "SCADA_DB_PORT=15432",
    "SCADA_DB_NAME=adui_scada",
    "SCADA_DB_USER=adui_scada",
  ].join("\n") + "\n";

const probeInput = {
  password: "a".repeat(43),
  systemIdentifier: "123456789",
  storageHash: "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436",
};
const probeOutput = {
  status: "DOCKER_NATIVE_PROVIDER_READY",
  providerReady: true,
  providerClosed: true,
  readOnlyBoundaryVerified: true,
  authorizationReadVerified: true,
  sessionReadVerified: true,
  identityWriteDenied: true,
  oidcDiscoverySkipped: true,
  projectListReadVerified: true,
  projectLockedReadDenied: true,
  projectWriteDenied: true,
  releaseLockedReadDenied: true,
  releaseWriteDenied: true,
  rollbackWriteDenied: true,
  missingProjectDenied: true,
  nativeRootAssemblyVerified: true,
  singleNativeProviderVerified: true,
  legacyProviderAbsent: true,
  providerSwitched: true,
  reactHttpVerified: true,
  vueHttpVerified: true,
};

function mockDocker(options = {}) {
  const calls = [];
  const events = [];
  const inputs = [];
  const run = (args, _showOutput, input) => {
    calls.push(args);
    if (args.includes("up")) events.push(args.includes("--build") ? "应用启动" : "基础设施启动");
    if (args.includes("exec")) {
      events.push("容器烟测");
      inputs.push(input);
      return {
        status: options.probeFailed ? 1 : 0,
        stdout: options.probeInvalid ? "{}" : JSON.stringify(probeOutput),
      };
    }
    if (args.includes("config") && options.badConfig) return { status: 1, stdout: "" };
    if (args[0] === "ps" && options.legacy) return { status: 0, stdout: "old-id\n" };
    return { status: 0, stdout: "" };
  };
  const verifyDatabase = () => {
    events.push("严格数据库验证");
    if (options.invalidDatabase) throw new Error("模拟数据库严格验证失败");
    return probeInput;
  };
  return { run, calls, events, inputs, verifyDatabase };
}

void describe("ADui SCADA 全新单项目 Docker 安全测试", () => {
  void it("允许受控本机业务数据库 adui_scada", () => {
    assert.equal(validateDockerEnv(env), true);
  });

  void it("拒绝旧数据库、旧账号和非当前数据库端口", () => {
    for (const invalid of [
      env.replace("SCADA_DB_NAME=adui_scada", "SCADA_DB_NAME=adui_scada_oidc_lab"),
      env.replace("SCADA_DB_USER=adui_scada", "SCADA_DB_USER=adui_scada_oidc_lab"),
      env.replace("SCADA_DB_PORT=15432", "SCADA_DB_PORT=15433"),
    ])
      assert.throws(() => validateDockerEnv(invalid), /禁止连接历史数据库/);
  });

  void it("拒绝重复环境变量及冲突端口", () => {
    assert.throws(() => validateDockerEnv(env + "SCADA_DB_NAME=adui_scada\n"), /重复/);
    assert.throws(() => validateDockerEnv(env.replace("16379", "15432")), /端口/);
  });

  void it("拒绝公网监听及不安全 OIDC 模式", () => {
    assert.throws(
      () => validateDockerEnv(env.replace("SCADA_WEB_HOST=127.0.0.1", "SCADA_WEB_HOST=0.0.0.0")),
      /本机回环/,
    );
    assert.throws(
      () =>
        validateDockerEnv(
          env.replace(
            "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
            "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true",
          ),
        ),
      /本机回环/,
    );
  });

  void it("正确的 Prisma URL 可使用且禁止远程或历史数据库", () => {
    const valid =
      env +
      "SCADA_DATABASE_URL=postgresql://adui_scada:sample@127.0.0.1:15432/adui_scada?schema=public\n";
    assert.equal(validateDockerEnv(valid), true);
    assert.throws(() => validateDockerEnv(valid.replace(":15432/", ":15433/")), /全新的本机/);
    assert.throws(
      () => validateDockerEnv(valid.replace("127.0.0.1:15432", "remote.example:15432")),
      /全新的本机/,
    );
  });

  void it("预检不依赖任何旧存储卷，也不执行删除", () => {
    const { run, calls } = mockDocker();
    assert.match(manageDockerStack("plan", env, run), /全新安装预检通过/);
    assert.equal(
      calls.some((args) => args[0] === "volume"),
      false,
    );
    assert.equal(
      calls.some((args) => args.includes("rm") || args.includes("down")),
      false,
    );
  });

  void it("检测到残留旧容器时拒绝自动清理", () => {
    const { run, calls } = mockDocker({ legacy: true });
    assert.throws(() => manageDockerStack("up", env, run), /禁止自动清理/);
    assert.equal(
      calls.some((args) => args.includes("up")),
      false,
    );
  });

  void it("Compose 无效时不启动服务", () => {
    const { run, calls } = mockDocker({ badConfig: true });
    assert.throws(() => manageDockerStack("up", env, run), /Docker 执行失败/);
    assert.equal(
      calls.some((args) => args.includes("up")),
      false,
    );
  });

  void it("七服务一键启动先验证原生数据库再构建应用并执行容器烟测", () => {
    const { run, calls, events, inputs, verifyDatabase } = mockDocker();
    assert.match(manageDockerStack("up", env, run, verifyDatabase), /容器原生只读及双端 HTTP 验证通过/);
    assert.deepEqual(events, ["基础设施启动", "严格数据库验证", "应用启动", "容器烟测"]);
    const applications = calls.find((args) => args.includes("--build"));
    assert.ok(applications);
    assert.deepEqual(applications.slice(-4), ["server", "demo", "web-react", "web-vue"]);
    assert.equal(applications[2], "adui-scada");
    assert.ok(applications.includes("deploy/docker/compose.yaml"));
    assert.ok(applications.includes("--wait"));
    assert.ok(applications.includes("--no-deps"));
    assert.equal(calls.some((args) => args.includes("--remove-orphans") || args.includes("-v")), false);
    assert.deepEqual(inputs, [JSON.stringify(probeInput)]);
    assert.equal(calls.some((args) => args.join(" ").includes(probeInput.password)), false);
  });

  void it("数据库严格验证失败时不构建或启动应用也不执行初始化", () => {
    const { run, calls, events, verifyDatabase } = mockDocker({ invalidDatabase: true });
    assert.throws(() => manageDockerStack("up", env, run, verifyDatabase), /数据库严格验证失败/);
    assert.deepEqual(events, ["基础设施启动", "严格数据库验证"]);
    assert.equal(calls.some((args) => args.includes("--build") || args.includes("exec")), false);
  });

  void it("容器烟测失败或标志不完整时不能报告启动验收通过", () => {
    for (const options of [{ probeFailed: true }, { probeInvalid: true }]) {
      const { run, calls, events, verifyDatabase } = mockDocker(options);
      assert.throws(
        () => manageDockerStack("up", env, run, verifyDatabase),
        /Docker 执行失败|容器原生数据库或双端 HTTP 验证失败/,
      );
      assert.deepEqual(events, ["基础设施启动", "严格数据库验证", "应用启动", "容器烟测"]);
      assert.equal(calls.some((args) => args.includes("down") || args.includes("rm")), false);
    }
  });

  void it("基础设施入口仅启动三项基础设施，不验证或启动业务应用", () => {
    const { run, calls, events, verifyDatabase } = mockDocker();
    manageDockerStack("infra", env, run, verifyDatabase);
    assert.deepEqual(events, ["基础设施启动"]);
    const args = calls.find((call) => call.includes("up"));
    assert.ok(args);
    assert.deepEqual(args.slice(-10), [
      "up",
      "-d",
      "--pull",
      "never",
      "--wait",
      "--wait-timeout",
      "180",
      "postgres",
      "redis",
      "keycloak",
    ]);
    assert.equal(args.includes("--build"), false);
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
    for (const service of [
      "web-react",
      "web-vue",
      "server",
      "demo",
      "postgres",
      "redis",
      "keycloak",
    ]) {
      assert.ok(source.includes(`  ${service}:\n`));
    }
    assert.doesNotMatch(source, /postgres-dev:|legacy-db|external: true/);
    assert.equal((source.match(/^  postgres:$/gm) ?? []).length, 1);
  });

  void it("默认容器 HTTP 不开放 OIDC，原生只读探针独立复制到运行镜像", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    const server = source.slice(source.indexOf("\n  server:"), source.indexOf("\n  demo:"));
    assert.match(server, /SCADA_OIDC_ENABLED: "false"/);
    assert.match(server, /SCADA_LOCAL_DEMO_API_ENABLED: "false"/);
    assert.match(server, /networks:\s*\n\s*- app[\s\S]*\n\s*- lab/);
    assert.doesNotMatch(server, /SCADA_DATABASE_URL|SCADA_LAB_DB_PASSWORD|ports:/);
    const dockerfile = readFileSync(
      fileURLToPath(new URL("../deploy/docker/Dockerfile.server", import.meta.url)),
      "utf8",
    );
    assert.match(dockerfile, /container-prisma8-smoke\.mjs/);
    assert.match(dockerfile, /prisma8-provider-smoke\.mjs/);
    assert.match(dockerfile, /prisma8-fresh-runtime-probe\.mjs/);
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
