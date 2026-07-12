# 状态管理

## 1. 概述

Chet.Admin 前端使用 **Pinia** 作为状态管理方案，状态分为两层：

| 层级 | 位置 | 职责 |
| ---- | ---- | ---- |
| 应用级 store | `src/store/auth.ts` | 业务认证流程（登录、登出、获取用户信息） |
| 框架级 store | `@vben/stores`（基于 `@core/base/shared`） | `accessStore`（权限/Token）、`userStore`（用户信息）、`tabStore`（标签页） |
| 偏好设置 | `@vben/preferences` | 主题、布局、颜色等可视化偏好 |

应用级 store 编排框架级 store：`useAuthStore` 内部调用 `useAccessStore` 与 `useUserStore` 完成登录态写入。

## 2. 认证状态（store/auth.ts）

`useAuthStore` 是业务认证的核心，使用 Composition API 风格的 `defineStore`：

```ts
export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();
  const loginLoading = ref(false);

  // 登录
  async function authLogin(params: Recordable<any>, onSuccess?: () => Promise<void> | void) {
    let userInfo: null | UserInfo = null;
    try {
      loginLoading.value = true;
      const { accessToken, refreshToken } = await loginApi(params);
      if (accessToken) {
        accessStore.setAccessToken(accessToken);
        accessStore.setRefreshToken(refreshToken);
        userInfo = await fetchUserInfo();
        // 跳转首页
        await router.push(userInfo.homePath || preferences.app.defaultHomePath);
        notification.success({ /* 登录成功提示 */ });
      }
    } finally {
      loginLoading.value = false;
    }
    return { userInfo };
  }

  // 获取用户信息（含权限码）
  async function fetchUserInfo(): Promise<UserInfo> {
    const { userInfo, permissions } = await getUserInfoApi();
    userStore.setUserInfo(userInfo);
    accessStore.setAccessCodes(permissions);   // 权限码写入 accessStore
    return userInfo;
  }

  // 登出
  async function logout(redirect: boolean = true) {
    try { await logoutApi(); } catch { /* 忽略 */ }
    resetAllStores();
    accessStore.setLoginExpired(false);
    await router.replace({
      path: LOGIN_PATH,
      query: redirect ? { redirect: encodeURIComponent(router.currentRoute.value.fullPath) } : {},
    });
  }

  return { $reset, authLogin, fetchUserInfo, loginLoading, logout };
});
```

### 2.1 关键设计

- **Token 存储**：`accessToken` / `refreshToken` 写入 `accessStore`，由框架统一管理，请求拦截器自动读取
- **权限码注入**：`fetchUserInfo` 调用 `/auth/user-info`，后端返回 `{ userInfo, permissions }`，`permissions` 数组写入 `accessStore.setAccessCodes`
- **登出清理**：调用 `resetAllStores()` 重置所有 Pinia store，避免切换账号残留状态
- **登录方式**：支持 `onSuccess` 回调，登录页可在回调中做额外处理（如选择租户）

## 3. 访问权限状态（accessStore）

`accessStore` 由 `@vben/stores` 提供，是路由生成与按钮权限的数据源：

| 字段 | 类型 | 作用 |
| ---- | ---- | ---- |
| `accessToken` | `string \| null` | 访问令牌，注入请求头 `Authorization` |
| `refreshToken` | `string \| null` | 刷新令牌，401 时调用 `refreshTokenApi` |
| `accessCodes` | `string[]` | 权限码数组，如 `['system:role:create', ...]` |
| `accessMenus` | `MenuRecord[]` | 当前用户可见菜单树 |
| `accessRoutes` | `RouteRecordRaw[]` | 当前用户可访问路由 |
| `isAccessChecked` | `boolean` | 是否已生成动态路由（避免重复生成） |
| `loginExpired` | `boolean` | 登录是否过期（用于弹窗提示） |

### 3.1 主要方法

- `setAccessToken(token)` / `setRefreshToken(token)`
- `setAccessCodes(codes)`：写入权限码
- `setAccessMenus(menus)` / `setAccessRoutes(routes)`：写入菜单与路由
- `setIsAccessChecked(val)`：标记动态路由已生成
- `setLoginExpired(val)`：标记登录过期

### 3.2 驱动关系

```text
accessStore.accessCodes ──→ hasAccessByCodes（按钮权限）
accessStore.accessRoutes ──→ router 动态添加
accessStore.accessMenus  ──→ 侧边栏菜单渲染
accessStore.accessToken  ──→ 请求拦截器 / 路由守卫
```

