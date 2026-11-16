import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeLabSecrets, prepareOidcLab, validateLabSecrets } from "./prepare-oidc-lab.mjs";

const example =
  [
    "SCADA_WEB_HOST=127.0.0.1",
    "SCADA_SERVER_HOST=127.0.0.1",
    "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false",
    "SCADA_LAB_KEYCLOAK_PORT=18443",
    "SCADA_LAB_POSTGRES_PORT=15433",
    "SCADA_LAB_REDIS_PORT=16379",
  ].join("\n") + "\n";

function withRoot(test) {
  const root = mkdtempSync(join(tmpdir(), "adui-scada-lab-"));
  try {
    writeFileSync(join(root, ".env"), example);
    return test(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void describe("唯一 ADui SCADA Docker 首次安装准备", () => {
  void it("生成高熵随机凭据且不使用公开默认口令", () => {
    const secret = makeLabSecrets();
    assert.equal(Object.keys(secret).length, 4);
    assert.equal(new Set(Object.values(secret)).size, 4);
    for (const value of Object.values(secret)) assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  });

  void it("首次准备只修改 Git 忽略的本机目录，不修改根环境文件", () => {
    withRoot((root) => {
      const result = prepareOidcLab(root, { ensureTls: () => {} });
      assert.equal(readFileSync(join(root, ".env"), "utf8"), example);
      assert.ok(existsSync(result.composeEnv));
      assert.equal(
        validateLabSecrets(readFileSync(join(root, ".local/docker/secrets.env"), "utf8"))
          .SCADA_LAB_CLIENT_SECRET.length,
        43,
      );
      assert.match(readFileSync(result.composeEnv, "utf8"), /SCADA_LAB_CERT_DIR=/);
    });
  });

  void it("重复准备保留所有既有凭据", () => {
    withRoot((root) => {
      prepareOidcLab(root, { ensureTls: () => {} });
      const file = join(root, ".local/docker/secrets.env");
      const before = readFileSync(file, "utf8");
      prepareOidcLab(root, {
        ensureTls: () => {},
        generateSecrets: () => {
          throw new Error("禁止重新生成凭据");
        },
      });
      assert.equal(readFileSync(file, "utf8"), before);
    });
  });

  void it("根目录未创建 .env 时明确拒绝", () => {
    const root = mkdtempSync(join(tmpdir(), "adui-scada-lab-"));
    try {
      assert.throws(
        () => prepareOidcLab(root, { ensureTls: () => {} }),
        /先将根目录 .env.example 复制为 .env/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("生产模式、公开监听、端口冲突与不安全 OIDC 模式均拒绝", () => {
    for (const diff of [
      "SCADA_WEB_HOST=0.0.0.0",
      "SCADA_SERVER_HOST=0.0.0.0",
      "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=true",
      "SCADA_LAB_REDIS_PORT=15433",
      "SCADA_LAB_KEYCLOAK_PORT=65536",
      "NODE_ENV=production",
    ]) {
      withRoot((root) => {
        const replace = diff.split("=")[0];
        const content =
          example
            .split("\n")
            .filter((line) => !line.startsWith(`${replace}=`))
            .join("\n") +
          "\n" +
          diff +
          "\n";
        writeFileSync(join(root, ".env"), content);
        assert.throws(
          () => prepareOidcLab(root, { ensureTls: () => {} }),
          /本机端口|端口不得重复|本机回环|禁止生产/,
        );
      });
    }
  });

  void it("已有凭据文件损坏时拒绝重置", () => {
    withRoot((root) => {
      prepareOidcLab(root, { ensureTls: () => {} });
      writeFileSync(join(root, ".local/docker/secrets.env"), "SCADA_LAB_DB_PASSWORD=错误\n");
      assert.throws(() => prepareOidcLab(root, { ensureTls: () => {} }), /拒绝自动重置/);
    });
  });
});
