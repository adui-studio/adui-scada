import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Prisma8RuntimeLifecycle,
  requirePrisma8RuntimeIdentity,
  resolvePrisma8RuntimeUrl,
} from "../apps/server/src/database/prisma8-runtime-boundary.ts";

const password = "a".repeat(43);
const base = "postgresql://adui_scada:" + password + "@127.0.0.1:15432/adui_scada?schema=public";
const config = { connectionString: base, readOnly: true, expectedSystemIdentifier: "123456789" };
const storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const identity = {
  database: "adui_scada",
  role: "adui_scada",
  sessionRole: "adui_scada",
  schema: "public",
  version: "190000",
  systemIdentifier: "123456789",
  storageHash,
  readOnly: "on",
  defaultReadOnly: "on",
  recovery: false,
};

void test("连接只允许固定业务库并由提供方确定只读模式", () => {
  const readOnly = new URL(resolvePrisma8RuntimeUrl(config));
  const writable = new URL(resolvePrisma8RuntimeUrl({ ...config, readOnly: false }));
  assert.deepEqual([...readOnly.searchParams.keys()], ["options"]);
  assert.match(readOnly.searchParams.get("options") ?? "", /default_transaction_read_only=on/u);
  assert.match(writable.searchParams.get("options") ?? "", /default_transaction_read_only=off/u);
  assert.equal(readOnly.password, password);
});

void test("拒绝旧库、外部连接、额外选项和无效集群标识", () => {
  for (const connectionString of [
    undefined,
    base.replace("127.0.0.1", "remote.example"),
    base.replace("15432", "15434"),
    base.replace("/adui_scada?", "/adui_scada_test?"),
    base.replace("/adui_scada?", "/adui_scada_keycloak?"),
    base + "&schema=public",
    base + "&options=bad",
    base.replace(password, "short"),
    " " + base,
  ]) {
    assert.throws(() => resolvePrisma8RuntimeUrl({ ...config, connectionString }), /仅允许/u);
  }
  assert.throws(
    () => resolvePrisma8RuntimeUrl({ ...config, expectedSystemIdentifier: "bad" }),
    /仅允许/u,
  );
});

void test("真实标记、角色、数据库、只读和版本必须全部一致", () => {
  requirePrisma8RuntimeIdentity([identity], config, storageHash);
  requirePrisma8RuntimeIdentity(
    [{ ...identity, readOnly: "off", defaultReadOnly: "off" }],
    { ...config, readOnly: false },
    storageHash,
  );
  for (const drift of [
    { database: "adui_scada_test" },
    { role: "postgres" },
    { sessionRole: "postgres" },
    { schema: "other" },
    { version: "170011" },
    { systemIdentifier: "999" },
    { storageHash: null },
    { storageHash: "b".repeat(64) },
    { readOnly: "off" },
    { defaultReadOnly: "off" },
    { recovery: true },
  ]) {
    assert.throws(
      () => requirePrisma8RuntimeIdentity([{ ...identity, ...drift }], config, storageHash),
      /不一致/u,
    );
  }
  assert.throws(() => requirePrisma8RuntimeIdentity([], config, storageHash), /不一致/u);
  assert.throws(
    () => requirePrisma8RuntimeIdentity([identity, identity], config, storageHash),
    /不一致/u,
  );
});

void test("校验成功后才提供同一客户端且关闭只执行一次", async () => {
  const lifecycle = new Prisma8RuntimeLifecycle();
  const client = { id: "模拟客户端" };
  const events = [];
  assert.throws(() => lifecycle.client, /尚未就绪/u);
  await lifecycle.start(() => ({
    client,
    verify: () => {
      events.push("校验");
      return Promise.resolve();
    },
    close: () => {
      events.push("关闭");
      return Promise.resolve();
    },
  }));
  assert.equal(lifecycle.client, client);
  await assert.rejects(
    lifecycle.start(() => {
      throw new Error("禁止调用");
    }),
    /重复启动/u,
  );
  await Promise.all([lifecycle.stop(), lifecycle.stop()]);
  assert.throws(() => lifecycle.client, /已关闭/u);
  assert.deepEqual(events, ["校验", "关闭"]);
});

void test("启动失败释放资源并隐藏第三方异常", async () => {
  const lifecycle = new Prisma8RuntimeLifecycle();
  let closed = 0;
  await assert.rejects(
    lifecycle.start(() => ({
      client: {},
      verify: () => Promise.reject(new Error("模拟秘密")),
      close: () => {
        closed++;
        return Promise.resolve();
      },
    })),
    { message: "Prisma 8 数据库启动校验失败" },
  );
  await lifecycle.stop();
  assert.equal(closed, 1);
  assert.throws(() => lifecycle.client, /已关闭/u);
});

void test("启动过程中关闭不暴露客户端也不重复释放", async () => {
  const lifecycle = new Prisma8RuntimeLifecycle();
  let closed = 0;
  let complete = () => {
    throw new Error("校验夹具尚未初始化");
  };
  const verified = new Promise((resolve) => {
    complete = () => resolve(undefined);
  });
  const start = lifecycle.start(() => ({
    client: {},
    verify: () => verified,
    close: () => {
      closed++;
      return Promise.resolve();
    },
  }));
  const rejected = assert.rejects(start, /启动校验失败/u);
  const stop = lifecycle.stop();
  assert.throws(() => lifecycle.client, /已关闭/u);
  complete();
  await rejected;
  await stop;
  assert.equal(closed, 1);
});

void test("关闭失败不返回成功且保持终止状态", async () => {
  const lifecycle = new Prisma8RuntimeLifecycle();
  await lifecycle.start(() => ({
    client: {},
    verify: () => Promise.resolve(),
    close: () => Promise.reject(new Error("模拟秘密")),
  }));
  await assert.rejects(lifecycle.stop(), { message: "Prisma 8 数据库提供方关闭失败" });
  await assert.rejects(lifecycle.stop(), /关闭失败/u);
  assert.throws(() => lifecycle.client, /已关闭/u);
});

void test("启动与关闭同时失败保留两类脱敏原因", async () => {
  const lifecycle = new Prisma8RuntimeLifecycle();
  await assert.rejects(
    lifecycle.start(() => ({
      client: {},
      verify: () => Promise.reject(new Error("模拟启动异常")),
      close: () => Promise.reject(new Error("模拟关闭异常")),
    })),
    { message: "Prisma 8 数据库启动校验及关闭失败" },
  );
  await assert.rejects(lifecycle.stop(), /关闭失败/u);
  assert.throws(() => lifecycle.client, /已关闭/u);
});
