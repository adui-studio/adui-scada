import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  resolveStudioBrowserTargets,
  verifyStudioBrowserTarget,
} from "./studio-browser-targets.mjs";

// 浏览器验证统一读取仓库根目录 .env，避免连接其他端口上的旧工程服务。
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);
const targets = resolveStudioBrowserTargets(process.env);
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

/** 同一隔离浏览器配置内再打开一个真实标签页，共享 Origin 和 IndexedDB。 */
async function openCompanionChromeTab(port) {
  const response = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", {
    method: "PUT",
  });
  assert.ok(response.ok, "无法创建第二个浏览器调试标签页");
  const tab = await response.json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const session = new ChromeSession(socket);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    return session;
  } catch (error) {
    socket.close();
    throw error;
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

  // 仅采集受控错误类别，不能在诊断中暴露原始异常、资源 URL 或业务数据。
  const observed = {
    moduleLoadFailure: false,
    scriptError: false,
    unhandledRejection: false,
    resourceError: false,
  };
  const classifyModuleError = (value) => {
    const message = String(value || "");
    return [
      "failed to fetch dynamically imported module",
      "importing a module script failed",
      "loading chunk",
      "failed to load module script",
    ].some((phrase) => message.toLowerCase().includes(phrase));
  };
  const onPageError = (event) => {
    if (event instanceof ErrorEvent) {
      observed.scriptError = true;
      if (classifyModuleError(event.message)) observed.moduleLoadFailure = true;
    } else if (
      event.target instanceof HTMLScriptElement ||
      event.target instanceof HTMLLinkElement
    ) {
      observed.resourceError = true;
    }
  };
  const onUnhandledRejection = (event) => {
    observed.unhandledRejection = true;
    const reason = event.reason;
    if (classifyModuleError(reason?.message || reason)) observed.moduleLoadFailure = true;
  };
  window.addEventListener("error", onPageError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  try {
    if (!document.querySelector(".studio-workspace")) editorButton.click();
    const workspace = await waitFor(".studio-workspace", 15000);
    const svg = workspace && (await waitFor(".studio-svg", 5000));
    if (!workspace || !svg) {
      const requestedStudioModule = performance
        .getEntriesByType("resource")
        .some((resource) => /\/studio\/StudioPage\.(vue|tsx)/.test(resource.name));
      throw new Error(
        "点击组态编辑后未能加载工作台；地址：" +
          location.href +
          "；标题：" +
          document.title +
          "；导航状态：" +
          (editorButton.getAttribute("aria-current") || "未激活") +
          "；页面文本：" +
          (document.querySelector("#root, #app")?.textContent || "").trim().slice(0, 160) +
          "；导航诊断：工作台=" +
          Boolean(workspace) +
          "、SVG=" +
          Boolean(svg) +
          "、模块请求=" +
          requestedStudioModule +
          "、模块加载异常=" +
          observed.moduleLoadFailure +
          "、脚本异常=" +
          observed.scriptError +
          "、未处理异步拒绝=" +
          observed.unhandledRejection +
          "、脚本或样式资源失败=" +
          observed.resourceError,
      );
    }

    return { title: document.title, url: location.href };
  } finally {
    window.removeEventListener("error", onPageError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }
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
  const viewTrigger = menu.querySelector("button.t-button");
  if (!(viewTrigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到 TDesign 视图设置触发器");
  }
  viewTrigger.click();
  const viewOpened = Date.now();
  while (!menu.querySelector(".studio-view-popover")?.getClientRects().length) {
    if (Date.now() - viewOpened > 5000) throw new TypeError("视图设置弹层展开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
  viewTrigger.click();

  const firstLayer = document.querySelector(".studio-layer-tree .studio-layer");
  firstLayer?.click();
  await settle();
  verify("点击图层可更新属性面板", Boolean(firstLayer) && /已选\s*1/.test(properties.textContent));

  // 使用真实 TDesign 触发器验证页面菜单，而不是修改 details.open。
  const pageMenu = element(".studio-page-menu");
  const pageTrigger = pageMenu.querySelector("button.t-button");
  const pageTabs = () => [...document.querySelectorAll(".studio-page-tabs > button")];
  const menuItems = () => [...document.querySelectorAll(".t-dropdown__item")];
  const menuItem = (label) => menuItems().find((item) => item.textContent.trim() === label);
  const menuClosed = () => menuItems().length === 0;
  const initialPages = pageTabs();
  const initialIndex = initialPages.findIndex((tab) => tab.getAttribute("aria-current") === "page");
  verify(
    "页面管理使用 TDesign 按钮而非原生 details",
    pageTrigger instanceof HTMLButtonElement && !pageMenu.querySelector("summary"),
  );
  if (pageTrigger instanceof HTMLButtonElement) {
    pageTrigger.click();
    await settle();
    const labels = ["+ 新建页面", "复制页面", "页面前移", "页面后移", "重命名", "删除当前页"];
    verify(
      "TDesign 下拉菜单提供全部六项页面命令",
      labels.every((label) => Boolean(menuItem(label))) && menuItems().length === labels.length,
    );
    const expectedDisabled = [
      ["+ 新建页面", initialPages.length >= 100],
      ["复制页面", initialPages.length >= 100],
      ["页面前移", initialIndex <= 0],
      ["页面后移", initialIndex >= initialPages.length - 1],
      ["删除当前页", initialPages.length <= 1],
    ];
    verify(
      "页面命令禁用态与页数和当前位置一致",
      expectedDisabled.every(
        ([label, disabled]) =>
          menuItem(label)?.classList.contains("t-dropdown__item--disabled") === disabled,
      ),
    );
    menuItem("+ 新建页面")?.click();
    await settle();
    verify("TDesign 菜单可创建页面", pageTabs().length === initialPages.length + 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    verify("执行页面命令后下拉菜单自动关闭", menuClosed());

    pageTrigger.click();
    await settle();
    const createdPages = pageTabs();
    const currentIndex = createdPages.findIndex(
      (tab) => tab.getAttribute("aria-current") === "page",
    );
    const disabledNext = menuItem("页面后移");
    const beforeBlocked = createdPages.map((tab) => tab.textContent.trim()).join("|");
    disabledNext?.click();
    await settle();
    verify(
      "最后一页的禁用命令无法修改工程页面",
      currentIndex === createdPages.length - 1 &&
        disabledNext?.classList.contains("t-dropdown__item--disabled") &&
        pageTabs()
          .map((tab) => tab.textContent.trim())
          .join("|") === beforeBlocked,
    );
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    verify("点击弹层外部可收起 TDesign 菜单", menuClosed());
    pageTrigger.focus();
    verify("TDesign 页面菜单触发器可获得键盘焦点", document.activeElement === pageTrigger);
  }

  // 文件与草稿不再使用原生 details，弹层由 TDesign Popup 负责管理。
  const fileMenu = element(".studio-file-menu");
  const fileTrigger = fileMenu.querySelector("button.t-button");
  verify(
    "文件与草稿复用 TDesign Popup 触发器",
    fileMenu instanceof HTMLDivElement &&
      fileTrigger instanceof HTMLButtonElement &&
      !fileMenu.querySelector("summary"),
  );
  if (fileTrigger instanceof HTMLButtonElement) {
    fileTrigger.click();
    await settle();
    const filePanel = fileMenu.querySelector(".studio-file-popover");
    verify(
      "TDesign 文件草稿弹层包含原有五项操作",
      Boolean(filePanel?.getClientRects().length) &&
        Boolean(filePanel.querySelector('input[type="file"]')) &&
        ["导出 JSON", "恢复草稿", "清除草稿"].every((label) =>
          [...filePanel.querySelectorAll("button")].some(
            (button) => button.textContent.trim() === label,
          ),
        ) &&
        Boolean(filePanel.querySelector("button[aria-pressed]")),
    );
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    verify(
      "TDesign 文件草稿弹层可通过外部点击关闭",
      !fileMenu.querySelector(".studio-file-popover")?.getClientRects().length,
    );
  }

  // 本地版本历史由官方 Popup 展开，仍保留快照与差异操作。
  const historyMenu = element(".studio-local-history-menu");
  const historyTrigger = historyMenu.querySelector("button.t-button");
  verify(
    "本地版本历史使用 TDesign Popup 而非原生 details",
    historyMenu instanceof HTMLDivElement &&
      historyTrigger instanceof HTMLButtonElement &&
      !historyMenu.querySelector("summary"),
  );
  if (historyTrigger instanceof HTMLButtonElement) {
    historyTrigger.click();
    await settle();
    const historyPanel = historyMenu.querySelector(".studio-version-panel");
    verify(
      "本地历史弹层可见且保留快照与刷新入口",
      Boolean(historyPanel?.getClientRects().length) &&
        ["创建快照", "刷新"].every((label) =>
          [...historyPanel.querySelectorAll(".studio-version-tools button")].some(
            (button) => button.textContent.trim() === label,
          ),
        ),
    );
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    verify(
      "TDesign 本地历史弹层支持点击外部关闭",
      !historyMenu.querySelector(".studio-version-panel")?.getClientRects().length,
    );
  }

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
  const trigger = menu.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到 TDesign 文件草稿菜单触发器");
  }
  if (!menu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  const opening = Date.now();
  while (!menu.querySelector(".studio-file-popover")?.getClientRects().length) {
    if (Date.now() - opening > 5000) throw new TypeError("TDesign 文件草稿弹层展开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
    if (menu.querySelector(".studio-file-popover")?.getClientRects().length) {
      trigger.click();
    }
  }
}

/** 模拟选择工程 JSON 文件，等待 Vue/React 异步导入和状态反馈。 */
async function importStudioJsonInPage(json, expectSuccess) {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new Error("未找到文件与草稿菜单");
  const trigger = menu.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到 TDesign 文件草稿菜单触发器");
  }
  if (!menu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  const opening = Date.now();
  while (!menu.querySelector(".studio-file-popover")?.getClientRects().length) {
    if (Date.now() - opening > 5000) throw new TypeError("TDesign 文件草稿弹层展开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
    if (menu.querySelector(".studio-file-popover")?.getClientRects().length) {
      trigger.click();
    }
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

/** 仅在异常时输出同源模块响应类别，不暴露请求 URL、响应正文或敏感信息。 */
function watchStudioModuleNetwork(session, target) {
  const origin = new URL(target.url).origin;
  const requests = new Map();
  const failures = [];
  let studioStatus = "未收到响应";

  const categoryFor = (address) => {
    try {
      const url = new URL(address);
      if (url.origin !== origin) return null;
      if (url.pathname.endsWith("/src/studio/StudioPage.vue")) return "Studio模块";
      if (url.pathname.includes("/.vite/deps/")) return "Vite预构建依赖";
      if (url.pathname.startsWith("/src/")) return "Vue应用模块";
      if (url.pathname.startsWith("/@fs/")) return "工作区模块";
      return "其他同源资源";
    } catch {
      return null;
    }
  };
  const networkErrorCategory = (name) => {
    if (name === "net::ERR_ABORTED") return "导航中断";
    if (name === "net::ERR_FAILED") return "网络失败";
    if (name === "net::ERR_CONNECTION_RESET") return "连接重置";
    if (name === "net::ERR_CONNECTION_REFUSED") return "连接拒绝";
    if (name === "net::ERR_CERT_AUTHORITY_INVALID") return "证书不受信任";
    if (name === "net::ERR_CACHE_WRITE_FAILURE") return "浏览器HTTP缓存写入失败";
    if (name === "net::ERR_HTTP_RESPONSE_CODE_FAILURE") return "HTTP响应拒绝";
    // 只允许输出 Chromium 的固定错误码格式，避免透出资源地址或异常正文。
    const safeCode = /^net::ERR_[A-Z0-9_]{1,64}$/.exec(String(name));
    return safeCode ? "Chromium错误码=" + safeCode[0] : "其他网络错误";
  };
  const recordFailure = (entry) => {
    if (failures.length < 8) failures.push(entry);
  };
  const onMessage = ({ data }) => {
    const message = JSON.parse(String(data));
    const params = message.params;
    if (message.method === "Network.requestWillBeSent") {
      const category = categoryFor(params.request?.url);
      if (category) requests.set(params.requestId, category);
    } else if (message.method === "Network.responseReceived") {
      const category = requests.get(params.requestId);
      if (!category) return;
      const status = Number(params.response?.status);
      if (category === "Studio模块" && Number.isInteger(status)) {
        studioStatus = String(status);
      }
      if (Number.isInteger(status) && status >= 400) {
        recordFailure(category + ":HTTP" + status);
      }
    } else if (message.method === "Network.loadingFailed") {
      const category = requests.get(params.requestId);
      if (category) {
        recordFailure(category + ":" + networkErrorCategory(params.errorText));
        requests.delete(params.requestId);
      }
    } else if (message.method === "Network.loadingFinished") {
      requests.delete(params.requestId);
    }
  };
  session.socket.addEventListener("message", onMessage);
  return {
    summary: () =>
      "Studio模块HTTP=" +
      studioStatus +
      "、失败请求=" +
      (failures.length ? failures.join("、") : "无可见失败"),
    stop: () => {
      session.socket.removeEventListener("message", onMessage);
      requests.clear();
    },
  };
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

/** 只读取真实 Studio 发布预检面板的状态与问题，不访问网络或工程存储。 */
async function readStudioReleasePreflightInPage() {
  const menu = document.querySelector(".studio-release-preflight-menu");
  const trigger = menu?.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到发布预检 TDesign Popup 触发器");
  }
  if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) trigger.click();
  const started = Date.now();
  while (!menu.querySelector(".studio-version-panel")?.getClientRects().length) {
    if (Date.now() - started > 5000) throw new TypeError("发布预检弹层展开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const panel = menu.querySelector('[aria-label="工程发布前静态兼容性预检"]');
  if (!panel) throw new Error("未找到静态预检面板");
  const remotePanel = panel.querySelector('[aria-label="服务端已保存版本发布预检"]');
  if (!remotePanel) throw new Error("未找到服务端已保存版本预检面板");
  const remoteButton = remotePanel.querySelector("button");
  if (remoteButton?.textContent.trim() !== "检查服务端已保存版本") {
    throw new Error("服务端预检缺少手动只读入口");
  }
  if (remotePanel.querySelector('[role="status"]')) {
    throw new Error("未发起服务端请求时不得显示服务端预检成功");
  }
  const status = panel.querySelector('[role="status"]')?.textContent.trim() ?? "";
  const issues = [...panel.querySelectorAll('ol[aria-label="发布预检问题"] > li')].map((item) => ({
    path: item.querySelector("code")?.textContent.trim() ?? "",
    message: item.querySelector("p")?.textContent.trim() ?? "",
  }));
  if (menu.querySelector(".studio-version-panel")?.getClientRects().length) trigger.click();
  return {
    passed: status.includes("静态兼容性检查通过"),
    issueCount: issues.length,
    issues,
    serverReadAvailable: true,
  };
}

/** 两套 Studio 使用同一个共享 Core 校验契约，并在导入后立即更新预检结果。 */
async function runStudioReleasePreflight(session) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const target of targets) {
    await navigateStudioForInterop(session, target, "release-preflight-" + target.name);
    const evaluate = (fn, ...args) =>
      session.evaluate(
        "(" + fn.toString() + ")(" + args.map((arg) => JSON.stringify(arg)).join(",") + ")",
      );
    const initial = JSON.parse(await evaluate(exportStudioJsonInPage));
    const initialReport = await evaluate(readStudioReleasePreflightInPage);
    assert.deepStrictEqual(
      initialReport,
      { passed: true, issueCount: 0, issues: [], serverReadAvailable: true },
      target.name + " 合法演示工程的静态预检未通过",
    );

    const unsupported = JSON.parse(JSON.stringify(initial));
    const node = unsupported.pages[0].nodes[1];
    node.type = "future-gauge";
    node.rules = [{ kind: "not-implemented" }];
    unsupported.tags.find((tag) => tag.tagId === "water.level").dataType = "unknown";
    await evaluate(importStudioJsonInPage, JSON.stringify(unsupported), true);
    const report = await evaluate(readStudioReleasePreflightInPage);
    assert.equal(report.passed, false, target.name + " 不支持的工程误报静态预检通过");
    assert.equal(report.issueCount, 3, target.name + " 预检问题数量不符合预期");
    assert.deepStrictEqual(
      report.issues.map((issue) => issue.path),
      [
        "pages[0].nodes[1].type",
        "pages[0].nodes[1].rules",
        "pages[0].nodes[1].bindings.level.tagId",
      ],
      target.name + " 预检未显示准确的工程问题路径",
    );
    assert.ok(
      report.issues.every((issue) => issue.message.length > 0),
      target.name + " 预检问题缺少中文说明",
    );
    assert.deepStrictEqual(
      JSON.parse(await evaluate(exportStudioJsonInPage)),
      unsupported,
      target.name + " 发布预检意外改动了当前工程内容",
    );

    await evaluate(importStudioJsonInPage, JSON.stringify(initial), true);
    assert.deepStrictEqual(
      await evaluate(readStudioReleasePreflightInPage),
      { passed: true, issueCount: 0, issues: [], serverReadAvailable: true },
      target.name + " 恢复合法工程后仍显示过期预检问题",
    );
    process.stdout.write(target.name + " Studio 发布预检通过、问题展示与恢复更新通过\n");
  }
}

/** 在真实浏览器内定位项目 Tag 管理表单并打开详情区。 */
async function openTagManagerInPage() {
  const menu = [...document.querySelectorAll(".studio-advanced")].find((node) =>
    node.querySelector(".t-collapse-panel__header")?.textContent.includes("项目 Tag 定义"),
  );
  if (!menu) throw new Error("未找到项目 Tag 定义面板");
  const trigger = menu.querySelector(".t-collapse-panel__header");
  if (!(trigger instanceof HTMLElement)) throw new TypeError("Tag 定义折叠触发器不存在");
  trigger.click();
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const form = menu.querySelector('form[aria-label="项目 Tag 编辑表单"]');
    if (form?.getClientRects().length) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("项目 Tag 管理表单展开超时");
}

function focusTagFieldInPage(index) {
  const form = document.querySelector('form[aria-label="项目 Tag 编辑表单"]');
  const fields = [...(form?.querySelectorAll("label.studio-field") ?? [])]
    .filter((label) => !label.textContent.includes("数据类型"))
    .map((label) => label.querySelector("input, textarea"));
  const field = fields[index];
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error("项目 Tag 表单字段不存在：" + index);
  }
  field.focus();
  field.select();
  return true;
}

function submitTagFormInPage() {
  const button = document.querySelector(
    'form[aria-label="项目 Tag 编辑表单"] button[type="submit"]',
  );
  if (!button) throw new Error("未找到项目 Tag 保存按钮");
  button.click();
  return true;
}

async function clickTagRowActionInPage(tagId, action, confirmChoice) {
  const rows = document.querySelectorAll(
    '[role="list"][aria-label="项目 Tag 目录"] [role="listitem"]',
  );
  const row = [...rows].find((node) =>
    [...node.querySelectorAll("span")].some((span) => span.textContent.trim() === tagId),
  );
  const button = [...(row?.querySelectorAll("button") ?? [])].find(
    (node) => node.textContent.trim() === action,
  );
  if (!button) throw new Error("未找到项目 Tag 操作：" + tagId + " · " + action);
  button.click();
  if (confirmChoice !== null) {
    const started = Date.now();
    let choice = null;
    while (Date.now() - started < 12000) {
      choice = [...document.querySelectorAll(".t-dialog .t-button")].find((item) =>
        item.classList.contains(confirmChoice ? "t-dialog__confirm" : "t-dialog__cancel"),
      );
      if (choice?.getClientRects().length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(choice instanceof HTMLButtonElement)) throw new TypeError("Tag 删除确认弹层未出现");
    choice.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/** 从实际 DOM 度量 Tag 操作行，避免全量 TDesign 化后重现高亮整列按钮。 */
function inspectTagActionLayoutInPage() {
  const manager = document.querySelector(".studio-tag-manager");
  const row = manager?.querySelector(".studio-tag-item");
  const actions = row?.querySelector(".studio-tag-actions");
  const formActions = manager?.querySelector(".studio-tag-form-actions");
  if (!(actions instanceof HTMLElement) || !(formActions instanceof HTMLElement)) {
    throw new TypeError("项目 Tag 紧凑操作区未挂载");
  }
  const measure = (container) => {
    const buttons = [...container.querySelectorAll(".t-button")];
    return {
      columns: getComputedStyle(container).gridTemplateColumns.split(" ").length,
      count: buttons.length,
      bounds: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    };
  };
  return { item: measure(actions), form: measure(formActions) };
}

/** 使用 Chrome 输入协议触发真正的框架输入事件，不直接篡改 DOM 值。 */
async function fillTagField(session, index, value) {
  await evaluateStudioPage(session, focusTagFieldInPage, index);
  await session.send("Input.insertText", { text: value });
  await pause(120);
}

async function runStudioTagManagement(session) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const target of targets) {
    await navigateStudioForInterop(session, target, "tag-management");
    await evaluateStudioPage(session, openTagManagerInPage);
    const layout = await evaluateStudioPage(session, inspectTagActionLayoutInPage);
    for (const [kind, actions] of [
      ["Tag 条目", layout.item],
      ["Tag 表单", layout.form],
    ]) {
      assert.equal(actions.count, 2, target.name + " " + kind + " 操作按钮数量不正确");
      assert.equal(actions.columns, 2, target.name + " " + kind + " 操作没有保持双列");
      assert.ok(
        actions.bounds.every((button) => button.width > 0 && button.height > 0),
        target.name + " " + kind + " 存在不可见操作按钮",
      );
      assert.ok(
        Math.abs(actions.bounds[0].height - actions.bounds[1].height) <= 1 &&
          Math.abs(actions.bounds[0].width - actions.bounds[1].width) <= 1,
        target.name + " " + kind + " 按钮尺寸不一致",
      );
    }
    const tagId = "browser." + target.name.toLowerCase() + ".pressure";
    await fillTagField(session, 0, tagId);
    await fillTagField(session, 1, "浏览器新增压力");
    await fillTagField(session, 2, "kPa");
    await fillTagField(session, 3, "双框架 Tag 管理回归");
    await evaluateStudioPage(session, submitTagFormInPage);
    await pause(180);
    const created = JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage));
    assert.deepStrictEqual(
      created.tags.find((tag) => tag.tagId === tagId),
      {
        tagId,
        displayName: "浏览器新增压力",
        dataType: "number",
        unit: "kPa",
        description: "双框架 Tag 管理回归",
      },
      target.name + " 新建 Tag 未进入工程 JSON",
    );

    await evaluateStudioPage(session, clickTagRowActionInPage, tagId, "编辑", null);
    await fillTagField(session, 1, "浏览器编辑压力");
    await fillTagField(session, 2, "MPa");
    await evaluateStudioPage(session, submitTagFormInPage);
    await pause(180);
    const updated = JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage));
    assert.equal(updated.tags.find((tag) => tag.tagId === tagId)?.displayName, "浏览器编辑压力");
    assert.equal(updated.tags.find((tag) => tag.tagId === tagId)?.unit, "MPa");
    assert.equal(updated.tags.find((tag) => tag.tagId === tagId)?.dataType, "number");

    await evaluateStudioPage(session, clickTagRowActionInPage, "water.level", "删除", true);
    let guardNotice = "";
    const guardStarted = Date.now();
    while (Date.now() - guardStarted < 3000) {
      guardNotice = await session.evaluate(
        "document.querySelector('.studio-notice')?.textContent ?? ''",
      );
      if (guardNotice.includes("仍被")) break;
      await pause(50);
    }
    assert.match(
      guardNotice,
      /仍被.*绑定/,
      target.name + " 未显示已绑定 Tag 的删除保护提示：" + guardNotice,
    );
    // 必须先捕获删除失败提示，再导出工程；导出成功提示会覆盖状态栏文案。
    const guarded = JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage));
    assert.ok(
      guarded.tags.some((tag) => tag.tagId === "water.level"),
      "已绑定水位 Tag 被意外删除",
    );

    await evaluateStudioPage(session, clickTagRowActionInPage, tagId, "删除", true);
    await pause(180);
    const removed = JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage));
    assert.ok(
      !removed.tags.some((tag) => tag.tagId === tagId),
      target.name + " 删除 Tag 后工程仍包含该定义",
    );
    process.stdout.write(
      target.name + " 项目 Tag 新增、编辑、绑定删除保护、删除与 JSON 往返通过\n",
    );
  }
}

/** 写入与生产版本一致的旧版 localStorage 草稿包装，不绕过真实读取迁移逻辑。 */
function seedLegacyLocalStorageDraftInPage(document, savedAt) {
  const key = "adui-scada:studio:draft:" + document.projectId;
  localStorage.setItem(key, JSON.stringify({ formatVersion: 1, savedAt, document }));
  return key;
}

function readLegacyLocalStorageDraftInPage(projectId) {
  return localStorage.getItem("adui-scada:studio:draft:" + projectId);
}

/** 在真实 Dexie 数据库中写入旧 Schema 记录，保留原 revision 水位。 */
async function seedLegacyIndexedDbDraftInPage(document, revision, savedAt) {
  const database = await new Promise((resolve, reject) => {
    // 草稿库已由 Studio 的 DexieDraftRepository 初始化；只读取现有数据库，
    // 不显式指定原生版本，也不在测试夹具中自行升级数据库结构。
    void indexedDB.databases().then((databases) => {
      if (!databases.some((database) => database.name === "adui-scada-studio")) {
        reject(new TypeError("Studio 尚未初始化 IndexedDB 草稿数据库"));
        return;
      }
      const request = indexedDB.open("adui-scada-studio");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("打开草稿数据库失败"));
    }, reject);
  });
  try {
    if (!database.objectStoreNames.contains("drafts")) {
      throw new TypeError("现有草稿数据库缺少 drafts 数据表");
    }
    if (!database.objectStoreNames.contains("migrations")) {
      throw new TypeError("现有草稿数据库缺少 migrations 数据表");
    }
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(["drafts"], "readwrite");
      transaction.objectStore("drafts").put({
        projectId: document.projectId,
        revision,
        savedAt,
        document,
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("写入历史草稿失败"));
      transaction.onabort = () => reject(transaction.error || new Error("历史草稿写入事务中止"));
    });
  } finally {
    database.close();
  }
  return true;
}

