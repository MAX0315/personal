param(
  [string]$HostName = "47.97.34.195",
  [string]$User = "root",
  [string]$KeyPath = ".\deploy\anmaai_deploy_key"
)

$ErrorActionPreference = "Stop"

scp -i $KeyPath .\deploy\anmaai-site.tar.gz "$User@$HostName:/tmp/anmaai-site.tar.gz"
scp -i $KeyPath .\deploy\nginx\anmaai.cn.conf "$User@$HostName:/tmp/anmaai.cn.conf"
scp -i $KeyPath .\deploy\install_anmaai.sh "$User@$HostName:/tmp/install_anmaai.sh"
ssh -i $KeyPath "$User@$HostName" "chmod +x /tmp/install_anmaai.sh && /tmp/install_anmaai.sh"
