import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  describeLabIdentityFailure,
  parseLabIdentityArgs,
  reconcileLabIdentity,
  resolveLabIdentityTarget,
  runLabIdentityBinding,
} from "./oidc-lab-identity.mjs";

const KEYCLOAK_SUB = "12b379f1-1b7c-4d64-89e7-51c7bcb9e701";
const baseArguments = [
  "--tenant",
  "lab-tenant",
  "--subject",
  "lab-engineer",
  "--keycloak-sub",
  KEYCLOAK_SUB,
];
const applyArguments = [...baseArguments, "--apply", "--confirm-lab", "adui_scada_oidc_lab"];
const env = () => ({
  NODE_ENV: "development",
  SCADA_WEB_HOST: "127.0.0.1",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_SERVER_PORT: "13001",
  SCADA_REACT_DEV_PORT: "15173",
  SCADA_VUE_DEV_PORT: "15174",
  SCADA_OIDC_ENABLED: "true",
  SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
  SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
  SCADA_OIDC_REDIRECT_URI: "https://127.0.0.1:15173/api/v1/auth/oidc/callback",
  SCADA_OIDC_WEB_ORIGINS: "https://127.0.0.1:15173,https://127.0.0.1:15174",
  SCADA_OIDC_ISSUER: "https://127.0.0.1:18443/realms/adui-scada",
  SCADA_LAB_KEYCLOAK_PORT: "18443",
  SCADA_LAB_POSTGRES_PORT: "15433",
  SCADA_DB_HOST: "127.0.0.1",
  SCADA_DB_PORT: "15433",
  SCADA_DB_NAME: "adui_scada_oidc_lab",
  SCADA_DB_USER: "adui_scada_oidc_lab",
  SCADA_DATABASE_URL:
    "postgresql://adui_scada_oidc_lab:temporary-test-only@127.0.0.1:15433/adui_scada_oidc_lab?schema=public",
});

function fakeDatabase(options = {}) {
  const calls = [];
  const state = { connected: false, ended: false };
  const client = {
    async connect() {
      state.connected = true;
    },
    async end() {
      state.ended = true;
    },
    async query(query, params = []) {
      calls.push({ query, params });
      if (options.failOn && query.includes(options.failOn)) {
        throw new Error("模拟数据库异常，不能原样输出敏感参数");
      }
      if (query.includes('public."_prisma_migrations"')) {
        return { rows: options.noMigration ? [] : [{ "?column?": 1 }] };
      }
      if (query.includes("FROM public.scada_external_identities WHERE issuer")) {
        return {
          rows: options.external === undefined ? [] : [options.external],
        };
      }
      if (query.includes("FROM public.scada_identities WHERE tenant_id")) {
        return {
          rows: options.status === undefined ? [] : [{ status: options.status }],
        };
      }
      if (query.includes("FROM public.scada_external_identities WHERE tenant_id")) {
        return { rows: options.otherExternal ? [{ "?column?": 1 }] : [] };
      }
      if (query.includes("FROM public.scada_project_grants WHERE tenant_id")) {
        return { rows: options.granted ? [{ "?column?": 1 }] : [] };
      }
      return { rows: [] };
    },
  };
  return {
    calls,
    state,
    client,
    Client: class {
      constructor() {
        return client;
      }
    },
  };
}

