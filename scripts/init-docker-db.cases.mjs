import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createDockerDatabaseUrl } from "./init-docker-db.mjs";
import { makeLabSecrets } from "./prepare-oidc-lab.mjs";

const env = [
  "SCADA_WEB_HOST=127.0.0.1",
  "SCADA_SERVER_HOST=127.0.0.1",
  "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
  "SCADA_DB_HOST=127.0.0.1",
  "SCADA_DB_PORT=15433",
  "SCADA_DB_NAME=adui_scada",
  "SCADA_DB_USER=adui_scada",
  "SCADA_LAB_POSTGRES_PORT=15433",
  "SCADA_LAB_REDIS_PORT=16379",
  "SCADA_LAB_KEYCLOAK_PORT=18443",
].join("\n") + "\n";
const secrets = Object.entries(makeLabSecrets()).map(([name, value]) => `${name}=${value}`).join("\n") + "\n";

void describe("本机 Docker 首次 Prisma 迁移连接保护", () => {
  void it("只生成新的本机 adui_scada 连接地址", () => {
    const url = new URL(createDockerDatabaseUrl(env, secrets));
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "15433");
    assert.equal(url.pathname, "/adui_scada");
    assert.equal(url.username, "adui_scada");
    assert.equal(url.searchParams.get("schema"), "public");
    assert.ok(url.password.length > 20);
  });

  void it("拒绝旧数据库名称或账号", () => {
    assert.throws(
      () => createDockerDatabaseUrl(env.replace("SCADA_DB_NAME=adui_scada", "SCADA_DB_NAME=adui_scada_oidc_lab"), secrets),
      /禁止连接历史数据库/,
    );
    assert.throws(
      () => createDockerDatabaseUrl(env.replace("SCADA_DB_USER=adui_scada", "SCADA_DB_USER=postgres"), secrets),
      /禁止连接历史数据库/,
    );
  });

  void it("拒绝缺失或损坏的随机密码文件", () => {
    assert.throws(() => createDockerDatabaseUrl(env, ""), /不完整/);
    assert.throws(
      () => createDockerDatabaseUrl(env, "SCADA_LAB_DB_PASSWORD=123\n"),
      /不完整/,
    );
  });

  void it("本机密码永不作为 URL 查询参数泄露", () => {
    const url = new URL(createDockerDatabaseUrl(env, secrets));
    assert.deepEqual([...url.searchParams.keys()], ["schema"]);
    assert.equal(url.searchParams.has("password"), false);
  });

  void it("拒绝不可信的远程或不安全配置", () => {
    assert.throws(
      () => createDockerDatabaseUrl(env.replace("SCADA_SERVER_HOST=127.0.0.1", "SCADA_SERVER_HOST=0.0.0.0"), secrets),
      /回环/,
    );
    assert.throws(
      () => createDockerDatabaseUrl(env.replace("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false", "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true"), secrets),
      /回环/,
    );
  });
});
