import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real deployed frontend functions without modifying the script.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const zipModule = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../public/assets/jszip.js', import.meta.url), 'utf8'), { module: zipModule, exports: zipModule.exports, Blob, Buffer, Uint8Array, ArrayBuffer, setImmediate, clearImmediate, setTimeout, clearTimeout });
const JSZip = zipModule.exports;
const input = '这样的两室一厅有人喜欢吗～拱墅区转租 个人工作原因... https://xhslink.cn/o/70a9Csr9Fob 复制内容，然后进入【小红书】查看相关笔记。';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map();
    this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} }; this.queries = new Map();
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); if (key === 'src') this.src = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelector(selector) { if (!this.queries.has(selector)) this.queries.set(selector, new Element()); return this.queries.get(selector); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => child instanceof Element ? [...(selector === 'button' && child.tagName === 'BUTTON' ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { this.clicked = true; }
  remove() {}
  pause() {}
  load() {}
  focus() {}
  close() { this.open = false; }
}

function harness(fetchHandler = async () => new Response(JSON.stringify({ ready: true }), { headers: { 'content-type': 'application/json' } })) {
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement(tag) { return new Element(tag); }, createTextNode(text) { return { textContent: text }; },
    querySelectorAll() { return []; }, body: new Element('body'),
  };
  const downloads = [];
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const sandbox = { document, location: { origin: 'https://workbench.test' }, window: {}, navigator: {}, localStorage: storage, sessionStorage: storage, fetch: fetchHandler, AbortController, Blob, URL, Date, Set, Map, console, clearTimeout() {}, setTimeout() {}, setInterval() {} };
  sandbox.URL = class extends URL { static createObjectURL(blob) { downloads.push(blob); return 'blob:test'; } static revokeObjectURL() {} };
  vm.createContext(sandbox);
  const setup = source.slice(0, source.indexOf("  dom.form.addEventListener('submit'"));
  const videoListeners = source.slice(source.indexOf("  dom.video.addEventListener('loadedmetadata'"), source.indexOf("  dom.export.addEventListener('click'"));
  const exportListener = source.slice(source.indexOf("  dom.export.addEventListener('click'"), source.indexOf("  window.addEventListener('beforeunload'"));
  vm.runInContext(setup + videoListeners + exportListener + `globalThis.frontend = { dom, detectPlatform, startJob, renderJob, renderResult, readCandidate, saveFiles, setJob(job) { activeJob = job; }, setZip(zip) { window.JSZip = zip; } }; })();`, sandbox);
  return { api: sandbox.frontend, elements, downloads, document };
}

test('xhslink.cn and a complete Xiaohongshu share caption are recognized', () => {
  const { api } = harness();
  for (const text of [input, 'https://xhslink.cn/o/70a9Csr9Fob', 'https://xhslink.com/a/demo']) {
    api.dom.input.value = text; api.detectPlatform(); assert.equal(api.dom.platform.textContent, '小红书');
  }
});

test('the complete Douyin share caption including a hyphenated short link is recognized', () => {
  const { api } = harness();
  api.dom.input.value = '9.76 复制打开抖音，看看【祈枝枝o.o的作品】你好 我要三份草莓小蛋糕⚡️⚡️⚡️ # 白银之城... https://v.douyin.com/LHRdu-1AjXs/ 12/17 XMj:/ b@n.qE :2pm';
  api.detectPlatform();
  assert.equal(api.dom.platform.textContent, '抖音');
});

test('Douyin navigation timeouts show a Chinese retryable failure with collapsed sanitized diagnostics', () => {
  const { api } = harness();
  const raw = 'page.goto: Timeout 15000ms exceeded. Call log:\n - navigating to "https://user:password@v.douyin.com/LHRdu-1AjXs/?signature=private-value#token", waiting until "domcontentloaded"';
  api.renderJob({ id: 'douyin-timeout', platform: 'douyin', state: 'error', stage: 'browser', error: raw, events: [{ id: 'timeout', stage: 'browser', message: raw }] });
  assert.equal(api.dom.state.textContent, '未完成');
  assert.equal(api.dom.error.hidden, false);
  assert.equal(api.dom.retryActions.hidden, false);
  assert.equal(api.dom.submit.disabled, false);
  assert.match(api.dom.errorMessage.textContent, /抖音页面响应超时.*重新提取/);
  assert.equal(api.dom.message.textContent, api.dom.errorMessage.textContent);
  assert.doesNotMatch(api.dom.errorMessage.textContent, /page\.goto|https?:|signature|private-value|password/);
  const message = api.dom.log.children[0].children[2];
  const details = message.children[0];
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.getAttribute('open'), null);
  assert.equal(details.children[0].textContent, '查看诊断');
  assert.match(details.children[1].textContent, /page\.goto: Timeout 15000ms exceeded/);
  assert.match(details.children[1].textContent, /https:\/\/v\.douyin\.com\/LHRdu-1AjXs\//);
  assert.doesNotMatch(details.children[1].textContent, /signature|private-value|token|password|user@/);
});

test('processing-record exports retain timeout diagnostics while removing signed URL queries', async () => {
  const { api, downloads } = harness();
  const raw = 'page.goto: Timeout 15000ms exceeded. https://v.douyin.com/LHRdu-1AjXs/?signature=private-value#secret';
  api.setJob({ id: 'douyin-timeout', platform: 'douyin', state: 'error', error: { message: raw }, events: [{ stage: 'browser', message: raw }] });
  api.dom.export.listeners.get('click')();
  const exported = JSON.parse(await downloads[0].text());
  assert.match(exported.job.error.message, /Timeout 15000ms/);
  assert.match(exported.job.events[0].message, /https:\/\/v\.douyin\.com\/LHRdu-1AjXs\//);
  assert.doesNotMatch(JSON.stringify(exported), /signature|private-value|secret/);
});

test('an ordinary Douyin failure retains its reason without exposing URL queries', () => {
  const { api } = harness();
  api.renderJob({ id: 'douyin-unavailable', platform: 'douyin', state: 'error', stage: 'source', error: '作品已删除或暂不可见。https://www.douyin.com/video/123456789?secret=value' });
  assert.match(api.dom.errorMessage.textContent, /^作品已删除或暂不可见/);
  assert.doesNotMatch(api.dom.errorMessage.textContent, /超时|secret|value/);
  assert.equal(api.dom.retryActions.hidden, false);
});

test('submission preserves the complete share caption for backend parsing', async () => {
  const requests = [];
  const { api } = harness(async (url, options = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url === '/api/jobs' ? { error: 'Intentional test rejection' } : { ready: true }), { status: url === '/api/jobs' ? 400 : 200, headers: { 'content-type': 'application/json' } });
  });
  api.dom.input.value = input; await api.startJob();
  assert.equal(JSON.parse(requests.find(request => request.url === '/api/jobs').options.body).input, input);
});

