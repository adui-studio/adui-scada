import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manageDockerStack, validateDockerEnv } from "./docker-stack.mjs";
import { hasOnlyNoStore } from "./docker-web-https-smoke.mjs";

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
  runningDatabaseReadOnlyVerified: true,
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
        stdout: options.probeInvalid
          ? "{}"
          : JSON.stringify({
              ...probeOutput,
              runningDatabaseReadOnlyVerified: !options.runningDatabaseMissing,
            }),
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
  const prepareBinding = (input) => {
    events.push("只读绑定准备");
    assert.deepEqual(input, probeInput);
    if (options.bindingFailed) throw new Error("模拟只读绑定不一致");
  };
  const httpsPorts = [];
  const verifyHttps = (ports) => {
    events.push("宿主 HTTPS 验证");
    httpsPorts.push(...ports);
    if (options.httpsFailed) throw new Error("模拟双端 HTTPS 验证失败");
  };
  return { run, calls, events, inputs, verifyDatabase, verifyHttps, httpsPorts, prepareBinding };
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
    const { run, calls, events, inputs, verifyDatabase, verifyHttps, httpsPorts, prepareBinding } =
      mockDocker();
    assert.match(
      manageDockerStack("up", env, run, verifyDatabase, verifyHttps, undefined, prepareBinding),
      /容器原生只读及双端 HTTP 验证通过/,
    );
    assert.deepEqual(events, [
      "基础设施启动",
      "严格数据库验证",
      "只读绑定准备",
      "应用启动",
      "容器烟测",
      "宿主 HTTPS 验证",
    ]);
    assert.deepEqual(httpsPorts, ["18480", "18481"]);
    const applications = calls.find((args) => args.includes("--build"));
    assert.ok(applications);
    assert.deepEqual(applications.slice(-4), ["server", "demo", "web-react", "web-vue"]);
    assert.equal(applications[2], "adui-scada");
    assert.ok(applications.includes("deploy/docker/compose.yaml"));
    assert.ok(applications.includes("--wait"));
    assert.ok(applications.includes("--no-deps"));
    assert.equal(
      calls.some((args) => args.includes("--remove-orphans") || args.includes("-v")),
      false,
    );
    assert.deepEqual(inputs, [JSON.stringify(probeInput)]);
    assert.equal(
      calls.some((args) => args.join(" ").includes(probeInput.password)),
      false,
    );
  });

  void it("数据库严格验证失败时不构建或启动应用也不执行初始化", () => {
    const { run, calls, events, verifyDatabase, verifyHttps, prepareBinding } = mockDocker({
      invalidDatabase: true,
    });
    assert.throws(
      () =>
        manageDockerStack("up", env, run, verifyDatabase, verifyHttps, undefined, prepareBinding),
      /数据库严格验证失败/,
    );
    assert.deepEqual(events, ["基础设施启动", "严格数据库验证"]);
    assert.equal(
      calls.some((args) => args.includes("--build") || args.includes("exec")),
      false,
    );
  });

  void it("只读绑定不一致时拒绝构建或启动应用且不触碰原有资源", () => {
    const { run, calls, events, verifyDatabase, verifyHttps, prepareBinding } = mockDocker({
      bindingFailed: true,
    });
    assert.throws(
      () =>
        manageDockerStack("up", env, run, verifyDatabase, verifyHttps, undefined, prepareBinding),
      /模拟只读绑定不一致/,
    );
    assert.deepEqual(events, ["基础设施启动", "严格数据库验证", "只读绑定准备"]);
    assert.equal(
      calls.some(
        (args) =>
          args.includes("--build") ||
          args.includes("exec") ||
          args.includes("down") ||
          args.includes("rm"),
      ),
      false,
    );
  });

  void it("容器烟测失败或标志不完整时不能报告启动验收通过", () => {
    for (const options of [
      { probeFailed: true },
      { probeInvalid: true },
      { runningDatabaseMissing: true },
    ]) {
      const { run, calls, events, verifyDatabase, verifyHttps, prepareBinding } =
        mockDocker(options);
      assert.throws(
        () =>
          manageDockerStack("up", env, run, verifyDatabase, verifyHttps, undefined, prepareBinding),
        /Docker 执行失败|容器原生数据库或双端 HTTP 验证失败/,
      );
      assert.deepEqual(events, [
        "基础设施启动",
        "严格数据库验证",
        "只读绑定准备",
        "应用启动",
        "容器烟测",
      ]);
      assert.equal(
        calls.some((args) => args.includes("down") || args.includes("rm")),
        false,
      );
    }
  });

  void it("HTTPS 端口允许根环境显式配置，但拒绝与任何发布端口冲突", () => {
    const configured = env + "SCADA_REACT_HTTPS_PORT=18482\nSCADA_VUE_HTTPS_PORT=18483\n";
    const { run, verifyDatabase, verifyHttps, httpsPorts, prepareBinding } = mockDocker();
    assert.match(
      manageDockerStack(
        "up",
        configured,
        run,
        verifyDatabase,
        verifyHttps,
        undefined,
        prepareBinding,
      ),
      /宿主 HTTPS 验证通过/,
    );
    assert.deepEqual(httpsPorts, ["18482", "18483"]);
    for (const port of ["18080", "18481", "18443", "15432", "0", "65536"]) {
      assert.throws(() => validateDockerEnv(env + "SCADA_REACT_HTTPS_PORT=" + port + "\n"), /端口/);
    }
  });

  void it("SSE 上游与代理重复禁止缓存指令仍合法，拒绝混入其他缓存策略", () => {
    assert.equal(hasOnlyNoStore("no-store"), true);
    assert.equal(hasOnlyNoStore("no-store, no-store"), true);
    assert.equal(hasOnlyNoStore("No-Store, NO-STORE"), true);
    for (const value of ["", "public", "no-store, public", "no-store, max-age=60"]) {
      assert.equal(hasOnlyNoStore(value), false);
    }
  });

  void it("宿主 HTTPS 探针失败时不报告成功且不自动清理现场", () => {
    const { run, calls, events, verifyDatabase, verifyHttps, prepareBinding } = mockDocker({
      httpsFailed: true,
    });
    assert.throws(
      () =>
        manageDockerStack("up", env, run, verifyDatabase, verifyHttps, undefined, prepareBinding),
      /双端 HTTPS 验证失败/,
    );
    assert.deepEqual(events, [
      "基础设施启动",
      "严格数据库验证",
      "只读绑定准备",
      "应用启动",
      "容器烟测",
      "宿主 HTTPS 验证",
    ]);
    assert.equal(
      calls.some((args) => args.includes("down") || args.includes("rm") || args.includes("-v")),
      false,
    );
  });

  void it("基础设施入口仅启动三项基础设施，不验证或启动业务应用", () => {
    const { run, calls, events, verifyDatabase, verifyHttps } = mockDocker();
    manageDockerStack("infra", env, run, verifyDatabase, verifyHttps);
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

  void it("Keycloak 探针只验证已启动的七服务，不触发应用启动、数据库或 Web 探针", () => {
    const { run, calls, events, verifyDatabase, verifyHttps } = mockDocker();
    const configured = env.replace(
      "SCADA_LAB_KEYCLOAK_PORT=18443",
      "SCADA_LAB_KEYCLOAK_PORT=18444",
    );
    let probeCalls = 0;
    const result = manageDockerStack(
      "oidc",
      configured,
      run,
      verifyDatabase,
      verifyHttps,
      (port, dockerRun, composeArgs) => {
        probeCalls += 1;
        assert.equal(port, "18444");
        assert.equal(dockerRun, run);
        assert.equal(composeArgs[2], "adui-scada");
        assert.ok(composeArgs.includes("deploy/docker/compose.yaml"));
        return "模拟 Keycloak 只读验证通过";
      },
    );
    assert.equal(result, "模拟 Keycloak 只读验证通过");
    assert.equal(probeCalls, 1);
    assert.deepEqual(events, []);
    assert.equal(calls.length, 4);
    assert.ok(calls[0]?.includes("config"));
    assert.equal(
      calls.slice(1).every((args) => args[0] === "ps"),
      true,
    );
  });

  void it("Keycloak 独立探针在配置不安全、旧容器或验证失败时不清理现场", () => {
    for (const options of [{ badConfig: true }, { legacy: true }]) {
      const { run, calls, events, verifyDatabase, verifyHttps } = mockDocker(options);
      assert.throws(
        () =>
          manageDockerStack("oidc", env, run, verifyDatabase, verifyHttps, () => {
            throw new Error("不应调用 Keycloak 探针");
          }),
        /Docker 执行失败|禁止自动清理/,
      );
      assert.deepEqual(events, []);
      assert.equal(
        calls.some((args) => args.includes("up") || args.includes("down") || args.includes("rm")),
        false,
      );
    }
    const { run, calls, events, verifyDatabase, verifyHttps } = mockDocker();
    assert.throws(
      () =>
        manageDockerStack("oidc", env, run, verifyDatabase, verifyHttps, () => {
          throw new Error("模拟 Keycloak 验证失败");
        }),
      /模拟 Keycloak 验证失败/,
    );
    assert.deepEqual(events, []);
    assert.equal(
      calls.some((args) => args.includes("up") || args.includes("down") || args.includes("rm")),
      false,
    );
  });

  void it("Keycloak 只读探针进入运行镜像但不启用正式认证或秘密环境", () => {
    const dockerfile = readFileSync(
      fileURLToPath(new URL("../deploy/docker/Dockerfile.server", import.meta.url)),
      "utf8",
    );
    assert.ok(
      dockerfile.includes(
        "container-oidc-discovery.mjs /workspace/apps/server/container-oidc-discovery.mjs",
      ),
    );
    assert.ok(dockerfile.includes('CMD ["node", "apps/server/dist/main.js"]'));
    const compose = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    const server = compose.slice(compose.indexOf("\n  server:"), compose.indexOf("\n  demo:"));
    assert.match(server, /SCADA_OIDC_ENABLED: "false"/);
    assert.doesNotMatch(
      server,
      /NODE_TLS_REJECT_UNAUTHORIZED|SCADA_OIDC_CLIENT_SECRET|SCADA_DATABASE_URL/,
    );
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

  void it("常驻容器只使用独立只读绑定且不开放 OIDC，原生烟测仍保留", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    const server = source.slice(source.indexOf("\n  server:"), source.indexOf("\n  demo:"));
    assert.match(server, /SCADA_OIDC_ENABLED: "false"/);
    assert.match(server, /SCADA_LOCAL_DEMO_API_ENABLED: "false"/);
    assert.match(server, /SCADA_DOCKER_DB_READONLY: "true"/);
    assert.ok(server.includes("source: ../../.local/docker-runtime/server-database.json"));
    assert.ok(server.includes("target: /run/secrets/adui-scada-server-database.json"));
    assert.match(server, /read_only: true/);
    assert.match(server, /create_host_path: false/);
    assert.ok(server.includes("/health/database"));
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

  void it("双端 HTTPS 只发布回环端口及只读证书文件，不开放受保护接口", () => {
    const compose = readFileSync(
      fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url)),
      "utf8",
    );
    assert.ok(compose.includes("127.0.0.1:${SCADA_REACT_HTTPS_PORT:-18480}:8443"));
    assert.ok(compose.includes("127.0.0.1:${SCADA_VUE_HTTPS_PORT:-18481}:8443"));
    const web = compose.slice(compose.indexOf("\n  web-react:"), compose.indexOf("\n  server:"));
    assert.equal((web.match(/localhost\.pem:ro/g) ?? []).length, 2);
    assert.equal((web.match(/localhost-key\.pem:ro/g) ?? []).length, 2);
    assert.doesNotMatch(web, /secrets\.env|SCADA_LAB_DB_PASSWORD|SCADA_LAB_CLIENT_SECRET/);
    const nginx = readFileSync(
      fileURLToPath(new URL("../deploy/docker/nginx.conf", import.meta.url)),
      "utf8",
    );
    assert.match(nginx, /listen 8080;/);
    assert.match(nginx, /listen 8443 ssl;/);
    assert.match(nginx, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
    assert.ok(nginx.includes("location ^~ /api/ { return 404; }"));
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
