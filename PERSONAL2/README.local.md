# ANMA Portfolio 本地镜像

这个目录保存 `https://anma-portfolio-max0315.netlify.app/` 的公开页面与静态资源，作为后续本地制作和资源归档的独立副本。同步时间、资源 URL、文件大小和 SHA-256 校验值记录在 `mirror-manifest.json`。

## 本地预览

在此目录运行：

```powershell
node serve-local.mjs
```

然后打开 <http://localhost:4174/>。

使用 HTTP 本地服务器预览，页面里的根路径资源、模块脚本、图片、视频和音频才能按线上路径正常加载。

首页“个人作品”里的三个案例入口仍保留线上地址 `anmaai.cn/video.html`、`anmaai.cn/design.html` 和 `anmaai.cn/feed.html`；本次镜像范围是当前 Netlify 首页及其同源公开静态资源。

## 重新同步

```powershell
node .\sync-site.mjs
```

脚本只抓取同源公开静态资源，不会写入上级旧项目目录；再次同步前建议先保存本目录中的本地改动。
