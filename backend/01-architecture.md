# 后端架构

## 1. 架构概述

Chet.Admin 后端位于 `Chet.Admin.Api/`，基于 **.NET 10 + C# 12** 构建，采用 **Clean Architecture + 领域驱动设计（DDD）** 分层架构。核心目标是高内聚、低耦合，便于维护与扩展。

### 1.1 架构目标

- **解耦**：各层通过依赖注入实现松耦合
- **可测试性**：核心业务逻辑独立于基础设施，便于单元测试与集成测试
- **可扩展性**：新增业务模块不影响现有层
- **可维护性**：分层职责清晰，依赖方向单一
- **安全性**：内建 JWT 认证、限流、审计等安全机制

### 1.2 技术栈

| 类别 | 技术 | 说明 |
| ---- | ---- | ---- |
| 运行时 | .NET 10 | 最新稳定版 |
| 语言 | C# 12 | 现代化语言特性 |
| ORM | Entity Framework Core | SQLite（开发）/ PostgreSQL（生产） |
| 缓存 | Redis + MemoryCache | Redis 不可用时自动降级为 NoOp |
| 认证 | JWT | 双令牌机制（Access + Refresh） |
| 密码 | BCrypt | 不可逆哈希 |
| 对象映射 | AutoMapper | DTO 与实体转换 |
| 日志 | Serilog | 结构化日志，文件输出 |
| API 文档 | Swagger / OpenAPI | 启动自动生成 |
| 参数校验 | FluentValidation | 强类型输入校验 |
| 容器化 | Docker | Dockerfile + docker-compose |

## 2. 解决方案结构

解决方案文件 `Chet.Admin.slnx`，按 Clean Architecture 划分为五个项目组：

```
Chet.Admin.Api/
├── Chet.Admin.Api/                 # ① 表示层
│   ├── Configurations/             # DI 注册扩展方法（11 个）
│   ├── Controllers/                # API 控制器（12 个）
│   ├── Filters/                    # ApiExceptionFilter
│   ├── Middleware/                 # 中间件（4 个）
│   ├── Properties/                 # launchSettings.json
│   ├── Program.cs                  # 应用启动入口
│   ├── appsettings.json            # 应用配置
│   └── Chet.Admin.Api.csproj
├── Chet.Admin.Application/         # ② 应用层
│   ├── Chet.Admin.DTOs/            # 数据传输对象 + Validators
│   ├── Chet.Admin.Mapping/         # AutoMapper Profile
│   └── Chet.Admin.Services/        # 业务服务实现
├── Chet.Admin.Core/                # ③ 核心层
│   ├── Chet.Admin.Contracts/       # 接口契约
│   ├── Chet.Admin.Domain/          # 领域实体
│   └── Chet.Admin.Shared/          # 共享类型、异常、响应模型
├── Chet.Admin.Infrastructure/      # ④ 基础设施层
│   ├── Chet.Admin.Caching/         # Redis / NoOp 缓存
│   ├── Chet.Admin.Configuration/   # 强类型配置模型
│   ├── Chet.Admin.Data/            # EF Core 数据访问
│   └── Chet.Admin.Logging/         # 日志上下文与脱敏
├── Chet.Admin.Tests/               # ⑤ 测试层
│   ├── Chet.Admin.UnitTests/       # 单元测试
│   └── Chet.Admin.IntegrationTests/# 集成测试
├── Chet.Admin.slnx                 # 解决方案文件
├── Dockerfile
└── docker-compose.yml
```

## 3. 分层详解

依赖方向只能向内：**表示层 → 应用层 → 核心层 ← 基础设施层**（核心层不依赖任何外层）。

```
表示层 ──→ 应用层 ──→ 核心层 ←── 基础设施层
  │           │            │
  └───────────┴────────────┘ （测试层依赖所有层）
```

### 3.1 表示层（API Layer）

项目 `Chet.Admin.Api`，处理 HTTP 请求与响应，不含业务逻辑。

**Controllers（12 个）**：`AuthController` `UsersController` `RolesController` `MenusController` `DepartmentsController` `DictionariesController` `DashboardController` `AuditLogsController` `NotificationsController` `FilesController` `OnlineUsersController` `HealthController`

**Middleware（4 个）**：
- `AuditLogMiddleware`：记录写操作审计日志
- `OnlineUserTrackingMiddleware`：刷新用户活跃时间
- `LogContextMiddleware`：注入日志上下文（用户名、请求 ID 等）
- `RateLimitingMiddleware`：请求限流

**Configurations（11 个）**：以扩展方法组织 DI 注册，每个对应一个功能域：

