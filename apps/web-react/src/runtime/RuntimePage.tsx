import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Select, Upload } from "tdesign-react";
import { readWorkspaceJson } from "@adui/scada-draft-storage";
import type { ScadaDocument, TagHistoryPoint } from "@adui/scada-core";
import { TAG_QUALITIES, TAG_QUALITY_LABELS } from "@adui/scada-core";
import {
  DemoRuntime,
  createLocalProjectSimulationSource,
  simulationHistoryCsv,
  simulationTrendPaths,
  OfflineDemoRuntime,
  formatRuntimeDataAge,
  formatRuntimeUpdateTime,
  initialRuntimeState,
  RUNTIME_STATUS_LABELS,
  svgDataUrl,
} from "@adui/scada-runtime";
import type { LocalProjectSimulationSource, RuntimeState } from "@adui/scada-runtime";

export default function RuntimePage() {
  const [selection, setSelection] = useState<{ project: ScadaDocument | null; revision: number }>({
    project: null,
    revision: 0,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  async function importProject(file: File): Promise<void> {
    const token = ++generation.current;
    setBusy(true);
    try {
      const result = await readWorkspaceJson(file);
      if (token !== generation.current) return;
      setSelection((previous) => ({ project: result.document, revision: previous.revision + 1 }));
      setNotice("工程已校验，当前仅为本地模拟运行，未执行正式发布");
    } catch {
      if (token === generation.current) setNotice("工程文件无效，保留当前运行会话");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  function resetProject(): void {
    generation.current += 1;
    setBusy(false);
    setSelection((previous) => ({ project: null, revision: previous.revision + 1 }));
    setNotice("");
  }

  return (
    <RuntimeMonitor
      key={selection.revision}
      project={selection.project}
      controls={
        <div className="scada-simulation-tools">
          <Upload
            theme="custom"
            accept=".json,application/json"
            autoUpload={false}
            files={[]}
            allowUploadDuplicateFile
            disabled={busy}
            onSelectChange={(files) => {
              const file = files[0];
              if (file) void importProject(file);
            }}
          >
            <Button size="small" variant="outline" disabled={busy}>
              导入工程模拟运行
            </Button>
          </Upload>
          {selection.project && (
            <Button size="small" theme="default" variant="outline" onClick={resetProject}>
              返回内置示例
            </Button>
          )}
          {notice && <span role="status">{notice}</span>}
        </div>
      }
    />
  );
}

function RuntimeMonitor({
  project,
  controls,
}: {
  project: ScadaDocument | null;
  controls: ReactNode;
}) {
  const [state, setState] = useState<RuntimeState>(initialRuntimeState);
  const [pageId, setPageId] = useState(project?.pages[0]?.id);
  const [historyTag, setHistoryTag] = useState(
    project?.tags.find((tag) => tag.dataType === "number")?.tagId ?? project?.tags[0]?.tagId,
  );
  const [history, setHistory] = useState<readonly TagHistoryPoint[]>([]);
  const sourceRef = useRef<LocalProjectSimulationSource | null>(null);

  useEffect(() => {
    if (project) {
      const source = createLocalProjectSimulationSource(project);
      sourceRef.current = source;
      const runtime = new DemoRuntime((next) => {
        setState(next);
        setHistory(source.history());
      }, source);
      void runtime.start();
      return () => {
        sourceRef.current = null;
        runtime.stop();
      };
    }
    const runtime =
      import.meta.env.MODE === "desktop"
        ? new OfflineDemoRuntime(setState)
        : new DemoRuntime(setState);
    void runtime.start();
    return () => runtime.stop();
  }, [project]);

  const svg = state.document ? svgDataUrl(state.document, state.values, pageId) : null;
  const paths = simulationTrendPaths(history);

  return (
    <main id="scada-main-content" tabIndex={-1} className="scada-shell scada-shell--overview">
      <header className="scada-header">
        <div>
          <p className="scada-eyebrow">ADui SCADA · 本地模拟运行</p>
          <h1>{project ? (project.projectName ?? project.projectId) : "水处理实时监控"}</h1>
        </div>
        <span className="scada-status" data-status={state.status}>
          {RUNTIME_STATUS_LABELS[state.status]}
        </span>
      </header>
      {controls}
      <p role="status" className="scada-message">
        {state.message}
      </p>
      <div className="scada-monitor-layout">
        <section className="scada-panel scada-process-panel" aria-label="模拟工业监控画面">
          <h2>{project ? "导入工程只读模拟" : "模拟工艺流程"}</h2>
          <p className="scada-panel-subtitle">只读演示画面 · 不代表现场设备数据</p>
          {project && (
            <div className="scada-simulation-tools">
              <span>页面</span>
              <Select
                size="small"
                value={pageId}
                options={project.pages.map((page) => ({ label: page.name, value: page.id }))}
                onChange={(value) => {
                  if (
                    typeof value === "string" &&
                    project.pages.some((page) => page.id === value)
                  ) {
                    setPageId(value);
                  }
                }}
              />
            </div>
          )}
          {svg ? (
            <img
              className="scada-svg"
              src={svg}
              alt={project ? "导入工程模拟监控" : "水箱、水泵与流量模拟监控"}
            />
          ) : (
            <p>正在加载工程…</p>
          )}
        </section>
        <div className="scada-monitor-side">
          <section className="scada-panel scada-diagnostics" aria-label="本地实时链路诊断">
            <h2>实时链路诊断</h2>
            <p className="scada-diagnostics-note">
              本机只读观测 · 数据年龄为接受有效 Tag 后经过的时间，并非网络传输延迟
            </p>
            <dl className="scada-diagnostics-grid">
              <div>
                <dt>连接状态</dt>
                <dd>{RUNTIME_STATUS_LABELS[state.status]}</dd>
              </div>
              <div>
                <dt>断连过程次数</dt>
                <dd>{state.diagnostics.reconnectCount}</dd>
              </div>
              <div>
                <dt>最近有效更新</dt>
                <dd>{formatRuntimeUpdateTime(state.diagnostics.lastTagReceivedAt)}</dd>
              </div>
              <div>
                <dt>观测时数据年龄</dt>
                <dd>{formatRuntimeDataAge(state.diagnostics.dataAgeMs)}</dd>
              </div>
            </dl>
            <div className="scada-quality-summary" role="group" aria-label="Tag 质量分布">
              {TAG_QUALITIES.map((quality) => (
                <div key={quality} className="scada-quality-item" data-quality={quality}>
                  <span>{TAG_QUALITY_LABELS[quality]}</span>
                  <strong>{state.diagnostics.qualityCounts[quality]}</strong>
                </div>
              ))}
            </div>
            <p className="scada-diagnostics-total">当前 Tag 总数：{state.diagnostics.tagCount}</p>
            <section className="scada-status-history" aria-label="最近状态变化">
              <h3>最近状态变化</h3>
              <p className="scada-diagnostics-note">最多 20 条 · 仅当前会话 · 非报警历史</p>
              {state.diagnostics.statusEvents.length === 0 ? (
                <p className="scada-diagnostics-empty">暂无状态变化</p>
              ) : (
                <ol className="scada-status-events">
                  {state.diagnostics.statusEvents.map((event) => (
                    <li key={event.sequence} data-status={event.status}>
                      <span>{RUNTIME_STATUS_LABELS[event.status]}</span>
                      <time dateTime={new Date(event.occurredAt).toISOString()}>
                        {formatRuntimeUpdateTime(event.occurredAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </section>
          {project && (
            <section className="scada-panel scada-simulation-history" aria-label="本地模拟趋势">
              <h2>本地模拟趋势</h2>
              <p className="scada-panel-subtitle">最近 120 秒 · 单 Tag · 当前会话 · 不写入数据库</p>
              {project.tags.length > 0 && (
                <Select
                  size="small"
                  value={historyTag}
                  options={project.tags.map((tag) => ({
                    label: tag.displayName,
                    value: tag.tagId,
                  }))}
                  onChange={(value) => {
                    if (
                      typeof value !== "string" ||
                      !project.tags.some((tag) => tag.tagId === value)
                    )
                      return;
                    sourceRef.current?.selectHistoryTag(value);
                    setHistoryTag(value);
                    setHistory([]);
                  }}
                />
              )}
              <svg
                viewBox="0 0 320 120"
                role="img"
                aria-label="模拟数值趋势，范围零至一百"
                className="scada-simulation-chart"
              >
                <path
                  d="M 8 8 H 312 M 8 60 H 312 M 8 112 H 312"
                  className="scada-simulation-grid"
                />
                {paths.map((path) => (
                  <path key={path} d={path} className="scada-simulation-line" />
                ))}
              </svg>
              <p className="scada-panel-subtitle">
                {history.length === 0
                  ? "暂无采样"
                  : paths.length === 0
                    ? "当前没有正常数值点"
                    : "合成数值范围 0～100，非工程量程"}
              </p>
              {history.length > 0 && (
                <a
                  download="本地模拟历史.csv"
                  href={
                    "data:text/csv;charset=utf-8," +
                    encodeURIComponent("\uFEFF" + simulationHistoryCsv(history))
                  }
                >
                  导出当前模拟历史 CSV（{history.length} 条）
                </a>
              )}
            </section>
          )}
          <section className="scada-panel scada-values-panel" aria-label="Tag 质量与最近值">
            <h2>Tag 质量与最近值</h2>
            {state.values.length === 0 && (
              <p className="scada-diagnostics-empty">暂无可显示的 Tag 数据</p>
            )}
            <div className="scada-tags">
              {state.values.map((tag) => (
                <div className="scada-tag" key={tag.tagId}>
                  <strong>{tag.tagId}</strong>
                  <span>{tag.quality === "GOOD" ? String(tag.value ?? "--") : "--"}</span>
                  <small data-quality={tag.quality}>{TAG_QUALITY_LABELS[tag.quality]}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <footer>仅模拟数据 · 只读监控 · 不连接 PLC/DCS</footer>
    </main>
  );
}
