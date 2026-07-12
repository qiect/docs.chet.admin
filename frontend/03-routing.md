# 路由与权限

## 1. 路由体系概述

Chet.Admin 前端基于 **Vue Router** 实现路由，采用 **动态路由 + 后端菜单驱动** 模式。菜单由后端 `/menus/my-tree` 接口按当前用户角色返回，前端根据返回数据与本地页面组件动态生成可访问路由。

项目在 `src/preferences.ts` 中显式声明使用后端权限模式：

```ts
export const overridesPreferences = defineOverridesPreferences({
  app: {
    accessMode: 'backend',       // 菜单从后端 API 获取
    enableRefreshToken: true,
    defaultHomePath: '/dashboard',
  },
});
```

整体流程：

```text
登录成功 → fetchUserInfo（含 permissions）
       → generateAccess（getMyMenusApi 获取菜单树）
       → generateAccessible（backend 模式生成路由 + 菜单）
       → accessStore.setAccessRoutes / setAccessMenus
       → router 动态添加路由
```

## 2. 路由模块组织

### 2.1 路由文件分层

```tree
src/router/
├── routes/
│   ├── modules/          # 动态路由模块（每个文件 export default RouteRecordRaw[]）
│   │   └── dashboard.ts
│   ├── core.ts           # 核心路由（必须存在，不参与权限校验）
│   └── index.ts          # 聚合动态路由 + 核心路由
├── access.ts             # 生成菜单与路由的入口
├── guard.ts              # 路由守卫
└── index.ts              # createRouter 实例
```

### 2.2 动态路由聚合

`routes/index.ts` 用 `import.meta.glob` 自动收集 `modules/` 下所有 `.ts` 文件：

```ts
const dynamicRouteFiles = import.meta.glob('./modules/**/*.ts', {
  eager: true,
});
const dynamicRoutes: RouteRecordRaw[] = mergeRouteModules(dynamicRouteFiles);

/** 有权限校验的路由列表 */
const accessRoutes = [...dynamicRoutes, ...staticRoutes];
```

### 2.3 路由 meta 字段

每个路由通过 `meta` 声明菜单展示信息：

| 字段 | 作用 |
| ---- | ---- |
| `title` | 菜单标题（经过 `$t` 国际化） |
| `icon` | 图标，使用 Iconify 格式（如 `lucide:layout-dashboard`） |
| `order` | 菜单排序，数值越小越靠前 |
| `hideInMenu` | 是否在菜单中隐藏 |
| `keepAlive` | 是否启用 keep-alive 缓存 |
| `affixTab` | 是否固定标签页 |
| `ignoreAccess` | 是否忽略权限校验（白名单） |
| `link` | 外链地址（`isExternal` 时设置） |

## 3. 路由守卫（guard.ts）

`guard.ts` 注册两类守卫：

### 3.1 通用守卫 setupCommonGuard

- `beforeEach`：记录已加载页面、开启进度条（受 `preferences.transition.progress` 控制）
- `afterEach`：记录已加载路径、关闭进度条

### 3.2 权限守卫 setupAccessGuard

核心逻辑分四步：

```ts
router.beforeEach(async (to, from) => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const authStore = useAuthStore();

  // ① 核心路由（登录页等）放行；已登录访问登录页则跳首页
  if (coreRouteNames.includes(to.name as string)) {
    if (to.path === LOGIN_PATH && accessStore.accessToken) {
      return decodeURIComponent(
        (to.query?.redirect as string) ||
          userStore.userInfo?.homePath ||
          preferences.app.defaultHomePath,
      );
    }
    if (!accessStore.accessToken || accessStore.isAccessChecked) {
      return true;
    }
  }

  // ② 无 accessToken：白名单（meta.ignoreAccess）放行，否则跳登录页并带 redirect
  if (!accessStore.accessToken) {
    if (to.meta.ignoreAccess) return true;
    if (to.fullPath !== LOGIN_PATH) {
      return {
        path: LOGIN_PATH,
        query: { redirect: encodeURIComponent(to.fullPath) },
        replace: true,
      };
    }
    return to;
  }

  // ③ 已生成过动态路由：直接放行
  if (accessStore.isAccessChecked) return true;

  // ④ 生成动态路由
  const userInfo = userStore.userInfo || (await authStore.fetchUserInfo());
  const userRoles = userInfo.roles ?? [];
  const { accessibleMenus, accessibleRoutes } = await generateAccess({
    roles: userRoles,
    router,
    routes: accessRoutes,
  });
  accessStore.setAccessMenus(accessibleMenus);
  accessStore.setAccessRoutes(accessibleRoutes);
  accessStore.setIsAccessChecked(true);
  return { ...router.resolve(decodeURIComponent(redirectPath)), replace: true };
});
```

> **关键修复**：已登录但动态路由尚未生成时（如 F5 刷新核心路由页面），不能直接返回，需要继续走动态路由生成流程，否则菜单栏会消失。

