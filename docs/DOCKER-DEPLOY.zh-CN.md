# 修改版部署与迁移

此仓库基于 [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama) 的 4.0.9，基线提交 `3c6fdd68a6c21d4fbfae2689344d88063217abef`。提供可构建的 TypeScript/Vue 源码，不依赖 Windows EXE 或修改后的 ASAR。

## 包含的修改

- 火山引擎文本、图片、视频测试携带所选模型及必填参数，空模型提前报错。
- Base URL 接受域名、`/api/v3` 或误填的常见完整接口地址，保留代理前缀。
- 图片适配器使用 `size` 字段；返回图片 URL 时优先解析 URL，避免附带请求 ID 导致错误轮询。
- 视频不再用固定的 Seedance 2.0 名称前缀拦截自定义模型或接入点 ID；实际可用性和参数能力由火山校验。
- AI 服务弹窗挂到 body，表单内部滚动，标题及底部按钮保留。
- 新增火山图片模板；模板不预填私人配置中的模型 ID，请填写自己控制台已开通的模型或接入点。
- 失败图片、视频、合成任务支持单条和当前列表批量清除；只删除失败记录，保留文件与成功、运行中任务。两类任务记录在一个 SQLite 事务中清除。
- Docker 从本仓库构建；保留运行时依赖 `tsx`、`mysql2`，使用系统 FFmpeg/FFprobe，按 UID 1000 运行。没有自动切回官方镜像的 Watchtower。

模型名称、Key、项目和本机数据库不包含在源码包中。原上游 LICENSE 和署名保留，沿用 CC BY-NC-SA 4.0。

## Linux 服务器部署

需要 Docker Engine 和 Docker Compose v2。建议在 PVE 的 Linux VM 或 E5 处理机运行，NAS 继续负责下载和素材存储。火山 API 推理不要求本机显卡；剪辑和合成仍会使用 CPU。

```bash
git clone https://github.com/wangroot/huobao-new.git
cd huobao-new
cp .env.example .env
mkdir -p deploy-data
sudo chown -R 1000:1000 deploy-data
docker compose up -d --build
docker compose ps
curl -f http://127.0.0.1:5679/api/v1/health
```

首次构建要下载 Node 基础镜像、npm 包和 FFmpeg。镜像构建必须能访问 Docker Hub、npm、Debian 软件源，以及依赖安装脚本所需的 GitHub 下载地址。

默认只监听服务器本机 `127.0.0.1:5679`。通过 SSH 隧道访问：

```bash
ssh -L 5679:127.0.0.1:5679 your-user@your-server
```

之后在自己电脑打开 `http://localhost:5679`。可信局域网直接访问时，将 `.env` 的 `HUOBAO_BIND=0.0.0.0`，再执行 `docker compose up -d`，访问 `http://服务器IP:5679`。应用沿用上游的无登录接口，公网部署请放在带鉴权的 HTTPS 反向代理后。

常用环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HUOBAO_PORT` | `5679` | 宿主机端口 |
| `HUOBAO_BIND` | `127.0.0.1` | 监听地址 |
| `HUOBAO_DATA_PATH` | `./deploy-data` | 宿主机持久化目录 |
| `HUOBAO_IMAGE` | `huobao-drama-custom:4.0.9-fixes` | 自建镜像名称 |
| `PUBLIC_BASE_URL` | 空 | 火山获取本地参考素材时使用的公开 HTTPS 地址 |

如果参考图片、视频是本机 `/static/...` 文件，上游需要能访问它们。配置 `PUBLIC_BASE_URL=https://素材可访问的域名`，确保对应静态文件可被上游读取；127.0.0.1 或内网 IP 对火山无效。已经使用可访问的对象存储 URL 时可以留空。

## 火山模型配置

在设置 → AI 服务中，分别添加文本、图片、视频服务：

- 服务商：`volcengine`。
- Base URL：`https://ark.cn-beijing.volces.com/api/v3`。
- API Key：填自己的火山 Key。
- 模型：使用控制台已开通的模型 ID，或支持相应能力的 `ep-...` 接入点 ID。
- 同一类型如有多个启用服务，用优先级选择默认服务；已有集可能锁定旧配置，需要在工作台中检查。

