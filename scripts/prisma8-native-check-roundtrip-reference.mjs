import { isDeepStrictEqual } from "node:util";
import { roundTripTarget } from "./prisma8-native-check-roundtrip-execution.mjs";

export const referenceConfirmation = "--confirm-frozen-catalog-readonly";
const mainDatabases = [
  "adui_scada_test",
  "adui_scada_fresh_prisma8_ref",
  "adui_scada_fresh_prisma8_native",
];
const reproDatabase = "adui_scada_fresh_prisma8_repro";
const reproRole = "adui_scada_native_repro";
const mainRole = "adui_scada";
const containerIdPattern = /^[a-f0-9]{64}$/u;
const systemIdPattern = /^[1-9][0-9]{0,19}$/u;
const localePattern = /^[a-zA-Z0-9_.@+-]{1,128}$/u;
const versionPattern = /^[a-zA-Z0-9_.+-]{1,128}$/u;
const localeRuntimeRoots = [
  "/lib",
  "/lib64",
  "/usr/lib",
  "/usr/local/lib",
  "/usr/share/i18n",
  "/usr/share/locale",
  "/usr/local/share/i18n",
  "/usr/local/share/locale",
  "/etc/locale.conf",
  "/etc/locale.gen",
  "/etc/locale.alias",
  "/etc/default/locale",
  "/etc/environment",
  "/etc/ld.so.conf",
  "/etc/ld.so.conf.d",
  "/etc/ld.so.cache",
  "/etc/ld.so.preload",
  "/etc/os-release",
];

export class RoundTripReferenceError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new RoundTripReferenceError(message);
}

function isLocaleRuntimePath(path) {
  return localeRuntimeRoots.some(
    (root) =>
      path === root || path.startsWith(root + "/") || root.startsWith(path + "/") || path === "/",
  );
}

function isCanonicalPath(path) {
  return (
    typeof path === "string" &&
    path.length <= 1024 &&
    path.startsWith("/") &&
    (path === "/" ||
      path
        .slice(1)
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== "..")) &&
    !Array.from(path).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || code === 92;
    })
  );
}

/** 仅核对容器挂载目标，不读取或回显宿主机路径。 */
function requireUnmodifiedLocaleMounts(value, stage) {
  let mounts;
  try {
    mounts = JSON.parse(value);
  } catch {
    throw new RoundTripReferenceError(stage + "：容器挂载清单无效");
  }
  requireMatch(
    Array.isArray(mounts) && mounts.every(isCanonicalPath),
    stage + "：容器挂载清单无效",
  );
  requireMatch(!mounts.some(isLocaleRuntimePath), stage + "：容器挂载覆盖 libc 或 locale 环境");
}

/** 仅检查固定路径及其祖先的可见变更，不证明实际进程加载的库相同。 */
function requireUnchangedLocaleRuntime(output, stage) {
  const changes = output === "" ? [] : output.split(/\r?\n/u);
  requireMatch(
    changes.every((line) => /^[ACD] /u.test(line) && isCanonicalPath(line.slice(2))),
    stage + "：容器文件变更清单格式异常",
  );
  requireMatch(
    !changes.some((line) => isLocaleRuntimePath(line.slice(2))),
    stage + "：容器 libc 或 locale 文件发生变化",
  );
}

/** 固定系统目录读取，不读取业务表或接收外部 SQL。 */
function catalogQuery(databases) {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_catalog.jsonb_build_object(
  'database', current_database(), 'role', current_user,
  'version', current_setting('server_version_num')::integer,
  'readOnly', current_setting('transaction_read_only') = 'on',
  'defaultReadOnly', current_setting('default_transaction_read_only') = 'on',
  'isolation', current_setting('transaction_isolation'),
  'systemIdentifier', (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'rows', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'database', datname, 'encoding', pg_catalog.pg_encoding_to_char(encoding),
    'provider', datlocprovider::text, 'collate', datcollate, 'ctype', datctype,
    'locale', datlocale, 'version', datcollversion,
    'actualVersion', pg_catalog.pg_database_collation_actual_version(oid),
    'customIcuRules', daticurules IS NOT NULL))
    FROM pg_catalog.pg_database WHERE datname IN (${databases.map((name) => "'" + name + "'").join(", ")})));
