import { describe, expect, it, vi } from "vite-plus/test";
import type { ScadaApiClient, ScadaProjectSummary } from "../src/index.ts";
import { createStudioProjectBrowser, STUDIO_PROJECT_PAGE_SIZE } from "../src/project-browser.ts";

const createdAt = "2026-11-16T00:00:00.000Z";
const records: readonly ScadaProjectSummary[] = Array.from({ length: 25 }, (_, index) => ({
  projectId: "project-" + String(index + 1).padStart(3, "0"),
  headRevision: 1,
  createdAt,
  updatedAt: createdAt,
}));

function createHarness(items: readonly ScadaProjectSummary[] = records) {
  const listProjects = vi.fn<ScadaApiClient["listProjects"]>(async (query) =>
    items
      .filter((item) => item.projectId > (query?.afterProjectId ?? ""))
      .slice(0, query?.limit ?? STUDIO_PROJECT_PAGE_SIZE),
  );
  return { browser: createStudioProjectBrowser({ listProjects }), listProjects };
}

describe("双框架共享的服务端工程列表分页会话", () => {
  it("首十项、下一页和上一页均使用稳定 ID 游标", async () => {
    const { browser, listProjects } = createHarness();
    const first = await browser.refresh();
    expect(first.projects).toHaveLength(10);
    expect(first.pageNumber).toBe(1);
    expect(first.hasPrevious).toBe(false);
    expect(first.hasNext).toBe(true);

    const second = await browser.next();
    expect(second.projects[0]?.projectId).toBe("project-011");
    expect(second.pageNumber).toBe(2);
    expect(second.hasPrevious).toBe(true);
    expect(listProjects).toHaveBeenNthCalledWith(2, {
      limit: 10,
      afterProjectId: "project-010",
    });

    const back = await browser.previous();
    expect(back.projects[0]?.projectId).toBe("project-001");
    expect(back.pageNumber).toBe(1);
    expect(listProjects).toHaveBeenCalledTimes(3);
  });

  it("不足十项的末页禁止继续翻页，刷新回到第一页", async () => {
    const { browser, listProjects } = createHarness();
    await browser.refresh();
    await browser.next();
    const third = await browser.next();
    expect(third.projects).toHaveLength(5);
    expect(third.hasNext).toBe(false);
    await browser.next();
    expect(listProjects).toHaveBeenCalledTimes(3);
    const refreshed = await browser.refresh();
    expect(refreshed.pageNumber).toBe(1);
    expect(refreshed.projects[0]?.projectId).toBe("project-001");
  });

  it("满十项的末页遇到空响应不会丢失当前列表", async () => {
    const { browser } = createHarness(records.slice(0, 10));
    await browser.refresh();
    const result = await browser.next();
    expect(result.pageNumber).toBe(1);
    expect(result.projects).toHaveLength(10);
    expect(result.hasNext).toBe(false);
  });

  it("初次未加载时翻页不触发 HTTP 请求", async () => {
    const { browser, listProjects } = createHarness();
    expect((await browser.next()).loaded).toBe(false);
    expect((await browser.previous()).hasPrevious).toBe(false);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("请求失败不覆盖当前页，可恢复重试", async () => {
    const { browser, listProjects } = createHarness();
    await browser.refresh();
    listProjects.mockRejectedValueOnce(new Error("模拟只读请求中断"));
    await expect(browser.next()).rejects.toThrow("模拟只读请求中断");
    expect(browser.snapshot().pageNumber).toBe(1);
    expect(browser.snapshot().projects[0]?.projectId).toBe("project-001");
    expect((await browser.next()).pageNumber).toBe(2);
  });

  it("分页请求进行时拒绝重复并发查询", async () => {
    let release: ((rows: readonly ScadaProjectSummary[]) => void) | undefined;
    const listProjects = vi.fn<ScadaApiClient["listProjects"]>(
      () =>
        new Promise<readonly ScadaProjectSummary[]>((resolve) => {
          release = resolve;
        }),
    );
    const browser = createStudioProjectBrowser({ listProjects });
    const pending = browser.refresh();
    await expect(browser.refresh()).rejects.toThrow("工程列表正在读取，请勿重复提交");
    expect(listProjects).toHaveBeenCalledTimes(1);
    release?.(records.slice(0, 3));
    expect((await pending).projects).toHaveLength(3);
  });
});
