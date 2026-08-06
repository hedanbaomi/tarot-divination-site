// Shared test helpers: a D1-shaped facade over an in-memory SQLite database
// that executes the real migration SQL, plus request builders.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

/** Runs every migration file in order against an in-memory SQLite database. */
export function createMockD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const files = readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8");
  db.exec(files);

  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      const execute = (mode, args) => {
        if (mode === "all") {
          const rows = args.length === 0 ? statement.all() : statement.all(...args);
          return { results: rows };
        }
        if (mode === "first") {
          return args.length === 0 ? statement.get() ?? null : statement.get(...args) ?? null;
        }
        const info = args.length === 0 ? statement.run() : statement.run(...args);
        return {
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid)
          }
        };
      };
      return {
        bind(...args) {
          return {
            all: async () => execute("all", args),
            first: async () => execute("first", args),
            run: async () => execute("run", args)
          };
        },
        all: async () => execute("all", []),
        first: async () => execute("first", []),
        run: async () => execute("run", [])
      };
    },
    // Raw access for setup/assertions inside tests.
    exec(sql) {
      db.exec(sql);
    },
    all(sql, ...args) {
      return db.prepare(sql).all(...args);
    }
  };
}

/** A D1 binding that throws on every call, to prove fail-closed behaviour. */
export function failingD1() {
  return {
    prepare() {
      throw new Error("mock d1 failure");
    }
  };
}

/** Default D1 + Analytics + secret env for tests. */
export function makeEnv({ db, analytics, adminToken = "test-admin-token", overrides = {} } = {}) {
  const env = {
    DB: db,
    TELEMETRY: analytics,
    ADMIN_TOKEN: adminToken,
    RATE_LIMIT_PER_INSTALL_PER_HOUR: "600",
    RATE_LIMIT_PER_IP_PER_MINUTE: "600",
    ...overrides
  };
  if (db === undefined) delete env.DB;
  if (analytics === undefined) delete env.TELEMETRY;
  if (adminToken === null) delete env.ADMIN_TOKEN;
  return env;
}

let sequence = 0;

export function nextHash() {
  sequence += 1;
  return sequence.toString(16).padStart(64, "0");
}

export function mockAnalytics() {
  return {
    points: [],
    writeDataPoint(point) {
      this.points.push(point);
    }
  };
}

/** Builds a Request with an optional cf object and Authorization header. */
export function makeRequest(url, { method = "GET", body, token, ip = "198.51.100.10", cf = {} } = {}) {
  const headers = { "cf-connecting-ip": ip };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(new TextEncoder().encode(JSON.stringify(body)).byteLength);
  }
  if (token !== undefined) headers["authorization"] = "Bearer " + token;
  const request = new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  Object.defineProperty(request, "cf", { value: cf });
  return request;
}

export function makeEvent(event, overrides = {}) {
  return {
    schema_version: 1,
    event,
    install_hash: nextHash(),
    app_version: "1.2.0",
    locale: "zh-CN",
    android_major: 35,
    ...overrides
  };
}
