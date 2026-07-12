# 缓存策略

## 1. 缓存架构概述

Chet.Admin 采用**双缓存策略**提升系统性能与可用性：

- **Redis 分布式缓存**：基于 StackExchange.Redis，用于跨实例共享的业务数据缓存（用户信息、权限等），支持集群部署。
- **MemoryCache 本地缓存**：基于 `Microsoft.Extensions.Caching.Memory`，用于短期、单实例数据（验证码）。
- **NoOp 降级实现**：当 Redis 未启用或不可用时，自动切换为空操作实现，保证系统在无 Redis 环境下仍可运行。

缓存抽象层位于 `Chet.Admin.Contracts/Cache/ICacheService.cs`，具体实现位于 `Chet.Admin.Infrastructure/Chet.Admin.Caching/`。在 `Program.cs` 中通过 `ConfigureRedis` 完成注册：

```csharp
builder.Services.ConfigureRedis(appSettings);
// 内存缓存（验证码等）
builder.Services.AddMemoryCache();
```

## 2. 缓存抽象：ICacheService 接口

`ICacheService` 定义统一的缓存操作契约，采用策略模式，可在运行时通过依赖注入切换实现。接口定义如下：

```csharp
public interface ICacheService
{
    Task<T> GetAsync<T>(string key);
    Task SetAsync<T>(string key, T value, TimeSpan? expiry = null);
    Task RemoveAsync(string key);
    Task RemoveByPatternAsync(string pattern);
    Task<bool> ExistsAsync(string key);
    Task<string[]> GetKeysByPatternAsync(string pattern);
    Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> factory, TimeSpan? expiry = null);
    Task<bool> PingAsync();
}
```

各方法职责：

| 方法 | 说明 |
|------|------|
| `GetAsync` | 异步获取缓存值，未命中返回 `default` |
| `SetAsync` | 写入缓存，可指定过期时间 |
| `RemoveAsync` | 移除指定键 |
| `RemoveByPatternAsync` | 按通配符模式批量删除（如 `user:*`） |
| `ExistsAsync` | 检查键是否存在 |
| `GetKeysByPatternAsync` | 获取匹配模式的键数组 |
| `GetOrCreateAsync` | Cache-Aside 模式：未命中则调用工厂方法加载并写入 |
| `PingAsync` | 健康检查，验证缓存连接可用性 |

## 3. Redis 实现：RedisCacheService

`RedisCacheService` 基于 `StackExchange.Redis` 实现，核心要点：

- **连接复用**：通过 DI 注入单例 `IConnectionMultiplexer`，避免频繁创建连接。
- **JSON 序列化**：使用 `System.Text.Json` 序列化/反序列化，安全且高效。
- **异常降级**：所有方法包裹 try-catch，Redis 故障时记录日志并返回安全默认值，不影响主业务。

关键代码示例：

```csharp
public class RedisCacheService : ICacheService
{
    private readonly IDatabase _database;
    private readonly ILogger<RedisCacheService> _logger;

    public RedisCacheService(IConnectionMultiplexer connectionMultiplexer,
        ILogger<RedisCacheService> logger)
    {
        _database = connectionMultiplexer.GetDatabase();
        _logger = logger;
    }

    public async Task<T> GetAsync<T>(string key)
    {
        try
        {
            var value = await _database.StringGetAsync(key);
            if (value.IsNull) return default;
            return JsonSerializer.Deserialize<T>(value.ToString());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting value from Redis cache for key: {Key}", key);
            return default;
        }
    }
}
```

`GetOrCreateAsync` 实现经典的 Cache-Aside 模式：先查缓存，未命中则执行工厂方法并回写：

```csharp
public async Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> factory, TimeSpan? expiry = null)
{
    var value = await GetAsync<T>(key);
    if (value != null) return value;

    value = await factory();
    if (value != null) await SetAsync(key, value, expiry);
    return value;
}
```

`PingAsync` 通过 PING 命令检测连通性（响应时间小于 5 秒视为健康），供健康检查端点使用。

## 4. NoOp 降级实现：NoOpCacheService

`NoOpCacheService` 是空操作实现，所有方法立即返回默认值，不与任何缓存后端交互：

- `GetAsync` → 返回 `default(T)`
- `SetAsync` / `RemoveAsync` / `RemoveByPatternAsync` → 返回 `Task.CompletedTask`
- `ExistsAsync` → 返回 `false`
- `GetKeysByPatternAsync` → 返回空数组
- `GetOrCreateAsync` → 始终调用工厂方法（保证业务逻辑仍可执行，仅失去缓存加速）
- `PingAsync` → 始终返回 `true`

该实现保证系统在开发环境、单元测试或 Redis 不可用时仍可正常运行，所有方法调用会记录 Debug 日志便于追踪。

## 5. Redis 配置注册：RedisConfiguration

`Chet.Admin.Api/Configurations/RedisConfiguration.cs` 根据配置动态选择注册的实现：

```csharp
public static void ConfigureRedis(this IServiceCollection services, AppSettings appSettings)
{
    if (appSettings?.Redis != null && appSettings.Redis.Enabled)
    {
        services.AddScoped<ICacheService, RedisCacheService>();
    }
    else
    {
        services.AddScoped<ICacheService, NoOpCacheService>();
    }

    if (appSettings?.Redis != null && appSettings.Redis.Enabled)
    {
        var redisConnectionString = appSettings.Redis.ConnectionString ?? "localhost:6379";
        var configurationOptions = ConfigurationOptions.Parse(redisConnectionString);
        configurationOptions.AbortOnConnectFail = false;
        services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(configurationOptions));
    }
}
```

