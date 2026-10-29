// Минимальный CDP-клиент для отладки приложения.
//   node tools/cdp.mjs eval "<js>"      — выполнить выражение, вернуть JSON
//   node tools/cdp.mjs shot <file.png>  — скриншот страницы
//   node tools/cdp.mjs html <file.html> — сохранить DOM
//   node tools/cdp.mjs nav <url>        — перейти по адресу
//   node tools/cdp.mjs list             — список целей
// Опция --target <подстрока URL> выбирает вкладку (по умолчанию — music-application).
import fs from 'node:fs';

const PORT = process.env.YM_CDP_PORT || '9222';
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = [];
let targetHint = 'music-application://';
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i] === '--target') targetHint = argv[++i];
  else rest.push(argv[i]);
}

async function listTargets() {
  const response = await fetch(`${BASE}/json/list`);
  return response.json();
}

function pickTarget(list) {
  const pages = list.filter((t) => t.type === 'page');
  return pages.find((t) => t.url.includes(targetHint)) || pages[0];
}

class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  if (cmd === 'list') {
    const list = await listTargets();
    for (const t of list) console.log(`${t.type}\t${t.url.slice(0, 140)}`);
    return;
  }

  const target = pickTarget(await listTargets());
  if (!target) throw new Error('нет вкладок');
  const client = new Client(target.webSocketDebuggerUrl);
  await client.ready;

  if (cmd === 'eval') {
    const expression = rest[0] === '--file' ? fs.readFileSync(rest[1], 'utf8') : rest.join(' ');
    const result = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      console.error('EXCEPTION:', result.exceptionDetails.text, JSON.stringify(result.exceptionDetails.exception?.description || ''));
      process.exitCode = 1;
    }
    const value = result.result?.value ?? result.result?.description;
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } else if (cmd === 'click') {
    const selector = rest[0];
    const rect = await client.send('Runtime.evaluate', {
      expression: `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`,
      returnByValue: true,
    });
    const box = rect.result.value;
    if (!box || !box.w) throw new Error('элемент не найден или не виден: ' + selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await client.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: type === 'mouseMoved' ? 'none' : 'left',
        clickCount: type === 'mouseMoved' ? 0 : 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    console.log(`clicked ${selector} at ${Math.round(box.x)},${Math.round(box.y)}`);
  } else if (cmd === 'clickAt') {
    const x = Number(rest[0]);
    const y = Number(rest[1]);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await client.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: type === 'mouseMoved' ? 'none' : 'left',
        clickCount: type === 'mouseMoved' ? 0 : 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    console.log(`clicked at ${x},${y}`);
  } else if (cmd === 'wheel') {
    const [x, y, deltaY, times] = rest.map(Number);
    const count = Number.isFinite(times) ? times : 1;
    for (let i = 0; i < count; i += 1) {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX: 0,
        deltaY,
        pointerType: 'mouse',
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    console.log(`wheel ${deltaY} x${count} at ${x},${y}`);
  } else if (cmd === 'css') {
    const source = fs.readFileSync(rest[0], 'utf8');
    const result = await client.send('Runtime.evaluate', {
      expression: `(()=>{let el=document.getElementById('ymc-preview');if(!el){el=document.createElement('style');el.id='ymc-preview';document.head.appendChild(el)}el.textContent=${JSON.stringify(source)};return 'ok '+el.textContent.length})()`,
      returnByValue: true,
    });
    console.log(result.result.value);
  } else if (cmd === 'shot') {
    const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(rest[0], Buffer.from(result.data, 'base64'));
    console.log(`saved ${rest[0]}`);
  } else if (cmd === 'html') {
    const result = await client.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    });
    fs.writeFileSync(rest[0], result.result.value, 'utf8');
    console.log(`saved ${rest[0]} (${result.result.value.length} chars)`);
  } else if (cmd === 'nav') {
    await client.send('Page.navigate', { url: rest[0] });
    console.log('navigated');
  } else {
    console.error('неизвестная команда: ' + cmd);
    process.exitCode = 1;
  }

  client.ws.close();
}

main().catch((error) => {
  console.error('FAIL:', error.message);
  process.exit(1);
});