test('image-only notes display images and copy without a video player', () => {
  const { api } = harness();
  const job = { id: 'image-note', state: 'done', result: { platform: 'xiaohongshu', title: '转租', verifiedFile: true, contentText: '完整正文 #转租', candidates: [
    { kind: 'image', imageUrl: '/api/files/one', bytes: 123, format: 'jpg', fileName: '01.jpg' },
    { kind: 'image', imageUrl: '/api/files/two', bytes: 456, format: 'webp', fileName: '02.webp' },
  ] } };
  api.setJob(job); api.renderResult(job);
  assert.equal(api.dom.result.hidden, false); assert.equal(api.dom.videoResult.hidden, true);
  assert.equal(api.dom.images.hidden, false); assert.equal(api.dom.imageList.children.length, 2);
  assert.equal(api.dom.content.hidden, false); assert.equal(api.dom.contentText.textContent, job.result.contentText);
  assert.equal(api.dom.imageList.children[0].children[0].children[0].src, 'https://workbench.test/api/files/one');
  assert.equal(api.dom.imageList.querySelectorAll('button').every(button => !button.disabled), true);
});

test('an image save accepts complete bytes and reports an initiated download', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const { api, downloads } = harness(async (url, options) => {
    assert.equal(url, 'https://workbench.test/api/files/one'); assert.equal(options.headers.Range, 'bytes=0-3');
    return new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 0-3/4' } });
  });
  api.setJob({ id: 'save-note', state: 'done', result: { candidates: [{ kind: 'image', imageUrl: '/api/files/one', bytes: 4, format: 'jpg', fileName: '01.jpg' }] } });
  await api.saveFiles([0]);
  assert.equal(downloads[0].size, 4); assert.equal(downloads[0].type, 'image/jpeg');
  assert.match(api.dom.downloadState.textContent, /保存已发起/);
});

