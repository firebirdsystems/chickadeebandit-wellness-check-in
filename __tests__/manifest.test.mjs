import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("permissions.requires_approval is boolean", () => {
    expect(typeof manifest.permissions.requires_approval).toBe("boolean");
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });
});

// ── ai_access SQL file validation ─────────────────────────────────────────────
// Auto-discovers all db_exports/db_mutations/db_inserts/db_deletes entries and
// validates each SQL file for type, household_id filter, and single-statement.

if (manifest.ai_access) {
  const ai = manifest.ai_access;

  const SQL_TYPES = [
    { field: "db_exports",   dir: "queries",   keyword: /^(SELECT|WITH)\b/i, label: "SELECT or WITH" },
    { field: "db_mutations", dir: "mutations",  keyword: /^UPDATE\b/i,        label: "UPDATE"         },
    { field: "db_inserts",   dir: "inserts",    keyword: /^INSERT\b/i,        label: "INSERT"         },
    { field: "db_deletes",   dir: "deletes",    keyword: /^DELETE\b/i,        label: "DELETE"         },
  ];

  for (const { field, dir, keyword, label } of SQL_TYPES) {
    const names = ai[field] ?? [];
    if (names.length === 0) continue;

    describe(`ai_access.${field}`, () => {
      it(`each name has a src/${dir}/{name}.sql file`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          expect(existsSync(path), `missing: src/${dir}/${name}.sql`).toBe(true);
        }
      });

      it(`each SQL file starts with ${label}`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          if (!existsSync(path)) continue;
          const sql = readFileSync(path, "utf-8").trim();
          expect(
            keyword.test(sql),
            `src/${dir}/${name}.sql must start with ${label}, got: ${sql.slice(0, 50)}`
          ).toBe(true);
        }
      });

      it(`each SQL file is a single statement (no semicolons)`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          if (!existsSync(path)) continue;
          const sql = readFileSync(path, "utf-8");
          expect(
            sql.includes(";"),
            `src/${dir}/${name}.sql must not contain semicolons`
          ).toBe(false);
        }
      });
    });
  }

  if (ai.db_inserts?.length) {
    describe("ai_access.db_inserts schemas", () => {
      it("each insert has a src/schemas/{name}.json file", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          expect(existsSync(path), `missing: src/schemas/${name}.json`).toBe(true);
        }
      });

      it("each schema file is valid JSON", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(path)) continue;
          expect(
            () => JSON.parse(readFileSync(path, "utf-8")),
            `src/schemas/${name}.json must be valid JSON`
          ).not.toThrow();
        }
      });

      it("each schema declares type:array with an items definition", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(path)) continue;
          let schema;
          try { schema = JSON.parse(readFileSync(path, "utf-8")); } catch { continue; }
          expect(schema.type, `src/schemas/${name}.json must declare "type": "array"`).toBe("array");
          expect(
            Array.isArray(schema.items) || (typeof schema.items === "object" && schema.items !== null),
            `src/schemas/${name}.json must declare "items" to validate params`
          ).toBe(true);
        }
      });

      it("schema maxItems matches the number of $N placeholders in the SQL", () => {
        for (const name of ai.db_inserts) {
          const sqlPath    = join(__dirname, `../src/inserts/${name}.sql`);
          const schemaPath = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(sqlPath) || !existsSync(schemaPath)) continue;
          const sql = readFileSync(sqlPath, "utf-8");
          let schema;
          try { schema = JSON.parse(readFileSync(schemaPath, "utf-8")); } catch { continue; }
          const paramNums = [...sql.matchAll(/\$(\d+)/g)].map(m => parseInt(m[1], 10));
          const maxParam  = paramNums.length > 0 ? Math.max(...paramNums) : 0;
          expect(
            schema.maxItems,
            `src/schemas/${name}.json maxItems (${schema.maxItems}) must equal SQL $N count (${maxParam})`
          ).toBe(maxParam);
        }
      });
    });
  }
}

// ── hand-offs and the agreed time ─────────────────────────────────────────────
// Things the hub's validators cannot see, because each is a fact about how this
// app's own pieces line up rather than about one manifest key.

