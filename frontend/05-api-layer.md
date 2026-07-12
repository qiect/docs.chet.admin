# API 请求层

## 1. 请求层架构

Chet.Admin 前端的 HTTP 请求层基于 **`@vben/request`**（对 Axios 的封装），位于 `apps/web-antd/src/api/`。核心特性：

- **统一拦截器**：请求拦截器注入 Token 与语言；响应拦截器三层处理（格式化 / 鉴权 / 错误提示）
- **统一错误处理**：401 / 403 / 404 / 429 / 500 等状态码统一 `message` 提示
- **Token 自动刷新**：响应拦截器检测 401 → 调用 `refreshTokenApi` 续期 → 重发原请求
- **双实例**：`requestClient`（带拦截器，业务用）与 `baseRequestClient`（无拦截器，用于 refresh-token / logout，避免循环）

请求层文件组织：

```tree
src/api/
├── core/            # 核心接口（auth/menu/user）
├── system/          # 业务模块接口（9 个）
├── index.ts         # 统一导出
└── request.ts       # Axios 实例 + 拦截器
```

## 2. request.ts 配置

`request.ts` 创建两个实例：

```ts
const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({ ...options, baseURL });
  // 注册拦截器（见下文）
  return client;
}

// 业务请求实例（自动返回 data 字段）
export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

// 基础请求实例（无拦截器，用于刷新Token、登出）
export const baseRequestClient = new RequestClient({ baseURL: apiURL });
```

`apiURL` 来自环境变量 `VITE_GLOB_API_URL`（开发环境为 `/api/v1`）。

### 2.1 请求拦截器

注入 `Authorization` 头与 `Accept-Language` 头：

```ts
client.addRequestInterceptor({
  fulfilled: async (config) => {
    const accessStore = useAccessStore();
    config.headers.Authorization = formatToken(accessStore.accessToken);
    config.headers['Accept-Language'] = preferences.app.locale;
    return config;
  },
});

function formatToken(token: null | string) {
  return token ? `Bearer ${token}` : null;
}
```

### 2.2 响应拦截器（格式化）

后端统一响应格式为 `{ success, data, message, statusCode }`，前端用 `defaultResponseInterceptor` 解析：

```ts
client.addResponseInterceptor(
  defaultResponseInterceptor({
    codeField: 'success',   // 用 success 字段判断是否成功
    dataField: 'data',      // 用 data 字段取业务数据
    successCode: true,      // success === true 视为成功
  }),
);
```

由于 `requestClient` 配置了 `responseReturn: 'data'`，业务代码直接拿到 `data` 字段：

```ts
const user = await requestClient.get<BackendUserInfo>('/auth/user-info');
// user 即后端返回的 data 字段
```

## 3. Token 自动刷新

`authenticateResponseInterceptor` 负责 Token 过期处理，三步走：

```ts
client.addResponseInterceptor(
  authenticateResponseInterceptor({
    client,
    doReAuthenticate,            // 重新认证（跳登录）
    doRefreshToken,              // 刷新 Token
    enableRefreshToken: preferences.app.enableRefreshToken,  // true
    formatToken,
  }),
);
```

### 3.1 刷新逻辑 doRefreshToken

```ts
async function doRefreshToken() {
  const accessStore = useAccessStore();
  const resp = await refreshTokenApi({
    accessToken: accessStore.accessToken ?? '',
    refreshToken: accessStore.refreshToken ?? '',
  });
  accessStore.setAccessToken(resp.accessToken);
  accessStore.setRefreshToken(resp.refreshToken);
  return resp.accessToken;   // 返回新 Token，拦截器自动重发原请求
}
```

`refreshTokenApi` 使用 `baseRequestClient`（无拦截器），避免 401 死循环：

```ts
export async function refreshTokenApi(data: AuthApi.RefreshTokenParams) {
  return baseRequestClient.post<AuthApi.RefreshTokenResult>(
    '/auth/refresh-token',
    data,
  );
}
```

### 3.2 重新认证 doReAuthenticate

