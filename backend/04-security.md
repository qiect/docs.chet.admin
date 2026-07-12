# 后端安全设计

## 一、安全设计概述

Chet.Admin 后端基于 .NET 10 + ASP.NET Core 构建企业级 RBAC 权限管理系统，安全设计围绕以下几个核心维度展开：

| 维度 | 实现组件 | 作用 |
| ---- | ---- | ---- |
| 身份认证 | `JwtConfiguration`、`JwtService` | JWT 双令牌（Access Token + Refresh Token）签发、验证、刷新 |
| 密码安全 | `PasswordService` | BCrypt 哈希（工作因子 12），恒定时间比较 |
| 登录保护 | `AuthController`、`CaptchaService` | 失败锁定、密码过期强制改密、图形验证码 |
| 令牌吊销 | `IOnlineUserService` | 基于 `nbf` 的黑名单机制，支持强制下线 |
| 请求限流 | `RateLimitingMiddleware` | 登录/注册接口 IP 维度滑动窗口限流 |
| 跨域控制 | `CorsConfiguration` | 白名单源、凭据、预检缓存 |
| 配置体系 | `AppSettings` 强类型模型 | JWT、密码策略、CORS 等集中配置 |

所有时间计算统一使用 UTC，避免跨时区不一致问题。

## 二、JWT 双令牌认证

系统采用 Access Token + Refresh Token 双令牌机制。Access Token 短期有效（默认 30 分钟），用于 API 调用认证；Refresh Token 长期有效（默认 7 天），用于无感续期。

### 2.1 Access Token 签发

`JwtService.GenerateAccessTokenAsync` 负责签发，使用 HMAC-SHA256 对称签名：

```csharp
public async Task<string> GenerateAccessTokenAsync(UserEntity user)
{
    var claims = new List<Claim>
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),     // 用户ID
        new Claim(JwtRegisteredClaimNames.Email, user.Email),           // 邮箱
        new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()), // 唯一标识，防重放
        new Claim(ClaimTypes.Name, user.Name),                          // 用户名，供审计读取
    };

    // 注入角色 Claims
    var roles = await _roleRepository.GetRolesByUserIdAsync(user.Id);
    foreach (var role in roles)
        claims.Add(new Claim(ClaimTypes.Role, role.Code));

    // 注入权限码 Claims
    var permissions = await _menuRepository.GetPermissionCodesByUserIdAsync(user.Id);
    foreach (var permission in permissions)
        claims.Add(new Claim("permission", permission));

    var jwtSettings = _appSettings.Jwt ?? new JwtSettings();
    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SecretKey ?? "DefaultJwtSecretKeyForJWTAuthentication1234567890"));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

    var token = new JwtSecurityToken(
        issuer: jwtSettings.Issuer,
        audience: jwtSettings.Audience,
        claims: claims,
        notBefore: DateTime.UtcNow,   // 生效时间（UTC），供黑名单比较
        expires: DateTime.UtcNow.AddMinutes(jwtSettings.AccessTokenExpirationMinutes > 0 ? jwtSettings.AccessTokenExpirationMinutes : 30),
        signingCredentials: creds);

    return new JwtSecurityTokenHandler().WriteToken(token);
}
```

声明（Claims）说明：

| 声明类型 | 字段 | 用途 |
| ---- | ---- | ---- |
| `Sub` | 用户 ID | 标识用户身份，刷新令牌时从中提取 |
| `Email` | 邮箱 | 用户邮箱 |
| `Jti` | GUID | 令牌唯一标识，防止重放攻击 |
| `ClaimTypes.Name` | 用户名 | 审计中间件读取 |
| `ClaimTypes.Role` | 角色编码 | 授权校验 |
| `permission` | 权限码 | 细粒度权限校验 |

### 2.2 Refresh Token 签发

Refresh Token 使用密码学安全伪随机数生成器（CSPRNG）生成 32 字节随机数，再 Base64 编码：

```csharp
public string GenerateRefreshToken()
{
    var randomNumber = new byte[32];
    using (var rng = RandomNumberGenerator.Create())
    {
        rng.GetBytes(randomNumber);
        return Convert.ToBase64String(randomNumber);
    }
}
```