test('an incomplete image response cannot trigger a saved-file success', async () => {
  const { api, downloads } = harness(async () => new Response(new Uint8Array([0xff]), { status: 206, headers: { 'content-range': 'bytes 0-3/4' } }));
  api.setJob({ id: 'broken-note', state: 'done', result: { candidates: [{ kind: 'image', imageUrl: '/api/files/one', bytes: 4, format: 'jpg' }] } });
  await api.saveFiles([0]);
  assert.equal(downloads.length, 0); assert.match(api.dom.downloadState.textContent, /未完整接收/);
});

test('a video media endpoint returning 500 cannot report or initiate a saved file', async () => {
  const { api, downloads } = harness(async () => Response.json({ error: 'upstream file unavailable' }, { status: 500 }));
  api.setJob({ id: 'channels-broken', state: 'done', result: { candidates: [{ kind: 'video', videoUrl: '/api/files/channels.mp4', bytes: 1280000, format: 'mp4' }] } });
  await api.saveFiles([0]);
  assert.equal(downloads.length, 0);
  assert.equal(api.dom.downloadState.className, 'small-message error');
  assert.match(api.dom.downloadState.textContent, /文件分段读取失败 \(500\)/);
  assert.doesNotMatch(api.dom.downloadState.textContent, /保存已发起|完整文件已接收/);
});

test('preview error 4 explains that file reads as well as codecs may fail', () => {
  const { api } = harness();
  api.dom.video.setAttribute('src', 'https://workbench.test/api/files/channels.mp4');
  api.dom.video.error = { code: 4 };
  api.dom.video.listeners.get('error')();
  assert.equal(api.dom.video.hidden, true);
  assert.equal(api.dom.fallback.hidden, false);
  assert.equal(api.dom.previewError.hidden, false);
  assert.equal(api.dom.previewError.textContent, '视频文件无法读取或编码不受支持，请重新提取。');
});

test('completed Channels results await backend verification before showing the verified badge', () => {
  const { api, elements } = harness();
  api.renderJob({ id: 'channels-unverified', state: 'done', result: { platform: 'channels', verifiedFile: false, candidates: [{ kind: 'video', videoUrl: '/api/files/channels.mp4', bytes: 1280000, format: 'mp4', codec: 'h264' }] } });
  assert.equal(api.dom.message.textContent, '内容已提取，文件尚未验证');
  assert.equal(elements.get('verified-badge').hidden, true);
  assert.equal(api.dom.video.src, 'https://workbench.test/api/files/channels.mp4');
});

