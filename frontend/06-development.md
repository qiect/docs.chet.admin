# 前端开发指南

## 1. 开发流程概览

新增一个业务模块（以「文章管理」为例）的标准流程：

```text
① 新增 API 接口（src/api/system/article.ts）
       ↓
② 新增页面（src/views/system/article/index.vue）
       ↓
③ 新增路由（router/routes/modules/article.ts 或由后端菜单返回）
       ↓
④ 配置权限码（后端菜单表 permission 字段 + 前端按钮绑定）
       ↓
⑤ 国际化（locales/langs/zh-CN、en-US）
```

开发前确保已启动后端服务（`http://localhost:5000`），并在工程根目录执行 `pnpm dev:antd` 启动主应用（默认端口 5666）。

## 2. 新增 API 接口

在 `src/api/system/` 新建 `article.ts`，使用 `requestClient` 发起请求：

```ts
import { requestClient } from '#/api/request';

export namespace ArticleApi {
  export interface Article {
    id: number;
    title: string;
    content: string;
    categoryId: number;
    isEnabled: boolean;
    createdAt: string;
  }
  export interface ArticleQueryParams {
    pageNumber: number;
    pageSize: number;
    keyword?: string;
    categoryId?: number;
  }
  export interface ArticlePagedResult {
    items: Article[];
    metadata: { totalCount: number };
  }
}

/** 分页查询文章列表 */
export async function getArticleListApi(params: ArticleApi.ArticleQueryParams) {
  const result = await requestClient.get<ArticleApi.ArticlePagedResult>(
    '/articles/paged',
    { params },
  );
  return { items: result?.items || [], total: result?.metadata?.totalCount || 0 };
}

/** 获取全部文章（下拉用） */
export async function getArticleAllApi() {
  return requestClient.get<ArticleApi.Article[]>('/articles');
}

/** 创建文章 */
export async function createArticleApi(data: Partial<ArticleApi.Article>) {
  return requestClient.post('/articles', data);
}

/** 更新文章 */
export async function updateArticleApi(id: number, data: Partial<ArticleApi.Article>) {
  return requestClient.put(`/articles/${id}`, data);
}

/** 删除文章 */
export async function deleteArticleApi(id: number) {
  return requestClient.delete(`/articles/${id}`);
}
```

> 命名约定：函数名用 `<动作><资源>Api` 格式（如 `createArticleApi`），与 `role.ts`、`user.ts` 等现有模块保持一致。

无需手动在 `api/index.ts` 导出 system 模块，业务页面通过 `#/api/system/article` 显式导入，避免命名冲突。

## 3. 新增页面

在 `src/views/system/article/index.vue` 创建页面，遵循「搜索表单 + 表格 + 新增/编辑弹窗」三件套模式。参考 `views/system/role/index.vue` 的真实写法：

```vue
<script lang="ts" setup>
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridColumns, VxeTableGridOptions } from '#/adapter/vxe-table';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { Plus } from '@vben/icons';
import { useAccess } from '@vben/access';

import { Button, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid, VbenTableAction } from '#/adapter/vxe-table';
import {
  createArticleApi,
  deleteArticleApi,
  getArticleListApi,
  updateArticleApi,
} from '#/api/system/article';

const { hasAccessByCodes } = useAccess();

// ① 搜索表单 schema
const searchSchema: VbenFormSchema[] = [
  { component: 'Input', fieldName: 'keyword', label: '关键字' },
];

// ② 表格列定义
const columns: VxeTableGridColumns = [
  { field: 'id', title: 'ID', width: 80 },
  { field: 'title', title: '标题', minWidth: 200 },
  { field: 'categoryName', title: '分类', width: 120 },
  {
    field: 'isEnabled', title: '状态', width: 80,
    cellRender: { name: 'CellTag' },
  },
  {
    field: 'createdAt', title: '创建时间', minWidth: 180,
    slots: {
      default: ({ row }) => row.createdAt
        ? new Date(row.createdAt).toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })
        : '-',
    },
  },
  {
    align: 'center', field: 'operation', fixed: 'right',
    slots: { default: 'action' }, title: '操作', width: 200,
  },
];

// ③ 表格实例
const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: { schema: searchSchema, submitOnChange: true },
  gridOptions: {
    columns,
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        query: async ({ page }, formValues) =>
          await getArticleListApi({
            pageNumber: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          }),
      },
    },
    rowConfig: { keyField: 'id' },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  } as VxeTableGridOptions,
});

// ④ 编辑弹窗
const [Drawer, drawerApi] = useVbenDrawer({
  onConfirm: async (values) => {
    const id = drawerApi.getData()?.id;
    if (id) {
      await updateArticleApi(id, values);
      message.success('更新成功');
    } else {
      await createArticleApi(values);
      message.success('新增成功');
    }
    drawerApi.close();
    gridApi.query();
  },
});

function handleAdd() {
  drawerApi.setData({ id: null });
  drawerApi.open();
}

function handleEdit(row) {
  drawerApi.setData({ id: row.id });
  drawerApi.open();
}

async function handleDelete(row) {
  await deleteArticleApi(row.id);
  message.success('删除成功');
  gridApi.query();
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #action="{ row }">
        <VbenTableAction
          :actions="[
            { label: '编辑', auth: 'system:article:update', onClick: () => handleEdit(row) },
            { label: '删除', auth: 'system:article:delete', danger: true, onClick: () => handleDelete(row) },
          ]"
        />
      </template>
      <template #toolbar-actions>
        <Button
          v-access:code="['system:article:create']"
          type="primary"
          @click="handleAdd"
        >
          <Plus class="size-5" />
          新增
        </Button>
      </template>
    </Grid>
    <Drawer />
  </Page>
</template>
```