图片/视频点击“测试配置”会提示实际生成费用，确认后分别生成一张图片或提交 5 秒视频任务。视频测试成功表示提交任务成功，不代表最终生成完成；该测试不写入项目任务列表，用量及进度查看火山控制台。

## 从 Windows 桌面版迁移已有数据

仅迁移源码时无需复制任何本机数据，启动后重新配置模型即可。

如需迁移项目：

1. 在桌面设置 → 存储位置确认实际目录。默认用户数据在 `%APPDATA%\HuobaoDrama`，SQLite、`static`、`workspace` 的实际路径以当前设置及启动日志为准。
2. 等待生成任务结束，正常退出桌面版。关闭数据库写入后复制 SQLite 和素材；不能只复制一个仍在写入的 WAL 数据库文件。
3. 将数据库放到服务器 `deploy-data/huobao.sqlite3`，素材目录放到 `deploy-data/static/`，自定义提示词和技能放到 `deploy-data/workspace/`。如果原素材在另一个盘，复制实际素材目录。
4. `sudo chown -R 1000:1000 deploy-data`，然后启动容器。初次入口只补充缺失的 workspace 模板，不覆盖同名自定义文件。
5. 检查项目、缩略图及模型配置。原绝对 Windows 路径不会自动转换；如有此类记录，需要调整为新目录或重新导入相应素材。应用使用的 `static/...` 相对路径可沿用。

数据库含模型 Key，按私密数据传输和备份，不上传 GitHub。不同服务器不要同时通过 NAS 挂载同一个 SQLite 数据库运行多个实例；数据库放在各自本地磁盘，媒体可按需同步。

## 备份、升级与回滚

备份前等待任务结束，停止应用，复制整个持久化目录：

```bash
docker compose stop app
sudo tar -czf "huobao-data-$(date +%Y%m%d-%H%M%S).tar.gz" deploy-data
docker compose start app
```

如改过 `HUOBAO_DATA_PATH`，备份那个实际目录。备份包含 Key 和素材。

升级本仓库源码：

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 app
```

不要换成上游官方镜像，否则自定义修改会丢失。回滚时检出之前的 Git 提交重新构建；清除过的数据库记录不会随代码回滚恢复，需使用数据备份。

## 构建镜像搬到离线服务器

```bash
docker build -t huobao-drama-custom:4.0.9-fixes .
docker save huobao-drama-custom:4.0.9-fixes | gzip > huobao-drama-custom-amd64.tar.gz
```

复制压缩包、Compose 文件及 `.env` 到目标服务器：

```bash
gzip -dc huobao-drama-custom-amd64.tar.gz | docker load
docker compose up -d --no-build
```

镜像架构要匹配：E5/i5 是 `linux/amd64`；Apple Silicon 直接运行 Linux 容器时通常需要 `linux/arm64`。本次以 amd64 验证为准，ARM64 需单独构建及验证：

```bash
docker buildx build --platform linux/arm64 -t huobao-drama-custom:4.0.9-fixes --load .
```

## 本地开发与 GitHub 验证

后端 Node 22，前端同版本。执行：

```bash
cd backend
npm ci
npm run test:server-fixes
npm run typecheck
cd ../frontend
npm ci
npm run generate
cd ..
docker compose config --quiet
docker build -t huobao-drama-custom:4.0.9-fixes .
node scripts/docker-smoke.mjs
```

`backend/tests/server-fixes.test.ts` 使用临时 SQLite 和本地 HTTP 模拟接口，不需要 Key，不提交收费生成任务。仓库附带 GitHub Actions，执行测试、类型检查、Docker 构建及容器健康和页面检查。

`scripts/docker-smoke.mjs` 创建临时容器及数据卷，检查非 root 运行、页面、重启持久化、FFmpeg 编码，并在 Linux 容器内执行后端回归测试。结束后删除它自己创建的容器和卷，不操作正常部署的数据。

原仓库部分结构型历史测试仍假定 MySQL、旧模型模板或固定 Seedance 前缀；新增功能的回归入口为 `npm run test:server-fixes`。不把历史断言全部通过作为此次验证结论。