刷新失败或 refreshToken 也过期时触发：

```ts
async function doReAuthenticate() {
  const accessStore = useAccessStore();
  const authStore = useAuthStore();
  accessStore.setAccessToken(null);
  accessStore.setRefreshToken(null);
  if (preferences.app.loginExpiredMode === 'modal' && accessStore.isAccessChecked) {
    accessStore.setLoginExpired(true);   // 弹窗提示
  } else {
    await authStore.logout();            // 直接登出跳登录页
  }
}
```

### 3.3 流程图

```text
请求返回 401
   ├─ enableRefreshToken=true
   │     ├─ 调用 doRefreshToken（refreshTokenApi）
   │     │     ├─ 成功：用新 Token 重发原请求
   │     │     └─ 失败：调用 doReAuthenticate → logout 跳登录页
   │     └─ enableRefreshToken=false → doReAuthenticate
```

## 4. 统一错误处理

`errorMessageResponseInterceptor` 处理非鉴权类错误，按状态码分类提示：

```ts
client.addResponseInterceptor(
  errorMessageResponseInterceptor((msg: string, error) => {
    const responseData = error?.response?.data ?? {};
    const statusCode = responseData?.statusCode ?? error?.response?.status ?? 0;
    const errorMessage = responseData?.message ?? '';

    if (statusCode === 401) return;                              // 由鉴权拦截器处理
    if (statusCode === 429) { message.error('请求过于频繁，请稍后再试'); return; }
    if (statusCode === 403) { message.error('没有操作权限'); return; }
    if (statusCode === 404) { message.error('请求的资源不存在'); return; }
    if (statusCode === 500) { message.error('服务器内部错误，请稍后重试'); return; }

    message.error(errorMessage || msg || '请求失败');
  }),
);
```

| 状态码 | 处理 |
| ---- | ---- |
| 401 | 不提示，交给 `authenticateResponseInterceptor` 刷新或跳登录 |
| 403 | `没有操作权限` |
| 404 | `请求的资源不存在` |
| 429 | `请求过于频繁，请稍后再试` |
| 500 | `服务器内部错误，请稍后重试` |
| 其他 | 优先显示后端 `message`，否则默认 `请求失败` |

## 5. 接口模块组织

### 5.1 core/ —— 核心接口

`api/core/auth.ts` 真实代码示例：

```ts
import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  export interface LoginParams {
    email?: string;
    password?: string;
    captchaId?: string;
    captchaCode?: string;
  }
  export interface LoginResult {
    accessToken: string;
    refreshToken: string;
    requireCaptcha?: boolean;
    lockedUntil?: string;
  }
  export interface RefreshTokenParams {
    accessToken: string;
    refreshToken: string;
  }
  export interface RefreshTokenResult {
    accessToken: string;
    refreshToken: string;
  }
}

/** 登录 */
export async function loginApi(data: AuthApi.LoginParams) {
  return requestClient.post<AuthApi.LoginResult>('/auth/login', data);
}

/** 获取验证码 */
export async function getCaptchaApi() {
  return requestClient.get<AuthApi.CaptchaResult>('/auth/captcha');
}

/** 刷新 accessToken（用 baseRequestClient 避免循环） */
export async function refreshTokenApi(data: AuthApi.RefreshTokenParams) {
  return baseRequestClient.post<AuthApi.RefreshTokenResult>('/auth/refresh-token', data);
}

/** 退出登录 */
export async function logoutApi() {
  return baseRequestClient.post('/auth/logout');
}
```

`api/core/user.ts` 把后端用户信息转换为前端 `UserInfo`：

```ts
export interface BackendUserInfo {
  id: number;
  name: string;
  email: string;
  avatar?: string | null;
  departmentId?: number | null;
  roles: string[];
  permissions: string[];
}

export async function getUserInfoApi() {
  const backendUserInfo = await requestClient.get<BackendUserInfo>('/auth/user-info');
  const userInfo: UserInfo = {
    userId: String(backendUserInfo.id),
    username: backendUserInfo.email,
    realName: backendUserInfo.name,
    avatar: backendUserInfo.avatar || '',
    roles: backendUserInfo.roles,
  };
  return { userInfo, permissions: backendUserInfo.permissions };
}
```

