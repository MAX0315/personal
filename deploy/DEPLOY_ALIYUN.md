# anmaai.cn 阿里云部署说明

## 服务器信息

- 公网 IP：`47.97.34.195`
- 站点目录：`/var/www/anmaai.cn`
- Nginx 配置：`deploy/nginx/anmaai.cn.conf`

密码和私钥仅保存在本地安全位置，不得写入本文档或提交到 Git。

## 构建部署包

```powershell
node .\deploy\build-deploy-package.mjs
```

生成的压缩包位于 `deploy/anmaai-site.tar.gz`，该文件属于部署产物，不提交到仓库。

## 上传与安装

使用本地私钥时：

```powershell
.\deploy\upload-and-deploy.ps1
```

也可以通过环境变量传入服务器密码并使用现有 Node 部署脚本。不要把密码硬编码进脚本。

## Nginx

服务器首次安装可执行：

```bash
sudo dnf install -y nginx || sudo yum install -y nginx
sudo mkdir -p /var/www/anmaai.cn
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

## DNS

在阿里云 DNS 中配置：

```text
@    A    47.97.34.195
www  A    47.97.34.195
```

## HTTPS

域名解析和备案完成后，可使用 Certbot：

```bash
sudo dnf install -y certbot python3-certbot-nginx || sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d anmaai.cn -d www.anmaai.cn
```
