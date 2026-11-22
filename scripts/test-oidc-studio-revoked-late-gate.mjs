/** 只挂起页面收到的真实 GET 结果，不伪造 HTTP 响应或阻塞服务端写入。 */
export function installD5b5cLateGateInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location?.origin !== origin ||
    !/^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    ) ||
    !runtime.__aduiPublishedReadGuard ||
    runtime.__aduiD5b5cLateGate
  ) {
    throw new Error("D5b5c 真实只读响应门禁安装失败");
  }
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  const original = runtime.fetch.bind(runtime);
  const state = {
    path,
    origin,
    intercepted: 0,
    unexpected: 0,
    pending: false,
    delivered: false,
    settled: false,
    failed: false,
    status: null,
    noStore: false,
    direct: false,
    release: null,
  };
  runtime.__aduiD5b5cLateGate = state;
  runtime.fetch = (input, options) => {
    const raw =
      typeof input === "string"
        ? input
        : typeof input?.url === "string"
          ? input.url
          : typeof input?.href === "string"
            ? input.href
            : null;
    if (!raw) throw new Error("D5b5c 工程请求地址无效");
    const target = new URL(raw, origin + "/");
    if (target.origin !== origin || target.pathname !== path || target.search !== "") {
      return original(input, options);
    }
    const method = String(options?.method ?? input?.method ?? "GET").toUpperCase();
    if (method !== "GET") return original(input, options);
    if (
      options?.cache !== "no-store" ||
      options?.redirect !== "error" ||
      options?.credentials !== "same-origin" ||
      options?.body !== undefined ||
      state.intercepted !== 0
    ) {
      state.unexpected += 1;
      throw new Error("D5b5c 只允许一次精确的无缓存同源 GET");
    }
    state.intercepted += 1;
    return Promise.resolve(original(input, options))
      .then(
        (response) =>
          new Promise((resolve) => {
            state.status = response.status;
            state.noStore = response.headers?.get("cache-control") === "no-store";
            state.direct = response.redirected === false && response.url === origin + path;
            state.pending = true;
            state.release = () => {
              state.pending = false;
              state.delivered = true;
              state.release = null;
              resolve(response);
            };
          }),
      )
      .catch(() => {
        state.failed = true;
        throw new Error("D5b5c 真实只读请求失败");
      });
  };
  return true;
}

/** 在页面发起真实只读 GET，不等待响应；绝不调用工程写入接口。 */
export function startD5b5cLateReadInPage(runtime = globalThis) {
  const state = runtime.__aduiD5b5cLateGate;
  if (!state || state.intercepted !== 0 || state.settled || state.failed) {
    throw new Error("D5b5c 真实只读请求启动失败");
  }
  void runtime
    .fetch(state.path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    })
    .then((response) => {
      state.status = response.status;
      state.noStore = response.headers?.get("cache-control") === "no-store";
      state.direct = response.redirected === false && response.url === state.origin + state.path;
      state.settled = true;
    })
    .catch(() => {
      state.failed = true;
    });
  return true;
}

/** 仅披露可验证的布尔状态和 HTTP 状态码，不返回响应对象、正文、Cookie 或工程数据。 */
export function d5b5cLateReadStateInPage(runtime = globalThis) {
  const state = runtime.__aduiD5b5cLateGate;
  if (!state) return null;
  return {
    intercepted: state.intercepted,
    unexpected: state.unexpected,
    pending: state.pending,
    delivered: state.delivered,
    settled: state.settled,
    failed: state.failed,
    status: state.status,
    noStore: state.noStore,
    direct: state.direct,
  };
}

/** 只向发起页交付已经由真实网络完成的原始 Response，禁止补发请求。 */
export function releaseD5b5cLateReadInPage(runtime = globalThis) {
  const state = runtime.__aduiD5b5cLateGate;
  if (!state?.pending || state.delivered || typeof state.release !== "function") {
    throw new Error("D5b5c 真实响应尚未处于可释放状态");
  }
  state.release();
  return true;
}

/** 对实际 404/no-store/无重定向与交付时序进行闭集断言。 */
export function requireD5b5cLateReadState(state, phase) {
  if (
    !state ||
    !["pending", "settled"].includes(phase) ||
    state.intercepted !== 1 ||
    state.unexpected !== 0 ||
    state.failed !== false ||
    state.status !== 404 ||
    state.noStore !== true ||
    state.direct !== true ||
    (phase === "pending" && (state.pending !== true || state.delivered || state.settled)) ||
    (phase === "settled" && (state.pending || state.delivered !== true || state.settled !== true))
  ) {
    throw new Error("D5b5c 真实 404 响应挂起或释放时序不符合预期");
  }
  return true;
}
