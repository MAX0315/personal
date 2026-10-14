/* Only the owner's published tool can use this connector. No credentials leave the browser. */
(() => {
  const ORIGIN = 'https://anma-media-tool-20261012.netlify.app';
  function allowed(sender) {
    try { return !sender.id && (!Number.isInteger(sender.frameId) || sender.frameId === 0) && new URL(sender.url).origin === ORIGIN && (!sender.origin || sender.origin === ORIGIN); }
    catch (_) { return false; }
  }
  chrome.runtime.onMessageExternal?.addListener((message, sender, respond) => {
    if (!allowed(sender) || message?.source !== 'anma-web' || typeof message.type !== 'string') return false;
    (async () => {
      switch (message.type) {
        case 'ping': return { connected:true, version:'1.8.2', name:'原视频下载助手', browserOnly:true };
        case 'startAnalysis': return startAnalysis({ pageUrl:message.pageUrl });
        case 'analysisStatus': return analysisStatus();
        case 'download': return download({ token:message.token,index:message.index });
        case 'downloadImages': return downloadImages({ token:message.token,index:message.index });
        case 'downloadStatus': return downloadStatus();
        case 'startAudio': return queueAudio(() => startAudio({ token:message.token,index:message.index }));
        case 'audioStatus': return queueAudio(audioStatus);
        case 'cancelAudio': return queueAudio(cancelAudio);
        case 'channelsLogin': return BC.openLogin();
        case 'channelsBrowserStatus': return BC.status();
        case 'rejectCandidate': return rejectCandidate({ token:message.token,index:message.index,actualDuration:message.actualDuration });
        default: throw new Error('网站不支持该操作');
      }
    })().then(respond).catch(problem => respond({ error:problem.message || '插件连接操作失败' }));
    return true;
  });
})();