ROLLBACK;`;
}

function readCatalog(local, container, role, database, names) {
  const result = local(
    [
      "exec",
      "--user",
      "postgres",
      container,
      "env",
      "-i",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000 -c search_path=pg_catalog -c timezone=UTC",
      "PGAPPNAME=adui_scada_roundtrip_reference",
      "psql",
      "-X",
      "-w",
      "-q",
      "-A",
      "-t",
      "-h",
      "/var/run/postgresql",
      "-p",
      "5432",
      "-U",
      role,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      catalogQuery(names),
    ],
    "读取冻结库系统目录",
  );
  let facts;
  try {
    facts = JSON.parse(result);
  } catch {
    throw new RoundTripReferenceError("冻结库系统目录不是唯一合法 JSON");
  }
  requireMatch(
    facts &&
      facts.database === database &&
      facts.role === role &&
      facts.version === roundTripTarget.serverVersionNum &&
      facts.readOnly === true &&
      facts.defaultReadOnly === true &&
      facts.isolation === "repeatable read" &&
      typeof facts.systemIdentifier === "string" &&
      systemIdPattern.test(facts.systemIdentifier) &&
      Array.isArray(facts.rows) &&
      facts.rows.length === names.length,
    "冻结库身份、版本、只读事务或目录数量不符合预期",
  );
  const observed = new Map();
  for (const row of facts.rows) {
    requireMatch(
      row && names.includes(row.database) && !observed.has(row.database),
      "冻结库目录名称缺失或重复",
    );
    const versionValuesMatch = row.version === row.actualVersion;
    const versionValuesAvailable = row.version !== null && row.actualVersion !== null;
    requireMatch(
      row.encoding === "UTF8" &&
        ["c", "i", "b"].includes(row.provider) &&
        [row.collate, row.ctype].every(
          (value) => typeof value === "string" && localePattern.test(value),
        ) &&
        (row.provider === "c"
          ? row.locale === null
          : typeof row.locale === "string" && localePattern.test(row.locale)) &&
        (row.version === null ||
          (typeof row.version === "string" && versionPattern.test(row.version))) &&
        (row.actualVersion === null ||
          (typeof row.actualVersion === "string" && versionPattern.test(row.actualVersion))) &&
        versionValuesMatch &&
        (versionValuesAvailable || row.provider === "c") &&
        row.customIcuRules === false,
      "冻结库编码、排序规则版本或自定义规则需另行评审",
    );
    observed.set(row.database, {
      encoding: row.encoding,
      provider: row.provider,
      collate: row.collate,
      ctype: row.ctype,
      locale: row.locale,
      version: row.version,
      actualVersion: row.actualVersion,
    });
  }
  return { systemIdentifier: facts.systemIdentifier, observed };
}

/** 只读采集两座容器的共享系统目录及受限运行环境观察。 */
export function collectRoundTripReference(report, local) {
  const mainId = local(
    [
      "container",
      "ls",
      "--filter",
      "label=com.docker.compose.project=adui-scada",
      "--filter",
      "label=com.docker.compose.service=postgres",
      "--no-trunc",
      "--format",
      "{{.ID}}",
    ],
    "定位历史验收容器",
  );
  requireMatch(containerIdPattern.test(mainId), "未找到唯一运行中的历史验收容器");
  const mainIdentity = local(
    [
      "container",
      "inspect",
      "--format",
      '{{.Id}}|{{.State.Running}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|[{{range $i, $mount := .Mounts}}{{if $i}},{{end}}{{json $mount.Destination}}{{end}}]',
      mainId,
    ],
    "核对历史验收容器身份",
  ).split("|");
  const [mainIdFromInspect, mainRunning, mainImage, project, service, mainMounts] = mainIdentity;
  requireMatch(
    mainIdentity.length === 6 &&
      mainIdFromInspect === mainId &&
      mainRunning === "true" &&
      mainImage === roundTripTarget.image &&
      project === "adui-scada" &&
      service === "postgres",
    "历史验收容器身份或固定镜像不一致",
  );
  requireUnmodifiedLocaleMounts(mainMounts, "历史验收容器");

  const reproIdentity = local(
    [
      "container",
      "inspect",
      "--format",
      '{{.Id}}|{{.State.Running}}|{{.Image}}|{{index .Config.Labels "org.adui.scope"}}|[{{range $i, $mount := .Mounts}}{{if $i}},{{end}}{{json $mount.Destination}}{{end}}]',
      "adui-scada-prisma8-repro",
    ],
    "核对第四座保留容器身份",
  ).split("|");
  const [reproId, running, image, scope, reproMounts] = reproIdentity;
  requireMatch(
    reproIdentity.length === 5 &&
      containerIdPattern.test(reproId) &&
      reproId !== mainId &&
      running === "true" &&
      image === roundTripTarget.image &&
      scope === "prisma8-native-repro",
    "第四座保留容器身份或固定镜像不一致",
  );
  requireUnmodifiedLocaleMounts(reproMounts, "第四座保留容器");

  requireUnchangedLocaleRuntime(
    local(["diff", mainId], "检查历史验收容器 libc 与 locale 文件"),
    "历史验收容器",
  );
  requireUnchangedLocaleRuntime(
    local(["diff", reproId], "检查第四座容器 libc 与 locale 文件"),
    "第四座保留容器",
  );

  const historical = readCatalog(local, mainId, mainRole, mainDatabases[0], mainDatabases);
  const repro = readCatalog(local, reproId, reproRole, reproDatabase, [reproDatabase]);
  requireMatch(
    historical.systemIdentifier !== repro.systemIdentifier,
    "两座容器的 PostgreSQL 集群标识重复",
  );
  const referenceCollation = historical.observed.get(mainDatabases[0]);
  const allCollationsMatch =
    referenceCollation &&
    [...historical.observed.values(), ...repro.observed.values()].every((value) =>
      isDeepStrictEqual(value, referenceCollation),
    );
  requireMatch(allCollationsMatch, "四个冻结库的排序规则不一致，需独立评审");

  const versionObservations = [...historical.observed.values(), ...repro.observed.values()];
  const recordedCollationVersionAvailable = versionObservations.every(
    (value) => value.version !== null && value.actualVersion !== null,
  );
  const recordedCollationVersionMatches = recordedCollationVersionAvailable ? true : null;

  return {
    ...report,
    status: "NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED",
    referenceCatalogObserved: true,
    observedDatabaseCount: 4,
    observedClusterCount: 2,
    allFrozenCollationsMatch: true,
    allFrozenCollationCatalogMetadataMatch: true,
    containerImageIdentityMatched: true,
    localeRuntimePathsObservedUnchanged: true,
    collationRuntimeIdentityVerified: false,
    referenceCollation,
    recordedCollationVersionAvailable,
    recordedCollationVersionMatches,
    recordedCollationVersionStatus: recordedCollationVersionAvailable ? "MATCHED" : "UNAVAILABLE",
  };
}