要点说明：

- `ICacheService` 注册为 **Scoped** 生命周期。
- `IConnectionMultiplexer` 注册为 **Singleton**，全程复用连接。
- `AbortOnConnectFail = false`：Redis 连接失败时不中断应用启动，配合 NoOp 降级保证可用性。

## 6. MemoryCache 使用场景

短期、单实例数据使用 `IMemoryCache`，不经过 `ICacheService` 抽象。

### 6.1 验证码服务（CaptchaService）

`Chet.Admin.Services/Auth/CaptchaService.cs` 使用 `IMemoryCache` 存储验证码，5 分钟过期，验证后立即失效：

```csharp
public (string Id, string Code) Generate()
{
    var id = Guid.NewGuid().ToString("N");
    var code = new string(Enumerable.Range(0, 4)
        .Select(_ => Chars[_random.Next(Chars.Length)]).ToArray());
    _cache.Set($"captcha:{id}", code, TimeSpan.FromMinutes(5));
    return (id, code);
}

public bool Validate(string id, string code)
{
    if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(code)) return false;
    var cacheKey = $"captcha:{id}";
    if (_cache.TryGetValue(cacheKey, out string? cachedCode))
    {
        _cache.Remove(cacheKey); // 验证码使用后即失效
        return string.Equals(cachedCode, code, StringComparison.OrdinalIgnoreCase);
    }
    return false;
}
```

### 6.2 在线用户追踪（OnlineUserService）

`OnlineUserService` 使用静态 `ConcurrentDictionary` 维护在线用户列表与令牌黑名单（用于强制下线），数据仅存于当前进程内存：

```csharp
private static readonly ConcurrentDictionary<int, OnlineUserDto> _onlineUsers = new();
private static readonly ConcurrentDictionary<int, DateTime> _revokedUsers = new();
```

在线用户列表自动清理超过 30 分钟未活动的记录；令牌黑名单条目保留 2 小时后自动清理。

## 7. 缓存键规范

`Chet.Admin.Shared/Caching/CacheKeys.cs` 集中管理缓存键，采用层级结构：`{Prefix}:{Module}:{Entity}:{Identifier}`。

```csharp
public static class CacheKeys
{
    private const string Prefix = "ChetApp:";
    private const string Separator = ":";

    public static class Expiry
    {
        public static TimeSpan Short => TimeSpan.FromMinutes(5);     // 实时性高
        public static TimeSpan Medium => TimeSpan.FromMinutes(30);   // 一般业务
        public static TimeSpan Long => TimeSpan.FromHours(2);        // 变化较少
        public static TimeSpan VeryLong => TimeSpan.FromDays(1);     // 几乎不变
    }

    public static class Users
    {
        public static readonly string Pattern = $"{Prefix}users:*";
        public static string ById(int id) => $"{Prefix}users:{id}";
        public static string All() => $"{Prefix}users:all";
    }

    public static class Auth
    {
        public static string TokenBlacklist(string tokenHash) => $"{Prefix}auth:blacklist:{tokenHash}";
        public static string UserPermissions(int userId) => $"{Prefix}auth:permissions:{userId}";
    }
}
```

### 实际使用示例（UserService）

```csharp
// 读取：未命中则从仓储加载并写入缓存（30 分钟过期）
return await _cacheService.GetOrCreateAsync(
    CacheKeys.Users.ById(id),
    async () => _mapper.Map<UserDto>(await _userRepository.GetByIdAsync(id)),
    CacheKeys.Expiry.Medium);

// 写操作后失效缓存
await _cacheService.RemoveAsync(CacheKeys.Users.ById(id));
await _cacheService.RemoveByPatternAsync(CacheKeys.Users.Pattern);
```

## 8. Redis 配置项

`AppSettings.Redis` 对应 `appsettings.json` 中的 `AppSettings.Redis` 段：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `Enabled` | bool | `false` | 是否启用 Redis 缓存，关闭时使用 NoOp |
| `ConnectionString` | string | `localhost:6379` | Redis 连接字符串 |
| `InstanceName` | string | `ChetAdmin:` | 实例名前缀，用于多应用隔离 |

```json
"Redis": {
  "Enabled": false,
  "ConnectionString": "localhost:6379",
  "InstanceName": "ChetAdmin:"
}
```

> 默认 `Enabled: false`，便于本地开发零依赖启动；生产环境应设置为 `true`。

## 9. 生产建议

- **启用 Redis**：生产环境将 `Enabled` 设为 `true`，并配置可用的 `ConnectionString`（含密码、TLS）。
- **实例隔离**：通过 `InstanceName` 前缀区分不同应用/环境，避免共享 Redis 时键冲突。
- **连接容错**：保持 `AbortOnConnectFail = false`，配合 NoOp 降级，避免 Redis 抖动导致应用启动失败。
- **合理设置过期时间**：参照 `CacheKeys.Expiry` 分级，避免缓存雪崩与内存膨胀。
- **监控命中率**：通过 `HealthController` 的 `PingAsync` 健康检查监控 Redis 连通性，关注缓存命中率与延迟。
- **写后失效**：所有写操作必须调用 `RemoveAsync` / `RemoveByPatternAsync` 清除相关缓存，保证数据一致性。

## 10. 相关文档

- [配置管理](/backend/02-configuration)
- [安全设计](/backend/04-security)
- [开发指南](/backend/08-development)
