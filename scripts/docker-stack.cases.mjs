import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manageDockerStack, validateDockerEnv } from "./docker-stack.mjs";

const base =
  [
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
    "SCADA_DB_NAME=adui_scada_oidc_lab",
    "SCADA_DB_USER=adui_scada_oidc_lab",
  ].join("\n") + "\n";

const legacy = [
  ["adui-scada-v01-demo", "web-react"],
  ["adui-scada-postgres-dev", "postgres"],
  ["adui-scada-oidc-lab", "keycloak"],
];

function fakeDocker(settings = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "volume" && settings.missingVolume) {
      return { status: 1, stdout: "" };
    }
    if (args.includes("config") && settings.invalidCompose) {
      return { status: 1, stdout: "" };
    }
    if (args[0] === "ps") {
      const match = legacy.find(([project]) =>
        args.includes(`label=com.docker.compose.project=${project}`),
      );
      return {
        status: 0,
        stdout: match && settings.legacy ? `id-${match[0]}\n` : "",
      };
    }
    if (args[0] === "inspect" && args.includes("{{.State.Running}}")) {
      return { status: 0, stdout: settings.stopped ? "false" : "true" };
    }
    if (args[0] === "inspect") {
      const project = legacy.find(([p]) => args.at(-1) === `id-${p}`);
      return {
        status: 0,
        stdout: JSON.stringify({
          "com.docker.compose.project": settings.unknownLabel ? "not-adui-scada" : project?.[0],
          "com.docker.compose.service": project?.[1],
        }),
      };
    }
    if (args[0] === "stop" && settings.stopFails) return { status: 1, stdout: "" };
    return { status: 0, stdout: "" };
  };
  return { calls, run };
}