登录成功后，Refresh Token 持久化到 `UserEntity.RefreshToken` 字段，过期时间写入 `RefreshTokenExpiryTime`：

```csharp
// AuthService.LoginAsync
var accessToken = await _jwtService.GenerateAccessTokenAsync(user);
var refreshToken = _jwtService.GenerateRefreshToken();

user.RefreshToken = refreshToken;
user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(_appSettings.Jwt?.RefreshTokenExpirationDays ?? 7);
```

### 2.3 令牌刷新（Refresh Token Rotation）

`JwtService.RefreshTokenAsync` 实现令牌刷新流程，采用 Rotation 机制——每次刷新都签发全新的令牌对，旧 Refresh Token 立即失效：

```csharp
public async Task<JwtTokenDto> RefreshTokenAsync(string accessToken, string refreshToken)
{
    // 1. 从（可能已过期的）Access Token 解析用户身份，仅校验签名不校验过期
    ClaimsPrincipal principal;
    try
    {
        principal = GetPrincipalFromExpiredToken(accessToken);
    }
    catch (SecurityTokenException)
    {
        throw new SecurityTokenException("Invalid access token");
    }

    // 2. 提取用户 ID
    var subClaim = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
    if (string.IsNullOrEmpty(subClaim) || !int.TryParse(subClaim, out var userId) || userId <= 0)
        throw new SecurityTokenException("Invalid access token");

    // 3. 校验 Refresh Token：用户存在 / 匹配 / 未过期
    var user = await _userRepository.GetByIdAsync(userId);
    if (user == null) throw new SecurityTokenException("User not found");
    if (user.RefreshToken != refreshToken) throw new SecurityTokenException("Invalid refresh token");
    if (user.RefreshTokenExpiryTime < DateTime.UtcNow) throw new SecurityTokenException("Refresh token expired");

    // 4. 签发新令牌对并持久化（旧 Refresh Token 被覆盖失效）
    var newAccessToken = await GenerateAccessTokenAsync(user);
    var newRefreshToken = GenerateRefreshToken();

    user.RefreshToken = newRefreshToken;
    user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(jwtSettings.RefreshTokenExpirationDays > 0 ? jwtSettings.RefreshTokenExpirationDays : 7);
    _userRepository.Update(user);
    await _userRepository.SaveChangesAsync();

    return new JwtTokenDto { AccessToken = newAccessToken, RefreshToken = newRefreshToken };
}
```

`GetPrincipalFromExpiredToken` 在解析时设置 `ValidateLifetime = false`，仅验证签名与算法，确保从过期令牌中恢复用户身份：

```csharp
var tokenValidationParameters = new TokenValidationParameters
{
    ValidateAudience = false,
    ValidateIssuer = false,
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SecretKey ?? "...")),
    ValidateLifetime = false  // 不校验过期时间
};
// 同时校验算法必须为 HmacSha256，防止算法降级攻击
```

Rotation 的安全意义：即使 Refresh Token 被窃取，攻击者最多使用一次即被替换，无法长期滥用。

### 2.4 令牌验证与吊销

`JwtConfiguration.ConfigureJwt` 注册 JwtBearer 认证，验证参数四项全开：

```csharp
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidateAudience = true,
    ValidateLifetime = true,
    ValidateIssuerSigningKey = true,
    ValidIssuer = appSettings.Jwt.Issuer,
    ValidAudience = appSettings.Jwt.Audience,
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(appSettings.Jwt.SecretKey ?? "DefaultJwtSecretKey"))
};
```

**令牌吊销（强制下线黑名单）** 在 `OnTokenValidated` 事件中检查。JWT 本身无状态，签发后无法撤回，系统通过比较令牌签发时间与吊销时间实现强制下线：