| 扩展方法 | 文件 | 作用 |
| ---- | ---- | ---- |
| `ConfigureSerilog` | `SerilogConfiguration.cs` | 日志系统 |
| `ConfigureDatabase` | `DatabaseConfiguration.cs` | EF Core + 数据库初始化 |
| `ConfigureRedis` | `RedisConfiguration.cs` | Redis 缓存（含 NoOp 降级） |
| `ConfigureRepositories` | `RepositoryConfiguration.cs` | 仓储注册（Scoped） |
| `ConfigureServices` | `ServiceConfiguration.cs` | 业务服务注册 |
| `ConfigureJwt` | `JwtConfiguration.cs` | JWT 认证 |
| `ConfigureCors` | `CorsConfiguration.cs` | 跨域策略 |
| `ConfigureSwagger` | `SwaggerConfiguration.cs` | OpenAPI 文档 |
| `ConfigureApiVersioning` | `ApiVersionConfiguration.cs` | API 版本控制 |
| `ConfigureFluentValidation` | `FluentValidationConfiguration.cs` | 参数校验 |
| `ConfigureExceptionHandling` | `ExceptionHandlingConfiguration.cs` | 全局异常处理 |

**Filters**：`ApiExceptionFilter` 统一捕获并格式化异常响应。

### 3.2 应用层（Application Layer）

包含三个子项目，承载业务逻辑与数据传输。

- **Chet.Admin.DTOs**：各模块数据传输对象（Auth、User、Role、Menu、Department、Dictionary、Notification、Audit、File、Dashboard），含 `Validators`（FluentValidation 校验规则）
- **Chet.Admin.Mapping**：AutoMapper Profile，按模块组织 DTO ↔ Entity 映射
- **Chet.Admin.Services**：业务服务实现，按模块组织。另含：
  - `Jwt/JwtService`：令牌签发与验证
  - `Security/PasswordService`：BCrypt 密码哈希与校验
  - `Auth/CaptchaService`：图形验证码

### 3.3 核心层（Core Layer）

最内层，**不依赖任何其他项目**，定义领域核心。

- **Chet.Admin.Domain**：领域实体，全部继承 `BaseEntity`（含 `Id`、`CreatedAt`、`UpdatedAt`）。包含 User、Role、Menu、Department、Dictionary、AuditLog、Notification、File 等实体及关联表（UserRole、RoleMenu、RoleDataScopeDept）
- **Chet.Admin.Contracts**：接口契约
  - 通用：`IRepository<T>`、`IUnitOfWork`
  - 各模块：`IUserService`、`IAuthService`、`IRoleRepository` 等
- **Chet.Admin.Shared**：`ApiResponse`、`CacheKeys`、`UtcDateTimeJsonConverter`、自定义异常（`NotFoundException`、`BadRequestException`）

### 3.4 基础设施层（Infrastructure Layer）

实现核心层定义的接口，封装技术细节。

- **Chet.Admin.Data**：`AppDbContext`、`EfCoreRepository<T>`、各模块 Repository 实现、实体 EF 配置（`*Config.cs`）、`UnitOfWork`
- **Chet.Admin.Caching**：`RedisCacheService` + `NoOpCacheService`（Redis 不可用时降级实现）
- **Chet.Admin.Configuration**：`AppSettings`、`JwtSettings`、`RedisSettings`、`PasswordPolicySettings` 强类型配置模型
- **Chet.Admin.Logging**：`LogContextHelper`（日志上下文注入）、`SensitiveDataLogFilter`（敏感数据脱敏）

### 3.5 测试层（Tests Layer）

- **Chet.Admin.UnitTests**：xUnit + Moq 单元测试
- **Chet.Admin.IntegrationTests**：集成测试

## 4. 依赖关系

```
表示层 ──→ 应用层 ──→ 核心层 ←── 基础设施层
```

- API 层引用 Application 层和 Infrastructure 层
- Application 层只引用 Core 层（通过接口）
- Infrastructure 层引用 Core 层（实现接口）
- 所有层通过依赖注入解耦，核心层完全不依赖外层

## 5. 启动流程

`Program.cs` 按六个阶段组织，顺序清晰：

```
① 初始化日志（Serilog）
   └─ builder.ConfigureSerilog()

② 服务注册（DI）
   └─ Controllers、Swagger、Database、Redis、AutoMapper、
      Repositories、Services、FluentValidation、JWT、CORS、MemoryCache

③ 构建 WebApplication
   └─ builder.Build()

④ 数据库初始化
   └─ app.InitializeDatabaseAsync()  （自动迁移 + 种子数据）

⑤ 中间件管道
   └─ 异常处理 → 日志上下文 → CORS → 限流
      → SwaggerUI → 认证 → 审计日志 → 在线用户追踪
      → 静态文件（uploads）→ 控制器映射

⑥ 启动监听
   └─ app.Run()
```

### 5.1 中间件管道顺序

```
异常处理 → 日志上下文 → CORS → 限流 → SwaggerUI
 → 认证 → 授权 → 审计日志 → 在线用户追踪 → 静态文件 → 控制器
```

> 开发环境禁用 HTTPS 重定向，避免 Vite 代理请求被重定向到 HTTPS 端口。

## 6. 设计原则

- **依赖倒置**：外层依赖内层的接口定义，内层不依赖具体实现
- **单一职责**：每个类、每个方法只做一件事
- **接口抽象**：所有业务逻辑通过接口暴露，便于测试和替换
- **关注点分离**：表示层只处理 HTTP，业务逻辑在应用层，数据访问在基础设施层
- **配置即代码**：DI 注册通过扩展方法组织，集中且可读
