const { chromium } = require('playwright');
const { Pool } = require('pg');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const databaseUrl = process.env.ADMIN_QA_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/admin_analytics_test') throw new Error('ADMIN_QA_DATABASE_URL must name the isolated admin_analytics_test database');
const db = new Pool({connectionString: databaseUrl});
const evidence=process.env.ADMIN_QA_EVIDENCE_DIR || '/workspace/scratch/admin-panel-qa';
fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 let browser; let userId; let targetId;
 const results=[]; const errors=[];
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const guest=await browser.newContext({viewport:{width:390,height:844}}); const page=await guest.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/admin'); await page.getByText('Увійти', { exact: true }).waitFor({timeout:30000});
  results.push({scenario:'Guest /admin',url:page.url(),body:(await page.locator('body').innerText()).slice(0,1000)});
  await page.screenshot({path:evidence+'/guest-390.png',fullPage:true});
  await guest.close();
  const suffix=Date.now().toString();
  userId=(await db.query(`INSERT INTO users(username,username_normalized,country_code,phone,password_hash) VALUES($1,$1,'UA',$2,$3) RETURNING id`,['adminqa_'+suffix,'+38050'+suffix.slice(-7),'unusable-fixture-'+randomBytes(24).toString('hex')])).rows[0].id;
  const token=randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[userId,createHash('sha256').update(token).digest('hex')]);
  await db.query(`INSERT INTO admin_user_roles(user_id,role_id) VALUES($1,'analyst')`,[userId]);
  const context=await browser.newContext(); await context.addCookies([{name:'navpaky_session',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
  const admin=await context.newPage(); admin.on('pageerror',error=>errors.push(error.message));
  for(const width of (process.env.ADMIN_QA_RESOURCES_ONLY === '1' ? [] : [1280,1024,768,390,320])) {
   await admin.waitForTimeout(3000);
   await admin.setViewportSize({width,height:900});
   await admin.goto('http://127.0.0.1:5173/admin'); await admin.getByText('ДещоТреба · Адміністрування', { exact: true }).first().waitFor({timeout:30000}); await admin.getByText('Створені записи за днями (UTC)').waitFor({timeout:30000}); await admin.waitForTimeout(300);
   await admin.getByLabel('До (UTC, не включно)').fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
   await admin.getByRole('button',{name:'Показати',exact:true}).click();
   await admin.locator('canvas').waitFor();
   await admin.waitForTimeout(250);
   if (width === 1280) {
     await admin.getByRole('combobox',{name:'Графік',exact:true}).click();
     await admin.getByRole('option',{name:'Стовпчики',exact:true}).click();
     await admin.waitForTimeout(250);
     await admin.screenshot({path:evidence+'/analyst-bars-1280.png',fullPage:true});
     results.push({scenario:'ECharts bar chart switch',canvasCount:await admin.locator('canvas').count()});
     await admin.getByRole('combobox',{name:'Графік',exact:true}).click();
     await admin.getByRole('option',{name:'Лінії',exact:true}).click();
   }
   const body=await admin.locator('body').innerText();
   const measure=await admin.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
   results.push({scenario:'Analyst dashboard',width,...measure,url:admin.url(),body:body.slice(0,2000)});
   await admin.screenshot({path:`${evidence}/analyst-${width}.png`,fullPage:true});
  }
  if (process.env.ADMIN_QA_DASHBOARD_ONLY === '1') return;
  results.push({scenario:'Analyst mutation forbidden',status:(await context.request.post('http://127.0.0.1:5173/api/admin/grants',{headers:{Origin:'http://127.0.0.1:5173','X-Admin-Action':'1'},data:{userId,roleId:'admin',reason:'access_assignment'}})).status()});
  await admin.goto('http://127.0.0.1:5173/admin/roles'); await admin.waitForTimeout(700);
  results.push({scenario:'Analyst roles deep link',url:admin.url(),body:(await admin.locator('body').innerText()).slice(0,1000)});

  await db.query("UPDATE admin_user_roles SET role_id='super_admin' WHERE user_id=$1", [userId]);
  targetId=(await db.query(`INSERT INTO users(username,username_normalized,country_code,phone,password_hash) VALUES($1,$1,'UA',$2,$3) RETURNING id`,['adminqa_target_'+suffix,'+38067'+suffix.slice(-7),'unusable-fixture-'+randomBytes(24).toString('hex')])).rows[0].id;
  await admin.setViewportSize({width:1280,height:900});
  await admin.goto('http://127.0.0.1:5173/admin/roles');
  await admin.getByLabel('UUID користувача').waitFor({timeout:30000});
  await admin.getByLabel('UUID користувача').fill(targetId);
  await admin.getByRole('combobox',{name:'Роль',exact:true}).click();
  await admin.getByRole('option',{name:'Support Agent',exact:true}).click();
  admin.once('dialog',dialog=>dialog.accept());
  const grantResponse=admin.waitForResponse(r=>r.url().endsWith('/api/admin/grants') && r.request().method()==='POST');
  await admin.getByRole('button',{name:'Призначити роль',exact:true}).click();
  const granted=await grantResponse;
  await admin.getByRole('button',{name:'Відкликати',exact:true}).waitFor();
  results.push({scenario:'SuperAdmin UI grant',status:granted.status(),databaseActive:(await db.query('SELECT count(*)::int AS n FROM admin_user_roles WHERE user_id=$1 AND revoked_at IS NULL',[targetId])).rows[0].n});
  await admin.screenshot({path:evidence+'/roles-1280.png',fullPage:true});
  admin.once('dialog',dialog=>dialog.accept());
  const revokeResponse=admin.waitForResponse(r=>r.url().includes('/api/admin/grants/') && r.request().method()==='DELETE');
  await admin.getByRole('button',{name:'Відкликати',exact:true}).click();
  results.push({scenario:'SuperAdmin UI revoke',status:(await revokeResponse).status(),databaseActive:(await db.query('SELECT count(*)::int AS n FROM admin_user_roles WHERE user_id=$1 AND revoked_at IS NULL',[targetId])).rows[0].n});
  if (process.env.ADMIN_QA_RESOURCES_ONLY !== '1') await admin.waitForTimeout(30000);
  for(const resource of (process.env.ADMIN_QA_RESOURCE_NAMES?.split(',') ?? ['users','products','requests','offers','deals','moderation','audit'])) {
    for(const width of [1280,390]) {
      await admin.waitForTimeout(3000);
   await admin.setViewportSize({width,height:900});
      await admin.goto('http://127.0.0.1:5173/admin/'+resource);
      await admin.waitForTimeout(700);
      console.log('list',resource,width);
      await admin.getByLabel('Пошук', {exact:true}).waitFor({timeout:10000});
      await admin.waitForTimeout(400);
      results.push({scenario:'SuperAdmin resource list',resource,width,...await admin.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})),body:(await admin.locator('body').innerText()).slice(0,1300)});
      if(resource==='users') {
        await admin.getByLabel('Пошук', {exact:true}).fill('adminqa_target_');
        await admin.waitForTimeout(700);
        results.push({scenario:'Users search filter',width,filteredRows:await admin.getByText('adminqa_target_'+suffix,{exact:true}).count()});
        await admin.screenshot({path:evidence+`/users-${width}.png`,fullPage:true});
      }
    }
  }
  await context.close();
 } catch(e) {errors.push(e.stack);process.exitCode=1;} finally {
  if(userId) await db.query("DELETE FROM audit_logs WHERE actor_id=$1",[userId]);
  if(targetId) await db.query('DELETE FROM users WHERE id=$1',[targetId]);
  if(userId) await db.query('DELETE FROM users WHERE id=$1',[userId]);
  await db.end(); if(browser)await browser.close();
  fs.writeFileSync(evidence+'/browser-results.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors},null,2));
 }
})();
