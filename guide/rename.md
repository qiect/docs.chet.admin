# 项目重命名

## 1. 为什么需要重命名

fork 开源项目做二次开发时，通常要改造成自己的产品。Chet.Admin 代码中存在大量命名标识需要替换：

| 场景 | 旧名 | 新名示例 |
| ---- | ---- | ---- |
| 公司内部系统 | `Chet.Admin` | `CompanyX.Admin` |
| 商业产品 | `Chet.Admin` | `AcmeAdmin` |
| 个人项目 | `Chet.Admin` | `MyBlog.Admin` |

需要替换的位置涉及：C# namespace、csproj 文件名、解决方案文件（`.slnx`）、文件夹、Docker 镜像名、Redis 前缀、数据库文件名、GitHub 仓库路径、前端 namespace、展示名等。

手动改极易漏改，且 `ChetAdmin` 是 `Chet.Admin` 的子串，简单全文替换会破坏命名。Chet.Admin 内置了零依赖重命名工具 `chet-rename`，可一键完成所有改名工作。

## 2. 工具位置与依赖

工具位于项目根目录 `tools/chet-rename/`：

```
tools/chet-rename/
├── bin.mjs              # 入口脚本
├── package.json
└── src/
    ├── names.js         # 命名风格派生
    ├── fs.js            # 文件系统操作
    ├── validate.js      # 编译校验
    └── log.js           # 彩色日志
```

- **零依赖**：纯 Node.js 内置模块，无需 `npm install`
- **Node 18+**：用到 `fs/promises`、`readline` 等内置能力

## 3. 命名风格派生

用户只需输入一个 **PascalCase** 名字，工具自动派生所有命名风格：

| 字段 | 示例值（输入 `MyApp.Admin`、`mycompany/MyApp.Admin`） |
| ---- | ---- |
| `pascal` | `MyApp.Admin` |
| `display` | `MyApp Admin` |
| `kebab` | `myapp-admin` |
| `pascalNoDot` | `MyAppAdmin` |
| `githubUser` | `mycompany` |
| `github` | `mycompany/MyApp.Admin` |

工具按 token 长度**降序**替换（长 token 先替换，避免短 token 误伤长 token），并按「先改文件内容、再改文件名、最后改文件夹（叶子优先）」的顺序执行，保证引用不会断裂。

## 4. 使用方法

### 4.1 第一步：fork 并 clone 仓库

```bash
# 在 GitHub 上 fork Chet.Admin 到自己账号，然后 clone 下来
git clone https://github.com/yourname/Chet.Admin.git
cd Chet.Admin
```

> ⚠️ **不要在原始 `Chet.Admin` 仓库上执行**，脚本会把项目自身改名。正确用法是在复制出的新仓库中运行。

### 4.2 第二步：预览（dry-run）

强烈建议先跑一次 `--dry-run`，不会写入任何文件，只打印映射预览与改动清单：

```bash
node tools/chet-rename/bin.mjs --dry-run --name MyApp.Admin --github mycompany/MyApp.Admin
```

输出示例：

```
╭── Chet.Admin Project Renamer  v1.0 ───────────────────╮

  ─── 映射预览 ───────────────────────────────────
  qiect/Chet.Admin       → mycompany/MyApp.Admin   GitHub 仓库路径
  Chet.Admin.db          → MyApp.Admin.db          数据库文件名
  chet-admin-api         → myapp-admin-api         docker 镜像名
  Chet.Admin             → MyApp.Admin             namespace / csproj / 路径
  Chet Admin             → MyApp Admin             展示名
  ChetAdmin:             → MyAppAdmin:             Redis InstanceName
  chet-admin             → myapp-admin             前端 namespace
  ChetAdmin              → MyAppAdmin              Redis 前缀（无冒号）
  qiect                  → mycompany               GitHub 用户名
  ────────────────────────────────────────────────

▸ 扫描项目目录: /path/to/project
ℹ 找到 312 个待检查文件
▸ 替换文件内容...
✓ [DRY RUN] 287 个文件改动，1542 处匹配
```

确认无误后再执行下一步。

### 4.3 第三步：交互式执行（推荐）

```bash
node tools/chet-rename/bin.mjs
```

按提示输入：

```
? 新项目名称 (PascalCase，可含点，如 MyApp.Admin): MyApp.Admin
? GitHub 仓库地址 (如 user/MyApp.Admin) (默认: mycompany/MyApp.Admin): mycompany/MyApp.Admin

  项目名 (PascalCase)    : MyApp.Admin
  展示名                 : MyApp Admin
  前端 namespace         : myapp-admin
  Redis 前缀             : MyAppAdmin:
  GitHub 仓库            : mycompany/MyApp.Admin

? 确认以上信息？(y/N): y
```