## 4. 偏好设置（preferences）

`@vben/preferences` 的 `PreferenceManager` 管理可视化偏好，基于 `reactive` + `StorageManager`：

```ts
class PreferenceManager {
  private cache: StorageManager;
  private state: Preferences;        // reactive 状态
  private debouncedSave: () => void; // 防抖保存

  getPreferences = () => readonly(this.state);
  updatePreferences = (updates: DeepPartial<Preferences>) => {
    const mergedState = merge({}, updates, markRaw(this.state));
    Object.assign(this.state, mergedState);
    this.handleUpdates(updates);     // 更新 CSS 变量
    this.debouncedSave();            // 防抖写缓存
  };
}
```

### 4.1 偏好分类

| 分类 | 字段示例 | 说明 |
| ---- | ---- | ---- |
| `app` | `name`、`accessMode`、`defaultHomePath`、`enableRefreshToken`、`locale`、`isMobile` | 应用级配置 |
| `theme` | `mode`（light/dark/auto）、`fontSize` | 主题模式 |
| `layout` | `mode`、`collapsed` | 布局与折叠 |
| `color` | `primary`、`success`、`warning`、`danger` | 主题色 |

### 4.2 项目覆盖

`src/preferences.ts` 通过 `defineOverridesPreferences` 覆盖默认值：

```ts
export const overridesPreferences = defineOverridesPreferences({
  app: {
    name: import.meta.env.VITE_APP_TITLE,
    accessMode: 'backend',
    enableRefreshToken: true,
    defaultHomePath: '/dashboard',
  },
  copyright: { companyName: 'Chet Admin', date: '2024-2026' },
});
```

`definePreferencesExtension` 还可扩展自定义偏好字段（如 `tenantMode`、`defaultTableSize`），在偏好设置面板中渲染。

## 5. Tab 标签页状态

多标签页由 `@vben/stores` 的 `tabStore`（结合 `@core/ui-kit/tabs-ui`）管理：

- 维护已打开标签页列表
- 支持固定（`affixTab`）、缓存（`keepAlive`）、拖拽排序
- 关闭标签页时按规则跳转（左/右/其他/全部）
- 标签页数据持久化到 `localStorage`，刷新后恢复

路由 `meta` 中可声明：

```ts
meta: {
  affixTab: true,     // 固定标签
  keepAlive: true,    // 缓存组件
  hideInTab: true,    // 不在标签页显示
}
```

## 6. 状态持久化

| 状态 | 存储方式 | 说明 |
| ---- | ---- | ---- |
| `preferences` | `localStorage`（命名空间前缀） | `StorageManager` 防抖保存，键名 `preferences` / `preferences-locale` / `preferences-theme` |
| `accessStore` | `localStorage`（加密） | Token、权限码持久化，密钥来自 `VITE_APP_STORE_SECURE_KEY` |
| `tabStore` | `localStorage` | 标签页列表 |
| `useDict` 缓存 | `Map`（内存） | 字典数据仅内存缓存，刷新后重新拉取 |

### 6.1 命名空间隔离

`StorageManager` 支持命名空间前缀，避免多应用共享域名时冲突：

```ts
this.cache = new StorageManager({ prefix: namespace });
// namespace 来自 VITE_APP_NAMESPACE（本项目为 chet-admin）
```

### 6.2 加密

`accessStore` 持久化时使用 `VITE_APP_STORE_SECURE_KEY` 加密，生产环境务必替换默认密钥：

```bash
# .env
VITE_APP_STORE_SECURE_KEY=please-replace-me-with-your-own-key
```

## 7. 使用示例

在组件中调用 `useAuthStore`：

```vue
<script lang="ts" setup>
import { useAuthStore } from '#/store';

const authStore = useAuthStore();

// 登录
async function handleLogin(values) {
  await authStore.authLogin(values);
}

// 登出
async function handleLogout() {
  await authStore.logout();
}
</script>

<template>
  <a-button :loading="authStore.loginLoading" @click="handleLogin">登录</a-button>
  <a-button @click="handleLogout">登出</a-button>
</template>
```

读取偏好与权限码：

```ts
import { preferences, usePreferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';
import { useAccess } from '@vben/access';

// 偏好
const { isDark, locale } = usePreferences();
console.log(preferences.app.defaultHomePath);

// 权限
const accessStore = useAccessStore();
console.log(accessStore.accessCodes);
const { hasAccessByCodes } = useAccess();
const canEdit = hasAccessByCodes(['system:user:update']);
```
