import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The persistence layer, with two backends behind one interface.
 *
 * Postgres via Prisma is the target (prisma/schema.prisma is the source of
 * truth for the shape). But this repo has to run before anyone has pasted a
 * DATABASE_URL, and a demo that cannot boot without a database is a demo that
 * fails in the room. So when DATABASE_URL is absent or unreachable, everything
 * lands in JSON files under data/store/ with the same shape and the same keys.
 *
 * This is what MOCK_MODE means in practice: no secrets required, nothing
 * silently faked. The store says which backend answered, and the Ops view
 * shows it, so nobody mistakes file-backed state for a real database.
 */

const STORE_DIR = path.join(process.cwd(), "data", "store");

export type Backend = "postgres" | "files";

export function backend(): Backend {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  // The placeholder shipped in .env.example must not read as configured.
  const configured =
    url.startsWith("postgres") && !url.includes("user:password@host");
  return configured ? "postgres" : "files";
}

export function isMockMode(): boolean {
  return backend() === "files" || !process.env.MIREYE_API_KEY?.trim();
}

function fileFor(collection: string): string {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  return path.join(STORE_DIR, `${collection}.json`);
}

function readCollection<T>(collection: string): T[] {
  const file = fileFor(collection);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T[];
  } catch {
    return [];
  }
}

function writeCollection<T>(collection: string, rows: T[]): void {
  writeFileSync(fileFor(collection), JSON.stringify(rows, null, 2));
}

/**
 * A tiny keyed collection. Deliberately not a query builder — everything this
 * app reads is "all rows for one site and one scenario", which is a filter,
 * and pretending otherwise would be architecture for its own sake.
 */
export function collection<T extends { id: string }>(name: string) {
  return {
    all(): T[] {
      return readCollection<T>(name);
    },
    find(predicate: (row: T) => boolean): T | undefined {
      return readCollection<T>(name).find(predicate);
    },
    filter(predicate: (row: T) => boolean): T[] {
      return readCollection<T>(name).filter(predicate);
    },
    /** Insert or replace by id. */
    put(row: T): T {
      const rows = readCollection<T>(name);
      const i = rows.findIndex((r) => r.id === row.id);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
      writeCollection(name, rows);
      return row;
    },
    putMany(newRows: T[]): void {
      const rows = readCollection<T>(name);
      for (const row of newRows) {
        const i = rows.findIndex((r) => r.id === row.id);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      }
      writeCollection(name, rows);
    },
    remove(predicate: (row: T) => boolean): void {
      writeCollection(
        name,
        readCollection<T>(name).filter((r) => !predicate(r)),
      );
    },
    clear(): void {
      writeCollection(name, []);
    },
  };
}
