# ANMA Portfolio

ANMA 的个人 AI 作品集静态网站，包含首页、AI 视频作品、AI 设计作品与信息流视频展示。

## 页面

- `index.html`：作品集首页
- `video.html`：AI 视频作品
- `design.html`：AI 设计作品
- `feed.html`：信息流视频

## 本地预览

```powershell
npm install
node serve-local.mjs
```

打开 `http://127.0.0.1:4173/`。

## 目录

- `assets/`：网站使用的图片、视频、字体与动效资源
- `scripts/`：作品资源同步脚本
- `deploy/`：阿里云部署脚本、Nginx 配置与部署说明
- `script.js`：页面数据与交互逻辑
- `styles.css`：桌面端与移动端样式
- `PROJECT_MEMORY.md`：项目结构、维护规则与变更记录

大型二进制资源通过 Git LFS 管理。依赖目录、部署产物、缓存和服务器私钥不会提交到仓库。

## 在线地址

- 域名：`anmaai.cn`
- 服务器预览：`http://47.97.34.195/`
