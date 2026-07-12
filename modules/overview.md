# 模块总览

## 1. 概述

本文档详述 Chet.Admin 各业务模块的功能特性、后端接口与前端页面。

## 2. 模块清单

| 模块 | 路由 | 后端控制器 | 前端页面 |
| ---- | ---- | ---- | ---- |
| 认证登录 | `/auth/login` | AuthController | `_core/authentication` |
| 用户管理 | `/system/user` | UsersController | `system/user` |
| 角色管理 | `/system/role` | RolesController | `system/role` |
| 菜单管理 | `/system/menu` | MenusController | `system/menu` |
| 部门管理 | `/system/department` | DepartmentsController | `system/department` |
| 字典管理 | `/system/dictionary` | DictionariesController | `system/dictionary` |
| 仪表盘 | `/dashboard` | DashboardController | `dashboard` |
| 操作日志 | `/system/audit-log` | AuditLogsController | `system/audit-log` |
| 通知公告 | `/system/notification` | NotificationsController | `system/notification` |
| 文件上传 | `/system/file` | FilesController | `system/file` |
| 在线用户 | `/system/online-user` | OnlineUsersController | `system/online-user` |
| 个人中心 | `/profile` | AuthController | `_core/profile` |

## 3. 各模块说明

| 模块 | 核心能力 |
| ---- | ---- |
| **认证登录** | 注册、登录、刷新令牌、注销、验证码、登录失败锁定、密码过期策略 |
| **用户管理** | 用户 CRUD、密码强度校验、修改密码、分配角色、数据权限过滤 |
| **角色管理** | 角色 CRUD、菜单分配（含按钮权限）、数据权限范围（5 种） |
| **菜单管理** | 菜单 CRUD、树形展示、动态路由生成 |
| **部门管理** | 部门 CRUD、树形结构 |
| **字典管理** | 字典 CRUD、`useDict` 组合式函数联动业务表单 |
| **仪表盘** | 统计卡片、SVG 趋势图、最近操作记录 |
| **个人中心** | 资料修改、密码修改、头像上传 |
| **操作日志** | 中间件自动记录写操作、分页查询、清理 |
| **通知公告** | 全局公告、个人通知、未读计数、标记已读 |
| **文件上传** | 本地存储、上传 / 下载 / 删除、10MB 限制 |
| **在线用户** | 登录追踪、强制下线 |

详细模块说明请参考左侧导航各模块页面。
