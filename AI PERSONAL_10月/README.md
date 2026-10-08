# ANMA 本地独立预览

这是从 `https://anmaai.cn/` 同步的本地静态预览，保留原站的页面结构、中文文案、作品数据、交互和响应式布局。

## 页面

- `index.html`：首页
- `video.html`：AI 视频作品
- `design.html`：AI 设计作品与灯箱预览
- `feed.html`：信息流视频

## 启动

在此目录运行：

```powershell
node serve.mjs 4173
```

然后打开 `http://localhost:4173/`。也可以双击 `serve-preview.cmd` 启动。

`vendor/` 中已经包含 React、ReactDOM、Babel、Framer Motion 和 Tailwind CDN 脚本，作品图片、缩略图、视频、字体和二维码均已保存到 `assets/`。首页背景视频因生产 CloudFront 源站拒绝下载，仍保留原站远程地址；其余站点内容可直接在本地运行。

同步时间：2026-10-08
