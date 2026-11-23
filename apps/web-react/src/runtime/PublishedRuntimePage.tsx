import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "tdesign-react";
import "tdesign-react/es/style/index.css";
import { createScadaApiClient } from "@adui/scada-api-client";
import {
  PUBLISHED_RUNTIME_EMPTY_HINTS,
  PUBLISHED_RUNTIME_STATUS_LABELS,
  PublishedRuntime,
  PublishedRuntimeRefresher,
  initialPublishedRuntimeState,
  publishedSnapshotSvg,
} from "@adui/scada-runtime";
import type { PublishedRuntimeState } from "@adui/scada-runtime";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** 只从服务端正式发布指针加载配置，不访问 Studio 草稿或模拟设备。 */
export default function PublishedRuntimePage() {
  const [projectId, setProjectId] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [state, setState] = useState<PublishedRuntimeState>(initialPublishedRuntimeState);
  const [message, setMessage] = useState("");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const refresherRef = useRef<PublishedRuntimeRefresher | null>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    const api = createScadaApiClient();
    const runtime = new PublishedRuntime((next) => {
      if (!lifetime.signal.aborted) setState(next);
    }, api);
    const refresher = new PublishedRuntimeRefresher(runtime);
    refresherRef.current = refresher;

    const onVisibilityChange = () => {
      void refresher.setVisible(document.visibilityState === "visible").catch(() => {
        if (!lifetime.signal.aborted) setMessage("发布运行状态切换失败，请重新启动读取");
      });
    };
    const onPageHide = () => {
      refresher.stop();
      if (!lifetime.signal.aborted) {
        setActiveProjectId(null);
        setSelectedPageId(null);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      lifetime.abort();
      refresherRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      refresher.stop();
    };
  }, []);

  const pages = state.status === "verified" ? (state.snapshot?.document.pages ?? []) : [];
  const activePageId = pages.some((page) => page.id === selectedPageId)
    ? selectedPageId
    : (pages[0]?.id ?? null);
  const svg = useMemo(
    () =>
      state.status === "verified" && state.snapshot && activePageId
        ? publishedSnapshotSvg(state.snapshot, activePageId)
        : null,
    [state.status, state.snapshot, activePageId],
  );

  function onStart(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const id = projectId.trim();
    if (!PROJECT_ID_PATTERN.test(id)) {
      setMessage("工程 ID 必须是 1～128 位字母、数字、点、下划线或连字符");
      return;
    }
    const refresher = refresherRef.current;
    if (!refresher) return;
    setMessage("");
    setSelectedPageId(null);
    setActiveProjectId(id);
    void refresher.start(id).catch(() => {
      setMessage("正式发布读取启动失败，已停止运行会话");
    });
  }

  function onRefresh(): void {
    const refresher = refresherRef.current;
    if (!refresher) return;
    setMessage("");
    void refresher.refresh().catch(() => {
      setMessage("发布指针刷新失败，请重新启动读取");
    });
  }

  function onStop(): void {
    refresherRef.current?.stop();
    setActiveProjectId(null);
    setSelectedPageId(null);
    setMessage("");
  }

  return (
    <main
      id="scada-main-content"
      tabIndex={-1}
      className="scada-shell scada-shell--published"
      data-testid="published-runtime-page"
    >
      <header className="scada-header">
        <div>
          <p className="scada-eyebrow">ADui SCADA · 正式发布配置只读监控</p>
          <h1>已发布工程运行</h1>
        </div>
        <span className="scada-status" data-status={state.status}>
          {PUBLISHED_RUNTIME_STATUS_LABELS[state.status]}
        </span>
      </header>
      <p className="scada-message" role="status" data-testid="published-runtime-status">
        {state.message}
      </p>
      <section className="scada-panel scada-published-controls-panel" aria-label="正式发布工程选择">
        <h2>读取已发布工程</h2>
        <p className="scada-diagnostics-note">
          独立 release:read 权限 · 仅使用当前登录会话 · 不读取编辑草稿或模拟数据
        </p>
        <form onSubmit={onStart} className="scada-published-controls">
          <label htmlFor="published-react-project-id">工程 ID</label>
          <input
            id="published-react-project-id"
            name="projectId"
            type="text"
            maxLength={128}
            value={projectId}
            autoComplete="off"
            spellCheck={false}
            placeholder="输入已授权工程 ID"
            onChange={(event) => setProjectId(event.target.value)}
          />
          <Button type="submit">读取正式发布</Button>
          <Button type="button" variant="outline" disabled={!activeProjectId} onClick={onRefresh}>
            立即刷新
          </Button>
          <Button type="button" variant="text" disabled={!activeProjectId} onClick={onStop}>
            停止读取
          </Button>
        </form>
        {message ? <p role="alert">{message}</p> : null}
      </section>
      <section className="scada-panel scada-published-summary-panel" aria-label="正式发布状态">
        <h2>已提交发布指针</h2>
        <dl className="scada-diagnostics-grid">
          <div>
            <dt>工程</dt>
            <dd>{state.projectId ?? "未选择"}</dd>
          </div>
          <div>
            <dt>发布代次</dt>
            <dd>{state.releaseGeneration ?? "--"}</dd>
          </div>
          <div>
            <dt>发布修订</dt>
            <dd>{state.snapshot?.revision ?? "--"}</dd>
          </div>
          <div>
            <dt>实时 Tag 质量</dt>
            <dd>不可用 · UNAVAILABLE</dd>
          </div>
        </dl>
      </section>
      <section
        className="scada-panel scada-published-preview-panel"
        aria-label="已发布静态组态预览"
      >
        <h2>已发布组态静态预览</h2>
        {pages.length > 1 ? (
          <div className="scada-published-controls">
            <label htmlFor="published-react-page-id">组态页面</label>
            <select
              id="published-react-page-id"
              data-testid="published-runtime-page-select"
              value={activePageId ?? ""}
              onChange={(event) => setSelectedPageId(event.target.value)}
            >
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="scada-diagnostics-note">
          此画面只来自已验证的正式发布快照；未连接现场 Tag。 画布内缺失值的 BAD
          占位不代表设备故障诊断。
        </p>
        {svg ? (
          <img
            className="scada-svg"
            src={svg}
            alt="已发布组态静态配置预览，实时 Tag 数据未接入"
            data-testid="published-runtime-svg"
          />
        ) : (
          <p className="scada-diagnostics-empty">{PUBLISHED_RUNTIME_EMPTY_HINTS[state.status]}</p>
        )}
      </section>
      <footer>正式发布只读 · 未接入现场数据 · 不开放设备控制</footer>
    </main>
  );
}
