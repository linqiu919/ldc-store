/**
 * 数据库迁移基线脚本（Drizzle）
 *
 * 背景：
 * - 旧库长期使用 `drizzle-kit push`（本仓库脚本 `pnpm db:push`）会直接把 schema 推到数据库，
 *   但不会写入 Drizzle 的迁移记录表。
 * - 一旦后续改用 `drizzle-kit migrate`，迁移器会从 0000 开始执行，导致“表已存在/类型已存在”等报错。
 *
 * 这个脚本做的事情：
 * - 如果数据库已经有迁移记录：不做任何事（说明已经进入 migrate 流程）
 * - 如果数据库是全新空库：不做任何事（应该直接跑 `pnpm db:migrate`）
 * - 如果数据库已有业务表但没有迁移记录：把本地 migrations 目录中的迁移“标记为已应用”（baseline），
 *   让后续 `pnpm db:migrate` 只执行未来的新迁移。
 *
 * 运行: pnpm db:baseline
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

type MigrationRecord = {
  tag: string;
  createdAt: number;
  hash: string;
};

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const MIGRATIONS_DIR = path.join(process.cwd(), "lib/db/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta/_journal.json");

type SqlClient = ReturnType<typeof postgres>;

const readJournal = (): Journal => {
  if (!fs.existsSync(JOURNAL_PATH)) {
    throw new Error(`找不到迁移日志文件: ${JOURNAL_PATH}`);
  }

  const raw = fs.readFileSync(JOURNAL_PATH, "utf8");
  return JSON.parse(raw) as Journal;
};

const computeMigrationRecords = (journal: Journal): MigrationRecord[] => {
  return journal.entries.map((entry) => {
    const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`找不到迁移文件: ${sqlPath}`);
    }

    const sqlContent = fs.readFileSync(sqlPath, "utf8");
    const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");

    return {
      tag: entry.tag,
      createdAt: entry.when,
      hash,
    };
  });
};

const ensureMigrationsTable = async (sql: SqlClient): Promise<void> => {
  // 这里使用固定 schema/table 名称，避免把动态参数拼进 DDL 造成风险
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
};

const getAppliedMigrationsCount = async (sql: SqlClient): Promise<number> => {
  const rows = await sql.unsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`
  );
  const countAsString = rows[0]?.count ?? "0";
  const count = Number.parseInt(countAsString, 10);
  return Number.isFinite(count) ? count : 0;
};

const getPublicTablesCount = async (sql: SqlClient): Promise<number> => {
  // 仅用于判断“是不是空库”；不做强校验，避免因不同环境的辅助表导致误判
  const rows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  `;
  return rows.length;
};

const baseline = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  const journal = readJournal();
  const records = computeMigrationRecords(journal);

  if (records.length === 0) {
    console.log("ℹ️  本地 migrations 为空，无需 baseline");
    return;
  }

  const sql = postgres(connectionString, { max: 1 });

  try {
    await ensureMigrationsTable(sql);

    const appliedCount = await getAppliedMigrationsCount(sql);
    if (appliedCount > 0) {
      console.log(`ℹ️  数据库已存在迁移记录（${appliedCount} 条），跳过 baseline`);
      return;
    }

    const publicTablesCount = await getPublicTablesCount(sql);
    if (publicTablesCount === 0) {
      console.log("ℹ️  检测到空数据库：跳过 baseline，请直接运行 `pnpm db:migrate`");
      return;
    }

    console.log("🧱 开始为旧库写入迁移基线（baseline）...");

    for (const record of records) {
      await sql`
        INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
        SELECT ${record.hash}, ${record.createdAt}
        WHERE NOT EXISTS (
          SELECT 1
          FROM "drizzle"."__drizzle_migrations"
          WHERE "hash" = ${record.hash} AND "created_at" = ${record.createdAt}
        )
      `;
      console.log(`✅ 已标记迁移: ${record.tag}`);
    }

    console.log("\n🎉 baseline 完成！");
    console.log("📝 下一步：运行 `pnpm db:migrate`（应为 no-op），之后只用 migrate 管理变更。");
  } catch (error) {
    console.error("❌ baseline 失败:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
};

baseline();
