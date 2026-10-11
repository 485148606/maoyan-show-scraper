/**
 * 用 CDP 监听 show.maoyan.com 列表页的真实网络请求，
 * 并通过滚动/点击触发翻页，从而找到真正的数据接口。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CANDIDATES.find(p => fs.existsSync(p));
const PORT = 9334;
const PROFILE = path.join(os.tmpdir(), 'cdp_m2_' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function httpJSON(url, method) {
  const r = await fetch(url, method ? { method } : undefined);
  return r.json();
}

const REQUESTS = [];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
        return;
      }
      if (m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        if (!/\.(png|jpg|jpeg|gif|css|woff2?|svg|ico)(\?|$)/i.test(r.url)) {
          REQUESTS.push({ t: Date.now(), type: m.params.type, method: r.method, url: r.url });
        }
      }
      if (m.method === 'Network.responseReceived') {
        const r = m.params.response;
        const hit = REQUESTS.find(x => x.url === r.url && x.status === undefined);
        if (hit) hit.status = r.status;
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-dev-shm-usage',
    '--window-size=1400,1200', 'about:blank'
  ], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { await httpJSON(`http://127.0.0.1:${PORT}/json/version`); ready = true; break; } catch (e) { await sleep(300); }
  }
  if (!ready) { console.error('CDP 启动失败'); cleanup(); process.exit(1); }

  const list = await httpJSON(`http://127.0.0.1:${PORT}/json/list`);
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  console.log('== 阶段1: 打开列表页 ==');
  await cdp.send('Page.navigate', { url: 'https://show.maoyan.com/list?categoryId=1' });
  await sleep(7000);
  console.log('列表条数(DOM):', await cdp.evaluate(`document.querySelectorAll('a[href*="detail"]').length`));
  const before = REQUESTS.length;

  console.log('== 阶段2: 查找分页/加载更多元素 ==');
  const pg = await cdp.evaluate(`(() => {
    const out = [];
    document.querySelectorAll('*').forEach(e => {
      if (e.children.length) return;
      const t = (e.textContent || '').trim();
      if (/下一页|下一頁|加载更多|查看更多|^(1|2|3|4|5)$/.test(t) && t.length < 10) {
        out.push(e.tagName + '|' + (e.className || '') + '|' + t);
      }
    });
    return out.slice(0, 25);
  })()`);
  console.log(pg);

  console.log('== 阶段3: 滚动到底触发懒加载 ==');
  await cdp.evaluate(`window.scrollTo(0, document.body.scrollHeight); 'ok'`);
  await sleep(4000);
  await cdp.evaluate(`window.scrollTo(0, document.body.scrollHeight); 'ok'`);
  await sleep(4000);
  console.log('滚动后列表条数(DOM):', await cdp.evaluate(`document.querySelectorAll('a[href*="detail"]').length`));

  console.log('== 阶段4: 实际网络请求 ==');
  REQUESTS.slice(before).forEach(r => console.log(`[${r.type}] ${r.status || '?'} ${r.method} ${r.url.slice(0, 160)}`));
  console.log('-- 全部请求（去重，前 40）--');
  [...new Set(REQUESTS.map(r => `[${r.type}]${r.status || '?'} ${r.url}`))].slice(0, 40).forEach(u => console.log(u.slice(0, 200)));

  ws.close(); cleanup(); await sleep(300); process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
