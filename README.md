# docs.chet.admin

Chet.Admin 官方文档站点，基于 [VitePress](https://vitepress.dev) 构建。

## 内容结构

| 目录 | 说明 |
| --- | --- |
| `guide/` | 指南：项目简介、系统架构、快速开始、开发指南、部署等 |
| `modules/` | 功能模块文档：认证、用户、角色、菜单、部门、权限、字典等 |
| `api/` | API 文档：统一响应格式、认证机制、接口清单 |
| `backend/` | 后端架构文档：架构概览、配置管理、数据库设计、安全设计、缓存策略等 |
| `articles/` | 系列文章：从快速上手到部署上线的完整教程 |
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