```csharp
OnTokenValidated = context =>
{
    var jwtToken = context.SecurityToken as JwtSecurityToken;
    if (jwtToken == null) return Task.CompletedTask;

    var userIdClaim = context.Principal?.FindFirst(ClaimTypes.NameIdentifier)
                  ?? context.Principal?.FindFirst(JwtRegisteredClaimNames.Sub);
    if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out var userId))
        return Task.CompletedTask;

    var onlineUserService = context.HttpContext.RequestServices.GetService<IOnlineUserService>();
    if (onlineUserService == null) return Task.CompletedTask;

    // 令牌签发时间早于吊销时间 → 已被吊销，拒绝
    if (onlineUserService.IsTokenRevoked(userId, jwtToken.ValidFrom))
    {
        context.Fail("Token has been revoked");
    }
    return Task.CompletedTask;
}
```

`IOnlineUserService.IsTokenRevoked` 的判定逻辑：令牌的 `nbf`（ValidFrom）早于吊销时间则拒绝，晚于则放行（即重新登录签发的新令牌不受影响）。黑名单条目保留 2 小时后自动清理。

**401 响应处理** 统一在 `OnChallenge` 事件中返回结构化 JSON，根据失败原因区分提示：

```csharp
OnChallenge = context =>
{
    context.HandleResponse();
    context.Response.StatusCode = 401;
    context.Response.ContentType = "application/json";

    var message = "未授权访问，请先登录";
    if (context.AuthenticateFailure is SecurityTokenExpiredException)
        message = "登录已过期，请重新登录";
    else if (context.AuthenticateFailure is SecurityTokenException)
        message = "认证失败，请重新登录";

    var response = new { success = false, message, statusCode = 401 };
    return context.Response.WriteAsJsonAsync(response);
}
```

### 2.5 注销机制

`AuthController.Logout` 调用 `IOnlineUserService.UserOffline` 移除在线记录。JWT 无状态特性决定了令牌本身在过期前仍技术有效，强制下线需通过上述黑名单机制（管理员操作）实现：

```csharp
[HttpPost("logout")]
[Authorize]
public async Task<IActionResult> Logout()
{
    var userId = GetUserId();
    _onlineUserService.UserOffline(userId);
    return Ok(ApiResponse.Ok(null, "Logout successful"));
}
```

### 2.6 JWT 禁用降级

当 `AppSettings.Jwt.Enabled = false` 时，注册 `AllowAllAuthenticationHandler` 放行所有请求，供开发调试使用：

```csharp
services.AddAuthentication(options => { options.DefaultScheme = "AllowAll"; })
    .AddScheme<AuthenticationSchemeOptions, AllowAllAuthenticationHandler>("AllowAll", null);
```

该 Handler 构造一个包含 `Anonymous` 名称、`Guest` 角色的默认身份。生产环境必须启用 JWT。

## 三、密码安全

### 3.1 BCrypt 哈希

`PasswordService` 使用 BCrypt 算法，工作因子（Work Factor）固定为 12（2^12 = 4096 轮迭代）：

```csharp
public class PasswordService : IPasswordService
{
    private const int WorkFactor = 12;

    public string Hash(string password)
    {
        if (string.IsNullOrWhiteSpace(password))
            throw new ArgumentException("Password cannot be empty", nameof(password));
        if (password.Length < 6)
            throw new ArgumentException("Password must be at least 6 characters", nameof(password));

        return global::BCrypt.Net.BCrypt.HashPassword(password, WorkFactor);
    }

    public bool Verify(string password, string hash)
    {
        if (string.IsNullOrWhiteSpace(password) || string.IsNullOrWhiteSpace(hash))
            return false;
        try
        {
            return global::BCrypt.Net.BCrypt.Verify(password, hash);
        }
        catch
        {
            return false;  // 异常不泄露信息，统一返回 false
        }
    }
}
```

安全特性：

| 特性 | 说明 |
| ---- | ---- |
| 内置盐值 | 每次哈希自动生成唯一盐值，无需单独管理，抵御彩虹表攻击 |
| 自适应工作因子 | 值越大计算越慢，可随硬件升级提升，当前 12 约需 250ms |
| 恒定时间比较 | BCrypt 内置，防时序攻击（Timing Attack） |
| 异常静默 | `Verify` 捕获所有异常返回 false，防止通过异常行为推断信息 |
| 哈希格式 | `$2a$12$...`，60 字符，含版本标识、工作因子、盐值与哈希结果 |

