# API 版本控制

## 1. 概述

Chet.Admin 后端内置 API 版本控制机制，基于 `Microsoft.AspNetCore.Mvc.Versioning` 实现。版本号通过 URL 路径段传递（如 `/api/v1/users`），同时兼容 Header 与 Query 参数两种识别方式。Swagger UI 会按版本自动分组生成独立文档，便于多版本并存与平滑升级。

## 2. 版本识别方式

系统支持三种版本识别方式，按优先级从高到低：

| 方式 | 示例 | 优先级 | 说明 |
| ---- | ---- | ---- | ---- |
| URL 路径段 | `/api/v1/users` | 1（最高） | 路由模板中 `api/v{version:apiVersion}/[controller]` |
| 请求头 | `X-API-Version: 1.0` | 2 | 适合不改 URL 的场景 |
| 查询参数 | `?api-version=1.0` | 3 | 适合快速调试 |

> 默认版本为 `v1.0`，未指定版本时自动使用默认版本（`AssumeDefaultVersionWhenUnspecified = true`）。

## 3. 配置实现

版本控制配置位于 `Chet.Admin.Api/Configurations/ApiVersionConfiguration.cs`，在 `Program.cs` 启动时注册：

```csharp
builder.Services.ConfigureApiVersioning();
```

核心配置：

```csharp
public static void ConfigureApiVersioning(this IServiceCollection services)
{
    services.AddApiVersioning(options =>
    {
        options.DefaultApiVersion = new ApiVersion(1, 0);
        options.AssumeDefaultVersionWhenUnspecified = true;
        options.ReportApiVersions = true;  // 响应头返回支持的版本
        options.ApiVersionReader = ApiVersionReader.Combine(
            new UrlSegmentApiVersionReader(),
            new HeaderApiVersionReader("X-API-Version"),
            new QueryStringApiVersionReader("api-version")
        );
    });

    services.AddVersionedApiExplorer(options =>
    {
        options.GroupNameFormat = "'v'VVV";        // 版本分组名格式：v1、v2
        options.SubstituteApiVersionInUrl = true;  // URL 中替换版本占位符
    });
}
```

| 配置项 | 值 | 说明 |
| ---- | ---- | ---- |
| `DefaultApiVersion` | `1.0` | 默认版本 |
| `AssumeDefaultVersionWhenUnspecified` | `true` | 未指定版本时使用默认版本 |
| `ReportApiVersions` | `true` | 响应头 `api-supported-versions` 返回支持的版本列表 |
| `GroupNameFormat` | `'v'VVV` | 分组名格式（v1、v2） |

## 4. 控制器路由约定

所有控制器使用统一的路由模板，版本号通过路由约束指定：

```csharp
[ApiController]
[Route("api/v{version:apiVersion}/[controller]")]
[ApiVersion("1.0")]
public class UsersController : ControllerBase
{
    // GET /api/v1/users
    // GET /api/v1/users?api-version=1.0
    // GET /api/v1/users (Header: X-API-Version: 1.0)
}
```

新增版本时，在控制器上标注 `[ApiVersion("2.0")]` 即可：

```csharp
[ApiController]
[Route("api/v{version:apiVersion}/[controller]")]
[ApiVersion("1.0")]
[ApiVersion("2.0")]
public class UsersController : ControllerBase
{
    // v1 与 v2 共用此控制器

    [HttpGet]
    public IActionResult GetAll() => Ok(/* ... */);

    [HttpGet]
    [MapToApiVersion("2.0")]
    public IActionResult GetAllV2() => Ok(/* v2 新实现 */);
}
```

## 5. Swagger 多版本文档

Swagger 配置位于 `Chet.Admin.Api/Configurations/SwaggerConfiguration.cs`，通过 `IApiVersionDescriptionProvider` 动态为每个版本生成独立的 Swagger 文档：

```csharp
public static void ConfigureSwaggerUI(this WebApplication app)
{
    if (app.Environment.IsDevelopment())
    {
        var provider = app.Services.GetRequiredService<IApiVersionDescriptionProvider>();

        app.UseSwagger();
        app.UseSwaggerUI(options =>
        {
            foreach (var description in provider.ApiVersionDescriptions)
            {
                options.SwaggerEndpoint(
                    $"/swagger/{description.GroupName}/swagger.json",
                    $"API {description.GroupName.ToUpperInvariant()}");
            }
        });
    }
}
```

访问 `http://localhost:5000/swagger` 后，右上角下拉框可切换不同版本的 API 文档（如 `API V1`、`API V2`）。

### 5.1 Swagger 文档信息

每个版本的文档信息通过 `ConfigureSwaggerOptions` 生成：

```csharp
private static OpenApiInfo CreateInfoForApiVersion(ApiVersionDescription description)
{
    var info = new OpenApiInfo
    {
        Title = "Chet.Admin",
        Version = description.ApiVersion.ToString(),
        Description = "基于.NET 10的WebAPI模板框架，提供用户认证和管理功能"
    };

    if (description.IsDeprecated)
    {
        info.Description += " (已弃用)";  // 弃用版本自动标注
    }

    return info;
}
```

### 5.2 Swagger 增强配置

| 配置 | 说明 |
| ---- | ---- |
| JWT 认证 | 内置 Bearer 认证支持，点击右上角 Authorize 填入 Token 即可调试 |
| XML 注释 | 读取 `Chet.Admin.Api.xml`，将控制器 / DTO 的三斜杠注释渲染到文档 |
| 注解增强 | 启用 `EnableAnnotations()`，支持 `[ProducesResponseType]` 等标注 |

> Swagger UI 仅在开发环境（`Development`）启用，生产环境自动关闭。

## 6. 版本升级策略

### 6.1 新增版本（向后兼容）

```csharp
// 1. 控制器添加新版本标注
[ApiVersion("2.0")]
public class UsersController : ControllerBase { }

// 2. 需要新行为的方法用 MapToApiVersion 指定
[MapToApiVersion("2.0")]
public IActionResult GetAll() => Ok(/* v2 实现 */);

// 3. v1 与 v2 并存，前端逐步迁移
```

### 6.2 弃用旧版本

```csharp
[ApiVersion("1.0", Deprecated = true)]
public class UsersController : ControllerBase { }
```

Swagger 文档会自动标注「已弃用」，提醒前端迁移。

### 6.3 移除旧版本

确认所有前端已迁移后，移除 `[ApiVersion("1.0")]` 标注，v1 接口将返回 400。

## 7. 前端适配

前端请求基础路径由 `VITE_GLOB_API_URL=/api/v1` 决定，切换版本时修改此环境变量即可：

```bash
# .env.development
VITE_GLOB_API_URL=/api/v1   # 当前版本
VITE_GLOB_API_URL=/api/v2   # 升级到 v2
```

## 8. 相关文档

- [统一响应格式](/backend/09-api-response) — ApiResponse 结构与错误码
- [认证机制](/backend/10-api-authentication) — JWT 双令牌与登录流程
- [接口清单](/backend/11-api-endpoints) — 全部接口一览（v1）
- [配置管理](/backend/02-configuration) — appsettings.json 配置项
