# 配置管理

## 1. 配置概述

Chet.Admin 采用 .NET 10 内置的 Configuration 系统，通过 `appsettings.json` + 强类型模型（`AppSettings`）管理应用配置。支持多环境配置、环境变量覆盖与命令行参数。

配置在 `Program.cs` 启动时一次性读取并注册为单例：

```csharp
var appSettings = builder.Configuration.GetSection("AppSettings").Get<AppSettings>();
builder.Services.AddSingleton(appSettings!);
```

各功能域通过依赖注入获取 `AppSettings`，而非直接访问 `IConfiguration`。

## 2. 配置源与优先级

.NET Configuration 按以下优先级加载（高优先级覆盖低优先级）：

1. 命令行参数（最高）
2. 环境变量
3. `appsettings.{Environment}.json`（如 `appsettings.Development.json`）
4. `appsettings.json`（默认）
5. `appsettings.{Environment}.json`（环境特定）

> 通过环境变量覆盖时，层级用双下划线 `__` 分隔，例如 `AppSettings__Jwt__SecretKey`。

## 3. appsettings.json 完整结构

以下是 `Chet.Admin.Api/Chet.Admin.Api/appsettings.json` 的实际配置结构：

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Data Source=Chet.Admin.db"
  },
  "AppSettings": {
    "Jwt": {
      "Enabled": true,
      "SecretKey": "YourSecretKeyForJWTAuthentication1234567890",
      "Issuer": "Chet.Admin",
      "Audience": "Chet.Admin",
      "AccessTokenExpirationInMinutes": 30,
      "RefreshTokenExpirationDays": 7
    },
    "Redis": {
      "Enabled": false,
      "ConnectionString": "localhost:6379",
      "InstanceName": "ChetAdmin:"
    },
    "PasswordPolicy": {
      "ExpirationDays": 90,
      "MinLength": 6,
      "RequireUppercase": false,
      "RequireLowercase": false,
      "RequireDigit": false,
      "RequireSpecialChar": false
    }
  },
  "Cors": {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:5173"
    ]
  },
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
  },
  "AllowedHosts": "*"
}
```

## 4. 强类型配置模型

配置模型位于 `Chet.Admin.Infrastructure/Chet.Admin.Configuration/AppSettings.cs`，与 JSON 结构一一对应。

### 4.1 AppSettings 根模型

```csharp
public class AppSettings
{
    public string? ConnectionStrings { get; set; }
    public JwtSettings? Jwt { get; set; }
    public RedisSettings? Redis { get; set; }
    public PasswordPolicySettings? PasswordPolicy { get; set; }
}
```

### 4.2 JwtSettings

```csharp
public class JwtSettings
{
    public bool Enabled { get; set; } = true;
    public string? Key { get; set; }
    public string? SecretKey { get; set; }
    public string? Issuer { get; set; }
    public string? Audience { get; set; }
    public int AccessTokenExpirationMinutes { get; set; }
    public int RefreshTokenExpirationDays { get; set; }
}
```

### 4.3 RedisSettings

```csharp
public class RedisSettings
{
    public bool Enabled { get; set; } = true;
    public string? ConnectionString { get; set; }
    public string? InstanceName { get; set; }
}
```

### 4.4 PasswordPolicySettings

```csharp
public class PasswordPolicySettings
{
    public int ExpirationDays { get; set; } = 90;
    public int MinLength { get; set; } = 6;
    public bool RequireUppercase { get; set; } = false;
    public bool RequireLowercase { get; set; } = false;
    public bool RequireDigit { get; set; } = false;
    public bool RequireSpecialChar { get; set; } = false;
}
```

## 5. 配置项详解

### 5.1 数据库连接

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `ConnectionStrings.DefaultConnection` | `Data Source=Chet.Admin.db` | SQLite 连接串（开发） |

生产环境切换 PostgreSQL 时，将连接串改为 `Host=...;Database=chet_admin;Username=...;Password=...`，并在 `DatabaseConfiguration.cs` 中将 `UseSqlite` 替换为 `UseNpgsql`。

### 5.2 JWT 配置

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `AppSettings.Jwt.Enabled` | `true` | 是否启用 JWT 认证 |
| `AppSettings.Jwt.SecretKey` | 内置默认值 | **生产环境必须修改**，建议 32 位以上 |
| `AppSettings.Jwt.Issuer` | `Chet.Admin` | 令牌发行者 |
| `AppSettings.Jwt.Audience` | `Chet.Admin` | 令牌受众 |
| `AppSettings.Jwt.AccessTokenExpirationInMinutes` | `30` | Access Token 有效期（分钟） |
| `AppSettings.Jwt.RefreshTokenExpirationDays` | `7` | Refresh Token 有效期（天） |

### 5.3 Redis 配置

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `AppSettings.Redis.Enabled` | `false` | 是否启用 Redis |
| `AppSettings.Redis.ConnectionString` | `localhost:6379` | Redis 连接串 |
| `AppSettings.Redis.InstanceName` | `ChetAdmin:` | 缓存键前缀 |

> Redis 不可用时，`RedisConfiguration` 会自动降级为 `NoOpCacheService`，不影响系统运行。

### 5.4 密码策略

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `AppSettings.PasswordPolicy.ExpirationDays` | `90` | 密码过期天数，0 表示不过期 |
| `AppSettings.PasswordPolicy.MinLength` | `6` | 密码最小长度 |
| `AppSettings.PasswordPolicy.RequireUppercase` | `false` | 是否要求大写字母 |
| `AppSettings.PasswordPolicy.RequireLowercase` | `false` | 是否要求小写字母 |
| `AppSettings.PasswordPolicy.RequireDigit` | `false` | 是否要求数字 |
| `AppSettings.PasswordPolicy.RequireSpecialChar` | `false` | 是否要求特殊字符 |

### 5.5 CORS 配置

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `Cors.AllowedOrigins` | `localhost:3000/5173` | 允许的跨域来源列表 |

生产环境需在此配置实际前端域名。

### 5.6 Serilog 日志

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `Serilog.MinimumLevel.Default` | `Information` | 默认日志级别 |
| `Serilog.WriteTo[0].Args.path` | `logs/log-.txt` | 日志文件路径（按天滚动） |
| `Serilog.WriteTo[0].Args.retainedFileCountLimit` | `7` | 保留日志文件数 |
| `Serilog.WriteTo[0].Args.fileSizeLimitBytes` | `52428800` | 单文件大小上限（50MB） |

## 6. 环境变量覆盖（Docker / CI 友好）

部署时通过环境变量覆盖配置，层级用双下划线 `__` 分隔：

```bash
# 数据库连接
ConnectionStrings__DefaultConnection=Data Source=/data/Chet.Admin.db