test('image-note ZIP includes all original images and the complete copy', async () => {
  const { api, downloads } = harness(async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-3');
    assert.match(url, /\/api\/files\/(one|two)$/);
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'content-range': 'bytes 0-3/4' } });
  });
  const contentText = '两室一厅转租\n#杭州租房 #拱墅区';
  api.setZip(JSZip);
  api.setJob({ id: 'zip-note', state: 'done', result: { title: '转租', contentText, candidates: [
    { kind: 'image', imageUrl: '/api/files/one', bytes: 4, format: 'jpg', fileName: '01.jpg' },
    { kind: 'image', imageUrl: '/api/files/two', bytes: 4, format: 'webp', fileName: '02.webp' },
  ] } });
  await api.saveFiles([0, 1], true);
  assert.equal(downloads.length, 1);
  const archive = await JSZip.loadAsync(await downloads[0].arrayBuffer());
  assert.deepEqual(Object.keys(archive.files), ['01_01.jpg', '02_02.webp', '文案.txt']);
  assert.equal(await archive.file('文案.txt').async('string'), contentText);
  assert.equal((await archive.file('01_01.jpg').async('uint8array')).byteLength, 4);
  assert.match(api.dom.downloadState.textContent, /完整文件已接收，保存已发起/);
});

test('empty completed jobs expose a retryable failure instead of a verified success', () => {
  for (const result of [undefined, {}, { candidates: [], contentText: ' \n ' }, { candidates: [{ kind: 'image', imageUrl: 'https://untrusted.test/image.jpg' }] }]) {
    const { api, elements } = harness();
    api.renderJob({ id: 'empty-note', state: 'done', stage: 'verify', result });
    assert.equal(api.dom.state.textContent, '未完成');
    assert.equal(api.dom.state.className, 'state-badge error');
    assert.equal(api.dom.message.textContent, '未取得可保存的内容');
    assert.equal(api.dom.error.hidden, false); assert.equal(api.dom.retryActions.hidden, false);
    assert.equal(api.dom.result.hidden, true); assert.equal(elements.get('verified-badge').hidden, true);
  }
});

test('unverified media and text-only results do not claim file verification', () => {
  const { api, elements } = harness();
  api.renderJob({ id: 'unverified-note', state: 'done', result: { verifiedFile: false, candidates: [{ kind: 'image', imageUrl: '/api/files/one', bytes: 4, format: 'jpg' }] } });
  assert.equal(api.dom.message.textContent, '内容已提取，文件尚未验证');
  assert.equal(elements.get('verified-badge').hidden, true);
  api.renderJob({ id: 'text-note', state: 'done', result: { verifiedFile: true, contentText: '完整笔记正文', candidates: [] } });
  assert.equal(api.dom.message.textContent, '文案已提取');
  assert.equal(elements.get('verified-badge').hidden, true);
});

test('result changes for the same job are rendered after an empty initial result', () => {
  const { api, elements } = harness();
  api.renderJob({ id: 'updated-note', state: 'done', result: {} });
  api.renderJob({ id: 'updated-note', state: 'done', result: { title: '笔记', contentText: '提取完成', verifiedFile: false, candidates: [{ kind: 'image', imageUrl: '/api/files/one', bytes: 4, format: 'jpg' }] } });
  assert.equal(api.dom.result.hidden, false); assert.equal(api.dom.error.hidden, true);
  assert.equal(api.dom.state.textContent, '已完成'); assert.equal(api.dom.imageList.children.length, 1);
  assert.equal(api.dom.contentText.textContent, '提取完成'); assert.equal(elements.get('verified-badge').hidden, true);
  api.renderJob({ id: 'updated-note', state: 'done', result: { title: '笔记', contentText: '补充完整正文', verifiedFile: true, candidates: [{ kind: 'image', imageUrl: '/api/files/one', bytes: 4, format: 'jpg' }, { kind: 'image', imageUrl: '/api/files/two', bytes: 4, format: 'webp' }] } });
  assert.equal(api.dom.contentText.textContent, '补充完整正文'); assert.equal(api.dom.imageList.children.length, 2);
  assert.equal(elements.get('verified-badge').hidden, false); assert.equal(api.dom.message.textContent, '内容已提取，文件已验证');
  assert.equal(api.dom.retryActions.hidden, true);
});
