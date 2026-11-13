import { useEffect, useState } from "react";
import { TAG_QUALITIES, TAG_QUALITY_LABELS } from "@adui/scada-core";
import {
  DemoRuntime,
  OfflineDemoRuntime,
  formatRuntimeDataAge,
  formatRuntimeUpdateTime,
  initialRuntimeState,
  RUNTIME_STATUS_LABELS,
  svgDataUrl,
} from "@adui/scada-runtime";
import type { RuntimeState } from "@adui/scada-runtime";

export default function RuntimePage() {
  const [state, setState] = useState<RuntimeState>(initialRuntimeState);

  useEffect(() => {
    const runtime =
      import.meta.env.MODE === "desktop"
        ? new OfflineDemoRuntime(setState)
        : new DemoRuntime(setState);
    void runtime.start();
    return () => runtime.stop();
  }, []);

  const svg = state.document ? svgDataUrl(state.document, state.values) : null;

  return (
    <main className="scada-shell">
      <header className="scada-header">
        <div>
          <p className="scada-eyebrow">ADui SCADA · V0.1</p>
          <h1>水处理实时监控</h1>
        </div>
        <span className="scada-status" data-status={state.status}>
          {RUNTIME_STATUS_LABELS[state.status]}
        </span>
      </header>
      <p role="status" className="scada-message">
        {state.message}
      </p>
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
      <section className="scada-panel" aria-label="模拟工业监控画面">
        {svg ? (
          <img className="scada-svg" src={svg} alt="水箱、水泵与流量模拟监控" />
        ) : (
          <p>正在加载工程...</p>
        )}
      </section>
      <section className="scada-panel">
        <h2>Tag 质量与最近值</h2>
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
      <footer>仅模拟数据 · 只读监控 · 不连接 PLC/DCS</footer>
    </main>
  );
}
