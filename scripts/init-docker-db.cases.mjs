import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  createDockerDatabaseUrl,
  createDockerPrismaEnvironment,
  resolveDockerPrismaAction,
} from "./init-docker-db.mjs";
import { makeLabSecrets } from "./prepare-oidc-lab.mjs";

const env =
  [
    "SCADA_WEB_HOST=127.0.0.1",
    "SCADA_SERVER_HOST=127.0.0.1",
    "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
    "SCADA_DB_HOST=127.0.0.1",
    "SCADA_DB_PORT=15432",
    "SCADA_DB_NAME=adui_scada",
    "SCADA_DB_USER=adui_scada",
    "SCADA_LAB_POSTGRES_PORT=15432",
    "SCADA_LAB_REDIS_PORT=16379",
    "SCADA_LAB_KEYCLOAK_PORT=18443",
  ].join("\n") + "\n";
const secrets =
  Object.entries(makeLabSecrets())
    .map(([name, value]) => `${name}=${value}`)
    .join("\n") + "\n";

void describe("本机 Docker 首次 Prisma 迁移连接保护", () => {
  void it("只生成新的本机 adui_scada 连接地址", () => {
    const url = new URL(createDockerDatabaseUrl(env, secrets));
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "15432");
    assert.equal(url.pathname, "/adui_scada");
    assert.equal(url.username, "adui_scada");
    assert.equal(url.searchParams.get("schema"), "public");
    assert.ok(url.password.length > 20);
  });

  void it("拒绝旧数据库名称或账号", () => {
    assert.throws(
      () =>
        createDockerDatabaseUrl(
          env.replace("SCADA_DB_NAME=adui_scada", "SCADA_DB_NAME=adui_scada_oidc_lab"),
          secrets,
        ),
      /禁止连接历史数据库/,
    );
    assert.throws(
      () =>
        createDockerDatabaseUrl(
          env.replace("SCADA_DB_USER=adui_scada", "SCADA_DB_USER=postgres"),
          secrets,
        ),
      /禁止连接历史数据库/,
    );
  });

  void it("拒绝缺失或损坏的随机密码文件", () => {
    assert.throws(() => createDockerDatabaseUrl(env, ""), /不完整/);
    assert.throws(() => createDockerDatabaseUrl(env, "SCADA_LAB_DB_PASSWORD=123\n"), /不完整/);
  });

  void it("本机密码永不作为 URL 查询参数泄露", () => {
    const url = new URL(createDockerDatabaseUrl(env, secrets));
    assert.deepEqual([...url.searchParams.keys()], ["schema"]);
    assert.equal(url.searchParams.has("password"), false);
  });

  void it("Docker 状态查询只允许固定的只读 Prisma 命令", () => {
    assert.equal(resolveDockerPrismaAction([]), "deploy");
    assert.equal(resolveDockerPrismaAction(["--status"]), "status");
    for (const args of [["--reset"], ["--status", "--force"], ["migrate", "dev"]]) {
      assert.throws(() => resolveDockerPrismaAction(args), /仅支持迁移部署或只读状态查询/);
    }
  });

  void it("状态查询使用 Docker 随机密码覆盖过期的根环境变量", () => {
    const stale = {
      SCADA_DATABASE_URL: "postgresql://adui_scada:invalid@127.0.0.1:15432/adui_scada",
      SCADA_DB_PASSWORD: "invalid",
      NODE_ENV: "production",
    };
    const actual = createDockerPrismaEnvironment(env, secrets, stale);
    const connection = new URL(actual.SCADA_DATABASE_URL);
    assert.equal(connection.hostname, "127.0.0.1");
    assert.equal(connection.port, "15432");
    assert.equal(connection.pathname, "/adui_scada");
    assert.equal(actual.SCADA_DB_USER, "adui_scada");
    assert.equal(actual.SCADA_DB_PASSWORD, connection.password);
    assert.notEqual(actual.SCADA_DB_PASSWORD, stale.SCADA_DB_PASSWORD);
    assert.equal(actual.NODE_ENV, "development");
    assert.equal(stale.SCADA_DB_PASSWORD, "invalid");
  });

  void it("根目录存在旧密码和 URL 时仍以 Docker 凭据为准", () => {
    const configured =
      env +
      "SCADA_DB_PASSWORD=old_local_password\n" +
      "SCADA_DATABASE_URL=postgresql://adui_scada:old_local_password@127.0.0.1:15432/adui_scada?schema=public\n";
    const actual = createDockerPrismaEnvironment(configured, secrets);
    assert.equal(
      actual.SCADA_DATABASE_URL,
      createDockerDatabaseUrl(configured, secrets),
    );
    assert.notEqual(actual.SCADA_DB_PASSWORD, "old_local_password");
  });

  void it("状态查询仍拒绝连接到旧库或不可信远程地址", () => {
    assert.throws(
      () =>
        createDockerPrismaEnvironment(
          env.replace("SCADA_DB_NAME=adui_scada", "SCADA_DB_NAME=old_database"),
          secrets,
        ),
      /禁止连接历史数据库/,
    );
    assert.throws(
      () =>
        createDockerPrismaEnvironment(
          env.replace("SCADA_DB_HOST=127.0.0.1", "SCADA_DB_HOST=example.invalid"),
          secrets,
        ),
      /禁止连接历史数据库/,
    );
  });

  void it("拒绝不可信的远程或不安全配置", () => {
    assert.throws(
      () =>
        createDockerDatabaseUrl(
          env.replace("SCADA_SERVER_HOST=127.0.0.1", "SCADA_SERVER_HOST=0.0.0.0"),
          secrets,
        ),
      /回环/,
    );
    assert.throws(
      () =>
        createDockerDatabaseUrl(
          env.replace(
            "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
            "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true",
          ),
          secrets,
        ),
      /回环/,
    );
  });
});