## 4. 新增路由

本项目采用 `backend` 权限模式，业务菜单通常由后端 `/menus/my-tree` 返回，前端无需手写路由。若需添加静态路由，参考 `router/routes/modules/dashboard.ts`：

```ts
import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:file-text',
      order: 10,
      title: $t('page.article.title'),
    },
    name: 'Article',
    path: '/article',
    children: [
      {
        name: 'ArticleList',
        path: 'list',
        component: () => import('#/views/system/article/index.vue'),
        meta: { icon: 'lucide:list', title: $t('page.article.list') },
      },
    ],
  },
];

export default routes;
```

后端菜单方式：在后端菜单管理页新增菜单，`component` 字段填 `system/article/index`（相对 `views/` 的路径，不含 `.vue`），前端 `access.ts` 的 `import.meta.glob('../views/**/*.vue')` 会自动映射到组件。

## 5. 表格规范

基于 `adapter/vxe-table.ts` 的预设，遵循以下规范：

| 场景 | 规范 |
| ---- | ---- |
| 数据结构 | 扁平数据 + `treeConfig: { transform: true }` 处理树形 |
| 分页参数 | 请求用 `pageNumber` / `pageSize`，响应取 `items` / `total` |
| 状态列 | 用 `cellRender: { name: 'CellTag' }`，默认渲染启用/禁用 Tag |
| 多状态列 | `cellRender: { name: 'CellTag', options: dataScopeOptions }` |
| 图片列 | `cellRender: { name: 'CellImage' }` |
| 时间列 | `slots.default` 中 `new Date(val).toLocaleString('zh-CN', {...})` |
| 操作列 | `slots: { default: 'action' }`，配合 `VbenTableAction` 组件 |
| 权限按钮 | `VbenTableAction` 的 `actions[].auth` 字段，或 `v-access:code` 指令 |
| 行键 | `rowConfig: { keyField: 'id' }` |
| 工具栏 | `toolbarConfig: { custom: true, refresh: true, search: true, zoom: true }` |

`proxyConfig` 的响应字段映射在 `vxe-table.ts` 中已配置：

```ts
proxyConfig: {
  response: { result: 'items', total: 'total', list: 'items' },
},
```

## 6. 表单规范

表单基于 `adapter/form.ts` 的 `useVbenForm`，配合 `useVbenDrawer` / `useVbenModal` 实现弹窗表单：

```ts
import { useVbenForm } from '#/adapter/form';
import { useVbenDrawer } from '@vben/common-ui';

const [Form, formApi] = useVbenForm({
  schema: [
    { component: 'Input', fieldName: 'title', label: '标题', rules: 'required' },
    { component: 'Select', fieldName: 'categoryId', label: '分类' },
    {
      component: 'Switch', fieldName: 'isEnabled', label: '状态',
      defaultValue: true,
    },
  ],
});

const [Drawer, drawerApi] = useVbenDrawer({
  formApi,
  onConfirm: async (values) => { /* 提交 */ },
});
```

### 6.1 VbenFormSchema 字段

| 字段 | 说明 |
| ---- | ---- |
| `component` | Ant Design Vue 组件名：`Input` / `Select` / `Switch` / `Checkbox` / `Radio` / `Upload` / `TreeSelect` 等 |
| `fieldName` | 表单字段名（提交时的 key） |
| `label` | 标签文案 |
| `rules` | 校验规则：`'required'` / `'selectRequired'` 或自定义 |
| `defaultValue` | 默认值 |
| `componentProps` | 传给组件的 props，如 `options`、`placeholder` |
| `dependencies` | 联动依赖，如某字段变化时显示/隐藏 |
| `ifExpand` | 是否在折叠区 |

### 6.2 动态注入选项

字典选项通过 `updateSchema` 动态注入：

```ts
const { options: categoryOptions } = useDict('article-category');
watch(categoryOptions, (opts) => {
  formApi.updateSchema([
    { fieldName: 'categoryId', componentProps: { options: opts } },
  ]);
});
```

