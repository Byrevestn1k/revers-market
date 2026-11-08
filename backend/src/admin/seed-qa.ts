import { searchSettlements } from '../settlements.js';
/** Offline local-only demo data. No auth bypass and no built-in password. */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';

async function seed() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.ADMIN_QA_SEED_ACK !== 'CREATE_ISOLATED_FIXTURES' || url.pathname !== '/admin_part2_test' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Only explicit local admin_part2_test fixtures are allowed');
  const suffix = randomBytes(5).toString('hex');
  const password = randomBytes(24).toString('base64url');
  const hash = await bcrypt.hash(password,12);
  const db = await pool.connect();
  const accounts: {role:string;id:string;username:string}[] = [];
  try {
    await db.query('BEGIN');
    for (const [index,role] of ['owner','seller','buyer','moderator','support_agent','analyst'].entries()) {
      const username = `qa_${role}_${suffix}`;
      const id = (await db.query(`INSERT INTO users(username,username_normalized,nickname,country_code,phone,password_hash) VALUES($1,$1,$2,'UA',$3,$4) RETURNING id`,[username,`Тест ${role}`,`+380${Date.now().toString().slice(-8)}${index}`,hash])).rows[0].id;
      accounts.push({role,id,username});
      if (['moderator','support_agent','analyst'].includes(role)) await db.query('INSERT INTO admin_user_roles(user_id,role_id) VALUES($1,$2)',[id,role]);
    }
    const category = (await db.query("SELECT id FROM categories WHERE code='grains'")).rows[0].id;
    const product = (await db.query(`INSERT INTO products(owner_id,category_id,title,description,quantity,unit,price,currency,delivery_mode,geo_zone,status)
      VALUES($1,$2,'Тестовий товар для модерації','Публічний опис тестового товару',10,'kg',100,'UAH','pickup','Рівне','active') RETURNING id`,[accounts[1].id,category])).rows[0].id;
    const request = (await db.query(`INSERT INTO buy_requests(buyer_id,category_id,title,description,requested_quantity,unit,currency,geo_area)
      VALUES($1,$2,'Тестовий запит для модерації','Публічний опис тестового запиту',10,'kg','UAH','Рівне') RETURNING id`,[accounts[2].id,category])).rows[0].id;
    const place = searchSettlements('Рівне').settlements.find(p=>p.name === 'Рівне' && p.region === 'Рівненська область')!;
    await db.query('UPDATE products SET settlement_code=$2 WHERE id=$1',[product,place.code]);
    await db.query('UPDATE buy_requests SET settlement_code=$2 WHERE id=$1',[request,place.code]);
    for (const [type,id] of [['product',product],['buy_request',request],['user',accounts[1].id]]) await db.query(`INSERT INTO reports(reporter_id,target_type,target_id,reason) VALUES($1,$2,$3,'Неправильна категорія')`,[accounts[2].id,type,id]);
    await db.query(`INSERT INTO audit_logs(action,entity_type,entity_id,metadata) VALUES('admin.qa_seed','user',$1,'{"reason":"controlled_local_qa_seed","result":"success"}')`,[accounts[0].id]);
    // Write credentials exclusively to an ignored operator file, never console/Git.
    await writeFile('docs/TEST_ACCOUNTS.local.md',`# Ізольована admin_part2_test\n\nОдноразово згенерований пароль для цього набору: ${password}\n\n${accounts.map(a=>`${a.role}: ${a.username} (UUID ${a.id})`).join('\n\n')}\n\nOwner ще не має прав: виконайте контрольований admin:bootstrap для його UUID.\n\nProduct: ${product}\nRequest: ${request}\n`,{mode:0o600,flag:'wx'});
    await db.query('COMMIT');
    console.log(`Fixtures created. Owner UUID: ${accounts[0].id}. Credentials: docs/TEST_ACCOUNTS.local.md (local only).`);
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
seed().catch(error=>{console.error(error instanceof Error ? error.message : 'Seed failed');process.exitCode=1;}).finally(()=>pool.end());
