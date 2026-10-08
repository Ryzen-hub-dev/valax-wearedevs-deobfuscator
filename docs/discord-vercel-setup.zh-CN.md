# Valax：Vercel + Discord 部署说明

## 架构

- Vercel 运行 `POST /api/recovery`，作为轻量同步恢复和故障回退接口。
- Discord Gateway bot 必须运行在常驻进程（Railway、Render、Fly.io 或 VPS），负责监听自定义状态、分配频道角色和处理 `/1`。
- Bot 默认把恢复任务放进独立 Worker 子进程。单个任务超时或内存耗尽不会让 Bot 主进程掉线。
- Worker 容器包含 C++20 原生预检引擎；它会按脚本体积、Token 数和嵌套深度选择安全恢复阶段。
- Vercel Serverless Function 不能长期保持 Discord Gateway WebSocket，因此 bot 本身不能只部署在 Vercel。

## 1. Vercel 环境变量

在 Vercel 项目中设置：

```text
INTERNAL_BOT_SERVICE_SECRET=<至少 32 字节的随机密钥>
MAX_SOURCE_BYTES=2000000
MAX_OUTPUT_BYTES=3500000
```

不要把真实密钥提交到 GitHub。API 只接受带有以下请求头的请求：

```text
Authorization: Bearer <INTERNAL_BOT_SERVICE_SECRET>
```

Vercel 单次请求和响应的硬限制为 4.5 MB，因此默认输入限制为 2 MB，输出限制为 3.5 MB。

## 2. 在 Discord Developer Portal 创建 bot

1. 打开 <https://discord.com/developers/applications>，创建 Application。
2. 在 **Bot** 页面创建 bot，复制 token 并妥善保存。
3. 在 **Privileged Gateway Intents** 开启：
   - Server Members Intent
   - Presence Intent
4. 在 **OAuth2 → URL Generator** 勾选 `bot` 与 `applications.commands`。
5. bot 权限至少包含：Manage Roles、Manage Channels、View Channels、Send Messages、Attach Files、Read Message History、Use Application Commands。
6. 使用生成的链接把 bot 邀请进服务器。
7. 在服务器角色列表中，将 bot 的角色移动到 `Valax Supporter` 角色上方，否则 bot 无法自动加/删角色。

## 3. 初始化 Discord 频道和角色

先设置：

```text
DISCORD_BOT_TOKEN=<bot token>
DISCORD_GUILD_ID=<服务器 ID>
```

然后运行：

```bash
npm run discord:setup
```

脚本会创建或更新：

- `Valax Supporter` 角色；
- `deobfuscate` 文字频道；
- 对 `@everyone` 隐藏频道，只允许 supporter 角色进入；
- Discord 原生 20 分钟 slowmode。

把脚本输出的 `SUPPORT_ROLE_ID` 和 `DEOBFUSCATE_CHANNEL_ID` 保存到 bot 的环境变量。

## 4. Bot 环境变量

```text
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DEOBFUSCATE_CHANNEL_ID=
SUPPORT_ROLE_ID=
SUPPORT_STATUS_TEXT=support valaxscrub.shop
VALAX_API_URL=https://<vercel-project>.vercel.app
INTERNAL_BOT_SERVICE_SECRET=<与 Vercel 完全相同>
COOLDOWN_SECONDS=1200
MAX_SOURCE_BYTES=2000000
LOCAL_RECOVERY_ENABLED=true
WORKER_TIMEOUT_SECONDS=300
WORKER_MEMORY_MB=3072
```

## 5. 注册命令并启动

```bash
npm run discord:register
npm run discord:start
```

`/1` 接受且只接受一种输入：

- `link`：可公开访问的 HTTPS 直链；
- `file`：Discord 附件；
- `paste`：直接粘贴，最多 6000 字符。

普通成员的自定义状态包含 `support valaxscrub.shop` 后，bot 会自动添加 `Valax Supporter` 角色；状态被删除或用户离线时角色会自动移除。管理员可跳过状态限制与 20 分钟冷却。

## 6. 常驻托管建议

仓库已经包含 `railway.json` 与 `infra/docker/Dockerfile.bot`。在 Railway 中从 GitHub 仓库新建项目后，它会自动构建包含 C++ 原生引擎的 Bot 镜像。

如果平台要求手动填写启动命令，使用：

```text
npm run discord:start
```

将第 4 节的全部变量设置到托管平台。托管主机至少应提供 4 GB 内存；若内存不足，可降低 `WORKER_MEMORY_MB`，或把 `LOCAL_RECOVERY_ENABLED` 设为 `false` 使用 Vercel 回退接口。

只运行一个 bot 实例；当前 20 分钟命令冷却保存在常驻进程内存中，多实例部署需要改用 Redis 等共享存储。
