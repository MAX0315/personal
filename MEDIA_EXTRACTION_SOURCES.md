# 媒体提取网站与 Chrome 插件源码

本机已有的提取工具源码、依赖锁、测试、部署配置、浏览器转换引擎及其许可证集中在本仓库。可以在另一台电脑克隆后继续维护。

## 目录入口

| 项目 | 源码目录 | 说明 |
| --- | --- | --- |
| 当前媒体工作台 2.5.3 | `output/media-workbench-xhs-fix` | 保留原站界面，小红书移动分享解析、视频号文件接口与抖音短链修复 |
| Chrome 插件 1.8.2 | `output/media-downloader-web/chrome-extension` | 完整 Manifest V3 插件、侧栏、后台、平台解析器、图标及 FFmpeg WASM |
| 网页与插件连接版 | `output/media-downloader-web` | 网页、解析函数、媒体接口、插件打包脚本与文档 |
| 独立网页 2.1 | `output/media-downloader-standalone` | 本机保留的早期独立云浏览器版本及服务端实现 |
| 云浏览器实验源码 | `output/media-downloader-web/cloud-browser-prototype` | 可行性说明、实验函数和依赖锁，非当前正式站点 |

当前工作台网址：https://anma-media-workbench-xhs-20261014.netlify.app/?v=2.5.3

本机未取得另一台电脑上的原站 2.5.0 私有后台源码。当前工作台的部分平台继续使用该原站云端服务，源码中明确保留这一依赖；本仓库包含本机能够取得的网页资源、修复服务和早期独立后台，不代表原站私有后台已完整迁移。

## 克隆与运行

仓库包含 Git LFS 管理的图片，先安装 Git LFS，再执行：

```powershell
git clone https://github.com/MAX0315/personal.git
cd personal
git lfs pull
cd output/media-workbench-xhs-fix
npm ci
npm test
npm run dev
```

打开 `http://localhost:8097/`。云端任务、官方扫码和完整平台提取需要相应 Netlify 环境及原站服务；每个项目的 README 说明具体使用方式。

Chrome 插件通过 `chrome://extensions` 的开发者模式加载 `output/media-downloader-web/chrome-extension` 文件夹。打包脚本 `output/media-downloader-web/package-connector.ps1` 会从这份主源生成 1.8.2 ZIP，网页的下载目录中也保留对应交付包。

## 文件保留范围

保留代码、静态网页、必要运行资源、依赖锁、测试、许可证、打包和部署配置。忽略已安装依赖、Netlify 本机状态、登录会话、Cookie、私密诊断、测试下载视频、重复解压目录和部署返回数据。这些本机文件继续留在电脑上，不进入 Git 历史。

仓库中其他作品集页面的现有修改不属于这次媒体工具同步。
