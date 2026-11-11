import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

const targets = [
  { name: "React", url: process.env.SCADA_REACT_URL || "http://127.0.0.1:5173/" },
  { name: "Vue", url: process.env.SCADA_VUE_URL || "http://127.0.0.1:5174/" },
];
const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
];

function browserExecutable() {
  const root = process.env.PROGRAMFILES || "C:\\Program Files";
  const rootX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const candidates = [
    process.env.SCADA_BROWSER_PATH,
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(rootX86, "Google", "Chrome", "Application", "chrome.exe"),
    join(rootX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function waitForPort(directory, child) {
  const filename = join(directory, "DevToolsActivePort");
  for (let index = 0; index < 150; index += 1) {
    if (existsSync(filename)) return Number(readFileSync(filename, "utf8").split("\n")[0]);
    if (child.exitCode !== null) break;
    await pause(100);
  }
  throw new Error("浏览器调试端口未就绪，请检查 Chrome/Edge 是否可启动");
}

class ChromeSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      const task = this.pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timeout);
      this.pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("浏览器指令超时：" + method));
        },
        method === "Runtime.evaluate" ? 45000 : 15000,
      );
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(source) {
    const data = await this.send("Runtime.evaluate", {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
    });
    if (data.exceptionDetails) {
      throw new Error(
        data.exceptionDetails.text + "：" + (data.exceptionDetails.exception?.description || ""),
      );
    }
    return data.result.value;
  }
}