describe("requests and the agreed-time reminder", () => {
  const logic = readFileSync(join(__dirname, "../src/logic.js"), "utf-8");
  const html = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
  const migration = readFileSync(join(__dirname, "../migrations/003_requests_and_agreed_time.sql"), "utf-8");
  const reminders = manifest.schedule_reminders;
  const plaintext = new Set(manifest.db_plaintext_columns);

  it("the board waits exactly as long as the hub does before calling a check-in missed", () => {
    const grace = Number(/export const GRACE_MINUTES = (\d+);/.exec(logic)?.[1]);
    expect(grace).toBe(reminders.escalation.grace_minutes);
  });

  it("the timed audience is its own column, never the silence window's list", () => {
    // recipient_member_ids stores "[]" for "all adults"; the reminder protocol
    // reads "[]" as "nobody". Pointing it there would switch escalation off for
    // every profile that left the default.
    expect(reminders.escalation.member_column).toBe("timed_alert_member_ids");
    expect(manifest.inactivity_alerts.recipients_column).toBe("recipient_member_ids");
    expect(migration).toMatch(/timed_alert_member_ids TEXT NOT NULL DEFAULT ''/);
  });

  it("a check-in writes the three columns the reminder matches on", () => {
    const { parent_fk_column, date_column, slot_column } = reminders.completion;
    const insert = /INSERT INTO \$\{T\}checkins \(([^)]*)\)/.exec(html)?.[1] ?? "";
    for (const column of [parent_fk_column, date_column, slot_column]) {
      expect(insert.split(",").map(c => c.trim()), column).toContain(column);
      expect(plaintext.has(column), `${column} is compared in SQL`).toBe(true);
    }
  });

  it("every column a request is filtered or deduped on is plaintext", () => {
    for (const column of ["status", "kind", "claimed_by", "source_event_id"]) {
      expect(plaintext.has(column), column).toBe(true);
    }
  });

  it("the automation can only open a request, and never raises a call on someone's behalf", () => {
    const action = manifest.automation_actions.open_request;
    expect(action.steps.map(s => s.op)).toEqual(["insert"]);
    expect(action.steps[0].values.status).toBe("open");
    expect(action.params.kind.options).not.toContain("call");
    expect(action.dedupe).toEqual({ table: "requests", column: "source_event_id" });
  });

  it("ships no rule on inactivity.alert_fired", () => {
    // The hub publishes that event for every app with a check-in switch, as
    // source "hub", so a rule cannot be pinned to this app's own alerts. The
    // board shows its own missed check-ins directly instead (missedCheckins).
    const triggers = manifest.suggested_automations.map(s => s.trigger_event);
    expect(triggers).toEqual(["medication.dose_missed"]);
  });

  it("the glance reads one table", () => {
    // A second governed table inside a subquery is refused at run time, and
    // the hub then shows an empty card rather than an error.
    expect(manifest.glance.source.query.match(/FROM /g)).toHaveLength(1);
  });

  it("unfinished requests are never read under a limit shared with history", () => {
    // One list capped across every status lets closed requests push an open
    // one off the board, where nobody can take it.
    const open = manifest.preload.requests_open.sql;
    const handled = manifest.preload.requests_handled.sql;
    expect(open).toMatch(/WHERE status <> 'done' ORDER BY created_at ASC/);
    expect(handled).toMatch(/WHERE status = 'done'/);
    expect(Object.values(manifest.preload).map(p => p.sql).filter(q => /__requests/.test(q) && !/WHERE status/.test(q))).toEqual([]);
  });

  it("the board re-reads everything a missed check-in is derived from, whatever it currently shows", () => {
    const refresh = /async function refreshBoard\(\) \{([\s\S]*?)\n    \}/.exec(html)?.[1] ?? "";
    for (const loader of ["loadProfiles()", "loadCheckins()", "loadRequests()"]) expect(refresh, loader).toContain(loader);
    const tick = /const tick = async \(\) => \{([\s\S]*?)\n      \};/.exec(html)?.[1] ?? "";
    expect(tick).toContain("refreshBoard()");
    // Not gated on what is already loaded: an empty board must still poll.
    expect(html).toMatch(/setInterval\(\(\) => \{ if \(!document\.hidden\) tick\(\); \}, 60_000\)/);
    expect(tick).not.toMatch(/requests\.(some|length)/);
  });

  it("the person a request is about can read the follow-up note the form promises them", () => {
    const self = /function renderSelfRequests\(\) \{([\s\S]*?)\n    \}\n/.exec(html)?.[1] ?? "";
    expect(self).toContain("lastDone.followup_note");
    expect(html).toMatch(/The care circle and \$\{esc\(memberName\(r\.member_id\)\)\} can read this/);
  });

  it("publishes every event the app sends", () => {
    const sent = [...html.matchAll(/(?:publishEvent|announce)\("([a-z_.]+)"/g)].map(m => m[1]);
    expect(sent.length).toBeGreaterThan(0);
    for (const type of sent) expect(manifest.publishes, type).toContain(type);
  });

  it("no event carries a person's own words", () => {
    const body = /function announce\(type, r\) \{([\s\S]*?)\n    \}/.exec(html)?.[1] ?? "";
    expect(body).toContain("publishEvent");
    expect(body).not.toMatch(/note/);
  });
});