注册时哈希存储，登录时 `AuthService.LoginAsync` 调用 `Verify` 比对：

```csharp
// 注册
user.PasswordHash = _passwordService.Hash(registerDto.Password);
user.PasswordChangedAt = DateTime.UtcNow;
user.MustChangePassword = false;

// 登录校验
if (user == null || !_passwordService.Verify(loginDto.Password, user.PasswordHash))
    throw new UnauthorizedAccessException("Invalid email or password");
```

### 3.2 密码策略配置

密码策略通过 `AppSettings.PasswordPolicy`（类型 `PasswordPolicySettings`）配置，强类型模型定义于 `Chet.Admin.Configuration` 命名空间：

```csharp
public class PasswordPolicySettings
{
    public int ExpirationDays { get; set; } = 90;          // 密码过期天数，0 表示不过期
    public int MinLength { get; set; } = 6;                // 密码最小长度
    public bool RequireUppercase { get; set; } = false;    // 是否要求包含大写字母
    public bool RequireLowercase { get; set; } = false;    // 是否要求包含小写字母
    public bool RequireDigit { get; set; } = false;        // 是否要求包含数字
    public bool RequireSpecialChar { get; set; } = false;  // 是否要求包含特殊字符
}
```

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `ExpirationDays` | 90 | 密码过期天数，超过后登录时标记需强制改密 |
| `MinLength` | 6 | 密码最小长度（`PasswordService.Hash` 亦硬编码 6 位下限） |
| `RequireUppercase` | false | 是否必须包含大写字母 |
| `RequireLowercase` | false | 是否必须包含小写字母 |
| `RequireDigit` | false | 是否必须包含数字 |
| `RequireSpecialChar` | false | 是否必须包含特殊字符 |

## 四、登录保护

### 4.1 登录失败锁定

`AuthController.Login` 实现账号锁定策略，常量定义：

```csharp
private const int MaxLoginFailCount = 5;   // 最多连续失败 5 次
private const int LockoutMinutes = 15;     // 锁定 15 分钟
```

锁定状态基于 `UserEntity` 的两个字段持久化到数据库，重启不丢失：

- `LoginFailCount`：连续登录失败次数
- `LockedUntil`：锁定截止时间（UTC）

登录流程核心逻辑：

```csharp
[HttpPost("login")]
public async Task<IActionResult> Login([FromBody] LoginDto loginDto)
{
    var user = await _unitOfWork.Users.GetByEmailAsync(loginDto.Email);

    // 1. 检查锁定状态：未到解锁时间则拒绝
    if (user != null && user.LockedUntil.HasValue && user.LockedUntil.Value > DateTime.UtcNow)
    {
        var remaining = user.LockedUntil.Value - DateTime.UtcNow;
        return Ok(ApiResponse.Error($"账号已锁定，请在 {Math.Ceiling(remaining.TotalMinutes)} 分钟后重试", StatusCodes.Status400BadRequest));
    }

    // 2. 锁定时间已过，重置失败计数
    if (user != null && user.LockedUntil.HasValue && user.LockedUntil.Value <= DateTime.UtcNow)
    {
        user.LoginFailCount = 0;
        user.LockedUntil = null;
        _unitOfWork.Users.Update(user);
        await _unitOfWork.SaveChangesAsync();
    }

    try
    {
        var token = await _authService.LoginAsync(loginDto);

        // 3. 登录成功，重置失败计数并标记在线
        if (user != null)
        {
            user.LoginFailCount = 0;
            user.LockedUntil = null;
            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync();
            _onlineUserService.UserOnline(user.Id, user.Name, clientIp);
        }
        // ... 密码过期检查 ...
        return Ok(/* 令牌对 */);
    }
    catch (UnauthorizedAccessException)
    {
        // 4. 登录失败，累加失败计数，达到阈值则锁定
        if (user != null)
        {
            user.LoginFailCount++;
            if (user.LoginFailCount >= MaxLoginFailCount)
            {
                user.LockedUntil = DateTime.UtcNow.AddMinutes(LockoutMinutes);
                _logger.LogWarning("Account locked for user: {Email} until {LockedUntil}", user.Email, user.LockedUntil);
            }
            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync();
        }
        return Ok(ApiResponse.Error(/* 锁定或密码错误提示 */));
    }
}
```

