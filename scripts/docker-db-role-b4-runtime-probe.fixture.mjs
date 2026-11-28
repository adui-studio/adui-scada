import assert from "node:assert/strict";

export function createScadaB4RuntimeProbeFixture(fault = "") {
  const calls = [];
  let role = "adui_scada";
  let denial = false;
  let denied = 0;
  let rolledBack = false;
  let tenant;
  let hash;
  let session;
  let revoked = false;
  let created = false;
  let states;
  const select = (rows) => ({ command: "SELECT", rows });
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values, role });
      if (sql === "SAVEPOINT scada_b4_denial") {
        denial = true;
        return { command: "SAVEPOINT" };
      }
      if (sql === "ROLLBACK TO SAVEPOINT scada_b4_denial") return { command: "ROLLBACK" };
      if (sql === "RELEASE SAVEPOINT scada_b4_denial") {
        denial = false;
        return { command: "RELEASE" };
      }
      if (denial) {
        denied++;
        if (fault === "allowed" && denied === 1) return select([]);
        throw Object.assign(new Error("SENSITIVE"), {
          code: fault === "wrong-code" && denied === 1 ? "23505" : "42501",
        });
      }
      if (sql === "SAVEPOINT scada_b4_runtime_probe") return { command: "SAVEPOINT" };
      if (sql === "ROLLBACK TO SAVEPOINT scada_b4_runtime_probe") {
        if (fault === "rollback") throw new Error("SENSITIVE");
        role = "adui_scada";
        rolledBack = true;
        return { command: "ROLLBACK" };
      }
      if (sql === "RELEASE SAVEPOINT scada_b4_runtime_probe") return { command: "RELEASE" };
      if (sql.startsWith("SET LOCAL ROLE ")) {
        role = sql.split(" ").at(-1);
        return { command: "SET" };
      }
      if (sql === "RESET ROLE") {
        role = "adui_scada";
        return { command: "RESET" };
      }
      if (sql.includes("current_user::text AS role"))
        return select([
          {
            role,
            sessionRole: "adui_scada",
            database: fault === "database" ? "other" : "adui_scada",
            read_only: "off",
            isolation: "serializable",
          },
        ]);
      if (sql.startsWith("LOCK TABLE")) {
        assert.equal(role, "adui_scada");
        assert.match(sql, /SHARE ROW EXCLUSIVE MODE NOWAIT$/u);
        return { command: fault === "lock" ? "SELECT" : "LOCK" };
      }
      if (sql.endsWith("AS clean")) {
        assert.deepEqual(values, ["https://127.0.0.1:18443/realms/adui-scada"]);
        return select([{ clean: fault !== "existing" }]);
      }
      if (sql.endsWith("AS absent")) {
        assert.equal(rolledBack, true);
        assert.equal(role, "adui_scada");
        assert.ok(sql.includes("scada_tag_history_records"));
        return select([{ absent: fault !== "residue" }]);
      }
      if (sql.startsWith("INSERT INTO public.scada_identities")) {
        assert.equal(role, "adui_scada");
        tenant = values[0];
        assert.match(tenant, /^b4-probe-[a-f0-9-]{36}$/u);
        return { command: "INSERT", rowCount: 3 };
      }
      assert.equal(role, "adui_scada_runtime");
      if (sql.includes("public.scada_lock_identity(")) return select([{ status: "active" }]);
      if (sql.includes("public.scada_create_project(")) {
        assert.equal(values[0], tenant);
        const snapshot = JSON.parse(values[3]);
        assert.equal(snapshot.projectId, values[1]);
        assert.equal(snapshot.contentHash, values[4]);
        assert.equal(snapshot.createdAt, values[5]);
        if (values[2] === "disabled") return select([{ result: "DENIED" }]);
        if (created) return select([{ result: fault === "duplicate" ? "CREATED" : "EXISTS" }]);
        created = true;
        hash = values[4];
        return select([{ result: "CREATED" }]);
      }
      if (sql.includes("public.scada_lock_project_grants("))
        return select(
          values[2] === "other"
            ? []
            : ["project:read", "version:append", "version:read"].map((permission) => ({
                permission,
              })),
        );
      if (sql.includes("public.scada_lock_project_version("))
        return select([{ content_hash: hash }]);
      if (sql.includes("public.scada_lock_release_state_")) return select([{ generation: "0" }]);
      if (
        sql.includes("public.scada_lock_release_event(") ||
        sql.includes("public.scada_lock_release_request(") ||
        sql.includes("public.scada_lock_prior_publish(")
      )
        return select([]);
      if (sql.startsWith("SELECT action FROM")) return select([{ action: "version:append" }]);
      if (sql.startsWith("SELECT head_revision")) return select([{ revision: "2" }]);
      if (sql.startsWith("SELECT payload FROM")) return select([{ payload: "probe" }]);
      if (sql.startsWith("INSERT INTO public.scada_auth_sessions")) {
        session = values[0];
        return { command: "INSERT", rowCount: 1 };
      }
      if (sql.includes("public.scada_lock_session_identity("))
        return select(revoked ? [] : [{ session_id: session }]);
      if (sql.startsWith("UPDATE public.scada_auth_sessions")) {
        revoked = true;
        return { command: "UPDATE", rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO public.scada_oidc_transactions")) {
        states = values.slice(0, 3);
        assert.equal(new Set(states).size, 3);
        return { command: "INSERT", rowCount: 3 };
      }
      if (sql.includes("public.scada_cleanup_expired_oidc("))
        return select([{ deleted: fault === "cleanup" ? "2" : "1" }]);
      if (sql.startsWith("SELECT state_hash FROM")) {
        assert.deepEqual(values, [states]);
        return select(
          states
            .slice(1)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
            .map((state_hash) => ({ state_hash })),
        );
      }
      if (sql.startsWith("SELECT consumed_at IS NOT NULL")) return select([{ consumed: true }]);
      if (sql.startsWith("INSERT INTO public.")) return { command: "INSERT", rowCount: 1 };
      if (sql.startsWith("UPDATE public."))
        return { command: "UPDATE", rowCount: fault === "cas" ? 0 : 1 };
      throw new Error("SENSITIVE");
    },
  };
  return { client, calls };
}
