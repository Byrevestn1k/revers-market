const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync('docs/TEST_ACCOUNTS.local.md','utf8');
const password = source.match(/цього набору: (\S+)/)[1];
const username = source.match(/owner: (\S+)/)[1];
const seller = source.match(/seller: \S+ \(UUID ([^)]+)\)/)[1];
const product = source.match(/Product: (\S+)/)[1];
const request = source.match(/Request: (\S+)/)[1];
const base = process.env.ADMIN_QA_BASE_URL || 'http://127.0.0.1:5173';
const evidence = process.env.ADMIN_QA_EVIDENCE_DIR || '/workspace/scratch/admin-part2-qa';
fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page = await browser.newPage();
 const errors=[], results=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/') && r.status()>=400) console.log('HTTP',r.status(),new URL(r.url()).pathname);});
 page.setDefaultTimeout(15000);
 try {
  await page.goto(base+'/admin/users');
  await page.locator('input[name="username"]').waitFor({timeout:30000});
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button',{name:'Увійти',exact:true}).click();
  await page.waitForURL(url=>!url.pathname.includes('login'),{timeout:30000});
  const reports = await page.request.get(base+'/api/admin/moderation?perPage=100');
  const reportId = (await reports.json()).data.find(r=>r.targetId===product).id;
  const routes = [`moderation/${reportId}/show`,'users','products','requests','moderation','audit',`users/${seller}/show`,`products/${product}/show`,`requests/${request}/show`];
  for(const width of [1280,390]) {
   await page.setViewportSize({width,height:900});
   for(const route of routes) {
    console.log('Check',route,width);
    await page.goto(base+'/admin/'+route);
    await page.locator('.RaList-content,.RaShow-main').first().waitFor({timeout:30000});
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,route+' horizontal overflow at '+width);
    const name=route.replace(/\/[0-9a-f-]+\/show/,'-detail');
    await page.screenshot({path:path.join(evidence,`${name}-${width}.png`),fullPage:true});
    results.push({route,width,overflow:false});
   }
  }
  // Confirmation and real backend result through the owner password session.
  await page.goto(base+`/admin/products/${product}/show`);
  await page.getByRole('button',{name:'Приховати',exact:true}).click();
  await page.getByRole('combobox',{name:'Причина рішення'}).click();
  await page.getByRole('option',{name:'Порушення правил',exact:true}).click();
  await page.getByRole('button',{name:'Перевірити рішення'}).click();
  await page.screenshot({path:path.join(evidence,'decision-confirmation-390.png'),fullPage:true});
  await page.getByRole('button',{name:'Підтвердити',exact:true}).click();
  await page.getByText('Приховано модерацією',{exact:false}).waitFor();
  assert.equal((await page.request.get(base+`/api/products/${product}`)).status(),404);
  await page.screenshot({path:path.join(evidence,'product-hidden-390.png'),fullPage:true});
  await page.getByRole('button',{name:'Відновити',exact:true}).click();
  await page.getByRole('combobox',{name:'Причина рішення'}).click();
  await page.getByRole('option',{name:'Виправлення помилкового рішення',exact:true}).click();
  await page.getByRole('button',{name:'Перевірити рішення'}).click();
  await page.getByRole('button',{name:'Підтвердити',exact:true}).click();
  await page.getByText('Видимість дозволена',{exact:false}).waitFor();
  assert.equal((await page.request.get(base+`/api/products/${product}`)).status(),200);
  results.push({flow:'password login, confirmed hide → public404 → confirmed restore → public200',pass:true});
  for (const [route,action,reason] of [
    [`moderation/${reportId}/show`,'Взяти на розгляд','Перевірку завершено'],
    [`moderation/${reportId}/show`,'Відхилити скаргу','Недостатньо доказів'],
    [`users/${seller}/show`,'Тимчасово заблокувати','Порушення правил'],
    [`users/${seller}/show`,'Розблокувати','Виправлення помилкового рішення']
  ]) {
    await page.goto(base+'/admin/'+route);
    await page.getByRole('button',{name:action,exact:true}).click();
    await page.getByRole('combobox',{name:'Причина рішення'}).click();
    await page.getByRole('option',{name:reason,exact:true}).click();
    if(action === 'Тимчасово заблокувати') await page.locator('input[type="datetime-local"]').fill(new Date(Date.now()+3600000).toISOString().slice(0,16));
    await page.getByRole('button',{name:'Перевірити рішення'}).click();
    const response=page.waitForResponse(r=>r.url().endsWith('/actions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Підтвердити',exact:true}).click();
    assert.equal((await response).status(),200);
    await page.getByText('Рішення збережено в журналі',{exact:true}).waitFor();
    results.push({flow:action,pass:true});
  }

  // Filters persist in the URL and change the actual list result.
  await page.goto(base+'/admin/users');
  await page.getByRole('textbox',{name:'Пошук за ID або назвою'}).fill(username);
  await page.waitForTimeout(1200);
  await page.getByText(username,{exact:true}).first().waitFor();
  assert.ok(page.url().includes('filter='));
  results.push({flow:'users search',pass:true});

  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto(base+'/admin/products');
    await page.getByRole('textbox',{name:'Пошук за ID або назвою'}).waitFor();
    if (!(await page.getByRole('combobox',{name:'Видимість',exact:true}).isVisible())) {
      await page.getByRole('button',{name:'Додати фільтр',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'Видимість',exact:true}).click();
    }
    await page.getByRole('combobox',{name:'Видимість',exact:true}).click();
    await page.getByRole('option',{name:'Приховано',exact:true}).click();
    await page.getByRole('textbox',{name:'Пошук за ID або назвою'}).fill(product);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const filtered=await page.request.get(base+`/api/admin/products?q=${product}&visibility=hidden`);
    assert.equal((await filtered.json()).total,0);
    await page.screenshot({path:path.join(evidence,`filters-empty-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:/Сортувати/}).click();
    await page.getByRole('menuitem',{name:/Створено/}).click();
    results.push({flow:'visibility filter, empty result and sorting',width,pass:true});
  }
  for(const width of [1024,768,320]) {
   await page.setViewportSize({width,height:900});
   await page.goto(base+`/admin/products/${product}/show`);
   await page.getByRole('button',{name:'Приховати',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   results.push({route:'product detail',width,overflow:false});
  }
  assert.deepEqual(errors,[]);
 } finally {
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({results,errors},null,2));
  await browser.close();
 }
 console.log(JSON.stringify({checks:results.length,errors:errors.length,evidence}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
