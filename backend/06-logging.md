# 日志配置

## 1. 日志体系概述

Chet.Admin 采用**两层日志体系**，分别覆盖系统运行日志与业务操作审计：

- **Serilog 系统日志**：结构化日志，输出到文件（Compact JSON 格式），记录请求链路、异常、运行时信息，用于运维排查。
- **审计日志（AuditLog）**：业务操作日志，存入数据库（`AuditLogs` 表），记录谁在何时对哪个模块做了什么写操作，用于安全审计与合规追溯。

两者协同工作：Serilog 负责技术维度诊断，审计日志负责业务维度留痕。日志中间件管道在 `Program.cs` 中按序注册：

```csharp
app.UseLogContext();                                      // 注入日志上下文
app.UseMiddleware<AuditLogMiddleware>();                   // 记录写操作审计
app.UseMiddleware<OnlineUserTrackingMiddleware>();         // 刷新在线用户活跃时间
```

## 2. Serilog 配置：SerilogConfiguration

`Chet.Admin.Api/Configurations/SerilogConfiguration.cs` 负责初始化 Serilog，核心逻辑：

- 清除默认日志提供程序，避免重复输出。
- 从 `appsettings.json` 的 `Serilog` 段读取基础配置。
- 通过 `Enrich` 添加上下文属性：`FromLogContext`、`MachineName`、`EnvironmentUserName`、`Application`、`Environment`。
- 开发环境额外输出到控制台（Debug 级别，带颜色主题）。
- 生产环境输出 Compact JSON 到控制台（Information 级别）。

```csharp
public static void ConfigureSerilog(this WebApplicationBuilder builder)
{
    builder.Logging.ClearProviders();

    builder.Host.UseSerilog((context, configuration) =>
    {
        configuration.ReadFrom.Configuration(context.Configuration);

        configuration.Enrich.FromLogContext()
            .Enrich.WithMachineName()
            .Enrich.WithEnvironmentUserName()
            .Enrich.WithProperty("Application", "Chet.Admin")
            .Enrich.WithProperty("Environment", context.HostingEnvironment.EnvironmentName);

        if (context.HostingEnvironment.IsDevelopment())
        {
            configuration.MinimumLevel.Debug()
                .WriteTo.Console(
                    outputTemplate: "[{Timestamp:HH:mm:ss}] [{Level:u4}] {Message:lj}{NewLine}    └─ Properties: {Properties}{NewLine}{Exception}",
                    theme: Serilog.Sinks.SystemConsole.Themes.AnsiConsoleTheme.Code);
        }

        if (context.HostingEnvironment.IsProduction())
        {
            configuration.MinimumLevel.Information()
                .WriteTo.Console(new Serilog.Formatting.Compact.CompactJsonFormatter());
        }
    });
}
```

## 3. appsettings.json Serilog 段详解

`appsettings.json` 中的 `Serilog` 配置段：

```json
"Serilog": {
  "MinimumLevel": {
    "Default": "Information",
    "Override": {
      "Microsoft": "Warning",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore": "Warning",
      "System": "Warning"
    }
  },
  "WriteTo": [
    {
      "Name": "File",
      "Args": {
        "path": "logs/log-.txt",
        "rollingInterval": "Day",
        "rollOnFileSizeLimit": true,
        "fileSizeLimitBytes": 52428800,
        "retainedFileCountLimit": 7,
        "formatter": "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact",
        "shared": true,
        "flushToDiskInterval": 2
      }
    }
  ],
  "Enrich": [ "FromLogContext" ]
}
```

配置项说明：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `MinimumLevel.Default` | `Information` | 全局默认日志级别 |
| `MinimumLevel.Override.Microsoft` | `Warning` | 抑制微软框架的 Information 噪音 |
| `MinimumLevel.Override.Microsoft.EntityFrameworkCore` | `Warning` | 抑制 EF Core SQL 日志 |
| `WriteTo.File.path` | `logs/log-.txt` | 日志文件路径（按日期补全） |
| `WriteTo.File.rollingInterval` | `Day` | 按天滚动生成新文件 |
| `WriteTo.File.rollOnFileSizeLimit` | `true` | 达到大小上限时滚动 |
| `WriteTo.File.fileSizeLimitBytes` | `52428800`（50 MB） | 单文件大小上限 |
| `WriteTo.File.retainedFileCountLimit` | `7` | 保留最近 7 个日志文件 |
| `WriteTo.File.formatter` | `CompactJsonFormatter` | 紧凑 JSON 格式，便于日志聚合 |
| `WriteTo.File.shared` | `true` | 多进程共享写入 |
| `WriteTo.File.flushToDiskInterval` | `2`（秒） | 刷盘间隔 |
| `Enrich` | `FromLogContext` | 从 LogContext 注入上下文属性 |