/** 生成符合真实 Project Snapshot SHA-256 契约的 0.2.0 历史快照。 */
async function seedLegacyProjectSnapshotInPage(document, revision, createdAt) {
  // evaluateStudioPage 只序列化当前函数；摘要规范化逻辑必须在页面函数内部自包含。
  function stableValue(source) {
    if (Array.isArray(source)) return source.map(stableValue);
    if (source !== null && typeof source === "object") {
      const result = Object.create(null);
      for (const key of Object.keys(source).sort()) {
        result[key] = stableValue(source[key]);
      }
      return result;
    }
    return source;
  }

  const payload = {
    formatVersion: 1,
    projectId: document.projectId,
    revision,
    createdAt,
    hashAlgorithm: "SHA-256",
    document,
  };
  const canonical = JSON.stringify(stableValue(payload));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contentHash = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const snapshot = { ...payload, contentHash };
  const database = await new Promise((resolve, reject) => {
    // 历史版本库必须先由 Studio 的 Dexie 仓储初始化；测试夹具只写入现有结构。
    void indexedDB.databases().then((databases) => {
      if (!databases.some((database) => database.name === "adui-scada-studio-versions")) {
        reject(new TypeError("Studio 尚未初始化工程历史版本数据库"));
        return;
      }
      const request = indexedDB.open("adui-scada-studio-versions");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("打开历史版本数据库失败"));
    }, reject);
  });
  try {
    if (!database.objectStoreNames.contains("heads")) {
      throw new TypeError("现有历史版本数据库缺少 heads 数据表");
    }
    if (!database.objectStoreNames.contains("versions")) {
      throw new TypeError("现有历史版本数据库缺少 versions 数据表");
    }
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(["heads", "versions"], "readwrite");
      transaction.objectStore("heads").put({ projectId: document.projectId, revision });
      transaction.objectStore("versions").put(snapshot);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("写入历史快照失败"));
      transaction.onabort = () => reject(transaction.error || new Error("历史快照写入事务中止"));
    });
  } finally {
    database.close();
  }
  return { contentHash, revision };
}