锁定流程：

```
登录失败 → LoginFailCount +1 → Count >= 5? ─ 是 → 设置 LockedUntil = Now + 15min
                                      │
                                      否
                                      │
                                 返回"邮箱或密码错误"
```

设计要点：失败计数持久化到数据库；锁定时间过后下次登录自动重置；所有时间使用 UTC。

### 4.2 强制改密

强制改密由两种情况触发：

1. **管理员显式标记**：`UserEntity.MustChangePassword = true`
2. **密码过期策略**：登录时检查 `PasswordChangedAt` 距今天数是否超过 `PasswordPolicy.ExpirationDays`

```csharp
var passwordPolicy = _appSettings?.PasswordPolicy;
var mustChangePassword = user?.MustChangePassword ?? false;

if (!mustChangePassword && passwordPolicy?.ExpirationDays > 0 && user?.PasswordChangedAt.HasValue == true)
{
    var daysSinceChange = (DateTime.UtcNow - user.PasswordChangedAt.Value).TotalDays;
    if (daysSinceChange > passwordPolicy.ExpirationDays)
    {
        mustChangePassword = true;
    }
}
```

登录响应 `LoginResponseDto` 携带 `MustChangePassword` 标志，前端据此跳转强制改密页面。改密通过专用接口 `PUT /auth/force-change-password` 完成，该接口要求 `Authorize`，DTO 强制新密码至少 6 位：

```csharp
[HttpPut("force-change-password")]
[Authorize]
public async Task<IActionResult> ForceChangePassword([FromBody] ForceChangePasswordDto dto)
{
    var userId = GetUserId();
    await _userService.ChangePasswordAsync(userId, dto.OldPassword, dto.NewPassword);
    return Ok(ApiResponse.Ok(null, "Password changed successfully"));
}
```

### 4.3 图形验证码

`CaptchaService` 基于内存缓存实现图形验证码，注册为单例：

```csharp
public class CaptchaService
{
    private readonly IMemoryCache _cache;
    private static readonly Random _random = new();
    // 排除易混淆字符（0/O、1/I/l 等）
    private const string Chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

    public (string Id, string Code) Generate()
    {
        var id = Guid.NewGuid().ToString("N");
        var code = new string(Enumerable.Range(0, 4).Select(_ => Chars[_random.Next(Chars.Length)]).ToArray());
        _cache.Set($"captcha:{id}", code, TimeSpan.FromMinutes(5));  // 5 分钟有效
        return (id, code);
    }

    public bool Validate(string id, string code)
    {
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(code)) return false;
        var cacheKey = $"captcha:{id}";
        if (_cache.TryGetValue(cacheKey, out string? cachedCode))
        {
            _cache.Remove(cacheKey);  // 一次性使用，验证后立即失效
            return string.Equals(cachedCode, code, StringComparison.OrdinalIgnoreCase);
        }
        return false;
    }
}
```

`GET /auth/captcha` 返回 SVG 格式验证码（含噪点、字符旋转、随机颜色），响应包含验证码 ID 与 SVG 内容。验证码特性：

| 特性 | 说明 |
| ---- | ---- |
| 字符集 | 排除 `0`/`O`/`1`/`I`/`l` 等易混淆字符 |
| 长度 | 4 位 |
| 有效期 | 5 分钟 |
| 一次性 | 验证后立即从缓存移除，不可重放 |
| 大小写 | 校验时忽略大小写 |

> 说明：`CaptchaService` 的 `Generate`/`Validate` 已完整实现，`AuthController.Login` 当前未在校验流程中调用 `Validate`，验证码强制校验尚未接入登录主流程。

## 五、请求限流

`RateLimitingMiddleware` 基于客户端 IP 对登录、注册接口实施滑动窗口限流，防止暴力破解与接口滥用。

### 5.1 限流规则

