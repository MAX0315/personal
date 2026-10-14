# 原媒体下载助手网页版

正式网站：https://anma-media-tool-20261012.netlify.app/

网页版包含公开链接解析、媒体预览、单文件视频保存、原图逐张及 ZIP 打包、首帧保存、本地视频转 MP3。登录内容可通过随站提供的 v1.8.2 Chrome 插件连接，继续使用正常浏览器账号会话。账号 Cookie、密码及身份请求头不会发送到网站服务器。

## v1.8.2 使用流程

1. 在 Google Chrome 中打开正式网站，下载并解压网页兼容插件。
2. 在 `chrome://extensions` 开启开发者模式，加载解压后的 `video-origin-downloader-extension` 文件夹。已安装旧版时，重新加载新文件夹或更新原文件夹并点刷新。插件 ID 应为 `jmieokljbejfpppioadgppnhfolajoka`。
3. 回到网站，粘贴完整分享文案，检查识别出的链接，点击“解析素材”。网站会在解析前再次检查插件连接。
4. 抖音公开页面没有媒体地址时，插件会读取目标作品的正常浏览器页面。如平台要求登录或验证，在打开的抖音页面正常完成，再回到网站重新解析。
5. 核对预览内容和时长后保存视频或提取 MP3。账号登录、解析与下载均在 Chrome 内完成，不需要启动本地助手。

Codex 内置浏览器和其他未安装该扩展的浏览器无法调用 Chrome 插件；请使用安装插件的 Google Chrome 打开同一个网站。

截图中的抖音链接 `https://v.douyin.com/Z0wh2LKx4MI/` 已识别到作品 ID `7568826746301189418`。公开服务器读取实际返回平台验证页；普通浏览器正常加载后，插件使用的页面脚本已取得对应标题和视频源，并完整下载 7,301,287 字节的 1080×1932、18.566667 秒 H.264/AAC 视频，ffmpeg 完整解码通过。本次测试没有登录账号、没有使用用户 Cookie，也没有绕过平台验证。浏览器回退流程的自动化测试和实际页面下载证据分别记录在 qa/ 中。

站点使用独立 Netlify 项目，不覆盖工作区原有作品集。项目 ID 见 netlify-site.json。

## 本地与部署

启动：`node serve-local.mjs`，访问 http://127.0.0.1:4188。

检查：`node --test tests/backend.test.mjs tests/web-bridge.test.cjs`。

部署后网络验证：`node tests/backend-live-smoke.mjs https://anma-media-tool-20261012.netlify.app`。

Netlify 配置：dist/ 为公开目录；netlify/functions/resolve.mjs 提供解析；netlify/edge-functions/media.mjs 提供经域名白名单、容器检查的流式媒体读取。server/ 保存与插件共享的解析器副本。公开目录不含账号凭证或服务器配置。

公开网络测试样片来自 MDN CC0 flower.mp4，仅证明媒体直链功能，不能代表抖音、小红书、B 站或视频号账号作品均已完成实测。具体线上验证记录保存在 tests/artifacts/ 中。