async function readRawLegacyProjectSnapshotInPage(projectId, revision) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("adui-scada-studio-versions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开历史版本数据库失败"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(["versions"], "readonly");
      const request = transaction.objectStore("versions").get([projectId, revision]);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("读取原始历史快照失败"));
      transaction.onabort = () => reject(transaction.error || new Error("历史快照只读事务中止"));
    });
  } finally {
    database.close();
  }
}

/** 三条真实浏览器迁移路径：localStorage、IndexedDB 草稿、历史 Project Snapshot。 */
async function runStudioLegacyMigration(session) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const savedAt = "2026-11-14T02:00:00.000Z";
  const createdAt = "2026-11-14T02:01:00.000Z";

  for (const target of targets) {
    await navigateStudioForInterop(session, target, "legacy-source-" + target.name);
    const current = JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage));
    const legacy = JSON.parse(JSON.stringify(current));
    legacy.schemaVersion = "0.2.0";
    delete legacy.tags;
    assert.ok(
      legacy.pages.some((page) => page.nodes.some((node) => Object.keys(node.bindings).length > 0)),
      target.name + " 历史迁移样本必须包含既有图元绑定",
    );

    // 旧 localStorage 草稿：启动时自动校验迁移，成功写入 IndexedDB 后清除旧副本。
    await evaluateStudioPage(session, seedLegacyLocalStorageDraftInPage, legacy, savedAt);
    await navigateStudioForInterop(session, target, "legacy-localstorage-" + target.name);
    const localMigrated = await waitForStudioDraftRevision(session, legacy.projectId, 1);
    assert.equal(localMigrated.document.schemaVersion, "0.3.0");
    assert.ok(localMigrated.document.tags.length > 0);
    assert.ok(localMigrated.document.tags.every((tag) => tag.dataType === "unknown"));
    assert.equal(
      await evaluateStudioPage(session, readLegacyLocalStorageDraftInPage, legacy.projectId),
      null,
      target.name + " localStorage 迁移成功后仍残留旧草稿副本",
    );
    const localTank = localMigrated.document.pages[0]?.nodes.find((node) => node.id === "tank");
    assert.deepStrictEqual(
      localTank?.bindings.level,
      { tagId: "water.level" },
      target.name + " localStorage 迁移改变了原有 Tag 绑定",
    );
    await evaluateStudioPage(
      session,
      studioDraftFileActionInPage,
      "恢复草稿",
      "已恢复 IndexedDB 草稿",
      true,
    );
    assert.deepStrictEqual(
      JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage)),
      localMigrated.document,
      target.name + " localStorage 历史草稿未能通过 Studio 恢复",
    );
    process.stdout.write(target.name + " localStorage 0.2.0 草稿迁移、旧副本清理和恢复通过\n");

    // 已存在的 IndexedDB 旧记录：同一数据库事务内迁移，并将 revision 从 4 推进到 5。
    await evaluateStudioPage(session, seedLegacyIndexedDbDraftInPage, legacy, 4, savedAt);
    await navigateStudioForInterop(session, target, "legacy-indexeddb-" + target.name);
    const indexedMigrated = await waitForStudioDraftRevision(session, legacy.projectId, 5);
    assert.equal(indexedMigrated.document.schemaVersion, "0.3.0");
    assert.ok(indexedMigrated.document.tags.every((tag) => tag.dataType === "unknown"));
    assert.deepStrictEqual(
      indexedMigrated.document.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level,
      { tagId: "water.level" },
      target.name + " IndexedDB 迁移改变了原有 Tag 绑定",
    );
    await evaluateStudioPage(
      session,
      studioDraftFileActionInPage,
      "恢复草稿",
      "已恢复 IndexedDB 草稿",
      true,
    );
    assert.deepStrictEqual(
      JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage)),
      indexedMigrated.document,
      target.name + " IndexedDB 历史草稿未能通过 Studio 恢复",
    );
    process.stdout.write(target.name + " IndexedDB 0.2.0 草稿事务迁移、修订号推进和恢复通过\n");

    // 先由真实 Studio/Dexie 打开并初始化历史库，再写入旧快照测试数据。
    const emptyVersions = await evaluateStudioPage(session, studioVersionRowsInPage);
    assert.deepStrictEqual(emptyVersions, [], target.name + " 新建浏览器上下文的历史版本库应为空");
    await evaluateStudioPage(session, async () => {
      const menu = document.querySelector(".studio-local-history-menu");
      const trigger = menu?.querySelector("button.t-button");
      if (!(trigger instanceof HTMLButtonElement)) {
        throw new TypeError("未找到本地版本历史 Popup 触发器");
      }
      if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) {
        throw new TypeError("历史版本库初始化后弹层意外关闭");
      }
      trigger.click();
      const started = Date.now();
      while (Date.now() - started < 5000) {
        if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new TypeError("写入旧快照前，本地历史弹层关闭超时");
    });

    // 历史 Project Snapshot：先验证原 SHA-256，再在只读返回值中归一化，不能改写原记录。
    const seededSnapshot = await evaluateStudioPage(
      session,
      seedLegacyProjectSnapshotInPage,
      legacy,
      1,
      createdAt,
    );
    const versions = await evaluateStudioPage(session, studioVersionRowsInPage);
    assert.deepStrictEqual(versions, ["版本 #1"], target.name + " 未发现旧版历史快照");
    await evaluateStudioPage(
      session,
      studioVersionActionInPage,
      "载入",
      "已载入本地版本 #1",
      true,
      1,
    );
    const snapshotDocument = JSON.parse(await evaluateStudioPage(session, exportStudioJsonInPage));
    assert.equal(snapshotDocument.schemaVersion, "0.3.0");
    assert.ok(snapshotDocument.tags.length > 0);
    assert.ok(snapshotDocument.tags.every((tag) => tag.dataType === "unknown"));
    assert.deepStrictEqual(
      snapshotDocument.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level,
      { tagId: "water.level" },
      target.name + " 历史快照迁移改变了原有 Tag 绑定",
    );
    const originalSnapshot = await evaluateStudioPage(
      session,
      readRawLegacyProjectSnapshotInPage,
      legacy.projectId,
      1,
    );
    assert.equal(originalSnapshot.contentHash, seededSnapshot.contentHash);
    assert.equal(originalSnapshot.document.schemaVersion, "0.2.0");
    assert.equal("tags" in originalSnapshot.document, false);
    process.stdout.write(target.name + " 历史快照 SHA-256 校验、只读归一化和原记录保留通过\n");
  }
}