| 端点匹配 | 限制 | 时间窗口 |
| ---- | ---- | ---- |
| 路径含 `/login` | 5 次 | 60 秒 |
| 路径含 `/register` | 10 次 | 60 秒 |

仅对包含 `/login` 或 `/register` 的路径生效，其他请求直接放行。

### 5.2 实现机制

使用 `ConcurrentDictionary` 保证线程安全，键为 `IP:路径`，值为 `(计数, 窗口起始时间)`：

```csharp
private static readonly ConcurrentDictionary<string, (int Count, DateTime WindowStart)> _requestLog = new();

// 定时清理过期记录，每 5 分钟执行一次，防止内存泄漏
private static readonly Timer _cleanupTimer = new(
    CleanupExpiredRecords, null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

public async Task InvokeAsync(HttpContext context)
{
    var path = context.Request.Path.Value?.ToLowerInvariant() ?? string.Empty;
    if (!path.Contains("/login") && !path.Contains("/register"))
    {
        await _next(context);
        return;
    }

    var clientIp = GetClientIpAddress(context);
    var key = $"{clientIp}:{path}";
    var now = DateTime.UtcNow;  // UTC 计算
    var windowMinutes = 1;
    var maxRequestsPerWindow = path.Contains("/login") ? 5 : 10;

    _requestLog.AddOrUpdate(key,
        addValue: (1, now),
        updateValueFactory: (_, existing) =>
            (now - existing.WindowStart).TotalMinutes < windowMinutes
                ? (existing.Count + 1, existing.WindowStart)  // 窗口内累加
                : (1, now));                                   // 窗口过期，重置

    if (_requestLog.TryGetValue(key, out var record) && record.Count > maxRequestsPerWindow)
    {
        _logger.LogWarning("Rate limit exceeded for {ClientIp} on {Path}. Count: {Count}, Max: {Max}",
            clientIp, path, record.Count, maxRequestsPerWindow);

        context.Response.StatusCode = (int)HttpStatusCode.TooManyRequests;  // 429
        context.Response.Headers["Retry-After"] = (60 - (int)(now - record.WindowStart).TotalSeconds).ToString();
        await context.Response.WriteAsJsonAsync(ApiResponse.Error("请求过于频繁，请稍后再试", 429));
        return;
    }

    await _next(context);
}
```

超限响应：HTTP 429 + `Retry-After` 头（建议等待秒数）+ 结构化错误体。

### 5.3 客户端 IP 获取

按以下优先级解析真实客户端 IP，适配反向代理部署：

```csharp
private static string GetClientIpAddress(HttpContext context)
{
    // 1. X-Forwarded-For（标准反向代理头，取第一个有效 IP）
    var forwardedFor = context.Request.Headers["X-Forwarded-For"].FirstOrDefault();
    if (!string.IsNullOrEmpty(forwardedFor))
        return forwardedFor.Split(',')[0].Trim();

    // 2. X-Real-Ip（Nginx 常用）
    var realIp = context.Request.Headers["X-Real-Ip"].FirstOrDefault();
    if (!string.IsNullOrEmpty(realIp))
        return realIp.Trim();

    // 3. TCP 连接直接远程 IP（无代理场景）
    return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}
```

部署在 Nginx、CloudFlare 等反向代理后时，必须配置代理正确传递这些头部，否则所有请求会被视为同一 IP。

### 5.4 内存清理

定时器每 5 分钟清理窗口起始时间超过 5 分钟的记录，避免内存无限增长：

```csharp
private static void CleanupExpiredRecords(object? state)
{
    var cutoffTime = DateTime.UtcNow.AddMinutes(-5);
    foreach (var key in _requestLog.Keys
        .Where(k => _requestLog.TryGetValue(k, out var record) && record.WindowStart < cutoffTime).ToList())
    {
        _requestLog.TryRemove(key, out _);
    }
}
```

中间件通过 `app.UseRateLimiting()` 扩展方法注册，推荐位于 `UseCors` 之后、`UseAuthentication` 之前。

## 六、CORS 跨域策略

`CorsConfiguration` 配置名为 `DefaultPolicy` 的跨域策略，从 `Cors:AllowedOrigins` 读取允许的源列表：

