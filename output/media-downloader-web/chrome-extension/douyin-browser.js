/* Read the requested work in the user's normal Chrome page. No account data leaves that page. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BrowserDouyin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const TOTAL_MS = 24000, LOAD_MS = 10000, SCRIPT_MS = 7000;
  const E = () => root.VideoExtractor;
  const chromeApi = () => root.chrome;
  function official(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
        /^(?:www\.)?(?:douyin|iesdouyin)\.com$|^v\.douyin\.com$/.test(u.hostname);
    } catch (_) { return false; }
  }
  const target = value => official(value) ? E().getDouyinId(value) : '';
  const sameWork = (tab, id) => target(tab?.url) === id && (!tab.pendingUrl || target(tab.pendingUrl) === id);
  function problem(message, reasonCode) { return Object.assign(new Error(message), { reasonCode }); }
  function bounded(promise, timeoutMs, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(problem(message, 'timeout')), Math.max(1, timeoutMs)); })])
      .finally(() => clearTimeout(timer));
  }
  function canonical(id, pageUrl) {
    return 'https://www.douyin.com/' + (/\/(?:note|share\/(?:note|slides))\//i.test(new URL(pageUrl).pathname) ? 'note/' : 'video/') + id;
  }
  async function waitForPage(tabId, expectedId, deadline) {
    const chrome = chromeApi();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, tab) => {
        if (done) return;
        done = true; clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(changed);
        chrome.tabs.onRemoved?.removeListener(removed);
        error ? reject(error) : resolve(tab);
      };
      const inspect = tab => {
        if (done) return;
        const value = tab.pendingUrl || tab.url;
        if (!official(value) || tab.url && !official(tab.url) && !(tab.status === 'loading' && tab.url === 'about:blank' && official(tab.pendingUrl))) return finish(problem('抖音链接跳转到了其他网站，已停止解析。', 'navigation'));
        const id = target(value);
        if (expectedId && id && id !== expectedId) return finish(problem('页面作品与目标不一致，请回到目标作品后重新解析。', 'identity'));
        if (tab.status === 'complete' && !tab.pendingUrl) finish(null, tab);
      };
      const changed = (id, _change, tab) => { if (id === tabId) inspect(tab); };
      const removed = id => { if (id === tabId) finish(problem('目标抖音页面已关闭，请重新解析。', 'closed')); };
      const timer = setTimeout(() => finish(problem('抖音页面加载超时，请检查网络或完成页面验证后重新解析。', 'timeout')), Math.max(1, Math.min(LOAD_MS, deadline - Date.now())));
      chrome.tabs.onUpdated.addListener(changed);
      chrome.tabs.onRemoved?.addListener(removed);
      chrome.tabs.get(tabId).then(inspect, () => finish(problem('目标抖音页面已关闭，请重新解析。', 'closed')));
    });
  }
  async function readPage(tabId, id, deadline) {
    const chrome = chromeApi();
    if (!sameWork(await chrome.tabs.get(tabId), id)) throw problem('页面作品与目标不一致，已停止解析。', 'identity');
    await bounded(chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['extractor.js', 'page-hook.js'] }),
      Math.min(SCRIPT_MS, deadline - Date.now()), '抖音页面读取超时，请重试。');
    const responses = await bounded(chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', args: [id],
      func: async wanted => {
        const extractor = globalThis.VideoExtractor;
        if (!extractor || extractor.getDouyinId(location.href) !== wanted) return { candidates: [], reasonCode: 'identity' };
        const candidates = typeof globalThis.__vodExtractCurrent === 'function' ? await globalThis.__vodExtractCurrent(wanted) : [];
        if (extractor.getDouyinId(location.href) !== wanted) return { candidates: [], reasonCode: 'identity' };
        const text = String(document.body?.innerText || '').slice(0, 6000);
        const reasonCode = /验证码|安全验证|完成验证|verifycenter|captcha/i.test(text) ? 'verification'
          : /登录后(?:即可|才能)?(?:观看|播放)(?:该|此|本)?(?:视频|作品)|请(?:先)?登录(?:抖音)?(?:后)?(?:观看|播放)/i.test(text) ? 'auth' : '';
        return { candidates, reasonCode };
      } }), Math.min(SCRIPT_MS, deadline - Date.now()), '抖音页面读取超时，请重试。');
    if (!sameWork(await chrome.tabs.get(tabId), id)) throw problem('解析期间页面已切换作品，已停止解析。', 'identity');
    const payload = responses[0]?.result || {};
    if (payload.reasonCode === 'identity') throw problem('页面作品与目标不一致，已停止解析。', 'identity');
    const noteRoute = /\/(?:note|share\/(?:note|slides))\//i.test(new URL((await chrome.tabs.get(tabId)).url).pathname);
    const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []).filter(item => item.videoId === id &&
      /^https?:\/\//.test(item.videoUrl || '') && (item.kind === 'video' || noteRoute && item.kind === 'image'));
    return { candidates: E().rankCandidates(candidates), reasonCode: payload.reasonCode || '' };
  }
  async function resolve(pageUrl, preferredTabId, linked = {}) {
    const chrome = chromeApi(), deadline = Date.now() + TOTAL_MS;
    let id = linked.videoId || target(linked.pageUrl) || target(pageUrl), tab, own = false, adopted = false;
    const activation = info => { if (tab?.id === info.tabId) adopted = true; };
    chrome.tabs.onActivated?.addListener(activation);
    try {
      if (!official(pageUrl)) throw problem('请输入正常的抖音作品或分享链接。', 'input');
      if (id && !/^\d{8,24}$/.test(id) || target(pageUrl) && id && target(pageUrl) !== id) throw problem('分享链接与目标作品 ID 不一致，请重新解析。', 'identity');
      const tabs = await chrome.tabs.query({});
      tab = tabs.filter(item => id ? sameWork(item, id) : official(item.url) && item.url.split('#')[0] === pageUrl.split('#')[0])
        .sort((a, b) => Number(b.id === preferredTabId) - Number(a.id === preferredTabId))[0];
      if (!tab) { tab = await chrome.tabs.create({ url: id ? canonical(id, linked.pageUrl || pageUrl) : pageUrl, active: false }); own = true; }
      tab = await waitForPage(tab.id, id, deadline);
      if (!id) id = target(tab.url);
      if (!id) throw problem('分享页暂未显示目标作品，请在已打开的抖音页面完成正常验证，再回到网页重新解析。', 'verification');
      pageUrl = canonical(id, tab.url);
      // A short link may land on the mobile share page. Let the real desktop player load its normal state.
      if (own && new URL(tab.url).hostname.includes('iesdouyin.com')) {
        await chrome.tabs.update(tab.id, { url: pageUrl });
        tab = await waitForPage(tab.id, id, deadline);
      }
      let observed = { candidates: [], reasonCode: '' };
      for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
        observed = await readPage(tab.id, id, deadline);
        // Comment/login prompts can be visible while a public player is still initializing.
        // Give native target responses time to arrive before treating login as a playback requirement.
        if (observed.candidates.length || observed.reasonCode === 'verification') break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, Math.min(700, Math.max(0, deadline - Date.now()))));
      }
      if (!observed.candidates.length) {
        const message = observed.reasonCode === 'auth' ? '请在已打开的抖音页面正常登录，再回到网页重新解析。'
          : observed.reasonCode === 'verification' ? '请在已打开的抖音页面完成正常验证，再回到网页重新解析。'
            : '已打开并读取目标抖音作品，页面暂未返回可下载的完整媒体。请在该页正常播放作品，再回到网页重新解析。';
        throw problem(message, observed.reasonCode || 'media-unavailable');
      }
      if (own && !adopted) {
        const current = await chrome.tabs.get(tab.id);
        if (sameWork(current, id) && !current.active && !current.pinned) await chrome.tabs.remove(tab.id);
      }
      return { candidates: observed.candidates, videoId: id, pageUrl, tabId: tab.id, platform: 'douyin', matched: true,
        method: own ? 'browser-page' : 'existing-page' };
    } catch (error) {
      let recoveryOpened = false;
      if (tab && error.reasonCode !== 'navigation' && error.reasonCode !== 'closed') {
        try { const current = await chrome.tabs.get(tab.id); if (official(current.url)) { await chrome.tabs.update(tab.id, { active: true }); recoveryOpened = true; } } catch (_) {}
      }
      return { candidates: [], error: error.message || '抖音浏览器解析失败，请重新解析。', reasonCode: error.reasonCode || 'page',
        pageUrl: id ? canonical(id, pageUrl) : pageUrl, videoId: id || '', targetId: id || '', tabId: tab?.id,
        platform: 'douyin', matched: false, requiresPage: true, needsBridge: true, needsLogin: error.reasonCode === 'auth',
        recoveryOpened, browserOpened: own };
    } finally { chrome.tabs.onActivated?.removeListener(activation); }
  }
  return { resolve };
});
