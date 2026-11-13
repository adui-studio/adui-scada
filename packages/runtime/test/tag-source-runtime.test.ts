import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { DemoRuntime } from "../src/runtime.ts";
import type { RuntimeState } from "../src/runtime.ts";
import type {
  ReadonlyTagSource,
  ReadonlyTagSourceHandlers,
} from "../src/tag-source.ts";

const makeTag = (sequence: number, value = 42) => ({
  tagId: "water.level",
  value,
  quality: "GOOD" as const,
  sourceTimestamp: "2026-11-13T00:00:00.000Z",
  serverTimestamp: "2026-11-13T00:00:00.000Z",
  sequence,
});

function controlledSource() {
  const handlers: ReadonlyTagSourceHandlers[] = [];
  let closed = 0;
  const source: ReadonlyTagSource = {
    async loadProject() {
      return waterTreatmentDemoDocument;
    },
    subscribe(next) {
      handlers.push(next);
      return {
        close() {
          closed++;
        },
      };
    },
  };
  return { source, handlers, closed: () => closed };
}

test("注入数据源可交付原始 Tag 对象和 SSE JSON 文本，统一 Core 校验", async () => {
  const controlled = controlledSource();
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), controlled.source);
  try {
    await runtime.start();
    expect(states.at(-1)?.status).toBe("connecting");
    expect(states.at(-1)?.document?.projectId).toBe("water-demo");

    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(5)] });
    expect(states.at(-1)?.status).toBe("live");
    expect(states.at(-1)?.values[0]?.sequence).toBe(5);

    controlled.handlers[0]?.onMessage(
      JSON.stringify({ kind: "delta", values: [makeTag(6, 55)] }),
    );
    expect(states.at(-1)?.values[0]?.value).toBe(55);
    expect(states.at(-1)?.values[0]?.sequence).toBe(6);
  } finally {
    runtime.stop();
  }
  expect(controlled.closed()).toBe(1);
});

test("模拟断连使旧值 STALE，重连新快照允许从新会话序列重新开始", async () => {
  const controlled = controlledSource();
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), controlled.source);
  try {
    await runtime.start();
    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(20)] });
    controlled.handlers[0]?.onDisconnected();
    expect(states.at(-1)?.status).toBe("reconnecting");
    expect(states.at(-1)?.values[0]?.quality).toBe("STALE");

    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(1, 88)] });
    expect(states.at(-1)?.status).toBe("live");
    expect(states.at(-1)?.values[0]?.quality).toBe("GOOD");
    expect(states.at(-1)?.values[0]?.value).toBe(88);
    expect(states.at(-1)?.values[0]?.sequence).toBe(1);
  } finally {
    runtime.stop();
  }
});

test("恶意或无效 Tag 事件使订阅关闭，旧数据不得继续标成正常", async () => {
  const controlled = controlledSource();
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), controlled.source);
  try {
    await runtime.start();
    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(2)] });
    controlled.handlers[0]?.onMessage('{"kind":"delta","values":[{"tagId":"water.level","value":null}]}');
    expect(states.at(-1)?.status).toBe("error");
    expect(states.at(-1)?.values[0]?.quality).toBe("STALE");
    expect(controlled.closed()).toBe(1);

    const count = states.length;
    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(100)] });
    expect(states).toHaveLength(count);
  } finally {
    runtime.stop();
  }
});

test("停止期间取消加载并屏蔽迟到的工程数据，不产生新订阅", async () => {
  let finishLoad: ((value: unknown) => void) | undefined;
  let receivedSignal: AbortSignal | undefined;
  let subscriptions = 0;
  const source: ReadonlyTagSource = {
    loadProject(signal) {
      receivedSignal = signal;
      return new Promise<unknown>((resolve) => {
        finishLoad = resolve;
      });
    },
    subscribe() {
      subscriptions++;
      return { close() {} };
    },
  };
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), source);
  const pending = runtime.start();

  expect(states.at(-1)?.status).toBe("loading");
  runtime.stop();
  expect(receivedSignal?.aborted).toBe(true);
  const count = states.length;
  finishLoad?.(waterTreatmentDemoDocument);
  await pending;

  expect(subscriptions).toBe(0);
  expect(states).toHaveLength(count);
});

test("停止并重新开始后，旧 SSE 回调不能污染新会话", async () => {
  const controlled = controlledSource();
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), controlled.source);
  try {
    await runtime.start();
    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(3)] });
    runtime.stop();

    await runtime.start();
    expect(states.at(-1)?.status).toBe("connecting");
    const count = states.length;
    controlled.handlers[0]?.onMessage({ kind: "snapshot", values: [makeTag(100)] });
    controlled.handlers[0]?.onDisconnected();
    expect(states).toHaveLength(count);

    controlled.handlers[1]?.onMessage({ kind: "snapshot", values: [makeTag(1, 77)] });
    expect(states.at(-1)?.status).toBe("live");
    expect(states.at(-1)?.values[0]?.value).toBe(77);
  } finally {
    runtime.stop();
  }
  expect(controlled.closed()).toBe(2);
});

test("同步下发错误事件时，订阅建立后仍立即回收连接", async () => {
  let closeCount = 0;
  const source: ReadonlyTagSource = {
    async loadProject() {
      return waterTreatmentDemoDocument;
    },
    subscribe(handlers) {
      handlers.onMessage("{无效 JSON");
      return {
        close() {
          closeCount++;
        },
      };
    },
  };
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), source);
  try {
    await runtime.start();
    expect(states.at(-1)?.status).toBe("error");
    expect(closeCount).toBe(1);
  } finally {
    runtime.stop();
  }
});