## 7. 字典数据联动

`composables/useDict.ts` 提供字典数据加载与缓存，内置 `Map` 缓存避免重复请求：

```ts
import { useDict } from '#/composables/useDict';

const { options, loading, refresh } = useDict('article-category');
// options: { label, value }[]，可直接用于 Select / Radio
```

实现原理：

```ts
const dictCache = new Map<string, { label: string; value: string }[]>();

export function useDict(code: string) {
  const options = ref<{ label: string; value: string }[]>([]);
  const loading = ref(false);

  async function load() {
    if (dictCache.has(code)) {           // 命中缓存
      options.value = dictCache.get(code)!;
      return;
    }
    loading.value = true;
    try {
      const res = await requestClient.get(`/dictionaries/code/${code}`);
      const items = res?.items || res || [];
      const mapped = items.map((item: any) => ({ label: item.label, value: item.value }));
      dictCache.set(code, mapped);       // 写入缓存
      options.value = mapped;
    } catch { options.value = []; }
    finally { loading.value = false; }
  }

  load();                                  // 自动加载
  return { options, loading, refresh: load };
}
```

- **缓存策略**：模块级 `Map`，同一 code 只请求一次，刷新页面后失效
- **手动刷新**：调用 `refresh()` 重新拉取并更新缓存
- **使用场景**：表单 Select、表格 CellTag options、搜索表单

## 8. 权限码配置

权限码采用 **`模块:资源:操作`** 三段式，前后端保持一致。

### 8.1 后端配置

在后端菜单管理页新增按钮类型菜单，`permission` 字段填权限码：

| 菜单名 | 类型 | permission |
| ---- | ---- | ---- |
| 文章列表 | Menu | （留空） |
| 新增文章 | Button | `system:article:create` |
| 编辑文章 | Button | `system:article:update` |
| 删除文章 | Button | `system:article:delete` |

角色通过菜单分配获得对应权限码，`/auth/user-info` 接口返回的 `permissions` 数组包含这些码。

### 8.2 前端绑定

```vue
<!-- 指令方式 -->
<a-button v-access:code="['system:article:create']">新增</a-button>

<!-- 函数方式 -->
<a-button v-if="hasAccessByCodes(['system:article:create'])">新增</a-button>

<!-- 表格操作列（VbenTableAction 自动判断） -->
<VbenTableAction
  :actions="[
    { label: '编辑', auth: 'system:article:update', onClick: handleEdit },
    { label: '删除', auth: 'system:article:delete', danger: true, onClick: handleDelete },
  ]"
/>
```

## 9. 国际化

语言包位于 `src/locales/langs/`，按 `zh-CN` / `en-US` 分目录，按页面拆分 JSON：

```tree
locales/langs/
├── zh-CN/
│   ├── demos.json
│   └── page.json
└── en-US/
    ├── demos.json
    └── page.json
```

`page.json` 中按页面组织键：

```json
{
  "article": {
    "title": "文章管理",
    "list": "文章列表"
  },
  "dashboard": {
    "title": "仪表盘",
    "analytics": "分析页",
    "workspace": "工作台"
  }
}
```

在组件中通过 `$t` 调用：

```ts
import { $t } from '#/locales';

const title = $t('page.article.title');
```

模板中直接用：

```vue
<span>{{ $t('page.article.title') }}</span>
```

切换语言会触发 `preferences.app.locale` 更新，请求头 `Accept-Language` 同步变化，dayjs 与 Ant Design Vue 语言包也会重新加载。

## 10. 常用命令

在工程根目录 `Chet.Admin.Web/` 执行：

```bash
# 安装依赖（仅允许 pnpm）
pnpm install

# 启动主应用（开发模式，端口 5666）
pnpm dev:antd

# 构建主应用（生产模式）
pnpm build:antd

# 代码检查（ESLint + Oxlint）
pnpm lint

# 自动格式化
pnpm format

# 类型检查（vue-tsc）
pnpm check:type

# 单元测试（Vitest + happy-dom）
pnpm test:unit

# 端到端测试（Playwright）
pnpm test:e2e

# 循环依赖检查
pnpm check:circular

# 依赖完整性检查
pnpm check:dep

# 拼写检查
pnpm check:cspell

# 综合检查（循环依赖 + 依赖 + 类型 + 拼写）
pnpm check

# 清理构建产物与 node_modules
pnpm clean
```

> 注意：工程通过 `preinstall` 脚本强制只允许 pnpm，使用 npm 或 yarn 会被拦截。Node 版本要求 `^22.18.0 || ^24.0.0`，pnpm 版本 `>=11.0.0`。

## 11. 延伸阅读

- [前端开发指南（入门）](/guide/frontend)
- [目录结构](/frontend/02-structure)
- [路由与权限](/frontend/03-routing)
- [API 请求层](/frontend/05-api-layer)
