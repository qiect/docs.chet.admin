# 目录结构

## 1. 主应用目录

业务开发全部集中在 `apps/web-antd/src`。基于真实源码的完整树形结构如下：

```tree
apps/web-antd/
├── public/                       # 静态资源（favicon、logo）
├── src/
│   ├── adapter/                  # 适配器层
│   │   ├── component/
│   │   │   └── index.ts          # 通用组件适配映射
│   │   ├── form.ts               # VbenForm 适配 Ant Design Vue
│   │   └── vxe-table.ts          # VxeTable 适配 + CellTag/CellImage 渲染器
│   ├── api/                      # API 请求层
│   │   ├── core/                 # 核心接口
│   │   │   ├── auth.ts           # 登录/登出/验证码/刷新Token/个人中心
│   │   │   ├── index.ts
│   │   │   ├── menu.ts           # 菜单树获取（my-tree / tree）
│   │   │   └── user.ts           # 用户信息（/auth/user-info）
│   │   ├── system/               # 业务模块接口（9 个）
│   │   │   ├── audit-log.ts
│   │   │   ├── dashboard.ts
│   │   │   ├── department.ts
│   │   │   ├── dictionary.ts
│   │   │   ├── file.ts
│   │   │   ├── menu.ts
│   │   │   ├── notification.ts
│   │   │   ├── online-user.ts
│   │   │   ├── role.ts
│   │   │   └── user.ts
│   │   ├── index.ts              # 统一导出
│   │   └── request.ts            # Axios 实例 + 拦截器
│   ├── composables/
│   │   └── useDict.ts            # 字典数据联动（带缓存）
│   ├── layouts/
│   │   ├── components/
│   │   │   └── notification-bell.vue
│   │   ├── auth.vue              # 登录页布局
│   │   ├── basic.vue             # 主布局
│   │   └── index.ts
│   ├── locales/
│   │   ├── langs/
│   │   │   ├── en-US/{demos,page}.json
│   │   │   └── zh-CN/{demos,page}.json
│   │   └── index.ts              # i18n 初始化
│   ├── router/
│   │   ├── routes/
│   │   │   ├── modules/
│   │   │   │   └── dashboard.ts  # 仪表盘路由模块
│   │   │   ├── core.ts           # 核心路由（根/登录/404）
│   │   │   └── index.ts          # 动态路由聚合
│   │   ├── access.ts             # 访问权限生成
│   │   ├── guard.ts              # 路由守卫
│   │   └── index.ts              # router 实例创建
│   ├── store/
│   │   ├── auth.ts               # 认证状态
│   │   └── index.ts
│   ├── views/
│   │   ├── _core/
│   │   │   ├── authentication/login.vue
│   │   │   ├── fallback/{coming-soon,forbidden,internal-error,not-found,offline}.vue
│   │   │   └── profile/{base-setting,index,password-setting,security-setting}.vue
│   │   ├── dashboard/
│   │   │   ├── analytics/index.vue
│   │   │   ├── workspace/index.vue
│   │   │   └── index.vue
│   │   └── system/               # 9 个业务模块
│   │       ├── audit-log/index.vue
│   │       ├── department/index.vue
│   │       ├── dictionary/index.vue
│   │       ├── file/index.vue
│   │       ├── menu/index.vue
│   │       ├── notification/index.vue
│   │       ├── online-user/index.vue
│   │       ├── role/index.vue
│   │       └── user/index.vue
│   ├── app.vue
│   ├── bootstrap.ts              # 应用引导
│   ├── main.ts                   # 入口
│   └── preferences.ts            # 偏好覆盖（accessMode: backend）
├── .env                          # 应用标题、命名空间、加密密钥
├── .env.development              # 端口、API URL、Mock 开关
├── .env.production               # 压缩、PWA、路由模式
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts                # Vite 代理配置
```

## 2. API 请求层（src/api/）

请求层负责所有 HTTP 调用，分为三部分：

### 2.1 core/ —— 核心接口

- **`auth.ts`**：认证相关。`loginApi`、`refreshTokenApi`、`logoutApi`、`getCaptchaApi`、`getAccessCodesApi`、`getProfileApi`、`updateProfileApi`、`changePasswordApi`
- **`user.ts`**：用户信息。`getUserInfoApi` 调用 `/auth/user-info`，将后端 `BackendUserInfo` 转换为前端 `UserInfo`，同时返回 `permissions` 数组
- **`menu.ts`**：菜单获取。`getMyMenusApi`（当前用户菜单，`/menus/my-tree`）、`getAllMenusApi`（全部菜单，`/menus/tree`），内部 `transformMenuData` 把后端菜单树转为 Vben `RouteRecordStringComponent` 格式
- **`index.ts`**：统一 `export * from './auth' / './menu' / './user'`

### 2.2 system/ —— 业务接口

9 个业务模块，每个文件导出该模块的 CRUD 与业务接口：