/** 按真实用户流程从默认运行监控切换到组态编辑，等待异步组件完成渲染。 */
async function enterStudioInPage() {
  const waitFor = async (selector, limit) => {
    const started = Date.now();
    while (Date.now() - started < limit) {
      const node = document.querySelector(selector);
      if (node) return node;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };

  const navigation = await waitFor(".scada-app-nav", 10000);
  const editorButton = [...(navigation?.querySelectorAll("button") || [])].find(
    (button) => button.textContent.trim() === "组态编辑",
  );
  if (!editorButton) {
    throw new Error(
      "未找到组态编辑导航入口；地址：" +
        location.href +
        "；标题：" +
        document.title +
        "；导航按钮：" +
        [...(navigation?.querySelectorAll("button") || [])]
          .map((button) => button.textContent.trim())
          .join("、"),
    );
  }

  if (!document.querySelector(".studio-workspace")) editorButton.click();
  const workspace = await waitFor(".studio-workspace", 15000);
  const svg = workspace && (await waitFor(".studio-svg", 5000));
  if (!workspace || !svg) {
    throw new Error(
      "点击组态编辑后未能加载工作台；地址：" +
        location.href +
        "；标题：" +
        document.title +
        "；导航状态：" +
        (editorButton.getAttribute("aria-current") || "未激活") +
        "；页面文本：" +
        (document.querySelector("#root, #app")?.textContent || "").trim().slice(0, 160),
    );
  }

  return { title: document.title, url: location.href };
}

async function checkStudioInPage() {
  const findings = [];
  function verify(name, passed) {
    findings.push({ name, passed: Boolean(passed) });
  }
  function element(selector) {
    const found = document.querySelector(selector);
    if (!found) throw new Error("未找到元素：" + selector);
    return found;
  }
  function bounds(found) {
    const rect = found.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 80));
  };
  const workspace = element(".studio-workspace");
  const stage = element(".studio-stage");
  const canvas = element(".studio-canvas-scroll");
  const board = element(".studio-canvas-board");
  const svg = element(".studio-svg");
  const layers = element(".studio-panel-layers");
  const properties = element(".studio-panel-properties");
  await settle();

  const canvasRect = bounds(canvas);
  const boardRect = bounds(board);
  const svgRect = bounds(svg);
  verify("页面无外层滚动条", document.documentElement.scrollHeight <= window.innerHeight + 2);
  verify(
    "中央画布无滚动条",
    canvas.scrollHeight <= canvas.clientHeight + 2 && canvas.scrollWidth <= canvas.clientWidth + 2,
  );
  verify(
    "画板与画布四边对齐",
    near(canvasRect.left, boardRect.left) &&
      near(canvasRect.right, boardRect.right) &&
      near(canvasRect.top, boardRect.top) &&
      near(canvasRect.bottom, boardRect.bottom),
  );
  verify(
    "SVG 与画板四边对齐",
    near(boardRect.left, svgRect.left) &&
      near(boardRect.right, svgRect.right) &&
      near(boardRect.top, svgRect.top) &&
      near(boardRect.bottom, svgRect.bottom),
  );
  verify("左侧栏固定 252px", near(bounds(layers).width, 252));
  verify("右侧栏固定 320px", near(bounds(properties).width, 320));
  verify("画布占据剩余宽度", near(bounds(workspace).width - 252 - 320, bounds(stage).width));

  const viewBox = svg.viewBox.baseVal;
  const grid = svg.querySelector('rect[fill="url(#scada-studio-grid)"]');
  verify(
    "工作区网格完整覆盖 viewBox",
    Boolean(grid) &&
      ["x", "y", "width", "height"].every((key) =>
        near(Number(grid.getAttribute(key)), viewBox[key], 0.001),
      ),
  );
  verify(
    "SVG 世界坐标比例匹配视口",
    near(viewBox.width / viewBox.height, svgRect.width / svgRect.height, 0.002),
  );
  const boundary = svg.querySelector(".studio-page-boundary");
  verify(
    "工程页面边界独立显示",
    Boolean(boundary) &&
      Number(boundary.getAttribute("width")) > 0 &&
      Number(boundary.getAttribute("height")) > 0,
  );

  const zoomButtons = [...element(".studio-zoom").querySelectorAll("button")];
  const originalWidth = svg.viewBox.baseVal.width;
  zoomButtons[2]?.click();
  await settle();
  verify(
    "放大只改变视图，不改变 SVG DOM 尺寸",
    svg.viewBox.baseVal.width < originalWidth && near(bounds(svg).width, svgRect.width),
  );
  zoomButtons[1]?.click();
  await settle();
  verify("适应按钮恢复原始视图", near(svg.viewBox.baseVal.width, originalWidth, 0.01));

  const menu = element(".studio-view-menu");
  menu.open = true;
  await settle();
  const label = [...menu.querySelectorAll("label")].find((item) =>
    item.textContent.includes("显示网格"),
  );
  const gridInput = label?.querySelector('input[type="checkbox"]');
  if (gridInput?.checked) {
    gridInput.click();
    await settle();
    verify("网格可关闭", !svg.querySelector('rect[fill="url(#scada-studio-grid)"]'));
    gridInput.click();
    await settle();
    verify("网格可恢复", Boolean(svg.querySelector('rect[fill="url(#scada-studio-grid)"]')));
  } else {
    verify("存在网格显示控制", Boolean(gridInput));
  }

  const toggle = (name) =>
    [...menu.querySelectorAll("button")].find((item) => item.textContent.trim() === name);
  const initialWidth = bounds(stage).width;
  toggle("隐藏图层")?.click();
  await settle();
  verify("隐藏图层后画布自动扩展", bounds(stage).width > initialWidth + 200);
  toggle("显示图层")?.click();
  await settle();
  verify("恢复图层后画布宽度恢复", near(bounds(stage).width, initialWidth));
  toggle("隐藏属性")?.click();
  await settle();
  verify("隐藏属性后画布自动扩展", bounds(stage).width > initialWidth + 260);
  toggle("显示属性")?.click();
  await settle();
  verify("恢复属性后画布宽度恢复", near(bounds(stage).width, initialWidth));
  menu.open = false;

  const firstLayer = document.querySelector(".studio-layer-tree .studio-layer");
  firstLayer?.click();
  await settle();
  verify("点击图层可更新属性面板", Boolean(firstLayer) && /已选\s*1/.test(properties.textContent));

  return { findings, viewport: { width: innerWidth, height: innerHeight } };
}

/** 只在隔离浏览器中操作真实 Studio DOM，不修改正式应用代码。 */
async function addStudioSymbolInPage(label) {
  const button = [...document.querySelectorAll(".studio-add button")].find(
    (item) => item.textContent.trim() === label,
  );
  if (!button) throw new Error("未找到添加图元按钮：" + label);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const notice = document.querySelector(".studio-notice")?.textContent || "";
  if (!notice.includes("已新增图元")) throw new Error("新增图元失败：" + notice);
  return notice;
}