/** 测试真实本地版本菜单，确认框只在隔离浏览器上下文中临时替换。 */
async function studioVersionActionInPage(
  label,
  expectedNotice,
  confirmChoice = null,
  revision = 1,
) {
  const menu = document.querySelector(".studio-local-history-menu");
  const trigger = menu?.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("未找到本地版本历史 Popup 触发器");
  }
  if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) {
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const panel = menu.querySelector(".studio-version-panel");
      if (
        panel?.getClientRects().length &&
        !panel.querySelector(".studio-version-tools button:disabled")
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) {
    throw new TypeError("本地版本历史 Popup 未能展开");
  }
  const candidates =
    label === "载入" || label === "查看差异"
      ? [...menu.querySelectorAll(".studio-version-item")]
          .filter(
            (item) => item.querySelector("strong")?.textContent.trim() === `版本 #${revision}`,
          )
          .flatMap((item) => [...item.querySelectorAll("button")])
      : [...menu.querySelectorAll(".studio-version-panel button")];
  const button = candidates.find((item) => item.textContent.trim() === label);
  if (!button) throw new Error("找不到版本历史操作按钮：" + label);
  if (button.disabled) throw new Error("版本历史操作尚未结束：" + label);
  button.click();
  if (confirmChoice !== null) {
    const confirmationStarted = Date.now();
    let choice = null;
    while (Date.now() - confirmationStarted < 12000) {
      choice = document.querySelector(
        confirmChoice ? ".t-dialog .t-dialog__confirm" : ".t-dialog .t-dialog__cancel",
      );
      if (choice?.getClientRects().length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(choice instanceof HTMLButtonElement)) {
      throw new TypeError("历史载入确认弹层未出现");
    }
    choice.click();
  }
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
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) {
    trigger.click();
    const opened = Date.now();
    while (Date.now() - opened < 12000) {
      const panel = menu.querySelector(".studio-version-panel");
      if (
        panel?.getClientRects().length &&
        !panel.querySelector(".studio-version-tools button:disabled")
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return {
    versions: [...menu.querySelectorAll(".studio-version-item strong")].map((item) =>
      item.textContent.trim(),
    ),
    comparison: menu.querySelector(".studio-version-comparison")?.textContent || "",
  };
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
    const created = await evaluate(studioVersionActionInPage, "创建快照", "已创建本地历史版本 #1");
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
    const second = await evaluate(studioVersionActionInPage, "创建快照", "已创建本地历史版本 #2");
    assert.deepStrictEqual(
      second.versions,
      ["版本 #2", "版本 #1"],
      target.name + " 历史版本未按最新修订号倒序排列",
    );
    process.stdout.write(target.name + " 历史版本创建、差异、取消载入、恢复及倒序列表通过\n");
  }
}

/** 等待真实 Studio 历史菜单读取数据库完成，用于刷新后持久化及 Origin 隔离。 */
async function studioVersionRowsInPage() {
  const menu = document.querySelector(".studio-local-history-menu");
  const trigger = menu?.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到本地版本历史 Popup 触发器");
  }
  if (!menu.querySelector(".studio-version-panel")?.getClientRects().length) trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const start = Date.now();
  while (Date.now() - start < 12000) {
    const panel = menu.querySelector(".studio-version-panel");
    const busy = panel?.querySelector(".studio-version-tools button:disabled");
    const error = menu.querySelector(".studio-version-error")?.textContent;
    if (error) throw new TypeError("历史版本查询失败：" + error);
    if (panel?.getClientRects().length && !busy) {
      return [...menu.querySelectorAll(".studio-version-item strong")].map((item) =>
        item.textContent.trim(),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  const panel = menu.querySelector(".studio-version-panel");
  const visibility = panel
    ? panel.getClientRects().length
      ? "弹层可见"
      : "弹层不可见"
    : "弹层未挂载";
  const busy = Boolean(panel?.querySelector(".studio-version-tools button:disabled"));
  throw new TypeError(`历史版本列表加载超时：${visibility}，忙碌=${busy}`);
}

/** 通过真实开关启动自动保存，不绕过 Studio 的确认和订阅逻辑。 */
async function enableStudioAutoSaveInPage(confirmExisting = false) {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new TypeError("没有找到文件与草稿菜单");
  const trigger = menu.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到 TDesign 文件草稿菜单触发器");
  }
  if (!menu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  const opening = Date.now();
  while (!menu.querySelector(".studio-file-popover")?.getClientRects().length) {
    if (Date.now() - opening > 5000) throw new TypeError("TDesign 文件草稿弹层展开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const button = [...menu.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === "开启自动保存",
  );
  if (!button) throw new TypeError("自动保存开关不是关闭状态");
  button.click();
  if (confirmExisting) {
    const confirmStart = Date.now();
    let confirmButton = null;
    while (Date.now() - confirmStart < 12000) {
      confirmButton = document.querySelector(".t-dialog .t-dialog__confirm");
      if (confirmButton?.getClientRects().length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new TypeError("开启自动保存覆盖确认弹层未出现");
    }
    confirmButton.click();
  }
  const start = Date.now();
  try {
    while (Date.now() - start < 12000) {
      const pressed = menu.querySelector('button[aria-pressed="true"]');
      if (pressed?.textContent.includes("暂停自动保存")) return true;
      const notice = document.querySelector(".studio-notice")?.textContent || "";
      if (notice.startsWith("开启自动保存失败")) throw new TypeError(notice);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new TypeError("开启自动保存超时");
  } finally {
    if (menu.querySelector(".studio-file-popover")?.getClientRects().length) {
      trigger.click();
    }
  }
}

/** 直接只读 IndexedDB 草稿，以区分当前编辑器工程和已持久化的数据。 */
async function readStudioDraftFromDatabaseInPage(projectId) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("adui-scada-studio");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开草稿数据库失败"));
  });
  try {
    if (!database.objectStoreNames.contains("drafts")) {
      throw new TypeError("草稿数据库缺少 drafts 数据表");
    }
    const record = await new Promise((resolve, reject) => {
      const tx = database.transaction("drafts", "readonly");
      const request = tx.objectStore("drafts").get(projectId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("读取草稿记录失败"));
      tx.onabort = () => reject(tx.error || new Error("草稿只读事务中止"));
    });
    return record === null ? null : JSON.parse(JSON.stringify(record));
  } finally {
    database.close();
  }
}

/** 版本菜单打开之前模拟浏览器拒绝打开历史库，不修改 IndexedDB 真实记录。 */
async function simulateHistoryDatabaseUnavailableInPage() {
  const menu = document.querySelector(".studio-local-history-menu");
  const trigger = menu?.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到本地版本历史 Popup 触发器");
  }
  if (menu.querySelector(".studio-version-panel")?.getClientRects().length) {
    throw new TypeError("历史版本弹层必须在关闭状态下测试存储失败");
  }
  const originalOpen = Reflect.get(IDBFactory.prototype, "open");
  if (typeof originalOpen !== "function") throw new TypeError("无法读取 IndexedDB 打开方法");
  IDBFactory.prototype.open = function (...args) {
    if (args[0] === "adui-scada-studio-versions") {
      throw new DOMException("模拟本地历史库不可访问", "SecurityError");
    }
    return Reflect.apply(originalOpen, this, args);
  };
  try {
    trigger.click();
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const error = menu.querySelector(".studio-version-error")?.textContent || "";
      if (error) return error;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new TypeError("历史库权限异常未显示错误提示");
  } finally {
    IDBFactory.prototype.open = originalOpen;
    if (menu.querySelector(".studio-version-panel")?.getClientRects().length) trigger.click();
  }
}

/** 异步 JSON 文件尚未读完时点击历史载入，不能插入执行或调用覆盖确认。 */
async function verifyImportHistoryIsolationInPage(json) {
  const fileMenu = document.querySelector(".studio-file-menu");
  const versionMenu = document.querySelector(".studio-local-history-menu");
  if (!fileMenu) throw new TypeError("未找到文件草稿菜单");
  const trigger = fileMenu.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) throw new TypeError("未找到文件草稿触发器");
  if (!fileMenu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  const opening = Date.now();
  while (!fileMenu.querySelector(".studio-file-popover")?.getClientRects().length) {
    if (Date.now() - opening > 5000) throw new TypeError("文件草稿弹层打开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const input = fileMenu.querySelector('.studio-import input[type="file"]');
  if (!input || !versionMenu) throw new TypeError("没有找到版本或 JSON 导入入口");
  const item = [...versionMenu.querySelectorAll(".studio-version-item")].find(
    (entry) => entry.querySelector("strong")?.textContent.trim() === "版本 #1",
  );
  const load = [...(item?.querySelectorAll("button") || [])].find(
    (button) => button.textContent.trim() === "载入",
  );
  if (!load) throw new TypeError("未找到历史版本 #1 的载入操作");
  const originalText = Reflect.get(Blob.prototype, "text");
  let releaseText = null;
  let confirmations = 0;
  Blob.prototype.text = function () {
    return new Promise((resolve) => {
      releaseText = () => resolve(json);
    });
  };
  try {
    const transfer = new DataTransfer();
    transfer.items.add(new File([json], "并发保护验收.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const started = Date.now();
    while (!releaseText && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (!releaseText) throw new TypeError("JSON 导入没有进入异步文件读取阶段");
    load.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    confirmations = [...document.querySelectorAll(".t-dialog .t-dialog__confirm")].filter(
      (element) => element.getClientRects().length,
    ).length;
    if (confirmations !== 0) {
      throw new TypeError("JSON 导入期间错误地显示历史覆盖确认");
    }
    releaseText();
    const ready = Date.now();
    while (Date.now() - ready < 12000) {
      const notice = document.querySelector(".studio-notice")?.textContent || "";
      if (notice.includes("工程 JSON 已校验并载入本地编辑器")) {
        return { confirmations, notice };
      }
      if (notice.includes("导入失败：")) throw new TypeError(notice);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new TypeError("释放文件读取后，工程导入未完成");
  } finally {
    releaseText?.();
    Blob.prototype.text = originalText;
    if (fileMenu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
    const versionTrigger = versionMenu?.querySelector("button.t-button");
    if (
      versionTrigger instanceof HTMLButtonElement &&
      versionMenu.querySelector(".studio-version-panel")?.getClientRects().length
    ) {
      versionTrigger.click();
    }
  }
}

async function runStudioVersionSafety(session) {
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
    await navigateStudioForInterop(session, target, "safety-first-" + target.name);
    const initial = JSON.parse(await evaluate(exportStudioJsonInPage));
    const empty = await evaluate(studioVersionRowsInPage);
    assert.deepStrictEqual(empty, [], target.name + " 新 Origin 不应读取到其他框架的历史");

    await evaluate(studioVersionActionInPage, "创建快照", "已创建本地历史版本 #1");
    await evaluate(enableStudioAutoSaveInPage);
    await evaluate(addStudioSymbolInPage, "+ 水箱");
    const modified = JSON.parse(await evaluate(exportStudioJsonInPage));
    assert.notDeepStrictEqual(initial, modified, target.name + " 编辑没有产生变更");

    const started = Date.now();
    let stored;
    while (Date.now() - started < 12000) {
      stored = await evaluate(readStudioDraftFromDatabaseInPage, modified.projectId);
      if (stored?.document && JSON.stringify(stored.document) === JSON.stringify(modified)) {
        break;
      }
      await pause(120);
    }
    assert.ok(stored?.revision >= 1, target.name + " 没有触发 IndexedDB 自动保存");
    assert.deepStrictEqual(stored.document, modified, target.name + " 草稿自动保存内容错误");

    await evaluate(studioVersionActionInPage, "载入", null, false, 1);
    const canceled = JSON.parse(await evaluate(exportStudioJsonInPage));
    assert.deepStrictEqual(canceled, modified, target.name + " 取消载入覆盖了当前工程");
    const stillEnabled = await session.evaluate(
      'Boolean(document.querySelector(".studio-file-menu button[aria-pressed=true]"))',
    );
    assert.equal(stillEnabled, true, target.name + " 取消载入不应关闭自动保存");

    await evaluate(studioVersionActionInPage, "载入", "已载入本地版本 #1", true, 1);
    const restored = JSON.parse(await evaluate(exportStudioJsonInPage));
    assert.deepStrictEqual(restored, initial, target.name + " 确认载入未恢复历史工程");
    const paused = await session.evaluate(
      'Boolean(document.querySelector(".studio-file-menu button[aria-pressed=true]"))',
    );
    assert.equal(paused, false, target.name + " 确认载入后自动保存未暂停");
    await pause(1400);
    const afterRestore = await evaluate(readStudioDraftFromDatabaseInPage, initial.projectId);
    assert.deepStrictEqual(afterRestore, stored, target.name + " 历史载入覆盖了已保存的本地草稿");

    await navigateStudioForInterop(session, target, "safety-error-" + target.name);
    const unavailable = await evaluate(simulateHistoryDatabaseUnavailableInPage);
    assert.ok(
      unavailable.includes("读取历史版本失败"),
      target.name + " 没有向用户提示存储权限异常",
    );
    assert.deepStrictEqual(
      JSON.parse(await evaluate(exportStudioJsonInPage)),
      initial,
      target.name + " 历史库读取错误污染了当前工程",
    );

    await navigateStudioForInterop(session, target, "safety-reload-" + target.name);
    const persisted = await evaluate(studioVersionRowsInPage);
    assert.deepStrictEqual(persisted, ["版本 #1"], target.name + " 浏览器刷新后丢失了本地历史版本");
    const again = await evaluate(studioVersionActionInPage, "创建快照", "已创建本地历史版本 #2");
    assert.deepStrictEqual(
      again.versions,
      ["版本 #2", "版本 #1"],
      target.name + " 存储异常恢复后无法继续追加版本",
    );
    const isolation = await evaluate(verifyImportHistoryIsolationInPage, JSON.stringify(modified));
    assert.equal(isolation.confirmations, 0, target.name + " 导入时发生了历史载入");
    assert.deepStrictEqual(
      JSON.parse(await evaluate(exportStudioJsonInPage)),
      modified,
      target.name + " 异步 JSON 导入被并发历史载入覆盖",
    );
    process.stdout.write(target.name + " 自动保存取消/确认保护、跨刷新持久性和存储异常恢复通过\n");
  }

  await navigateStudioForInterop(session, targets[0], "safety-react-return");
  const reactVersions = await evaluate(studioVersionRowsInPage);
  assert.deepStrictEqual(
    reactVersions,
    ["版本 #2", "版本 #1"],
    "Vue 的历史操作不应覆盖另一个 Origin 的 React 版本",
  );
  process.stdout.write("React / Vue 不同 Origin 历史版本隔离通过\n");
}

/** 只用现有 DOM 与可序列化输入，在独立标签页中执行交互。 */
function evaluateStudioPage(session, action, ...args) {
  return session.evaluate(
    "(" + action.toString() + ")(" + args.map((value) => JSON.stringify(value)).join(",") + ")",
  );
}

/** 等待自动保存开关与页面中文通知同时符合预期，拒绝仅凭定时猜测。 */
async function waitForStudioAutoSaveStateInPage(enabled, noticeText) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const button = document.querySelector(".studio-file-menu button[aria-pressed]");
    const actual = button?.getAttribute("aria-pressed") === "true";
    const notice = document.querySelector(".studio-notice")?.textContent || "";
    if (button && actual === enabled && notice.includes(noticeText)) return notice;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new TypeError("等待自动保存状态超时：" + noticeText);
}

/** 手动保存/清除必须真正点击 UI，确认提示仅在隔离页面内替换。 */
async function studioDraftFileActionInPage(label, expectedNotice, confirmChoice = null) {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new TypeError("未找到文件与草稿菜单");
  const trigger = menu.querySelector("button.t-button");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError("未找到 TDesign 文件草稿菜单触发器");
  }
  if (!menu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  const opening = Date.now();
  while (!menu.querySelector(".studio-file-popover")?.getClientRects().length) {
    if (Date.now() - opening > 5000) throw new TypeError("TDesign 文件草稿弹层展开超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const started = Date.now();
  let button = null;
  while (Date.now() - started < 12000) {
    button =
      label === "保存草稿"
        ? document.querySelector(".studio-save-actions button")
        : [...menu.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
    if (button && !button.disabled) break;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (!button || button.disabled) throw new TypeError("草稿操作按钮不可用：" + label);
  let resultNotice = null;
  try {
    button.click();
    if (confirmChoice !== null) {
      const confirmStart = Date.now();
      let choice = null;
      while (Date.now() - confirmStart < 12000) {
        choice = document.querySelector(
          confirmChoice ? ".t-dialog .t-dialog__confirm" : ".t-dialog .t-dialog__cancel",
        );
        if (choice?.getClientRects().length) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!(choice instanceof HTMLButtonElement)) {
        throw new TypeError("草稿确认弹层未出现：" + label);
      }
      choice.click();
    }
    const waiting = Date.now();
    while (Date.now() - waiting < 12000) {
      const notice = document.querySelector(".studio-notice")?.textContent || "";
      if (notice.includes(expectedNotice)) {
        resultNotice = notice;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (resultNotice === null) throw new TypeError("草稿操作结果超时：" + label);
  } finally {
    if (menu.querySelector(".studio-file-popover")?.getClientRects().length) {
      trigger.click();
    }
  }
  const closing = Date.now();
  while (menu.querySelector(".studio-file-popover")?.getClientRects().length) {
    if (Date.now() - closing > 5000) {
      throw new TypeError("TDesign 文件草稿弹层关闭超时");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return resultNotice;
}

/** 等待实际 IndexedDB 提交指定修订号，必要时校验完整工程内容。 */
async function waitForStudioDraftRevision(session, projectId, revision, document = null) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < 12000) {
    latest = await evaluateStudioPage(session, readStudioDraftFromDatabaseInPage, projectId);
    if (
      latest?.revision === revision &&
      (document === null || JSON.stringify(latest.document) === JSON.stringify(document))
    ) {
      return latest;
    }
    await pause(120);
  }
  throw new TypeError("等待 IndexedDB 草稿修订号超时：" + revision);
}

/** 仅在第二个标签页禁用 BroadcastChannel，以验证 IndexedDB 事务兜底。 */
async function navigateStudioWithoutBroadcast(session, target, marker) {
  const injection = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: [
      "window.BroadcastChannel = class {",
      "  constructor() { this.onmessage = null; }",
      "  postMessage() {}",
      "  close() {}",
      "};",
    ].join("\n"),
  });
  try {
    await navigateStudioForInterop(session, target, marker);
  } finally {
    await session.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: injection.identifier,
    });
  }
}

/** 在草稿对象仓库的真实 put 写入路径注入失败，且只影响隔离测试标签页。 */
async function simulateStudioDraftWriteFailureInPage() {
  const originalPut = Reflect.get(IDBObjectStore.prototype, "put");
  if (typeof originalPut !== "function") {
    throw new TypeError("浏览器不支持 IndexedDB 草稿写入测试");
  }
  let rejected = 0;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "drafts" && this.transaction.mode === "readwrite") {
      rejected += 1;
      throw new DOMException("模拟本地草稿存储故障", "QuotaExceededError");
    }
    return Reflect.apply(originalPut, this, args);
  };
  try {
    const button = [...document.querySelectorAll(".studio-add button")].find(
      (item) => item.textContent.trim() === "+ 水箱",
    );
    if (!button) throw new TypeError("未找到水箱图元添加按钮");
    button.click();
    const started = Date.now();
    let lastNotice = "";
    let lastEnabled = true;
    while (Date.now() - started < 12000) {
      lastNotice = document.querySelector(".studio-notice")?.textContent || "";
      lastEnabled =
        document
          .querySelector(".studio-file-menu button[aria-pressed]")
          ?.getAttribute("aria-pressed") === "true";
      if (lastNotice.includes("自动保存已暂停：") && !lastEnabled && rejected > 0) {
        return { notice: lastNotice, rejected };
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new TypeError(
      "模拟 IndexedDB 写入异常未触发自动保存暂停；拦截次数：" +
        rejected +
        "；自动保存：" +
        (lastEnabled ? "开启" : "关闭") +
        "；界面提示：" +
        lastNotice,
    );
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
}

/** 两个真实标签页共用同一浏览器配置，分别验证 Vue/React 业务 UI。 */
async function runStudioMultiTabSafety(first, second) {
  const viewport = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
  await Promise.all([
    first.send("Emulation.setDeviceMetricsOverride", viewport),
    second.send("Emulation.setDeviceMetricsOverride", viewport),
  ]);
  for (const target of targets) {
    // Vue 首次异步模块失败时附上 CDP HTTP/网络类别；不改变双标签并发和断言。
    const watchers = [];
    if (target.name === "Vue") {
      await Promise.all([first.send("Network.enable"), second.send("Network.enable")]);
      // 仅绕过两个测试标签页的 HTTP 缓存，不影响 IndexedDB 与 BroadcastChannel。
      await Promise.all([
        first.send("Network.setCacheDisabled", { cacheDisabled: true }),
        second.send("Network.setCacheDisabled", { cacheDisabled: true }),
      ]);
      watchers.push(watchStudioModuleNetwork(first, target));
      watchers.push(watchStudioModuleNetwork(second, target));
    }
    try {
      await Promise.all([
        navigateStudioForInterop(first, target, "multitab-first-" + target.name),
        navigateStudioForInterop(second, target, "multitab-second-" + target.name),
      ]);
    } catch (error) {
      if (watchers.length) {
        throw new Error(
          error.message +
            "；双标签页网络诊断：首标签=" +
            watchers[0].summary() +
            "；次标签=" +
            watchers[1].summary(),
        );
      }
      throw error;
    } finally {
      for (const watcher of watchers) watcher.stop();
    }
    const initial = JSON.parse(await evaluateStudioPage(first, exportStudioJsonInPage));
    assert.deepStrictEqual(
      JSON.parse(await evaluateStudioPage(second, exportStudioJsonInPage)),
      initial,
      target.name + " 两个标签页起始工程不一致",
    );
    assert.equal(
      await evaluateStudioPage(first, readStudioDraftFromDatabaseInPage, initial.projectId),
      null,
      target.name + " 隔离浏览器初始草稿并非空库",
    );

    // 正常广播：后打开的会话接收外部修订号，应暂停自动保存但保留本地画面。
    await evaluateStudioPage(second, enableStudioAutoSaveInPage);
    await evaluateStudioPage(first, enableStudioAutoSaveInPage);
    await evaluateStudioPage(first, addStudioSymbolInPage, "+ 水箱");
    const changedFirst = JSON.parse(await evaluateStudioPage(first, exportStudioJsonInPage));
    const firstSaved = await waitForStudioDraftRevision(first, initial.projectId, 1, changedFirst);
    await evaluateStudioPage(
      second,
      waitForStudioAutoSaveStateInPage,
      false,
      "其他标签页已修改草稿",
    );
    assert.deepStrictEqual(
      JSON.parse(await evaluateStudioPage(second, exportStudioJsonInPage)),
      initial,
      target.name + " 广播修改了第二个标签页未保存的画面",
    );
    await evaluateStudioPage(second, addStudioSymbolInPage, "+ 文本");
    await pause(1450);
    assert.deepStrictEqual(
      await evaluateStudioPage(second, readStudioDraftFromDatabaseInPage, initial.projectId),
      firstSaved,
      target.name + " 第二个标签页暂停后仍覆盖了草稿",
    );
    process.stdout.write(target.name + " 双标签页 BroadcastChannel 通知与停写保护通过\n");

    // 模拟浏览器不支持 BroadcastChannel：最终安全性必须依赖 IndexedDB CAS。
    await navigateStudioForInterop(first, target, "multitab-cas-first-" + target.name);
    await navigateStudioWithoutBroadcast(second, target, "multitab-cas-second-" + target.name);
    await evaluateStudioPage(second, enableStudioAutoSaveInPage, true);
    await evaluateStudioPage(first, enableStudioAutoSaveInPage, true);
    await evaluateStudioPage(first, addStudioSymbolInPage, "+ 水箱");
    const newer = JSON.parse(await evaluateStudioPage(first, exportStudioJsonInPage));
    const secondSaved = await waitForStudioDraftRevision(first, initial.projectId, 2, newer);
    await evaluateStudioPage(
      second,
      waitForStudioAutoSaveStateInPage,
      true,
      "IndexedDB 自动保存已开启",
    );
    await evaluateStudioPage(second, addStudioSymbolInPage, "+ 文本");
    await evaluateStudioPage(
      second,
      waitForStudioAutoSaveStateInPage,
      false,
      "自动保存已暂停：检测到其他页面修改了草稿",
    );
    assert.deepStrictEqual(
      await evaluateStudioPage(first, readStudioDraftFromDatabaseInPage, initial.projectId),
      secondSaved,
      target.name + " 无广播时过期修订号错误覆盖了较新草稿",
    );
    process.stdout.write(target.name + " 无广播时 IndexedDB 过期修订号保护通过\n");

    // 恢复正常广播后清除与重建，验证旧标签页停写及墓碑版本单调递增。
    await navigateStudioForInterop(second, target, "multitab-recreate-" + target.name);
    await evaluateStudioPage(
      second,
      studioDraftFileActionInPage,
      "清除草稿",
      "数据库草稿已清除",
      true,
    );
    await evaluateStudioPage(
      first,
      waitForStudioAutoSaveStateInPage,
      false,
      "其他标签页已修改草稿",
    );
    assert.equal(
      await evaluateStudioPage(first, readStudioDraftFromDatabaseInPage, initial.projectId),
      null,
      target.name + " 跨标签页清除草稿失败",
    );
    await evaluateStudioPage(second, addStudioSymbolInPage, "+ 文本");
    const recreatedDocument = JSON.parse(await evaluateStudioPage(second, exportStudioJsonInPage));
    await evaluateStudioPage(
      second,
      studioDraftFileActionInPage,
      "保存草稿",
      "已保存 IndexedDB 草稿",
    );
    const recreated = await waitForStudioDraftRevision(
      second,
      initial.projectId,
      3,
      recreatedDocument,
    );
    assert.deepStrictEqual(
      JSON.parse(await evaluateStudioPage(first, exportStudioJsonInPage)),
      newer,
      target.name + " 草稿清除重建错误覆盖了另一个标签页画面",
    );
    process.stdout.write(target.name + " 跨标签页草稿清除、墓碑修订号与重建通过\n");

    // 模拟写入权限异常，恢复正常事务后仍可由用户明确保存当前编辑画面。
    await evaluateStudioPage(second, enableStudioAutoSaveInPage, true);
    const failure = await evaluateStudioPage(second, simulateStudioDraftWriteFailureInPage);
    assert.ok(
      failure.notice.includes("自动保存已暂停：") && failure.rejected > 0,
      target.name + " 草稿写入故障未提供可见错误",
    );
    assert.deepStrictEqual(
      await evaluateStudioPage(first, readStudioDraftFromDatabaseInPage, initial.projectId),
      recreated,
      target.name + " 故障写入污染了已持久化草稿",
    );
    const unsaved = JSON.parse(await evaluateStudioPage(second, exportStudioJsonInPage));
    assert.notDeepStrictEqual(
      unsaved,
      recreatedDocument,
      target.name + " 故障后当前编辑画面意外丢失",
    );
    await evaluateStudioPage(
      second,
      studioDraftFileActionInPage,
      "保存草稿",
      "已保存 IndexedDB 草稿",
      true,
    );
    await waitForStudioDraftRevision(second, initial.projectId, 4, unsaved);
    process.stdout.write(target.name + " 模拟 IndexedDB 故障、编辑保护与恢复保存通过\n");
  }
}

async function main() {
  const browserPath = browserExecutable();
  assert.ok(browserPath, "未找到 Chrome/Edge，可设置 SCADA_BROWSER_PATH 指定浏览器路径");
  for (const target of targets) {
    await verifyStudioBrowserTarget(target);
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
  let companionSession;
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
    if (process.argv.includes("--release-preflight")) {
      await runStudioReleasePreflight(session);
      return;
    }
    if (process.argv.includes("--tags")) {
      await runStudioTagManagement(session);
      return;
    }
    if (process.argv.includes("--legacy")) {
      await runStudioLegacyMigration(session);
      return;
    }
    if (process.argv.includes("--versions")) {
      await runStudioVersionHistory(session);
      return;
    }
    if (process.argv.includes("--versions-safety")) {
      await runStudioVersionSafety(session);
      return;
    }
    if (process.argv.includes("--multitab")) {
      companionSession = await openCompanionChromeTab(port);
      await runStudioMultiTabSafety(session, companionSession);
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
    companionSession?.socket.close();
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