```csharp
public static void ConfigureCors(this IServiceCollection services, IConfiguration configuration)
{
    var allowedOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
        ?? ["http://localhost:3000", "http://localhost:5173"];

    services.AddCors(options =>
    {
        options.AddPolicy("DefaultPolicy", policy =>
        {
            policy.WithOrigins(allowedOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials()
                .SetPreflightMaxAge(TimeSpan.FromHours(1));
        });
    });
}
```

策略特性：

| 配置项 | 说明 |
| ---- | ---- |
| `WithOrigins` | 仅允许配置的白名单源，未配置时默认 `localhost:3000`、`localhost:5173` |
| `AllowAnyHeader` | 允许所有请求头（`Content-Type`、`Authorization` 等） |
| `AllowAnyMethod` | 允许所有 HTTP 方法（GET、POST、PUT、DELETE 等） |
| `AllowCredentials` | 允许携带凭据（Cookie、Authorization 头） |
| `SetPreflightMaxAge` | 预检请求缓存 1 小时，减少 OPTIONS 请求 |

中间件注册：`app.UseCors("DefaultPolicy")`，须位于 `UseAuthorization` 之前。生产环境须将 `AllowedOrigins` 限定为实际前端域名。

## 七、安全配置项

### 7.1 配置结构

`appsettings.json` 中与安全相关的配置结构如下：

```json
{
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
  }
}
```

### 7.2 强类型配置模型

配置映射到 `Chet.Admin.Configuration` 命名空间下的强类型模型，定义于 `Chet.Admin.Infrastructure` 项目的 `AppSettings.cs`：

```csharp
public class AppSettings
{
    public string? ConnectionStrings { get; set; }
    public JwtSettings? Jwt { get; set; }
    public RedisSettings? Redis { get; set; }
    public PasswordPolicySettings? PasswordPolicy { get; set; }
}

public class JwtSettings
{
    public bool Enabled { get; set; } = true;
    public string? Key { get; set; }
    public string? SecretKey { get; set; }       // 实际使用字段
    public string? Issuer { get; set; }
    public string? Audience { get; set; }
    public int AccessTokenExpirationMinutes { get; set; }   // 访问令牌过期（分钟）
    public int RefreshTokenExpirationDays { get; set; }     // 刷新令牌过期（天）
}

public class RedisSettings
{
    public bool Enabled { get; set; } = true;
    public string? ConnectionString { get; set; }
    public string? InstanceName { get; set; }
}
```

JWT 配置项说明：

| 属性 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `Enabled` | bool | true | 是否启用 JWT 认证；false 时降级为 `AllowAllAuthenticationHandler` |
| `SecretKey` | string | 内置开发密钥 | HMAC-SHA256 签名密钥，生产环境必须替换 |
| `Issuer` | string | - | 令牌发行者 |
| `Audience` | string | - | 令牌受众 |
| `AccessTokenExpirationMinutes` | int | 30（代码兜底） | Access Token 有效期，<=0 时回退 30 分钟 |
| `RefreshTokenExpirationDays` | int | 7（代码兜底） | Refresh Token 有效期，<=0 时回退 7 天 |

> 配置绑定为大小写不敏感，但配置键名需与属性名匹配。`JwtSettings.AccessTokenExpirationMinutes` 为代码实际读取的属性，`JwtService` 在该值不大于 0 时回退到 30 分钟。

### 7.3 安全配置注意事项

- **`SecretKey` 必须替换**：内置默认密钥仅用于开发，生产环境须使用 32 字节以上的强随机字符串，并通过环境变量或密钥管理服务注入。
- **`Jwt.Enabled = false` 仅限开发**：禁用后所有请求以 `Guest` 身份放行，生产环境必须为 true。
- **`Cors.AllowedOrigins` 须收窄**：生产环境仅允许实际前端域名，不要使用通配。
- **`PasswordPolicy` 按需增强**：默认策略较宽松（仅 6 位下限、无字符类型要求），高安全场景应开启 `RequireUppercase`/`RequireDigit`/`RequireSpecialChar` 并提升 `MinLength`。
