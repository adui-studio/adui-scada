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

export class RoundTripReferenceError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new RoundTripReferenceError(message);
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
        row.version === row.actualVersion &&
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
    });
  }
  return { systemIdentifier: facts.systemIdentifier, observed };
}

/** 只读采集两座容器的共享系统目录，四个冻结库均不执行写入。 */
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
      '{{.Id}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}',
      mainId,
    ],
    "核对历史验收容器身份",
  );
  requireMatch(mainIdentity === mainId + "|true|adui-scada|postgres", "历史验收容器身份不一致");
  const reproIdentity = local(
    [
      "container",
      "inspect",
      "--format",
      '{{.Id}}|{{.State.Running}}|{{.Image}}|{{index .Config.Labels "org.adui.scope"}}',
      "adui-scada-prisma8-repro",
    ],
    "核对第四座保留容器身份",
  ).split("|");
  const [reproId, running, image, scope] = reproIdentity;
  requireMatch(
    reproIdentity.length === 4 &&
      containerIdPattern.test(reproId) &&
      reproId !== mainId &&
      running === "true" &&
      image === roundTripTarget.image &&
      scope === "prisma8-native-repro",
    "第四座保留容器身份不一致",
  );
  const historical = readCatalog(local, mainId, mainRole, mainDatabases[0], mainDatabases);
  const repro = readCatalog(local, reproId, reproRole, reproDatabase, [reproDatabase]);
  requireMatch(
    historical.systemIdentifier !== repro.systemIdentifier,
    "两座容器的 PostgreSQL 集群标识重复",
  );
  const referenceCollation = historical.observed.get(mainDatabases[0]);
  requireMatch(
    referenceCollation &&
      [...historical.observed.values(), ...repro.observed.values()].every((value) =>
        isDeepStrictEqual(value, referenceCollation),
      ),
    "四个冻结库的排序规则不一致，需独立评审",
  );
  return {
    ...report,
    status: "NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED",
    referenceCatalogObserved: true,
    observedDatabaseCount: 4,
    observedClusterCount: 2,
    allFrozenCollationsMatch: true,
    referenceCollation,
    recordedCollationVersionMatches: true,
  };
}