# JWT 密钥（生产环境必须修改）
AppSettings__Jwt__SecretKey=YourVeryStrongSecretKeyHere
AppSettings__Jwt__Issuer=Chet.Admin
AppSettings__Jwt__AccessTokenExpirationInMinutes=30

# 启用 Redis
AppSettings__Redis__Enabled=true
AppSettings__Redis__ConnectionString=redis:6379
AppSettings__Redis__InstanceName=ChetAdmin:

# 密码策略
AppSettings__PasswordPolicy__MinLength=8
AppSettings__PasswordPolicy__RequireUppercase=true
```

## 7. 多环境配置

| 文件 | 用途 |
| ---- | ---- |
| `appsettings.json` | 公共默认配置 |
| `appsettings.Development.json` | 开发环境覆盖（开发端口、调试日志级别） |
| `appsettings.Production.json` | 生产环境覆盖（生产密钥、数据库、CORS） |

环境由 `ASPNETCORE_ENVIRONMENT` 环境变量决定（`Development` / `Production`），`launchSettings.json` 默认配置为 `Development`。

## 8. 生产环境配置清单

部署前逐项确认：

- [ ] 修改 `AppSettings.Jwt.SecretKey` 为 32 位以上强随机字符串
- [ ] 设置 `ASPNETCORE_ENVIRONMENT=Production`（关闭 Swagger）
- [ ] 切换数据库连接为 PostgreSQL
- [ ] 启用 Redis：`AppSettings.Redis.Enabled=true`
- [ ] 配置 `Cors.AllowedOrigins` 为实际前端域名
- [ ] 调整 `Serilog` 日志级别与保留策略
- [ ] 修改默认管理员密码 `admin@example.com`