## 4. 日志上下文中间件：LogContextMiddleware

`LogContextMiddleware` 为每个请求注入结构化上下文（RequestId、Method、Path、UserId、UserName），通过 `LogContextHelper` 推送到 Serilog `LogContext`，使该请求作用域内所有日志自动携带这些属性。

```csharp
public async Task InvokeAsync(HttpContext context)
{
    var stopwatch = Stopwatch.StartNew();

    using (LogContextHelper.WithRequest(
        context.TraceIdentifier,
        context.Request.Method,
        context.Request.Path.Value ?? ""))
    {
        if (context.User?.Identity?.IsAuthenticated == true)
        {
            var userId = context.User.FindFirst("sub")?.Value
                        ?? context.User.FindFirst("id")?.Value ?? "unknown";
            var userName = context.User.Identity.Name ?? "unknown";

            using (LogContextHelper.WithUser(userId, userName))
            {
                _logger.LogInformation("请求开始: {Method} {Path}",
                    context.Request.Method, context.Request.Path.Value);
                await _next(context);
            }
        }
        else
        {
            _logger.LogInformation("请求开始: {Method} {Path}",
                context.Request.Method, context.Request.Path.Value);
            await _next(context);
        }
    }

    stopwatch.Stop();
    _logger.LogInformation("请求完成: {Method} {Path} - {StatusCode} ({ElapsedMilliseconds}ms)",
        context.Request.Method, context.Request.Path.Value,
        context.Response.StatusCode, stopwatch.ElapsedMilliseconds);
}
```

`LogContextHelper`（位于 `Chet.Admin.Logging`）封装了 `LogContext.PushProperty`，提供 `WithUser`、`WithRequest`、`WithProperty`、`WithProperties` 方法，返回 `IDisposable` 配合 `using` 自动清理。

## 5. 审计日志中间件：AuditLogMiddleware

`AuditLogMiddleware` 拦截 `/api/v` 开头的**非 GET** 请求，记录业务写操作。核心流程：

1. **过滤**：仅处理 `/api/v` 前缀且非 GET 的请求。
2. **捕获请求体**：当 `Request.Body.CanSeek` 时读取并复位流（multipart 上传等不可 Seek 的流会被跳过）。
3. **捕获响应**：用 `MemoryStream` 替换 `Response.Body`，请求结束后回写原始流。
4. **提取上下文**：从 Claims 读取 `userId` / `userName`，未认证请求直接跳过。
5. **模块与动作映射**：根据路径段映射中文模块名（users→用户管理 等），HTTP 方法映射中文动作（POST→新增、PUT→修改、DELETE→删除）。
6. **异步写入**：`fire-and-forget` 模式在独立 DI 作用域内调用 `IAuditLogService.LogAsync`，避免阻塞请求；请求体超 2000 字符截断。

关键代码：

```csharp
if (!path.StartsWith("/api/v") || context.Request.Method == "GET")
{
    await _next(context);
    return;
}

// 提取模块名和动作（中文化）
var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
var controllerName = segments.Length >= 3 ? segments[2] : "";
var module = ModuleMap.TryGetValue(controllerName, out var m) ? m : controllerName;
var action = ActionMap.TryGetValue(httpMethod, out var a) ? a : httpMethod;

// fire-and-forget 写审计
_ = Task.Run(async () =>
{
    using var scope = scopeFactory.CreateScope();
    var auditLogService = scope.ServiceProvider.GetRequiredService<IAuditLogService>();
    var auditLog = new AuditLogDto
    {
        UserId = userId, UserName = userName,
        Action = action, Module = module,
        Description = $"{action}{module}",
        HttpMethod = httpMethod, RequestPath = path,
        RequestData = requestData, StatusCode = statusCode,
        ClientIp = clientIp, UserAgent = userAgent,
        Duration = duration, OperatedAt = operatedAt,
    };
    await auditLogService.LogAsync(auditLog);
});
```