回车确认后，工具会自动完成：

1. ✅ 替换所有文件内容（namespace、配置、文档等）
2. ✅ 重命名文件（`.csproj`、`.slnx`、`.db`）
3. ✅ 重命名文件夹（从最深层向根目录逐层改）
4. ✅ 自动运行 `dotnet build` 校验

### 4.4 非交互式（CI 友好）

```bash
node tools/chet-rename/bin.mjs --name MyApp.Admin --github mycompany/MyApp.Admin
```

一行命令搞定，适合在 CI/CD 中自动初始化项目。

## 5. 验证清单

跑完工具后，按这份清单检查。

### 5.1 后端编译

```bash
dotnet build MyApp.Admin.Api/MyApp.Admin.slnx
```

应看到 `已成功生成` + `0 个错误`。

### 5.2 后端启动

```bash
cd MyApp.Admin.Api/MyApp.Admin.Api
dotnet run
```

访问 `http://localhost:5000/swagger`，确认：

- ✅ Swagger 标题显示为新项目名
- ✅ JWT Issuer/Audience 已替换
- ✅ 数据库文件名为 `MyApp.Admin.db`

### 5.3 前端启动

```bash
cd MyApp.Admin.Web
pnpm install
pnpm dev:antd
```

访问 `http://localhost:5666/`，确认：

- ✅ 浏览器标签标题为新项目展示名
- ✅ 登录页 Logo 旁文字为新项目展示名
- ✅ 登录后 Dashboard 欢迎语包含新项目展示名

默认账号：`admin@example.com` / `Admin@123`。

### 5.4 Docker 镜像

```bash
docker compose -f MyApp.Admin.Api/docker-compose.yml config
```

确认容器名、镜像名已替换为 `myapp-admin-api`、`myapp-admin-redis`。

## 6. Git 远程仓库迁移

fork 的仓库要改成自己的远程仓库。

### 6.1 修改远程地址

```bash
# 查看当前远程
git remote -v

# 改成自己的远程
git remote set-url origin https://github.com/mycompany/MyApp.Admin.git

# 确认
git remote -v
```

### 6.2 推送

```bash
git add -A
git commit -m "Rename to MyApp.Admin"
git push -u origin main
```

### 6.3 同时配置 GitHub 和 Gitee

```bash
# 添加 Gitee 远程
git remote add gitee https://gitee.com/mycompany/MyApp.Admin.git

# 推送到两边
git push origin main
git push gitee main
```

### 6.4 保留 upstream（可选）

如果想以后还能拉取 Chet.Admin 的更新：

```bash
# 把原仓库设为 upstream
git remote add upstream https://github.com/qiect/Chet.Admin.git

# 以后合并上游更新
git fetch upstream
git merge upstream/main
```

> ⚠️ 合并上游更新时可能有冲突（因为命名空间全变了），需要手动解决。

## 7. 常见问题

### Q1: 执行后 `dotnet build` 报错找不到 csproj？

通常是文件夹重命名顺序异常。运行回滚：

```bash
git checkout .
git clean -fd
```

然后重试。如仍失败，请到 GitHub 提 issue 并附上 `--dry-run` 输出。

### Q2: 前端启动后白屏或样式异常？

检查 `apps/web-antd/.env` 中的 `VITE_APP_NAMESPACE` 是否已替换为新值（如 `myapp-admin`）。**清空浏览器 localStorage** 后重试（Vben 会缓存旧 namespace）。

### Q3: Swagger 标题还是旧的？

后端编译缓存。删掉 `bin/` 和 `obj/` 目录后重新 `dotnet build`。

### Q4: 登录失败返回 401？

JWT Issuer/Audience 已替换为新项目名，前端只携带 token 无需改动。如仍 401，**确认后端已重启**并清空浏览器 localStorage。

### Q5: 想换一个名字重新来过？

```bash
git checkout .
git clean -fd
```

这会丢弃所有改动并删除未跟踪的文件，恢复到上次 commit 的状态。然后重新运行脚本。

### Q6: 改完名字后 Redis 缓存怎么处理？

Redis 里旧 namespace 的 key 不会自动清理，建议：

```bash
# 删除旧 namespace 的所有 key
redis-cli --scan --pattern 'ChetAdmin:*' | xargs redis-cli del
```

新 key 会用新 namespace（如 `MyAppAdmin:*`）。

## 8. 延伸阅读

- [项目重命名指南（系列文章）](/articles/19-rename) — 完整原理剖析、token 替换顺序、文件夹改名策略
