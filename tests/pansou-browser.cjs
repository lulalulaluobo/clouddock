// Integration test against the actual NAS v0.8.3 browser bundle and mock APIs.
// Run with PLAYWRIGHT installed in the environment; no live resources are used.
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { convertResults } = require('../native/pansou.cjs');
const root = path.join(__dirname, '..', 'build', 'web');
const calls = [];
let setting = { enableCloudLinkValidityCheck: true, searchResponseMode: 'progressive', BatchSize: 2 };
let panConfig = {enabled:true,url:'http://pansou:8888',hasToken:false};
let checkState='ok';
const panGroups = convertResults({ results: [{ title: '盘搜测试资源', content: '模拟资源描述', datetime: '2026-11-20T00:00:00Z', links: [{ type: 'quark', url: 'https://pan.quark.cn/s/example123', password: 'aB12' }] }] });
const ordinary = [{ id:'original', channelInfo:{channelId:'original', name:'原频道',channelLogo:''}, displayList:true, list:[{ id:'old1', messageId:'old1', channelId:'original', title:'原频道测试资源', content:'模拟内容', cloudLinks:[{cloudType:'quark',link:'https://pan.quark.cn/s/old123'}], tags:[], isLastMessage:true }] }];
function json(res,data) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({code:0,success:true,data})); }
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost'); let chunks='';
  for await (const chunk of req) chunks += chunk;
  let body={}; try { body=chunks?JSON.parse(chunks):{}; } catch {}
  if (url.pathname.startsWith('/api/')) {
    calls.push({path:url.pathname,method:req.method,body});
    if (url.pathname==='/api/setting/get') return json(res,{globalSetting:setting,userSettings:{},searchChannels:[{id:'original',channelId:'original',name:'原频道',isEnabled:true}]});
    if (url.pathname==='/api/setting/save') { setting={...setting,...body.globalSetting}; return json(res,{}); }
    if (url.pathname==='/api/search/channels') return json(res,{mode:'progressive',batchSize:2,channels:[{id:'original',name:'原频道',index:0}]});
    if (url.pathname==='/api/search') return json(res,ordinary);
    if (url.pathname==='/api/clouddock-pansou/search') return json(res,panGroups);
    if (url.pathname==='/api/clouddock-pansou/check') return json(res,(body.items||[]).map(item=>({url:item.url,state:checkState})));
    if (url.pathname==='/api/clouddock-pansou/config') { if(req.method==='POST') panConfig={...panConfig,enabled:body.enabled,url:body.url}; return json(res,panConfig); }
    if (url.pathname==='/api/clouddock-pansou/health') return json(res,{connected:true,message:'PanSou 服务已连接'});
    if (url.pathname==='/api/clouddock/health') return json(res,{aria2:{connected:true,version:'1.36.0'}});
    if (url.pathname==='/api/clouddock/baidu/health') return json(res,{connected:false,message:'未连接'});
    if (url.pathname==='/api/clouddock/quark/share' || url.pathname==='/api/quark/share-info') return json(res,{shareCode:'example123',pwdId:'example123',stoken:'mock',list:[{fileId:'f1',fileIdToken:'t1',fileName:'测试文件.mp4',isFolder:false,fileSize:20}]});
    if (url.pathname==='/api/quark/folders') return json(res,[{cid:'dir1',name:'测试网盘目录'}]);
    if (url.pathname==='/api/clouddock/roots') return json(res,[{id:'media',label:'飞牛影视'}]);
    if (url.pathname==='/api/clouddock/directories') return json(res,{rootId:'media',relativePath:'',items:[]});
    if (url.pathname==='/api/clouddock/jobs') return json(res,[]);
    if (url.pathname==='/api/plugins/list') return json(res,[]);
    return json(res,{});
  }
  const pathname = ['/','/resource','/setting','/login','/transfer'].includes(url.pathname) ? '/index.html' : url.pathname;
  const filename = path.resolve(root,'.'+pathname);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); return res.end(); }
  const ext=path.extname(filename); res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[ext] || 'application/octet-stream'));
  fs.createReadStream(filename).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || chromium.executablePath()});
  try {
    for (const width of [375,1280]) {
      const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      await context.addInitScript(() => localStorage.setItem('token','test-token'));
      const page=await context.newPage();
      page.on('pageerror',error=>console.error('PAGE ERROR',error.message));
      await page.goto(origin+'/resource');
      await page.locator('.clouddock-search-source').waitFor();
      await page.locator('.clouddock-search-source').selectOption('all');
      const search=page.locator('input[placeholder*="关键词"]').first();
      await search.fill('测试电影'); await search.press('Enter');
      await page.waitForTimeout(2000);
      console.log(width,'搜索页:',(await page.locator('body').innerText()).slice(0,900));
      await page.screenshot({path:'/tmp/clouddock-pansou-search-'+width+'.png'});
      assert.ok(calls.some(c=>c.path==='/api/clouddock-pansou/search'));
      assert.ok(calls.some(c=>c.path==='/api/search'));
      for (let i=0; i<40 && !calls.some(c=>c.path==='/api/clouddock-pansou/check'); i++) await page.waitForTimeout(200);
      assert.ok(calls.some(c=>c.path==='/api/clouddock-pansou/check'));
      async function visiblePanCard() {
        for (const card of await page.locator('.resource-card-item,.resource-card__item').filter({hasText:'盘搜测试资源'}).all()) {
          const box=await card.boundingBox(); if (box && box.x >= 0 && box.x < width) return card;
        }
      }
      let panCard=await visiblePanCard();
      if (!panCard) { await page.getByText('PanSou',{exact:true}).last().click(); await page.waitForTimeout(800); panCard=await visiblePanCard(); }
      assert.ok(panCard, 'PanSou 结果卡片没有进入可见区域');
      await panCard.waitFor({state:'visible'});
      await panCard.getByText('转存', {exact:true}).first().click(); await page.waitForTimeout(1000);
      console.log(width,'转存窗口:',(await page.locator('body').innerText()).slice(-1400));
      if (width < 768) {
        const all=page.locator('.resource-select__nav [role=checkbox]').last();
        if (await all.getAttribute('aria-checked') !== 'true') await all.click();
      }
      await page.getByText('下一步',{exact:true}).last().click(); await page.waitForTimeout(800);
      console.log(width,'目录窗口:',(await page.locator('body').innerText()).slice(-1100));
      await page.getByText('测试网盘目录',{exact:true}).last().click(); await page.waitForTimeout(500);
      console.log(width,'选中网盘目录:',(await page.locator('body').innerText()).slice(-700));
      const beforeSubmit = calls.length;
      await page.getByText(width < 768 ? '保存' : '保存到此目录',{exact:true}).last().click();
      for (let i=0; i<30 && !calls.slice(beforeSubmit).some(c=>c.path==='/api/clouddock/jobs' && c.method==='POST'); i++) await page.waitForTimeout(100);
      const submitted = calls.slice(beforeSubmit).find(c=>c.path==='/api/clouddock/jobs' && c.method==='POST');
      assert.ok(submitted, '模拟提交未到达');
      assert.equal(submitted.body.shareCode,'example123'); assert.equal(submitted.body.passcode,'aB12');
      assert.deepEqual(submitted.body.selectedIds,['f1']); assert.equal(submitted.body.folderId,'dir1');
      await page.goto(origin+'/setting'); await page.waitForTimeout(800);
      console.log(width,'设置页:',(await page.locator('body').innerText()).slice(0,700));
      assert.ok(await page.locator('.clouddock-pansou-settings').isVisible());
      await page.getByRole('button',{name:'检测连接'}).click();
      await page.getByText('PanSou 服务已连接').waitFor();
      await page.getByLabel('启用 PanSou').uncheck();
      await page.getByRole('button',{name:'保存 PanSou 设置'}).click();
      assert.ok(calls.some(c=>c.path==='/api/clouddock-pansou/config' && c.method==='POST' && c.body.enabled===false));
      await page.getByLabel('启用 PanSou').check();
      await page.getByRole('button',{name:'保存 PanSou 设置'}).click();
      const validitySwitch=width < 768 ? page.locator('.setting__validity-cell [role=switch]') : page.locator('#EnableCloudLinkValidityCheck');
      assert.equal(await validitySwitch.getAttribute('aria-checked'),'true');
      if (width < 768) await validitySwitch.click(); else await validitySwitch.locator('..').locator('.el-switch__core').click();
      assert.equal(await validitySwitch.getAttribute('aria-checked'),'false');
      const beforeSave=calls.length;
      await page.getByRole('button',{name:/保存设置/}).last().click();
      for (let i=0; i<30 && !calls.slice(beforeSave).some(c=>c.path==='/api/setting/save'); i++) await page.waitForTimeout(100);
      const saved=calls.slice(beforeSave).find(c=>c.path==='/api/setting/save');
      assert.ok(saved, '设置未提交');
      assert.equal(saved.body.globalSetting?.enableCloudLinkValidityCheck,false, '关闭检测设置未保存');
      await page.getByRole('button',{name:/添加频道/}).last().click();
      await page.getByPlaceholder('自定义频道名称').last().fill('模拟频道');
      await page.getByPlaceholder('请输入频道ID').last().fill('mock_channel');
      const beforeChannelSave=calls.length;
      await page.getByRole('button',{name:/保存设置/}).last().click();
      for (let i=0; i<30 && !calls.slice(beforeChannelSave).some(c=>c.path==='/api/setting/save'); i++) await page.waitForTimeout(100);
      const channelSave=calls.slice(beforeChannelSave).find(c=>c.path==='/api/setting/save');
      assert.ok(channelSave?.body.searchChannels?.some(row=>row.name==='模拟频道' && row.channelId==='mock_channel'),'模拟频道未提交');
      for (const testWidth of (width < 768 ? [320,375,414,768] : [1024,1280,1440])) {
        await page.setViewportSize({width:testWidth,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true, testWidth+'px 横向溢出');
      }
      await page.setViewportSize({width,height:900});
      await page.goto(origin+'/resource'); await page.locator('.clouddock-search-source').waitFor();
      await page.evaluate(()=>sessionStorage.clear());
      const beforeOffSearch=calls.length;
      await page.locator('.clouddock-search-source').selectOption('pansou');
      const searchAgain=page.locator('input[placeholder*="关键词"]').first();
      await searchAgain.fill('关闭检测测试'); await searchAgain.press('Enter');
      for (let i=0; i<30 && !calls.slice(beforeOffSearch).some(c=>c.path==='/api/clouddock-pansou/search'); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(2500);
      assert.ok(calls.slice(beforeOffSearch).some(c=>c.path==='/api/clouddock-pansou/search'), '关闭检测后搜索未运行');
      assert.ok(!calls.slice(beforeOffSearch).some(c=>c.path==='/api/clouddock-pansou/check'), '关闭检测后仍发起检测');
      setting.enableCloudLinkValidityCheck=true;
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      await context.close();
    }
    for (const [state,label] of [['locked','需要提取码或提取码错误'],['uncertain','暂时无法确认'],['bad','链接失效']]) {
      checkState=state; setting.enableCloudLinkValidityCheck=true;
      const context=await browser.newContext({viewport:{width:375,height:900},serviceWorkers:'block'});
      await context.addInitScript(() => {localStorage.setItem('token','test-token');localStorage.setItem('clouddock_search_source','pansou');});
      const page=await context.newPage(); await page.goto(origin+'/resource');
      const search=page.locator('input[placeholder*="关键词"]').first(); await search.fill('状态测试'); await search.press('Enter');
      await page.getByText(label,{exact:true}).first().waitFor({timeout:12000});
      if (state !== 'bad') assert.ok(await page.getByText('转存',{exact:true}).first().isVisible(), state+' 不应隐藏转存入口');
      await context.close();
    }
    console.log('PASS: 手机/桌面搜索、可见检测、转存、目录、模拟提交和设置');
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
