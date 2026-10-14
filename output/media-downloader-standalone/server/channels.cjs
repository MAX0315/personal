/* Official WeChat Channels preview API adapter. Only the requested feed is read. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChannelsExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CHANNELS = 'https://channels.weixin.qq.com';
  const FEED_PATH = '/finder-preview/pages/feed';
  const SPH_PATH = '/finder-preview/pages/sph';
  const FEED_API = CHANNELS + '/finder-preview/api/feed/get_feed_info';

  function webUrl(value) {
    if (typeof value !== 'string' || value.length > 16384 || !/^https:\/\//i.test(value.trim())) throw new Error('请粘贴完整的视频号分享链接。');
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('视频号链接格式不正确，请重新复制分享链接。');
    return url;
  }
  function oneParam(url, name, required = false) {
    const values = url.searchParams.getAll(name);
    if (values.length > 1 || required && values.length !== 1) throw new Error('视频号链接缺少必要信息或参数重复，请重新复制链接。');
    const value = values[0] || '';
    if ((required || values.length) && (!value.trim() || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value))) throw new Error('视频号链接里的作品信息无效，请重新复制链接。');
    return value;
  }
  function parsePage(value) {
    const url = webUrl(value);
    url.hash = '';
    if (url.hostname === 'weixin.qq.com') {
      const shortUri = /^\/sph\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1];
      if (!shortUri || shortUri.length > 256) throw new Error('请使用视频号的 weixin.qq.com/sph/ 分享链接。');
      const shareUrl = 'https://weixin.qq.com/sph/' + shortUri;
      return { pageUrl: CHANNELS + SPH_PATH + '?id=' + encodeURIComponent(shortUri), shareUrl, shortUri, exportId: '', token: '' };
    }
    if (url.hostname !== 'channels.weixin.qq.com') throw new Error('这不是视频号的官方链接。');
    if (url.pathname === SPH_PATH) {
      const id = oneParam(url, 'id', true);
      // The official preview page takes the initial alphanumeric short URI.
      const shortUri = /^[A-Za-z0-9]+/.exec(id)?.[0] || '';
      if (!shortUri || shortUri.length > 256) throw new Error('视频号分享编号无效，请重新复制链接。');
      return { pageUrl: url.href, shareUrl: 'https://weixin.qq.com/sph/' + shortUri, shortUri, exportId: '', token: oneParam(url, 'token') };
    }
    if (url.pathname !== FEED_PATH) throw new Error('请使用视频号分享链接或官方作品播放页。');
    return { pageUrl: url.href, shareUrl: '', shortUri: '', exportId: oneParam(url, 'eid', true), token: oneParam(url, 'token') };
  }
  function isChannelsUrl(value) {
    try { parsePage(value); return true; } catch (_) { return false; }
  }
  function cleanMessage(value) {
    return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) : '';
  }
  function failure(reason, extra = {}) {
    return { candidates: [], reason, error: reason, platform: 'channels', matched: false, ...extra };
  }
  function meaningful(value) {
    return value !== undefined && value !== null && value !== '' && value !== false && value !== 0 && value !== '0' && value !== 'false';
  }
  function protectedMedia(feed, variant) {
    // A CDN encfilekey is an address signature, not a player decodeKey.
    for (const obj of [feed, variant]) {
      if (!obj || typeof obj !== 'object') continue;
      for (const key of ['encrypted', 'isEncrypted', 'is_encrypted', 'decodeKey', 'decode_key', 'decryptKey', 'decrypt_key', 'encryptionKey']) {
        if (meaningful(obj[key])) return true;
      }
    }
    return false;
  }
  function safeMedia(value) {
    if (typeof value !== 'string' || value !== value.trim()) return '';
    let url;
    try { url = webUrl(value); } catch (_) { return ''; }
    const host = url.hostname.toLowerCase(), path = url.pathname.toLowerCase();
    // Explicit video fields may use signed CDN paths without an MP4 suffix.
    // Exclude local networks, player pages, pictures, and partial/segmented files.
    if (!host.includes('.') || /^(?:localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(host) || host.includes(':') || /^\[/.test(host) || /^\d+(?:\.\d+){3}$/.test(host) || /^0x[\da-f]+$/i.test(host)) return '';
    if (/\.(?:jpg|jpeg|png|webp|gif|svg|avif|heic|heif|m3u8|mpd|m4s|ts|aac|mp3|m4a|ogg|wav|flac|html?|js|css|json|pdf|zip|exe|apk)(?:$|\/)/i.test(path)) return '';
    if (/\/(?:finder-preview|sph|embed|watch|player|dash|segments?|chunks?|cover|covers|poster|thumbnail)(?:\/|$)/i.test(path)) return '';
    for (const key of url.searchParams.keys()) {
      if (/^(?:range|byte_?start|byte_?end|start|end|segment|segment_index|chunk|chunk_index|part)$/i.test(key)) return '';
      if (/^(?:decodeKey|decode_key|decryptKey|decrypt_key|encrypted|encryptionKey)$/i.test(key) && meaningful(url.searchParams.get(key))) return '';
    }
    if (/audio|image|dash|mpegurl|m3u8|html/i.test(url.searchParams.get('mime_type') || url.searchParams.get('format') || '')) return '';
    // Keep the original text: re-serializing a signed CDN URL can invalidate it.
    return value;
  }
  function positive(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function firstNumber(objects, keys) {
    for (const obj of objects) for (const key of keys) {
      const n = positive(obj?.[key]);
      if (n) return n;
    }
    return 0;
  }
  function extractFeed(payload, info = {}) {
    const videoId = typeof info.exportId === 'string' && info.exportId || typeof info.shortUri === 'string' && info.shortUri || '';
    const base = { pageUrl: info.pageUrl || '', shareUrl: info.shareUrl || '', videoId };
    if (!payload || typeof payload.errCode !== 'number') return failure('视频号没有返回有效的作品信息，请重新解析。', base);
    if (payload.errCode !== 0) return failure('视频号暂时无法提供这条作品（错误码 ' + payload.errCode + '），请在官方页面确认是否能正常观看。', base);
    const warning = payload.data?.errMsg;
    if (warning && (typeof warning.type !== 'number' || warning.type !== 0)) {
      const message = cleanMessage(warning.title) || cleanMessage(warning.content);
      return failure('视频号提示这条作品暂时不可用' + (message ? '：' + message : '，请在官方页面确认是否能正常观看。'), base);
    }
    const feed = payload.data?.feedInfo;
    if (!feed || typeof feed !== 'object' || Array.isArray(feed)) return failure('视频号没有提供这条作品的完整视频地址。', base);
    const title = cleanMessage(feed.description) || cleanMessage(feed.title) || '视频号视频';
    const variants = [
      { item: feed.h264VideoInfo, url: feed.h264VideoInfo?.videoUrl, source: 'h264VideoInfo', codec: 'h264' },
      { item: feed.h265VideoInfo, url: feed.h265VideoInfo?.videoUrl, source: 'h265VideoInfo', codec: 'h265' },
      { item: feed, url: feed.videoUrl, source: 'videoUrl', codec: '' }
    ];
    const selected = variants.find(item => item.url !== undefined && item.url !== null && item.url !== '');
    if (!selected) return failure('腾讯目前只返回了作品封面，没有完整视频源。请检查浏览器登录状态后重试；封面不能作为视频下载。', { ...base, title, metadataOnly: true });
    if (protectedMedia(feed, selected.item)) return failure('这条视频的播放地址需要加密解码，当前无法确认是完整可播放文件，已停止下载。', { ...base, title, protected: true });
    const videoUrl = safeMedia(selected.url);
    if (!videoUrl) return failure('视频号返回的视频地址不是可下载的完整文件，已停止下载。', { ...base, title });
    const objects = [selected.item, feed];
    // Bare duration/videoTime fields have varied units across platform payloads.
    // Only trust explicit units; the popup otherwise reads the player's seconds.
    const duration = firstNumber(objects, ['durationSeconds', 'duration_seconds']) || firstNumber(objects, ['durationMs', 'duration_ms']) / 1000;
    const width = firstNumber(objects, ['width', 'videoWidth']);
    const height = firstNumber(objects, ['height', 'videoHeight']);
    const cleanId = videoId.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 32);
    const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70) || '视频号视频';
    const candidate = {
      videoUrl, videoId, title, fileName: name + (cleanId ? '_' + cleanId : '') + '.mp4',
      platform: 'channels', kind: 'video', source: 'CHANNELS.' + selected.source,
      sourceRole: 'native-playback', codec: selected.codec, duration, width, height,
      watermark: 'unknown', previewCompatible: true
    };
    return { ...base, title, candidates: [candidate], platform: 'channels', matched: true, method: 'channels-api' };
  }
  return { isChannelsUrl, parsePage, extractFeed, safeMedia };
});
