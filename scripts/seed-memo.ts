import { getPostgresDatabase } from '../src/react-widgets/core/postgres-database.js';

async function main() {
  const db = getPostgresDatabase();
  await db.initialize();

  const result = await db.getPool().query(
    `INSERT INTO memos (id, text, enabled, sort_order, status)
     VALUES ('memo-001', '带Win11重装U盘回公司', true, 0, 'draft')
     ON CONFLICT (id) DO NOTHING
     RETURNING id`
  );

  if (result.rows.length > 0) {
    console.log(`✅ Seed memo 插入成功: ${result.rows[0].id}`);
  } else {
    console.log('ℹ️ Seed memo 已存在，跳过');
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Seed memo 失败:', error);
  process.exit(1);
});