### 5.2 system/ —— 业务接口

业务接口按模块拆分，每个文件聚焦单一资源。以 `api/system/role.ts` 为例：

```ts
import { requestClient } from '#/api/request';

/** 分页查询角色列表 */
export async function getRoleListApi(params: any) {
  const result = await requestClient.get('/roles/paged', { params });
  return { items: result?.items || [], total: result?.metadata?.totalCount || 0 };
}

/** 创建角色 */
export async function createRoleApi(data: any) {
  return requestClient.post('/roles', data);
}

/** 更新角色 */
export async function updateRoleApi(id: number, data: any) {
  return requestClient.put(`/roles/${id}`, data);
}

/** 删除角色 */
export async function deleteRoleApi(id: number) {
  return requestClient.delete(`/roles/${id}`);
}
```

### 5.3 统一导出

`api/index.ts` 通过 `export *` 统一导出：

```ts
// api/core/index.ts
export * from './auth';
export * from './menu';
export * from './user';

// api/index.ts
export * from './core';
```

业务模块接口通过 `#/api/system/role` 显式导入，避免命名冲突。

## 6. Vite 代理配置

开发环境通过 Vite `server.proxy` 把前端请求代理到后端，避免跨域。`apps/web-antd/vite.config.ts`：

```ts
import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            target: 'http://localhost:5000',   // 后端 API 地址
            ws: true,
          },
          '/uploads': {
            changeOrigin: true,
            target: 'http://localhost:5000',   // 静态资源代理
          },
        },
      },
    },
  };
});
```

请求链路：`浏览器 → http://localhost:5666/api/v1/roles/paged → Vite 代理 → http://localhost:5000/api/v1/roles/paged`

## 7. 环境变量

环境变量分三个文件，按 `.env` < `.env.development` / `.env.production` 优先级合并：

### 7.1 .env —— 基础变量（所有环境共享）

```bash
VITE_APP_TITLE=Chet Admin
VITE_APP_NAMESPACE=chet-admin
VITE_APP_STORE_SECURE_KEY=please-replace-me-with-your-own-key
```

### 7.2 .env.development —— 开发环境

```bash
VITE_PORT=5666
VITE_BASE=/
VITE_GLOB_API_URL=/api/v1
VITE_NITRO_MOCK=false        # 关闭 Nitro Mock，对接真实后端
VITE_DEVTOOLS=false
VITE_INJECT_APP_LOADING=true
```

### 7.3 .env.production —— 生产环境

```bash
VITE_BASE=/
VITE_GLOB_API_URL=/api/v1
VITE_COMPRESS=none           # 压缩方式：none / brotli / gzip
VITE_PWA=false
VITE_ROUTER_HISTORY=hash     # 生产用 hash 路由
VITE_INJECT_APP_LOADING=true
VITE_ARCHIVER=true           # 打包生成 dist.zip
```

### 7.4 常用变量说明

| 变量 | 作用 |
| ---- | ---- |
| `VITE_APP_TITLE` | 应用标题，显示在浏览器标签与登录页 |
| `VITE_APP_NAMESPACE` | 缓存命名空间，隔离多应用 |
| `VITE_PORT` | 开发服务端口 |
| `VITE_GLOB_API_URL` | API 基础路径，注入到 `requestClient.baseURL` |
| `VITE_NITRO_MOCK` | 是否启用 Nitro Mock 服务 |
| `VITE_ROUTER_HISTORY` | 路由模式：`hash` 或留空（history） |
| `VITE_COMPRESS` | 生产构建压缩方式 |
| `VITE_ARCHIVER` | 是否生成 dist.zip |

## 8. 延伸阅读

- [安全基石 JWT 认证](/articles/05-jwt-auth)
- [后端安全设计](/backend/04-security)
- [状态管理](/frontend/04-state)
