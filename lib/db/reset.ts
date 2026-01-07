/**
 * 数据库重置脚本
 * 清除所有表和数据，然后重新创建
 *
 * 运行: pnpm db:reset
 */

import postgres from "postgres";

async function reset() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  const sql = postgres(connectionString);

  console.log("⚠️  警告: 即将删除所有数据库表和数据!");
  console.log("🔄 开始重置数据库...\n");

  try {
    // 获取 public schema 下的所有表
    const tables = await sql`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
    `;

    console.log(`📋 发现 ${tables.length} 个表需要删除\n`);

    // 删除所有表
    for (const { tablename } of tables) {
      await sql.unsafe(`DROP TABLE IF EXISTS "public"."${tablename}" CASCADE`);
      console.log(`✅ 已删除表: ${tablename}`);
    }

    // 获取所有自定义枚举类型
    const enums = await sql`
      SELECT typname FROM pg_type 
      WHERE typtype = 'e' 
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `;

    console.log(`\n📋 发现 ${enums.length} 个枚举类型需要删除\n`);

    // 删除所有枚举类型
    for (const { typname } of enums) {
      await sql.unsafe(`DROP TYPE IF EXISTS "public"."${typname}" CASCADE`);
      console.log(`✅ 已删除枚举: ${typname}`);
    }

    // 获取所有序列
    const sequences = await sql`
      SELECT sequencename FROM pg_sequences 
      WHERE schemaname = 'public'
    `;

    if (sequences.length > 0) {
      console.log(`\n📋 发现 ${sequences.length} 个序列需要删除\n`);
      for (const { sequencename } of sequences) {
        await sql.unsafe(`DROP SEQUENCE IF EXISTS "public"."${sequencename}" CASCADE`);
        console.log(`✅ 已删除序列: ${sequencename}`);
      }
    }

    console.log("\n🎉 数据库已完全清空!");
    console.log("\n📝 下一步:");
    console.log("   1. 运行 pnpm db:migrate 创建新表结构");
    console.log("   2. 运行 pnpm db:seed 初始化数据");
  } catch (error) {
    console.error("❌ 重置失败:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

reset();