/** 通过点击导出按钮捕获真实 Blob，阻止临时浏览器写入无意义的下载文件。 */
async function exportStudioJsonInPage() {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new Error("未找到文件与草稿菜单");
  menu.open = true;
  const button = [...menu.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === "导出 JSON",
  );
  if (!button) throw new Error("未找到导出 JSON 按钮");
  const originalCreate = Reflect.get(URL, "createObjectURL");
  const originalClick = Reflect.get(HTMLAnchorElement.prototype, "click");
  if (typeof originalCreate !== "function" || typeof originalClick !== "function") {
    throw new TypeError("浏览器不支持工程 JSON 导出所需的方法");
  }
  let exportedBlob = null;
  try {
    URL.createObjectURL = function (value) {
      exportedBlob = value;
      return originalCreate.call(URL, value);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith("blob:")) return;
      return originalClick.call(this);
    };
    button.click();
    if (!(exportedBlob instanceof Blob)) throw new Error("导出按钮没有生成 JSON Blob");
    const json = await exportedBlob.text();
    JSON.parse(json);
    return json;
  } finally {
    URL.createObjectURL = originalCreate;
    HTMLAnchorElement.prototype.click = originalClick;
    menu.open = false;
  }
}

/** 模拟选择工程 JSON 文件，等待 Vue/React 异步导入和状态反馈。 */
async function importStudioJsonInPage(json, expectSuccess) {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new Error("未找到文件与草稿菜单");
  menu.open = true;
  const input = menu.querySelector(".studio-import input[type=file]");
  if (!input) throw new Error("未找到工程 JSON 文件输入");
  const transfer = new DataTransfer();
  transfer.items.add(new File([json], "互通验收.json", { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const expectedNotice = expectSuccess ? "工程 JSON 已校验并载入本地编辑器" : "导入失败：";
  const started = Date.now();
  try {
    while (Date.now() - started < 12000) {
      const notice = document.querySelector(".studio-notice")?.textContent || "";
      if (notice.includes(expectedNotice)) return notice;
      if (expectSuccess && notice.includes("导入失败：")) {
        throw new Error("工程导入异常：" + notice);
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(
      "导入结果等待超时：" + (document.querySelector(".studio-notice")?.textContent || ""),
    );
  } finally {
    menu.open = false;
  }
}

/** 跨框架测试每次切换页面均执行真实导航和进入 Studio。 */
async function navigateStudioForInterop(session, target, marker) {
  const url = new URL(target.url);
  url.searchParams.set("scada_interop_check", marker);
  await session.send("Page.navigate", { url: url.href });
  let loaded = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await pause(150);
    try {
      loaded = await session.evaluate(
        "location.href === " + JSON.stringify(url.href) + ' && document.readyState === "complete"',
      );
      if (loaded) break;
    } catch {
      // 新页面导航时执行上下文暂不可用。
    }
  }
  if (!loaded) {
    const href = await session.evaluate("location.href");
    throw new Error(target.name + " 页面导航失败：" + href);
  }
  await session.evaluate("(" + enterStudioInPage.toString() + ")()");
}

async function runStudioInteroperability(session) {
  const react = targets[0];
  const vue = targets[1];
  const evaluate = (fn, ...args) =>
    session.evaluate(
      "(" + fn.toString() + ")(" + args.map((arg) => JSON.stringify(arg)).join(",") + ")",
    );
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await navigateStudioForInterop(session, react, "react-initial");
  await evaluate(addStudioSymbolInPage, "+ 水箱");
  const reactExport = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.ok(
    reactExport.pages[0]?.nodes.some((node) => node.type === "tank" && node.id !== "tank"),
    "React 新增水箱未进入实际导出 JSON",
  );

  await navigateStudioForInterop(session, vue, "vue-import-react");
  await evaluate(importStudioJsonInPage, JSON.stringify(reactExport), true);
  const vueImported = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.deepStrictEqual(vueImported, reactExport, "React → Vue 导入导出导致工程数据发生变化");
  process.stdout.write("React → Vue：工程 JSON、页面、图元与 Tag 绑定一致\n");

  await evaluate(addStudioSymbolInPage, "+ 文本");
  const vueExport = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.equal(
    vueExport.pages[0].nodes.length,
    reactExport.pages[0].nodes.length + 1,
    "Vue 新增文本后图元数量未变化",
  );
  await navigateStudioForInterop(session, react, "react-import-vue");
  await evaluate(importStudioJsonInPage, JSON.stringify(vueExport), true);
  const reactImported = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.deepStrictEqual(reactImported, vueExport, "Vue → React 导入导出导致工程数据发生变化");
  process.stdout.write("Vue → React：工程 JSON、页面、图元与 Tag 绑定一致\n");

  await evaluate(importStudioJsonInPage, '{"schemaVersion":', false);
  const afterInvalidImport = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.deepStrictEqual(afterInvalidImport, vueExport, "非法 JSON 导入覆盖了已有工程数据");
  process.stdout.write("非法 JSON：正确拒绝导入，已有工程保持不变\n");

  await navigateStudioForInterop(session, vue, "vue-return");
  await evaluate(importStudioJsonInPage, JSON.stringify(reactImported), true);
  const vueReturned = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.deepStrictEqual(vueReturned, vueExport, "双向往返导致工程数据发生变化");
  await evaluate(importStudioJsonInPage, '{"schemaVersion":', false);
  const vueAfterInvalidImport = JSON.parse(await evaluate(exportStudioJsonInPage));
  assert.deepStrictEqual(vueAfterInvalidImport, vueExport, "Vue 非法 JSON 导入覆盖了已有工程数据");
  process.stdout.write("React → Vue → React → Vue：完整往返及双端非法导入保护成功\n");
}

/** 测试真实本地版本菜单，确认框只在隔离浏览器上下文中临时替换。 */
async function studioVersionActionInPage(label, expectedNotice, confirmChoice = null, revision = 1) {
  const menu = document.querySelector(".studio-version-menu");
  if (!menu) throw new Error("未找到本地工程版本历史菜单");
  if (!menu.open) {
    menu.open = true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const candidates = label === "载入" || label === "查看差异"
    ? [...menu.querySelectorAll(".studio-version-item")].filter(
        (item) => item.querySelector("strong")?.textContent.trim() === `版本 #${revision}`,
      ).flatMap((item) => [...item.querySelectorAll("button")])
    : [...menu.querySelectorAll(".studio-version-panel button")];
  const button = candidates.find((item) => item.textContent.trim() === label);
  if (!button) throw new Error("找不到版本历史操作按钮：" + label);
  if (button.disabled) throw new Error("版本历史操作尚未结束：" + label);
  const originalConfirm = Reflect.get(window, "confirm");
  try {
    if (confirmChoice !== null) window.confirm = () => confirmChoice;
    button.click();
    if (expectedNotice) {
      const start = Date.now();
      while (Date.now() - start < 12000) {
        const notice = document.querySelector(".studio-notice")?.textContent || "";
        if (notice.includes(expectedNotice)) break;
        const error = menu.querySelector(".studio-version-error")?.textContent || "";
        if (error) throw new Error("版本历史操作失败：" + error);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      if (!(document.querySelector(".studio-notice")?.textContent || "").includes(expectedNotice)) {
        throw new Error("等待版本历史操作结果超时：" + expectedNotice);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    return {
      versions: [...menu.querySelectorAll(".studio-version-item strong")].map(
        (item) => item.textContent.trim(),
      ),
      comparison: menu.querySelector(".studio-version-comparison")?.textContent || "",
    };
  } finally {
    if (confirmChoice !== null) window.confirm = originalConfirm;
  }
}

async function runStudioVersionHistory(session) {
  const evaluate = (fn, ...args) =>
    session.evaluate(
      "(" + fn.toString() + ")(" + args.map((arg) => JSON.stringify(arg)).join(",") + ")",
    );
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const target of targets) {
    await navigateStudioForInterop(session, target, "history-" + target.name);
    const initial = JSON.parse(await evaluate(exportStudioJsonInPage));
    const created = await evaluate(
      studioVersionActionInPage,
      "创建快照",
      "已创建本地历史版本 #1",
    );
    assert.deepStrictEqual(created.versions, ["版本 #1"], target.name + " 首次版本创建失败");

    await evaluate(addStudioSymbolInPage, "+ 水箱");
    const modified = JSON.parse(await evaluate(exportStudioJsonInPage));
    assert.notDeepStrictEqual(modified, initial, target.name + " 图元新增失败");
    const comparison = await evaluate(
      studioVersionActionInPage,
      "查看差异",
      "已查看本地版本 #1",
      null,
      1,
    );
    assert.ok(
      comparison.comparison.includes("与当前内容不同"),
      target.name + " 未报告当前工程与历史版本的差异",
    );

    await evaluate(studioVersionActionInPage, "载入", null, false, 1);
    const canceled = JSON.parse(await evaluate(exportStudioJsonInPage));
    assert.deepStrictEqual(canceled, modified, target.name + " 取消载入却覆盖了工程");

    await evaluate(studioVersionActionInPage, "载入", "已载入本地版本 #1", true, 1);
    const restored = JSON.parse(await evaluate(exportStudioJsonInPage));
    assert.deepStrictEqual(restored, initial, target.name + " 历史版本未完整恢复");

    await evaluate(addStudioSymbolInPage, "+ 文本");
    const second = await evaluate(
      studioVersionActionInPage,
      "创建快照",
      "已创建本地历史版本 #2",
    );
    assert.deepStrictEqual(
      second.versions,
      ["版本 #2", "版本 #1"],
      target.name + " 历史版本未按最新修订号倒序排列",
    );
    process.stdout.write(target.name + " 历史版本创建、差异、取消载入、恢复及倒序列表通过\n");
  }
}

async function main() {
  const browserPath = browserExecutable();
  assert.ok(browserPath, "未找到 Chrome/Edge，可设置 SCADA_BROWSER_PATH 指定浏览器路径");
  for (const target of targets) {
    try {
      const response = await fetch(target.url, { signal: AbortSignal.timeout(3000) });
      assert.ok(response.ok, "应用页面无法访问");
    } catch (error) {
      throw new Error(target.name + " 开发服务未启动：" + target.url, { cause: error });
    }
  }

  const userData = mkdtempSync(join(tmpdir(), "adui-scada-browser-check-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    "--user-data-dir=" + userData,
    "about:blank",
  ];
  if (process.getuid?.() === 0) args.unshift("--no-sandbox");
  const child = spawn(browserPath, args, { stdio: "ignore" });
  let session;
  try {
    const port = await waitForPort(userData, child);
    const response = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", {
      method: "PUT",
    });
    assert.ok(response.ok, "无法创建浏览器调试页面");
    const tab = await response.json();
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    session = new ChromeSession(socket);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    if (process.argv.includes("--interop")) {
      await runStudioInteroperability(session);
      return;
    }
    if (process.argv.includes("--versions")) {
      await runStudioVersionHistory(session);
      return;
    }
    let failed = 0;
    for (const target of targets) {
      for (const viewport of viewports) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        // 每个视口使用独立的本地验收 URL，避免读取到上一次导航的加载状态。
        const navigationUrl = new URL(target.url);
        navigationUrl.searchParams.set(
          "scada_browser_check",
          `${target.name}-${viewport.width}x${viewport.height}`,
        );
        await session.send("Page.navigate", { url: navigationUrl.href });
        let loaded = false;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await pause(150);
          try {
            loaded = await session.evaluate(
              "location.href === " +
                JSON.stringify(navigationUrl.href) +
                ' && document.readyState === "complete"',
            );
            if (loaded) break;
          } catch {
            // 页面导航期间旧的执行上下文可能已销毁。
          }
        }
        if (!loaded) {
          const pageUrl = await session.evaluate("location.href");
          throw new Error(
            target.name + " 页面导航失败：" + navigationUrl.href + "；浏览器实际地址：" + pageUrl,
          );
        }
        await session.evaluate("(" + enterStudioInPage.toString() + ")()");
        const data = await session.evaluate("(" + checkStudioInPage.toString() + ")()");
        const errors = data.findings.filter((entry) => !entry.passed);
        failed += errors.length;
        process.stdout.write(
          target.name +
            " " +
            viewport.width +
            "x" +
            viewport.height +
            " " +
            (errors.length ? "未通过" : "通过") +
            " (" +
            (data.findings.length - errors.length) +
            "/" +
            data.findings.length +
            ")\n",
        );
        for (const error of errors) process.stderr.write("  - " + error.name + "\n");
      }
    }
    assert.equal(failed, 0, "浏览器回归项存在失败");
  } finally {
    session?.socket.close();
    child.kill();
    await pause(500);
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    } catch {
      // 浏览器子进程可能仍在关闭临时用户目录。
    }
  }
}

main().catch((error) => {
  process.stderr.write("错误：" + error.message + "\n");
  process.exitCode = 1;
});
