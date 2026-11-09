import { useEffect, useState } from "react";
import {
  DemoRuntime,
  OfflineDemoRuntime,
  initialRuntimeState,
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
          {state.status.toUpperCase()}
        </span>
      </header>
      <p role="status" className="scada-message">
        {state.message}
      </p>
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
              <small data-quality={tag.quality}>{tag.quality}</small>
            </div>
          ))}
        </div>
      </section>
      <footer>仅模拟数据 · 只读监控 · 不连接 PLC/DCS</footer>
    </main>
  );
}