| 文件 | 主要接口 |
| ---- | ---- |
| `audit-log.ts` | 审计日志查询 |
| `dashboard.ts` | 仪表盘统计数据 |
| `department.ts` | 部门树 CRUD |
| `dictionary.ts` | 字典 CRUD、按 code 查询 |
| `file.ts` | 文件上传 |
| `menu.ts` | 菜单树 CRUD、角色菜单分配 |
| `notification.ts` | 通知发送与查询 |
| `online-user.ts` | 在线用户查询、强制下线 |
| `role.ts` | 角色 CRUD、菜单分配、数据权限 |
| `user.ts` | 用户 CRUD、重置密码、分配角色 |

### 2.3 request.ts —— Axios 实例

- 创建 `requestClient`（带拦截器，`responseReturn: 'data'`）与 `baseRequestClient`（无拦截器，用于 refresh-token / logout）
- 请求拦截器注入 `Authorization` 与 `Accept-Language`
- 响应拦截器三层：`defaultResponseInterceptor`（解析 success/data）→ `authenticateResponseInterceptor`（Token 刷新）→ `errorMessageResponseInterceptor`（统一错误提示）

详细见 [API 请求层](/frontend/05-api-layer)。

## 3. 适配器层（src/adapter/）

把 Vben 通用组件与 Ant Design Vue 对接，供所有视图复用：

- **`form.ts`**：调用 `setupVbenForm` 注册 Ant Design Vue 表单组件，配置 `v-model:value` 默认绑定、`Checkbox/Radio/Switch/Upload` 的特殊绑定，并定义 `required` / `selectRequired` 国际化校验规则。导出 `useVbenForm`、`VbenFormSchema`、`z`（zod）
- **`vxe-table.ts`**：调用 `setupVbenVxeTable` 配置 VxeTable 默认项（分页响应字段 `items`/`total`、small 尺寸、圆角等），注册 `CellImage` / `CellLink` / `CellTag` 单元格渲染器，并导出带权限判断的 `VbenTableAction` 组件
- **`component/index.ts`**：定义 `ComponentType` 与 `ComponentPropsMap`，把 Ant Design Vue 的 `Input`、`Select`、`Switch`、`Checkbox`、`Radio`、`Upload` 等组件映射到 VbenForm 的 `component` 字段

## 4. 视图层（src/views/）

按业务域分三个子目录：

### 4.1 _core/ —— 框架内置页面

- **`authentication/login.vue`**：登录页
- **`fallback/`**：5 个兜底页（`coming-soon`、`forbidden` 403、`internal-error` 500、`not-found` 404、`offline`）
- **`profile/`**：个人中心（`index.vue` 入口 + `base-setting`、`password-setting`、`security-setting`）

### 4.2 dashboard/ —— 仪表盘

- **`analytics/index.vue`**：分析页（ECharts 图表）
- **`workspace/index.vue`**：工作台

### 4.3 system/ —— 系统管理

9 个业务模块，每个模块一个目录，入口均为 `index.vue`：`audit-log`、`department`、`dictionary`、`file`、`menu`、`notification`、`online-user`、`role`、`user`。

## 5. 路由层（src/router/）

```tree
router/
├── routes/
│   ├── modules/          # 路由模块（每个文件导出 RouteRecordRaw[]）
│   │   └── dashboard.ts
│   ├── core.ts           # 核心路由：Root（BasicLayout）+ Authentication + 404
│   └── index.ts          # 用 import.meta.glob 聚合 modules/，导出 accessRoutes / coreRouteNames
├── access.ts             # generateAccess：调用 getMyMenusApi 生成菜单与路由
├── guard.ts              # 路由守卫：登录态校验 + 动态路由生成
└── index.ts              # createRouter 实例 + 注册守卫
```

- **`routes/modules/`**：每个文件 `export default routes`，`meta` 含 `icon` / `title` / `order`，由 `import.meta.glob('./modules/**/*.ts', { eager: true })` 自动聚合
- **`access.ts`**：核心是 `generateAccess`，通过 `import.meta.glob('../views/**/*.vue')` 收集所有页面组件，按 `preferences.app.accessMode`（本项目为 `backend`）调用 `generateAccessible`
- **`guard.ts`**：`setupAccessGuard` 处理登录态、白名单、动态路由生成；`setupCommonGuard` 处理进度条
- **`core.ts`**：定义 `coreRoutes`（根路由 + 登录路由）与 `fallbackNotFoundRoute`（404 兜底）

详细见 [路由与权限](/frontend/03-routing)。

## 6. 命名约定

为保证一致性，遵循以下约定：

- **页面文件**：统一用 `index.vue`，目录名即模块名（如 `views/system/role/index.vue`）
- **API 文件**：按业务模块拆分到 `api/system/<module>.ts`，函数名用 `<动作><资源>Api` 形式（如 `createRoleApi`、`getRoleListApi`）
- **路由模块**：`router/routes/modules/<module>.ts`，文件名与 `views/` 下目录对应，`export default routes`
- **接口路径**：RESTful 风格，资源用复数（`/roles`、`/users`、`/menus`），分页用 `/paged` 后缀
- **权限码**：`模块:资源:操作` 格式（如 `system:role:create`），与后端菜单 `permission` 字段一致
- **状态 store**：应用级 store 放 `src/store/`，框架级 store（accessStore / userStore）由 `@vben/stores` 提供
