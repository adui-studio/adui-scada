import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// 读取仓库根目录的统一 .env；显式传入的进程环境变量优先。
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const targets = [
  {
    name: "React",
    url:
      process.env.SCADA_REACT_URL ||
      `http://${process.env.SCADA_WEB_HOST || "127.0.0.1"}:${process.env.SCADA_REACT_DEV_PORT || "5173"}/`,
    command: "pnpm run dev:react",
  },
  {
    name: "Vue",
    url:
      process.env.SCADA_VUE_URL ||
      `http://${process.env.SCADA_WEB_HOST || "127.0.0.1"}:${process.env.SCADA_VUE_DEV_PORT || "5174"}/`,
    command: "pnpm run dev:vue",
  },
];

function validateLocalUrl(value) {
  const url = new URL(value);
  assert.ok(
    (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "浏览器 SSE 验收只允许访问本机回环地址",
  );
  return url;
}

function browserExecutable() {
  const root = process.env.PROGRAMFILES || "C:\\Program Files";
  const rootX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  return [
    process.env.SCADA_BROWSER_PATH,
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(rootX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((file) => file && existsSync(file));
}

async function waitForPort(directory, child) {
  const filename = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt++) {
    if (existsSync(filename)) return Number(readFileSync(filename, "utf8").split("\n")[0]);
    if (child.exitCode !== null) break;
    await pause(100);
  }
  throw new Error("Chrome/Edge 调试端口未就绪");
}

class ChromeSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const result = JSON.parse(String(data));
      const task = this.pending.get(result.id);
      if (!task) return;
      clearTimeout(task.timeout);
      this.pending.delete(result.id);
      if (result.error) task.reject(new Error(result.error.message));
      else task.resolve(result.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("浏览器调试指令超时：" + method));
      }, 15000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(source) {
    const result = await this.send("Runtime.evaluate", {
      expression: source,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error("浏览器执行失败：" + result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

// 在真实浏览器中包装原生 EventSource，只屏蔽测试流的事件回调，不伪造 HTTP 数据。
function installSseProbe() {
  const NativeEventSource = window.EventSource;
  const streams = [];
  const statuses = [];
  const probe = { streams, statuses };
  Object.defineProperty(window, "__scadaSseProbe", { value: probe, configurable: true });

  class TrackedEventSource extends NativeEventSource {
    constructor(url, options) {
      super(url, options);
      this.probeState = { url: String(url), mode: "normal", closed: false };
      streams.push(this.probeState);
    }

    set onmessage(handler) {
      this.probeMessageHandler = handler;
      super.onmessage = (event) => {
        if (this.probeState?.mode !== "normal") return;
        this.probeMessageHandler?.call(this, event);
      };
    }

    get onmessage() {
      return this.probeMessageHandler ?? null;
    }

    addEventListener(type, listener, options) {
      if (type === "heartbeat" && typeof listener === "function") {
        return super.addEventListener(
          type,
          (event) => {
            if (this.probeState?.mode !== "all") listener.call(this, event);
          },
          options,
        );
      }
      return super.addEventListener(type, listener, options);
    }

    close() {
      if (this.probeState) this.probeState.closed = true;
      super.close();
    }
  }

  window.EventSource = TrackedEventSource;
  const recordStatus = () => {
    const value = document.querySelector(".scada-status")?.getAttribute("data-status");
    if (value && statuses.at(-1) !== value) statuses.push(value);
  };
  new MutationObserver(recordStatus).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-status"],
  });
}

async function snapshot(session) {
  return session.evaluate(
    "(() => { const probe = window.__scadaSseProbe; return { " +
      "url: location.href, " +
      "status: document.querySelector('.scada-status')?.getAttribute('data-status') ?? null, " +
      "streams: probe?.streams.map((source) => ({ ...source })) ?? [], " +
      "statuses: [...(probe?.statuses ?? [])] }; })()",
  );
}

async function waitFor(session, description, predicate, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await snapshot(session);
      if (predicate(last)) return last;
    } catch (error) {
      // 页面导航期间旧执行上下文可能失效，下一次轮询会自动重试。
      last = { error: error.message };
    }
    await pause(200);
  }
  throw new Error(description + "超时：" + JSON.stringify(last));
}

async function checkTarget(session, target) {
  const url = validateLocalUrl(target.url);
  url.searchParams.set("scada_sse_browser_check", target.name.toLowerCase());
  const navigation = await session.send("Page.navigate", { url: url.href });
  if (navigation.errorText) {
    throw new Error(target.name + " 浏览器导航失败：" + navigation.errorText);
  }
  const ready = await waitFor(
    session,
    target.name + " 初始 SSE 快照",
    (state) =>
      state.url === url.href &&
      state.status === "live" &&
      state.streams.some((stream) => !stream.closed),
    20000,
  );
  let activeIndex = ready.streams.findLastIndex((source) => !source.closed);
  assert.ok(activeIndex >= 0, "没有有效 SSE 流");

  // 独立模拟 Tag 不更新：真正 SSE 心跳仍到达，必须 STALE 且不得重新连接。
  await session.evaluate("window.__scadaSseProbe.streams[" + activeIndex + "].mode = 'tag'");
  const stale = await waitFor(
    session,
    target.name + " Tag 静默质量降级",
    (state) => state.status === "stale",
    17000,
  );
  assert.equal(
    stale.streams.filter((stream) => !stream.closed).length,
    1,
    "仅 Tag 静默时不得重建仍有心跳的 SSE 流",
  );
  await session.evaluate("window.__scadaSseProbe.streams[" + activeIndex + "].mode = 'normal'");
  const resumed = await waitFor(
    session,
    target.name + " Tag 恢复",
    (state) => state.status === "live",
    15000,
  );

  // 完全屏蔽当前流的 Tag 与心跳回调，校验 15 秒静默重建及旧流关闭。
  activeIndex = resumed.streams.findLastIndex((source) => !source.closed);
  const previousCount = resumed.streams.length;
  await session.evaluate("window.__scadaSseProbe.streams[" + activeIndex + "].mode = 'all'");
  const recovered = await waitFor(
    session,
    target.name + " 传输静默重建",
    (state) =>
      state.streams.length > previousCount &&
      state.streams[activeIndex]?.closed &&
      state.streams.some((stream, index) => index >= previousCount && !stream.closed),
    21000,
  );
  assert.ok(
    recovered.streams.every((stream) => stream.url === recovered.streams[0].url),
    "重建连接必须保留原固定同源路径",
  );
  await waitFor(
    session,
    target.name + " 断流后快照恢复",
    (state) => state.status === "live",
    15000,
  );

  // 离开 Runtime 后全部 EventSource 必须关闭，且不能出现后台重建。
  await session.evaluate(
    "(() => { " +
      "const button = [...document.querySelectorAll('.scada-app-nav button')].find(" +
      "(node) => node.textContent.trim() === '组态编辑'); " +
      "if (!button) throw new Error('未找到组态编辑导航按钮'); " +
      "button.click(); })()",
  );
  const stopped = await waitFor(
    session,
    target.name + " 离开 Runtime 释放 SSE",
    (state) => state.streams.length > 0 && state.streams.every((stream) => stream.closed),
    10000,
  );
  await pause(1600);
  const idle = await snapshot(session);
  assert.equal(idle.streams.length, stopped.streams.length, "离开 Runtime 后不得建立新的 SSE 流");
  process.stdout.write(target.name + " 浏览器 SSE 心跳保活、Tag 过期、静默重连、资源清理通过\n");
}

async function checkService(target, path, command, expectedContentType) {
  const url = new URL(path, validateLocalUrl(target.url));
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    throw new Error(
      `${target.name} 本机服务不可访问：${url.href}；${reason}` +
        (cause ? `（${cause}）` : "") +
        `。请在另一个终端执行 ${command}，确认端口未被占用并检查根目录 .env。`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `${target.name} 接口返回 HTTP ${response.status}：${url.href}。请检查 ${command} 的启动日志。`,
    );
  }
  if (
    expectedContentType &&
    !response.headers.get("content-type")?.toLowerCase().includes(expectedContentType)
  ) {
    throw new Error(
      `${target.name} 接口内容类型异常：${url.href}，预期 ${expectedContentType}，实际 ${response.headers.get("content-type") ?? "未提供"}。请检查模拟服务和 Vite 代理。`,
    );
  }
}