void describe("OIDC Lab 手动身份预绑定安全门禁", () => {
  void it("未显式申请写入时只解析为预览", () => {
    const parsed = parseLabIdentityArgs(baseArguments);
    assert.equal(parsed.apply, false);
    assert.equal(parsed.tenantId, "lab-tenant");
    assert.equal(parsed.subjectId, "lab-engineer");
    assert.equal(parsed.keycloakSub, KEYCLOAK_SUB);
  });

  void it("执行写入必须明确确认独立数据库名称", () => {
    assert.equal(parseLabIdentityArgs(applyArguments).apply, true);
    assert.throws(() => parseLabIdentityArgs([...baseArguments, "--apply"]), /必须明确确认/);
    assert.throws(
      () => parseLabIdentityArgs([...baseArguments, "--confirm-lab", "adui_scada_oidc_lab"]),
      /只读预览不能/,
    );
  });

  void it("拒绝未知、重复及不完整的命令参数", () => {
    assert.throws(() => parseLabIdentityArgs([...baseArguments, "--bad"]), /未知选项/);
    assert.throws(() => parseLabIdentityArgs([...baseArguments, "--tenant", "changed"]), /重复/);
    assert.throws(() => parseLabIdentityArgs(["--tenant", "lab-tenant"]), /必须明确指定/);
  });

  void it("拒绝不可信本地主体、伪造邮箱及非 UUID 外部主体", () => {
    assert.throws(
      () =>
        parseLabIdentityArgs([
          "--tenant",
          "../admin",
          "--subject",
          "a",
          "--keycloak-sub",
          KEYCLOAK_SUB,
        ]),
      /本地租户/,
    );
    assert.throws(
      () =>
        parseLabIdentityArgs([
          "--tenant",
          "lab-tenant",
          "--subject",
          "lab-engineer",
          "--keycloak-sub",
          "user@example.com",
        ]),
      /UUID/,
    );
  });

  void it("只接受 HTTPS OIDC Lab 的固定本机数据库、Realm 和双 Web Origin", () => {
    const target = resolveLabIdentityTarget(env());
    assert.equal(target.issuer, "https://127.0.0.1:18443/realms/adui-scada");
    assert.equal(new URL(target.connectionString).pathname, "/adui_scada_oidc_lab");
  });

  void it("拒绝生产、TLS 验证关闭、不安全模式与普通数据库", () => {
    for (const diff of [
      { NODE_ENV: "production" },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true" },
      { SCADA_OIDC_ENABLED: "false" },
      { SCADA_DATABASE_URL: "postgresql://user:pass@127.0.0.1:15433/adui_scada?schema=public" },
      {
        SCADA_DATABASE_URL:
          "postgresql://user:pass@example.org:15433/adui_scada_oidc_lab?schema=public",
      },
    ]) {
      assert.throws(() => resolveLabIdentityTarget({ ...env(), ...diff }), /仅允许|数据库连接/);
    }
  });

  void it("拒绝错误的 Keycloak Realm 与不匹配的数据库端口", () => {
    assert.throws(
      () =>
        resolveLabIdentityTarget({
          ...env(),
          SCADA_OIDC_ISSUER: "https://id.example.org/realms/adui-scada",
        }),
      /Issuer/,
    );
    assert.throws(
      () => resolveLabIdentityTarget({ ...env(), SCADA_DB_PORT: "15432" }),
      /数据库连接/,
    );
  });

  void it("隔离数据库未完成 OIDC 迁移时拒绝预览和写入", async () => {
    const fake = fakeDatabase({ noMigration: true });
    await assert.rejects(
      () =>
        reconcileLabIdentity(
          fake.client,
          resolveLabIdentityTarget(env()),
          parseLabIdentityArgs(applyArguments),
        ),
      /缺少已完成/,
    );
    assert.equal(
      fake.calls.some((call) => call.query === "ROLLBACK"),
      true,
    );
    assert.equal(
      fake.calls.some((call) => call.query.includes("INSERT")),
      false,
    );
  });

  void it("默认预览只读核对且总是回滚", async () => {
    const fake = fakeDatabase();
    const result = await reconcileLabIdentity(
      fake.client,
      resolveLabIdentityTarget(env()),
      parseLabIdentityArgs(baseArguments),
    );
    assert.match(result, /只读预览/);
    assert.equal(
      fake.calls.some((call) => call.query === "ROLLBACK"),
      true,
    );
    assert.equal(
      fake.calls.some((call) => call.query.includes("INSERT")),
      false,
    );
    assert.equal(
      fake.calls.some((call) => call.query === "COMMIT"),
      false,
    );
  });

  void it("明确申请写入时只新增可信主体和外部映射，不写工程授权", async () => {
    const fake = fakeDatabase();
    const result = await reconcileLabIdentity(
      fake.client,
      resolveLabIdentityTarget(env()),
      parseLabIdentityArgs(applyArguments),
    );
    assert.match(result, /未授予任何工程权限/);
    assert.equal(fake.calls.filter((call) => call.query.startsWith("INSERT")).length, 2);
    assert.equal(
      fake.calls.some(
        (call) =>
          call.query.includes("status, updated_at") && call.query.includes("CURRENT_TIMESTAMP"),
      ),
      true,
    );
    assert.equal(
      fake.calls.some((call) => call.query === "COMMIT"),
      true,
    );
    assert.equal(
      fake.calls.some((call) => call.query.includes("INSERT INTO public.scada_project_grants")),
      false,
    );
    const externalInsert = fake.calls.find((call) =>
      call.query.startsWith("INSERT INTO public.scada_external_identities"),
    );
    assert.deepEqual(externalInsert?.params, [
      "https://127.0.0.1:18443/realms/adui-scada",
      KEYCLOAK_SUB,
      "lab-tenant",
      "lab-engineer",
    ]);
  });

  void it("重复预绑定同一主体保持幂等且不新增记录", async () => {
    const fake = fakeDatabase({
      external: { tenant_id: "lab-tenant", subject_id: "lab-engineer" },
      status: "active",
    });
    const result = await reconcileLabIdentity(
      fake.client,
      resolveLabIdentityTarget(env()),
      parseLabIdentityArgs(applyArguments),
    );
    assert.match(result, /未新增记录/);
    assert.equal(
      fake.calls.some((call) => call.query.startsWith("INSERT")),
      false,
    );
  });

  void it("拒绝重绑定、停用身份、已有其他外部身份与已有工程 ACL", async () => {
    const scenarios = [
      { external: { tenant_id: "another", subject_id: "lab-engineer" } },
      { status: "disabled" },
      { otherExternal: true },
      { granted: true },
    ];
    for (const scenario of scenarios) {
      const fake = fakeDatabase(scenario);
      await assert.rejects(
        () =>
          reconcileLabIdentity(
            fake.client,
            resolveLabIdentityTarget(env()),
            parseLabIdentityArgs(applyArguments),
          ),
        /拒绝/,
      );
      assert.equal(
        fake.calls.some((call) => call.query === "ROLLBACK"),
        true,
      );
      assert.equal(
        fake.calls.some((call) => call.query.startsWith("INSERT")),
        false,
      );
    }
  });

  void it("数据库查询失败时回滚、释放连接且隐藏内部异常", async () => {
    const fake = fakeDatabase({ failOn: "scada_identities" });
    await assert.rejects(
      () => runLabIdentityBinding(env(), applyArguments, fake.Client),
      /模拟数据库异常/,
    );
    assert.equal(fake.state.connected, true);
    assert.equal(fake.state.ended, true);
    assert.equal(
      fake.calls.some((call) => call.query === "ROLLBACK"),
      true,
    );
    assert.equal(
      describeLabIdentityFailure(new Error("模拟数据库异常，包含密码")),
      "本机身份绑定操作失败，请检查数据库或配置，不会输出原始异常",
    );
  });

  void it("安全诊断只接受预先审核的中文失败原因", () => {
    assert.equal(
      describeLabIdentityFailure(new Error("本地主体已有工程 ACL，拒绝隐式关联授权")),
      "本地主体已有工程 ACL，拒绝隐式关联授权",
    );
    assert.equal(
      describeLabIdentityFailure({ message: "postgres://用户名:密码" }),
      "本机身份绑定操作失败，请检查数据库或配置，不会输出原始异常",
    );
  });
});
