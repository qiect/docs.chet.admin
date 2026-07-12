# docs.chet.admin

Chet.Admin 官方文档站点，基于 [VitePress](https://vitepress.dev) 构建。

## 内容结构

| 目录 | 说明 |
| --- | --- |
| `guide/` | 指南：项目简介、系统架构、快速开始、项目重命名、前后端开发指南、部署 |
| `modules/` | 功能模块文档：认证、用户、角色、菜单、部门、权限、字典、操作日志等 |
| `backend/` | 后端架构：架构/配置/数据库/安全/缓存/日志/测试/开发指南 + API 文档（响应格式、认证机制、接口清单） |
| `frontend/` | 前端架构：架构概览、目录结构、路由与权限、状态管理、API 请求层、开发指南 |
| `articles/` | 系列教程：20 篇全栈实战教程，从快速上手到部署上线 |
| `public/` | 静态资源：Logo、截图等 |

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 本地预览构建产物
npm run preview
```

## 部署

站点部署在 GitHub Pages，地址：`https://qiect.github.io/docs.chet.admin/`

VitePress 的 `base` 已配置为 `/docs.chet.admin/`，如需更改部署地址请修改 `.vitepress/config.mts`。

## 相关仓库

- [Chet.Admin](https://github.com/qiect/Chet.Admin) — 主仓库（后端 + 前端）
