/** 仅允许 Prisma 8 探针连接本机专用验收库，不回退到业务库。 */
export function requirePrisma8ReadOnlyTestUrl(input: string | undefined): string {
  const message = "Prisma 8 只读探针仅允许连接本机 15432 端口的 adui_scada_test 数据库";
  if (
    !input ||
    Array.from(input).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  ) {
    throw new Error(message);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(message);
  }

  const parameters = [...url.searchParams.entries()];
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    url.port !== "15432" ||
    url.pathname !== "/adui_scada_test" ||
    !url.username ||
    url.hash ||
    parameters.length > 1 ||
    parameters.some(([key, value]) => key !== "schema" || value !== "public")
  ) {
    throw new Error(message);
  }

  // Prisma 7 的 schema 参数不传递给 node-postgres。
  url.search = "";
  return url.toString();
}