## 4. 访问权限（access.ts）

`access.ts` 的 `generateAccess` 是路由生成的核心入口：

```ts
async function generateAccess(options: GenerateMenuAndRoutesOptions) {
  // 收集所有页面组件
  const pageMap: ComponentRecordType = import.meta.glob('../views/**/*.vue');
  const layoutMap: ComponentRecordType = { BasicLayout, IFrameView };

  return await generateAccessible(preferences.app.accessMode, {
    ...options,
    fetchMenuListAsync: async () => {
      message.loading({ content: `${$t('common.loadingMenu')}...`, duration: 1.5 });
      return await getMyMenusApi();   // 调用后端 /menus/my-tree
    },
    forbiddenComponent,               // 无权限跳 forbidden.vue
    layoutMap,
    pageMap,
  });
}
```

`generateAccessible`（来自 `@vben/access`）支持三种模式：

- **`backend`**（本项目）：菜单与路由完全由后端返回，`generateRoutesByBackend` 把字符串 `component` 字段映射到 `pageMap` 中的真实组件
- **`frontend`**：前端定义完整路由，按 `roles` 过滤
- **`mixed`**：前后端路由按 `name` 合并，后端 meta 优先

## 5. 按钮级权限

按钮级权限通过 **指令** 与 **函数** 两种方式实现。

### 5.1 v-access 指令

`@vben/access` 的 `registerAccessDirective` 注册全局 `v-access` 指令。在 `mounted` 阶段判断，无权限则直接 `el.remove()`：

```vue
<a-button v-access:code="['system:role:create']">新增</a-button>
<a-button v-access:code="'system:role:delete'">删除</a-button>
```

指令内部根据 `accessMode` 选择判断方式：

```ts
const authMethod =
  accessMode.value === 'frontend' && binding.arg === 'role'
    ? hasAccessByRoles
    : hasAccessByCodes;
```

### 5.2 hasAccessByCodes 函数

在脚本中用 `useAccess()` 获取判断函数，常用于表格操作列按钮：

```ts
import { useAccess } from '@vben/access';
const { hasAccessByCodes } = useAccess();

const canCreate = hasAccessByCodes(['system:role:create']);
```

`hasAccessByCodes` 从 `accessStore.accessCodes` 取当前用户权限码集合，与传入 codes 取交集判断。

### 5.3 权限码格式

权限码采用 **`模块:资源:操作`** 三段式，与后端菜单表的 `permission` 字段一致：

| 权限码 | 含义 |
| ---- | ---- |
| `system:role:create` | 角色-创建 |
| `system:role:update` | 角色-更新 |
| `system:role:delete` | 角色-删除 |
| `system:user:list` | 用户-查询 |
| `system:menu:assign` | 菜单-分配 |

## 6. 数据权限

数据权限由 **后端按角色 `DataScope` 在 Service 层过滤**，前端无需处理：

| DataScope | 范围 | 后端实现 |
| ---- | ---- | ---- |
| `All` | 全部数据 | 不追加过滤 |
| `Dept` | 本部门 | 按 `user.DepartmentId` 过滤 |
| `DeptAndChild` | 本部门及下级 | 按部门树过滤 |
| `Self` | 仅本人 | 按 `user.Id` 过滤 |
| `Custom` | 自定义 | 按角色配置的部门集合过滤 |

前端在角色管理页（`views/system/role/index.vue`）通过 `updateDataScopeApi` 修改角色的 `DataScope` 与自定义部门集合，剩余过滤逻辑全部在后端 `Application` 层的 `DataPermissionInterceptor` 完成。

## 7. 路由配置示例

`router/routes/modules/dashboard.ts` 的真实代码：

```ts
import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:layout-dashboard',
      order: -1,
      title: $t('page.dashboard.title'),
    },
    name: 'Dashboard',
    path: '/dashboard',
    children: [
      {
        name: 'Analytics',
        path: 'analytics',
        component: () => import('#/views/dashboard/analytics/index.vue'),
        meta: {
          affixTab: true,
          icon: 'lucide:area-chart',
          title: $t('page.dashboard.analytics'),
        },
      },
      {
        name: 'Workspace',
        path: 'workspace',
        component: () => import('#/views/dashboard/workspace/index.vue'),
        meta: {
          icon: 'carbon:workspace',
          title: $t('page.dashboard.workspace'),
        },
      },
    ],
  },
];

export default routes;
```

> 在 `backend` 模式下，业务菜单通常由后端 `/menus/my-tree` 返回，前端 `modules/` 仅保留少量必须的静态路由（如 dashboard）。后端返回的 `component` 字符串会通过 `import.meta.glob('../views/**/*.vue')` 映射到真实组件。

## 8. 延伸阅读

- [权限模型 RBAC 三层防护](/articles/06-rbac)
- [安全基石 JWT 认证](/articles/05-jwt-auth)
- [后端安全设计](/backend/04-security)
