import { defineConfig } from 'vitepress'

// Chet.Admin 官方文档站点配置
export default defineConfig({
  lang: 'zh-CN',
  title: 'Chet.Admin',
  description: '基于 .NET 10 + Vue 3 的企业级 RBAC 权限管理系统',

  // GitHub Pages 部署需要设置 base 为仓库名
  base: '/docs.chet.admin/',

  lastUpdated: true,
  cleanUrls: true,

  // 忽略 localhost 开发地址的死链接检查
  ignoreDeadLinks: 'localhostLinks',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/docs.chet.admin/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#0066FF' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    siteTitle: 'Chet.Admin',

    nav: [
      { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: '功能模块', link: '/modules/overview', activeMatch: '/modules/' },
      { text: '🎨 前端架构', link: '/frontend/01-architecture', activeMatch: '/frontend/' },
      { text: '✨ 后端架构', link: '/backend/01-architecture', activeMatch: '/backend/' },
      {
        text: '🔥 系列教程',
        link: '/articles/overview',
        activeMatch: '/articles/',
      },
      { text: '💖 赞助', link: '/sponsor', activeMatch: '/sponsor' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          collapsed: false,
          items: [
            { text: '项目简介', link: '/guide/introduction' },
            { text: '系统架构', link: '/guide/architecture' },
            { text: '快速开始', link: '/guide/quick-start' },
            { text: '项目重命名', link: '/guide/rename' },
          ],
        },
        {
          text: '开发指南',
          collapsed: false,
          items: [
            { text: '前端开发指南', link: '/guide/frontend' },
            { text: '后端开发指南', link: '/guide/backend' },
          ],
        },
        {
          text: '其他',
          collapsed: false,
          items: [{ text: '部署指南', link: '/guide/deployment' }],
        },
      ],
      '/modules/': [
        {
          text: '功能模块',
          collapsed: false,
          items: [
            { text: '模块总览', link: '/modules/overview' },
            { text: '认证登录', link: '/modules/auth' },
            { text: '用户管理', link: '/modules/user' },
            { text: '角色管理', link: '/modules/role' },
            { text: '菜单管理', link: '/modules/menu' },
            { text: '部门管理', link: '/modules/department' },
            { text: '权限管理', link: '/modules/permission' },
            { text: '字典管理', link: '/modules/dictionary' },
            { text: '操作日志', link: '/modules/audit-log' },
            { text: '通知公告', link: '/modules/notification' },
            { text: '文件上传', link: '/modules/file-upload' },
            { text: '在线用户', link: '/modules/online-user' },
          ],
        },
      ],
      '/backend/': [
        {
          text: '后端架构',
          collapsed: false,
          items: [
            { text: '架构概览', link: '/backend/01-architecture' },
            { text: '配置管理', link: '/backend/02-configuration' },
            { text: '数据库设计', link: '/backend/03-database' },
            { text: '安全设计', link: '/backend/04-security' },
            { text: '缓存策略', link: '/backend/05-caching' },
            { text: '日志配置', link: '/backend/06-logging' },
            { text: '测试策略', link: '/backend/07-testing' },
            { text: '开发指南', link: '/backend/08-development' },
          ],
        },
        {
          text: 'API 文档',
          collapsed: false,
          items: [
            { text: '统一响应格式', link: '/backend/09-api-response' },
            { text: '认证机制', link: '/backend/10-api-authentication' },
            { text: '接口清单', link: '/backend/11-api-endpoints' },
          ],
        },
      ],
      '/frontend/': [
        {
          text: '前端架构',
          collapsed: false,
          items: [
            { text: '架构概览', link: '/frontend/01-architecture' },
            { text: '目录结构', link: '/frontend/02-structure' },
            { text: '路由与权限', link: '/frontend/03-routing' },
            { text: '状态管理', link: '/frontend/04-state' },
            { text: 'API 请求层', link: '/frontend/05-api-layer' },
            { text: '开发指南', link: '/frontend/06-development' },
          ],
        },
      ],
      '/articles/': [
        {
          text: '系列教程',
          collapsed: false,
          items: [
            { text: '教程总览', link: '/articles/overview' },
            { text: '开篇总览', link: '/articles/01-overview' },
            { text: '快速上手', link: '/articles/02-quick-start' },
            { text: '项目结构全解析', link: '/articles/03-project-structure' },
            { text: '后端分层架构', link: '/articles/04-backend-architecture' },
            { text: '安全基石 JWT 认证', link: '/articles/05-jwt-auth' },
            { text: '权限模型 RBAC 三层防护', link: '/articles/06-rbac' },
            { text: '模块详解：认证登录', link: '/articles/07-auth-module' },
            { text: '模块详解：用户管理', link: '/articles/08-user-module' },
            { text: '模块详解：角色与权限', link: '/articles/09-role-module' },
            { text: '模块详解：菜单管理', link: '/articles/10-menu-module' },
            { text: '模块详解：部门管理', link: '/articles/11-department-module' },
            { text: '模块详解：字典管理', link: '/articles/12-dictionary-module' },
            { text: '模块详解：仪表盘', link: '/articles/13-dashboard-module' },
            { text: '模块详解：操作日志', link: '/articles/14-audit-log-module' },
            { text: '模块详解：通知公告', link: '/articles/15-notification-module' },
            { text: '模块详解：文件上传', link: '/articles/16-file-upload-module' },
            { text: '模块详解：在线用户', link: '/articles/17-online-user-module' },
            { text: '时间时区统一方案', link: '/articles/18-timezone' },
            { text: '项目重命名指南', link: '/articles/19-rename' },
            { text: '部署上线', link: '/articles/20-deployment' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/qiect/Chet.Admin' }],

    footer: {
      message: '基于 MIT 协议发布',
      copyright: 'Copyright © 2026 Chet.Admin',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
            },
          },
        },
      },
    },

    outline: {
      label: '本页目录',
      level: [2, 3],
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    lastUpdated: {
      text: '最后更新于',
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
})