async function main() {
  const browserPath = browserExecutable();
  assert.ok(browserPath, "未找到 Chrome/Edge，可设置 SCADA_BROWSER_PATH");
  for (const target of targets) {
    process.stdout.write(`正在检查 ${target.name}：${validateLocalUrl(target.url).origin}\n`);
    await checkService(target, "/", target.command, "text/html");
    await checkService(target, "/demo/project", "pnpm run dev:demo", "application/json");
  }

  const directory = mkdtempSync(join(tmpdir(), "adui-scada-sse-browser-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    "--user-data-dir=" + directory,
    "about:blank",
  ];
  if (process.getuid?.() === 0) args.unshift("--no-sandbox");
  const child = spawn(browserPath, args, { stdio: "ignore" });
  let socket;
  try {
    const port = await waitForPort(directory, child);
    const response = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", {
      method: "PUT",
    });
    assert.ok(response.ok, "无法创建浏览器调试标签页");
    const tab = await response.json();
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const session = new ChromeSession(socket);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "(" + installSseProbe.toString() + ")()",
    });
    for (const target of targets) await checkTarget(session, target);
  } finally {
    socket?.close();
    child.kill();
    await pause(500);
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write("浏览器 SSE 验收失败：" + error.message + "\n");
  process.exitCode = 1;
});
