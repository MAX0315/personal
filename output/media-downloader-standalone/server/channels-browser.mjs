import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import C from './channels.cjs';
import {assertAllowedUrl} from './policy.mjs';

const TOTAL_MS = 27500;
const YUANBAO = 'https://yuanbao.tencent.com/';
const MIN_PAGE_WAIT = 4000;
const LOGIN_WAIT = 13000;
const API_WAIT = 4500;
const clean = value => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms, message = '视频号网页请求超时。') => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
};

function failure(pageUrl, reasonCode, error, extra = {}) {
  return { error, reasonCode, platform: 'channels', pageUrl, standalone: true, needsBridge: false, candidates: [], ...extra };
}

async function pageApi(page, endpoint, body, deadline) {
  const remaining = Math.min(API_WAIT, Math.max(800, deadline - Date.now() - 1200));
  return await bounded(page.evaluate(async ({ endpoint, body, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const api = window.$webApi;
      if (!api || typeof api.getYbCommonHeaders !== 'function' || typeof api.setContextualRequestHeaders !== 'function') return { ok: false, kind: 'page-init' };
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(await api.getYbCommonHeaders()) };
      const config = { url: new URL(endpoint).pathname + new URL(endpoint).search, method: 'post', data: body, headers };
      await api.setContextualRequestHeaders(config);
      if (typeof api.getThirdPartyReqHeaders === 'function') Object.assign(config.headers, await api.getThirdPartyReqHeaders());
      for (const key of Object.keys(config.headers)) if (config.headers[key] == null) delete config.headers[key];
      const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body), headers: config.headers, credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      if (!response.ok) return { ok: false, kind: 'http', status: response.status, text: text.slice(0, 500) };
      try { return { ok: true, payload: JSON.parse(text) }; } catch { return { ok: false, kind: 'invalid' }; }
    } catch (error) { return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network', detail: String(error?.message || error) }; }
    finally { clearTimeout(timer); }
  }, { endpoint, body, timeoutMs: remaining }), remaining + 500, '腾讯元宝解析请求超时。');
}

async function getQrData(page) {
  const frame = page.frames().find(item => /^https:\/\/open\.weixin\.qq\.com\/connect\/qrconnect/i.test(item.url()));
  if (!frame) return '';
  try {
    const images = await frame.$$('img');
    let best = null;
    let bestArea = 0;
    for (const image of images) {
      const size = await image.evaluate(node => ({ width: node.naturalWidth || node.width || 0, height: node.naturalHeight || node.height || 0 })).catch(() => ({ width: 0, height: 0 }));
      const area = size.width * size.height;
      if (area > bestArea) { best = image; bestArea = area; }
    }
    if (best && bestArea >= 10000) {
      const buffer = await best.screenshot({ type: 'png' });
      return 'data:image/png;base64,' + buffer.toString('base64');
    }
    const body = await frame.$('body');
    if (!body) return '';
    const buffer = await body.screenshot({ type: 'png' });
    return 'data:image/png;base64,' + buffer.toString('base64');
  } catch { return ''; }
}

async function loggedIn(page) {
  const url = page.url();
  if (!url.startsWith('https://yuanbao.tencent.com/')) return false;
  const state = await page.evaluate(() => {
    const body = document.body?.innerText || '';
    const loginVisible = [...document.querySelectorAll('button,[role="button"],div,span')].some(node => node.innerText?.trim() === '登录' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
    return { body, loginVisible, initialized: typeof window.$webApi?.getYbCommonHeaders === 'function' };
  }).catch(() => ({ body: '', loginVisible: true, initialized: false }));
  return state.initialized && state.body.trim().length > 30 && !state.loginVisible && !/(登录|注册|扫码|未登录|请登录后|请使用微信扫描二维码登录)/.test(state.body) && !page.frames().some(frame => /^https:\/\/open\.weixin\.qq\.com\/connect\/qrconnect/i.test(frame.url()));
}

async function openOfficialLogin(page) {
  return await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('button,[role="button"],div,span')].filter(node => node.innerText?.trim() === '登录' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
    const button = candidates.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    if (!button) return false;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    button.click();
    return true;
  }).catch(() => false);
}

