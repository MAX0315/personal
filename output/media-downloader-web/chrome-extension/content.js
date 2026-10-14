(() => {
  if (/(^|\.)douyin\.com$/i.test(location.hostname)) return [];
  const candidates = [];
  const add = (raw, source, duration = 0, area = 0) => {
    try {
      const url = new URL(raw, location.href);
      if (!raw || !/^https?:$/.test(url.protocol)) return;
      if (/^(?:player|api)\.bilibili\.com$/i.test(url.hostname) || /^www\.bilibili\.com$/i.test(url.hostname) && /\/(?:player|api|playurl)(?:\/|$)/i.test(url.pathname)) return;
      const ext = /\.(m3u8|webm|mov|m4v)$/i.exec(url.pathname)?.[1] || 'mp4';
      if (candidates.some(c => c.videoUrl === url.href)) return;
      candidates.push({ videoUrl: url.href, source, kind: ext === 'm3u8' ? 'hls' : 'video', duration, area, title: document.title, fileName: (document.title.slice(0, 80) || 'video') + '.' + ext });
    } catch (_) {}
  };
  for (const video of document.querySelectorAll('video')) {
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    if (area === 0 || getComputedStyle(video).visibility === 'hidden') continue;
    add(video.currentSrc || video.src, 'VIDEO', Number.isFinite(video.duration) ? video.duration : 0, area);
    for (const source of video.querySelectorAll('source')) add(source.src, 'VIDEO', 0, area);
  }
  candidates.sort((a,b) => b.area - a.area);
  for (const meta of document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]')) add(meta.content, 'META');
  return candidates;
})();