模块名映射覆盖：用户管理、角色管理、菜单管理、部门管理、字典管理、认证授权、审计日志、文件管理、通知管理、仪表盘、在线用户。

## 6. 审计日志存储：AuditLogEntity

`Chet.Admin.Domain/Audit/AuditLogEntity.cs` 定义审计日志实体，通过 EF Core 持久化到 `AuditLogs` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| `Id` | int | 主键 |
| `UserId` | int | 操作用户 ID |
| `UserName` | string | 操作用户名 |
| `Action` | string | 操作动作（新增/修改/删除） |
| `Module` | string | 操作模块（用户管理等） |
| `Description` | string | 操作描述（如 "新增用户管理"） |
| `TargetId` | string? | 操作目标对象 ID |
| `HttpMethod` | string | HTTP 方法（POST/PUT/DELETE） |
| `RequestPath` | string | 请求路径 |
| `RequestData` | string? | 请求数据（JSON，超 2000 字符截断） |
| `StatusCode` | int | HTTP 响应状态码 |
| `ClientIp` | string | 客户端 IP |
| `UserAgent` | string? | 客户端 User-Agent |
| `Duration` | long | 操作耗时（毫秒） |
| `OperatedAt` | DateTime | 操作时间（UTC） |

`AuditLogService` 实现 `IAuditLogService`，通过 `AppDbContext` 直接写入；`LogAsync` 内部捕获异常并记录日志，保证审计写入失败不影响主流程。

## 7. 审计日志查询

审计日志通过 `AuditLogsController` 暴露分页查询接口（需认证）：

```
GET /api/v{version}/audit-logs/paged
```

支持的查询参数：

| 参数 | 说明 |
|------|------|
| `pageNumber` | 页码（默认 1） |
| `pageSize` | 每页条数（默认 20） |
| `keyword` | 关键词（匹配 UserName / Description / RequestPath） |
| `userId` | 按用户 ID 筛选 |
| `module` | 按模块名称筛选 |
| `action` | 按操作类型筛选 |
| `startTime` / `endTime` | 按时间范围筛选 |

`AuditLogService.GetPagedAuditLogsAsync` 支持上述全部过滤条件，按 `OperatedAt` 倒序返回。另提供清理接口：

```
DELETE /api/v{version}/audit-logs/clear?before={datetime}
```

调用 `ClearBeforeAsync` 删除指定时间之前的审计记录。

## 8. 在线用户追踪：OnlineUserTrackingMiddleware

`OnlineUserTrackingMiddleware` 在请求**完成后**刷新用户活跃时间，用于在线用户列表展示：

```csharp
public async Task InvokeAsync(HttpContext context, IOnlineUserService onlineUserService)
{
    await _next(context);

    var userIdClaim = context.User.FindFirst(ClaimTypes.NameIdentifier);
    if (userIdClaim != null && int.TryParse(userIdClaim.Value, out var userId))
    {
        onlineUserService.UpdateActivity(userId);
    }
}
```

`OnlineUserService` 在内存中维护在线用户，自动清理超过 30 分钟未活动的记录，并提供强制下线（令牌黑名单）能力。详见 [缓存策略 - 在线用户追踪](/backend/05-caching#6-memorycache-使用场景)。

## 9. 生产建议

- **调整日志级别**：生产环境保持 `Information`，排障时可临时调高细分命名空间级别；避免 `Microsoft.EntityFrameworkCore` 设为 `Information` 导致 SQL 刷屏。
- **日志卷挂载**：容器部署时将 `logs/` 目录挂载到持久化卷，避免容器重建丢失日志。
- **定期清理**：`retainedFileCountLimit=7` 默认保留 7 天，按合规要求调整；审计日志通过 `clear` 接口定期清理。
- **日志聚合**：Compact JSON 格式便于被 ELK / Loki / Seq 等采集，建议接入集中式日志平台。
- **监控异常**：对 `Error` / `Fatal` 级别日志配置告警，及时响应生产故障。
- **审计写入容错**：审计日志采用 `fire-and-forget`，失败仅记录错误日志不阻断业务，需监控写入失败率。

## 10. 相关文档

- [配置管理](/backend/02-configuration)
- [接口清单](/backend/11-api-endpoints)
- [缓存策略](/backend/05-caching)