void describe("单一 ADui SCADA Docker 项目安全回归", () => {
  void it("正常配置仅使用一个 PostgreSQL 端口", () => {
    assert.equal(validateDockerEnv(base), true);
  });

  void it("拒绝重复环境变量、错误端口和端口冲突", () => {
    assert.throws(() => validateDockerEnv(base + "SCADA_DB_PORT=15433\n"), /重复/);
    assert.throws(() => validateDockerEnv(base.replace("18443", "65536")), /端口/);
    assert.throws(() => validateDockerEnv(base.replace("16379", "15433")), /冲突/);
  });

  void it("拒绝公网监听与不安全 OIDC", () => {
    assert.throws(
      () => validateDockerEnv(base.replace("SCADA_WEB_HOST=127.0.0.1", "SCADA_WEB_HOST=0.0.0.0")),
      /可信本机/,
    );
    assert.throws(
      () =>
        validateDockerEnv(
          base.replace(
            "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
            "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true",
          ),
        ),
      /可信本机/,
    );
  });

  void it("拒绝旧开发库端口与业务数据库名称漂移", () => {
    assert.throws(
      () => validateDockerEnv(base.replace("SCADA_DB_PORT=15433", "SCADA_DB_PORT=15432")),
      /唯一/,
    );
    assert.throws(
      () =>
        validateDockerEnv(
          base.replace("SCADA_DB_NAME=adui_scada_oidc_lab", "SCADA_DB_NAME=adui_scada"),
        ),
      /唯一/,
    );
  });

  void it("已有 Prisma URL 必须精确指向现存隔离数据库", () => {
    const good =
      base +
      "SCADA_DATABASE_URL=postgresql://adui_scada_oidc_lab:test@127.0.0.1:15433/adui_scada_oidc_lab?schema=public\n";
    assert.equal(validateDockerEnv(good), true);
    assert.throws(() => validateDockerEnv(good.replace(":15433/", ":15432/")), /连接目标/);
    assert.throws(
      () => validateDockerEnv(good.replace("127.0.0.1:15433", "db.example.org:15433")),
      /连接目标/,
    );
  });

  void it("预检只读确认两份持久化卷与 Compose 配置", () => {
    const mock = fakeDocker();
    assert.match(manageDockerStack("plan", base, mock.run), /预检通过/);
    assert.equal(mock.calls.filter((args) => args[0] === "volume").length, 2);
    assert.equal(
      mock.calls.some((args) => args.at(-1) === "stop"),
      false,
    );
  });

  void it("旧项目存在时普通启动拒绝挂载数据库卷", () => {
    const mock = fakeDocker({ legacy: true });
    assert.throws(() => manageDockerStack("up", base, mock.run), /docker:migrate/);
    assert.equal(
      mock.calls.some((args) => args.includes("up")),
      false,
    );
  });

  void it("迁移只停止已核验的三个旧项目容器，不清除卷", () => {
    const mock = fakeDocker({ legacy: true });
    assert.match(manageDockerStack("migrate", base, mock.run), /单 Compose 项目/);
    assert.equal(mock.calls.filter((args) => args[0] === "stop").length, 3);
    assert.equal(mock.calls.filter((args) => args[0] === "rm").length, 3);
    assert.equal(
      mock.calls.some(
        (args) => args.includes("-v") || (args.includes("volume") && args.includes("rm")),
      ),
      false,
    );
    assert.deepEqual(mock.calls.at(-1)?.slice(-4), ["up", "--build", "--remove-orphans", "-d"]);
  });

  void it("已停止的旧容器直接删除，不重复执行 docker stop", () => {
    const mock = fakeDocker({ legacy: true, stopped: true });
    assert.match(manageDockerStack("migrate", base, mock.run), /已启动/);
    assert.equal(mock.calls.filter((args) => args[0] === "stop").length, 0);
    assert.equal(mock.calls.filter((args) => args[0] === "rm").length, 3);
  });

  void it("旧容器标签不可信时立即阻止迁移", () => {
    const mock = fakeDocker({ legacy: true, unknownLabel: true });
    assert.throws(() => manageDockerStack("migrate", base, mock.run), /未知容器/);
    assert.equal(
      mock.calls.some((args) => args[0] === "stop"),
      false,
    );
  });

  void it("旧卷缺失时不能停止容器或初始化空白 Keycloak", () => {
    const mock = fakeDocker({ legacy: true, missingVolume: true });
    assert.throws(() => manageDockerStack("migrate", base, mock.run), /数据卷缺失/);
    assert.equal(
      mock.calls.some((args) => args[0] === "stop"),
      false,
    );
  });

  void it("Compose 配置无效时旧项目保持运行", () => {
    const mock = fakeDocker({ legacy: true, invalidCompose: true });
    assert.throws(() => manageDockerStack("migrate", base, mock.run), /Docker 命令执行失败/);
    assert.equal(
      mock.calls.some((args) => args[0] === "stop"),
      false,
    );
  });

  void it("旧容器停止失败时不删除容器也不启动新项目", () => {
    const mock = fakeDocker({ legacy: true, stopFails: true });
    assert.throws(() => manageDockerStack("migrate", base, mock.run), /Docker 命令执行失败/);
    assert.equal(
      mock.calls.some((args) => args[0] === "rm"),
      false,
    );
    assert.equal(
      mock.calls.some((args) => args.includes("up")),
      false,
    );
  });

  void it("日常启动仅使用最新 Compose 且清理同项目孤立容器", () => {
    const mock = fakeDocker();
    assert.match(manageDockerStack("up", base, mock.run), /已启动/);
    assert.equal(mock.calls.at(-1)?.includes("deploy/docker/compose.yaml"), true);
    assert.equal(mock.calls.at(-1)?.includes("--remove-orphans"), true);
    assert.equal(mock.calls.at(-1)?.includes("--profile"), false);
  });

  void it("查询、日志和停止仅操作 adui-scada 项目", () => {
    for (const action of ["down", "ps", "logs"]) {
      const mock = fakeDocker();
      assert.match(manageDockerStack(action, base, mock.run), /命令已执行/);
      assert.equal(mock.calls.length, 1);
      assert.equal(mock.calls[0]?.[2], "adui-scada");
      assert.equal(mock.calls[0]?.includes("-v"), false);
    }
  });

  void it("非法动作不会调用 Docker", () => {
    const mock = fakeDocker();
    assert.throws(() => manageDockerStack("prune", base, mock.run), /不支持/);
    assert.equal(mock.calls.length, 0);
  });

  void it("仓库只保留七服务的唯一 Compose 文件", () => {
    const path = fileURLToPath(new URL("../deploy/docker/compose.yaml", import.meta.url));
    const compose = readFileSync(path, "utf8");
    assert.match(compose, /^name: adui-scada$/m);
    for (const service of [
      "web-react",
      "web-vue",
      "server",
      "demo",
      "postgres",
      "redis",
      "keycloak",
    ]) {
      assert.ok(compose.includes(`  ${service}:\n`));
    }
    assert.doesNotMatch(compose, /^  postgres-dev:/m);
    assert.doesNotMatch(compose, /legacy-db/);
    assert.ok(compose.includes("jdbc:postgresql://postgres:5432/adui_scada_keycloak_lab"));
    assert.equal((compose.match(/^    external: true$/gm) || []).length, 2);
  });
});