export async function resolveChannelsWithBrowser(pageUrl, { onEvent = () => {}, signal, deadline = Date.now() + TOTAL_MS, loginWaitMs = LOGIN_WAIT } = {}) {
  let info;
  try { info = C.parsePage(pageUrl); } catch (error) { return failure(pageUrl, 'INVALID_LINK', error.message || '请粘贴完整的视频号分享链接。'); }
  const started = Date.now();
  let browser;
  const abort = () => { try { void browser?.close(); } catch {} };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await onEvent({ type: 'status', message: '正在打开腾讯官方网页会话…' });
    chromium.setGraphicsMode = false;
    const executablePath = await bounded(chromium.executablePath(), Math.min(9000, Math.max(1000, deadline - Date.now())), '云端浏览器启动超时。');
    const args = chromium.args.filter(arg => !/^--(?:disable-web-security|allow-running-insecure-content)(?:=|$)/.test(arg));
    browser = await puppeteer.launch({ args, executablePath, headless: 'shell', defaultViewport: { width: 1280, height: 900 }, timeout: Math.min(10000, Math.max(1000, deadline - Date.now())) });
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    await bounded(page.goto(YUANBAO, { waitUntil: 'domcontentloaded', timeout: Math.min(10000, Math.max(1000, deadline - Date.now() - 800)) }), Math.min(10000, Math.max(1000, deadline - Date.now() - 500)), '腾讯元宝网页加载超时。').catch(() => {});
    await sleep(Math.min(MIN_PAGE_WAIT, Math.max(0, deadline - Date.now() - 1000)));
    if (signal?.aborted) return failure(pageUrl, 'REQUEST_CANCELLED', '解析已取消。');
    let qr = await getQrData(page);
    const qrDeadline = Math.min(deadline - 8000, Date.now() + 15000);
    while (!qr && Date.now() < qrDeadline && !await loggedIn(page)) {
      await openOfficialLogin(page);
      await sleep(1000);
      qr = await getQrData(page);
    }
    if (qr) await onEvent({ type: 'qr', image: qr, message: '请使用微信扫描二维码登录腾讯元宝；二维码只用于本次解析。' });
    else if (!await loggedIn(page)) return failure(pageUrl, 'LOGIN_QR_UNAVAILABLE', '腾讯官方登录二维码暂时无法加载，请稍后重新解析。', { requiresLogin: true, loginInPage: true });
    const loginDeadline = Math.min(deadline - 8000, Date.now() + loginWaitMs);
    while (Date.now() < loginDeadline && !await loggedIn(page)) {
      if (!qr) {
        qr = await getQrData(page);
        if (qr) await onEvent({ type: 'qr', image: qr, message: '请使用微信扫描二维码登录腾讯元宝；二维码只用于本次解析。' });
      }
      await sleep(500);
    }
    if (!await loggedIn(page)) return failure(pageUrl, 'LOGIN_REQUIRED', '请在网页中完成微信扫码登录后重试。', { requiresLogin: true, loginInPage: true });
    await onEvent({ type: 'status', message: '登录会话已确认，正在请求这条视频号作品…' });
    const parsed = await pageApi(page, 'https://yuanbao.tencent.com/api/weixin/get_parse_result', { type: 'video_channel_url', url: info.shareUrl || pageUrl, scene: 1 }, deadline);
    if (!parsed?.ok || !parsed.payload || parsed.payload.code !== 0) {
      const status = parsed?.status ? `（HTTP ${parsed.status}）` : '';
      return failure(pageUrl, parsed?.kind === 'http' ? 'UPSTREAM_HTTP' : 'PARSE_FAILED', `腾讯元宝未能解析这条视频号链接${status}，请确认视频可正常观看后重试。`);
    }
    const playable = parsed.payload.data?.playable_url;
    let target;
    try {
      target = C.parsePage(playable);
      if (!target.token || !target.exportId || target.pageUrl.startsWith('https://channels.weixin.qq.com/finder-preview/pages/sph')) throw new Error('incomplete');
    } catch { return failure(pageUrl, 'PLAYABLE_PAGE_INVALID', '腾讯返回的播放页信息不完整，请重新复制最新的视频号分享链接。'); }
    await onEvent({ type: 'status', message: '正在读取官方播放源…' });
    await bounded(page.goto(target.pageUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(7000, Math.max(1000, deadline - Date.now() - 500)) }), Math.min(7000, Math.max(1000, deadline - Date.now() - 400)), '视频号播放页加载超时。').catch(() => {});
    const endpoint = new URL('https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info');
    endpoint.searchParams.set('_pageUrl', clean(target.pageUrl).replace(/[?&](?:token|eid)=[^&]+/g, ''));
    endpoint.searchParams.set('_rid', String(Math.floor(Date.now() / 1000)));
    const body = { baseReq: { generalToken: target.token }, exportId: target.exportId };
    const feed = await page.evaluate(async ({ endpoint, body, timeoutMs }) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
      try { const response = await fetch(endpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: controller.signal }); return { status: response.status, payload: await response.json().catch(() => null) }; }
      catch (error) { return { status: 0, error: String(error?.message || error) }; } finally { clearTimeout(timer); }
    }, { endpoint: endpoint.href, body, timeoutMs: Math.min(5000, Math.max(800, deadline - Date.now() - 800)) });
    if (feed?.status !== 200 && feed?.status !== 201) return failure(pageUrl, 'FEED_HTTP', `视频号播放接口返回 HTTP ${feed?.status || 0}，请稍后重试。`);
    const result = C.extractFeed(feed.payload, { ...target, pageUrl: target.pageUrl, shareUrl: info.shareUrl || pageUrl });
    if (result.candidates?.length) {
      try { assertAllowedUrl(result.candidates[0].videoUrl, 'media'); }
      catch { return failure(pageUrl, 'MEDIA_HOST_BLOCKED', '视频号返回的媒体地址不在安全媒体白名单内，已停止下载。'); }
    }
    if (!result.candidates?.length) return { ...result, platform: 'channels', standalone: true, method: 'channels-cloud-browser', reasonCode: result.protected ? 'PROTECTED_MEDIA' : 'MEDIA_UNAVAILABLE', clientPreview: true };
    return { ...result, platform: 'channels', standalone: true, method: 'channels-cloud-browser', clientPreview: true, resolution: { runtime: 'linux-chromium', elapsedMs: Date.now() - started, authenticated: true } };
  } catch (error) {
    return failure(pageUrl, 'CHANNELS_UNAVAILABLE', error.message || '视频号网页解析失败，请稍后重试。');
  } finally {
    signal?.removeEventListener('abort', abort);
    if (browser) await bounded(browser.close().catch(() => {}), 1200).catch(() => {});
  }
}

export { TOTAL_MS };
