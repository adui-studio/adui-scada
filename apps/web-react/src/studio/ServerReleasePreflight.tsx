import { useEffect, useMemo, useRef, useState } from "react";
import { compareProjectDocuments } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import {
  isScadaAccessRejection,
  readCurrentServerReleasePreflight,
  ScadaApiError,
} from "@adui/scada-api-client";
import type {
  ScadaApiClient,
  StudioServerReleasePreflight,
} from "@adui/scada-api-client";

interface ServerReleasePreflightProps {
  readonly api: ScadaApiClient;
  readonly document: ScadaDocument;
  readonly disabled: boolean;
  readonly onAccessRejected: (error: ScadaApiError) => void;
}

interface CheckedReleasePreflight extends StudioServerReleasePreflight {
  readonly requestedDocument: ScadaDocument;
}

/** 与本地静态预检分离：只检查服务端已保存的当前修订，不修改编辑会话。 */
export function ServerReleasePreflight({
  api,
  document,
  disabled,
  onAccessRejected,
}: ServerReleasePreflightProps) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<CheckedReleasePreflight | null>(null);
  const [failure, setFailure] = useState<{ document: ScadaDocument; message: string } | null>(
    null,
  );
  const inFlight = useRef(false);
  const active = useRef(true);
  const latestDocument = useRef(document);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    latestDocument.current = document;
  }, [document]);

  const visible = checked?.requestedDocument === document ? checked : null;
  const comparison = useMemo(
    () => (visible ? compareProjectDocuments(document, visible.snapshot.document) : null),
    [document, visible],
  );
  const error = failure?.document === document ? failure.message : "";

  async function checkSavedVersion(): Promise<void> {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setChecked(null);
    setFailure(null);
    const requestedDocument = document;
    try {
      const result = await readCurrentServerReleasePreflight(api, requestedDocument.projectId);
      if (active.current && latestDocument.current === requestedDocument) {
        setChecked({ ...result, requestedDocument });
      }
    } catch (cause) {
      if (active.current && latestDocument.current === requestedDocument) {
        if (isScadaAccessRejection(cause)) onAccessRejected(cause);
        setFailure({
          document: requestedDocument,
          message:
            cause instanceof ScadaApiError
              ? cause.message
              : "服务端发布预检失败，请检查当前登录和网络连接",
        });
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <section className="studio-version-panel" aria-label="服务端已保存版本发布预检">
      <p className="studio-version-help">
        服务端预检仅检查已保存的当前修订，与上方当前画布静态预检不同；不会保存、发布或修改草稿。
      </p>
      <button
        type="button"
        className="studio-version-more"
        disabled={disabled || busy}
        onClick={() => void checkSavedVersion()}
      >
        {busy ? "正在只读检查服务端版本…" : "检查服务端已保存版本"}
      </button>
      {error && (
        <p className="studio-version-error" role="alert">
          {error}；当前画布与 IndexedDB 草稿不变。
        </p>
      )}
      {checked && !visible && (
        <p className="studio-version-help">
          编辑内容已发生变化，之前的服务端预检结果已隐藏，请重新检查。
        </p>
      )}
      {visible && (
        <div>
          <p className="studio-version-help" role="status">
            服务端已保存版本 #{visible.report.revision}：
            {visible.report.passed ? "静态兼容性通过" : "静态兼容性未通过"}；
            {comparison?.sameContent
              ? "当前画布与所检查的快照一致"
              : "当前画布与已保存快照不同，当前画布不能视为通过服务端预检"}
            。该结果仅代表读取时的版本，不是正式发布许可。
          </p>
          {!visible.report.passed && (
            <ol className="studio-version-list" aria-label="服务端发布预检问题">
              {visible.report.issues.map((issue, index) => (
                <li
                  key={`${issue.code}:${issue.path}:${index}`}
                  className="studio-version-item"
                >
                  <code>{issue.path}</code>
                  <p className="studio-version-help">{issue.message}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
