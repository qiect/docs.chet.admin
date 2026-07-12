# 测试策略

## 1. 测试概述

Chet.Admin 测试代码位于 `Chet.Admin.Tests/` 解决方案目录下，按测试粒度分为两个独立项目：

| 项目 | 路径 | 粒度 | 依赖策略 |
|------|------|------|----------|
| `Chet.Admin.UnitTests` | `Chet.Admin.Tests/Chet.Admin.UnitTests/` | 单元测试 | Moq 模拟所有依赖 |
| `Chet.Admin.IntegrationTests` | `Chet.Admin.Tests/Chet.Admin.IntegrationTests/` | 集成测试 | EF Core InMemory + 真实服务注册 |

**测试框架与依赖**（基于 `.csproj` 实际引用）：

- 测试框架：**xUnit** `2.9.2`（`xunit` + `xunit.runner.visualstudio`）
- 测试 SDK：`Microsoft.NET.Test.Sdk` `17.12.0`
- 覆盖率采集：`coverlet.collector` `6.0.2`
- 单元测试 Mock：`Moq` `4.20.72`
- 集成测试 Web 适配：`Microsoft.AspNetCore.Mvc.Testing` `9.0.0`
- 集成测试数据库：`Microsoft.EntityFrameworkCore.InMemory` `9.0.0`
- 目标框架：`net10.0`

两个项目均通过 `<Using Include="Xunit" />` 全局引入 xUnit 命名空间，使用 `[Fact]` 特性标记测试方法。

## 2. 测试项目结构

测试项目按测试类型分目录组织，测试类以被测类名 + `Tests` 后缀命名：

```
Chet.Admin.Tests/
├── Chet.Admin.UnitTests/              # 单元测试（隔离依赖）
│   ├── Chet.Admin.UnitTests.csproj
│   └── UserServiceTests.cs            # UserService 单元测试
└── Chet.Admin.IntegrationTests/       # 集成测试（真实依赖链）
    ├── Chet.Admin.IntegrationTests.csproj
    └── UserServiceIntegrationTests.cs # UserService 集成测试
```

单元测试项目引用 Application、Core、Caching 层；集成测试项目额外引用 `Chet.Admin.Api` 与 `Chet.Admin.Data`，以构建完整的服务链路。

## 3. 单元测试：Service 层 + Moq

`UserServiceTests` 以 `UserService` 为被测对象，使用 Moq 模拟全部协作依赖：`IUserRepository`、`IUnitOfWork`、`ICacheService`、`IPasswordService`、`IDataScopeService`、`IMapper`、`ILogger`。在构造函数中统一初始化 Mock 与被测实例：

```csharp
public UserServiceTests()
{
    _mockUserRepository = new Mock<IUserRepository>();
    _mockUnitOfWork = new Mock<IUnitOfWork>();
    _mockCacheService = new Mock<ICacheService>();
    _mockPasswordService = new Mock<IPasswordService>();
    _mockMapper = new Mock<IMapper>();
    _mockLogger = new Mock<ILogger<UserService>>();
    var mockDataScopeService = new Mock<IDataScopeService>();

    _userService = new UserService(
        _mockUserRepository.Object,
        _mockUnitOfWork.Object,
        _mockCacheService.Object,
        _mockPasswordService.Object,
        mockDataScopeService.Object,
        _mockMapper.Object,
        _mockLogger.Object);
}
```

缓存由于使用 `GetOrCreateAsync`（接受工厂函数），Mock 需配置为直接执行工厂方法以触达真实仓储逻辑：

```csharp
_mockCacheService.Setup(x => x.GetOrCreateAsync(
        It.IsAny<string>(),
        It.IsAny<Func<Task<UserDto>>>(),
        It.IsAny<TimeSpan>()))
    .Returns<string, Func<Task<UserDto>>, TimeSpan>((key, factory, expiry) => factory());
```

测试方法示例（验证有效 ID 返回用户、写操作清除缓存）：

```csharp
[Fact]
public async Task GetUserByIdAsync_WithValidId_ReturnsUserDto()
{
    var userId = 1;
    var userEntity = new UserEntity { Id = userId, Name = "Test User", Email = "test@example.com" };
    var expectedUserDto = new UserDto { Id = userId, Name = "Test User", Email = "test@example.com",
        CreatedAt = DateTime.Now, UpdatedAt = DateTime.Now };

    _mockUserRepository.Setup(x => x.GetByIdAsync(userId)).ReturnsAsync(userEntity);
    _mockMapper.Setup(x => x.Map<UserDto>(userEntity)).Returns(expectedUserDto);

    var result = await _userService.GetUserByIdAsync(userId);

    Assert.Equal(expectedUserDto.Id, result.Id);
    _mockUserRepository.Verify(x => x.GetByIdAsync(userId), Times.Once);
}

[Fact]
public async Task DeleteUserAsync_WithValidId_DeletesUser()
{
    var userId = 1;
    var existingUser = new UserEntity { Id = userId, Name = "User to Delete", Email = "delete@example.com" };

    _mockUserRepository.Setup(x => x.GetByIdAsync(userId)).ReturnsAsync(existingUser);
    _mockUserRepository.Setup(x => x.Delete(existingUser));
    _mockUserRepository.Setup(x => x.SaveChangesAsync()).ReturnsAsync(1);
    _mockCacheService.Setup(x => x.RemoveAsync(CacheKeys.Users.ById(userId))).Returns(Task.CompletedTask);
    _mockCacheService.Setup(x => x.RemoveByPatternAsync(CacheKeys.Users.Pattern)).Returns(Task.CompletedTask);

    await _userService.DeleteUserAsync(userId);

    _mockUserRepository.Verify(x => x.Delete(existingUser), Times.Once);
    _mockCacheService.Verify(x => x.RemoveAsync(CacheKeys.Users.ById(userId)), Times.Once);
    _mockCacheService.Verify(x => x.RemoveByPatternAsync(CacheKeys.Users.Pattern), Times.Once);
}
```

## 4. 集成测试：DI 容器 + InMemory 数据库

集成测试项目引用了 `Microsoft.AspNetCore.Mvc.Testing` 包以支持 Web 服务器集成测试能力。当前 `UserServiceIntegrationTests` 采用**手动构建 `ServiceCollection`** 的轻量方式，注册真实服务链路并用 EF Core **InMemory** 数据库隔离持久化，无需启动完整 Web 服务器：

```csharp
public UserServiceIntegrationTests()
{
    var services = new ServiceCollection();

    // 每个测试使用唯一数据库名称，保证用例隔离
    services.AddDbContext<AppDbContext>(options =>
        options.UseInMemoryDatabase(Guid.NewGuid().ToString()));

    services.AddScoped<IUserRepository, UserRepository>();
    services.AddScoped<IUserService, UserService>();
    services.AddScoped<IPasswordService, PasswordService>();
    services.AddAutoMapper(typeof(MappingProfile));
    services.AddLogging(builder => builder.AddConsole());
    // 使用 NoOp 缓存，避免真实缓存干扰测试
    services.AddSingleton<ICacheService, NoOpCacheService>();

    _serviceProvider = services.BuildServiceProvider();
    _dbContext = _serviceProvider.GetRequiredService<AppDbContext>();
    _userService = _serviceProvider.GetRequiredService<IUserService>();
    _userRepository = _serviceProvider.GetRequiredService<IUserRepository>();
}
```

测试类实现 `IDisposable`，在 `Dispose` 中释放 `DbContext` 与 `ServiceProvider`，保证资源清理。集成测试使用真实仓储、真实映射、真实密码服务（BCrypt），验证服务与 EF Core 的端到端协作：

```csharp
[Fact]
public async Task CreateUserAsync_WithValidData_CreatesUser()
{
    // Arrange
    var userCreateDto = new UserCreateDto
    {
        Name = "New User", Email = "newuser@example.com", Password = "password123"
    };

    // Act
    var result = await _userService.CreateUserAsync(userCreateDto);

    // Assert
    Assert.NotNull(result);
    Assert.Equal(userCreateDto.Name, result.Name);

    var savedUser = await _userRepository.GetByIdAsync(result.Id);
    Assert.NotNull(savedUser);
    Assert.Equal(userCreateDto.Email, savedUser.Email);
}
```

> 说明：测试项目在本地定义了测试专用的 `NoOpCacheService`，确保缓存不干扰集成验证。后续若需端到端 HTTP 测试，可基于已引用的 `Microsoft.AspNetCore.Mvc.Testing` 包使用 `WebApplicationFactory` 启动测试服务器。

## 5. 测试约定

### 5.1 命名规范

测试方法采用 `MethodName_StateUnderTest_ExpectedBehavior` 三段式命名，清晰表达被测方法、前置条件与预期结果：

- `GetUserByIdAsync_WithValidId_ReturnsUserDto`
- `GetUserByIdAsync_WithInvalidId_ThrowsNotFoundException`
- `CreateUserAsync_WithValidData_CreatesAndReturnsUser`
- `UpdateUserAsync_WithNonExistingUser_ThrowsNotFoundException`

### 5.2 AAA 模式

集成测试严格遵循 Arrange-Act-Assert 三段结构，并以注释标注：

```csharp
// Arrange - 准备测试数据
var user = new UserEntity { Name = "Original Name", Email = "original@example.com",
    PasswordHash = BCrypt.Net.BCrypt.HashPassword("password") };
await _dbContext.Users.AddAsync(user);
await _dbContext.SaveChangesAsync();

// Act - 执行被测方法
await _userService.UpdateUserAsync(user.Id, userUpdateDto);

// Assert - 验证结果
var updatedUser = await _userRepository.GetByIdAsync(user.Id);
Assert.Equal(userUpdateDto.Name, updatedUser.Name);
```

### 5.3 用例隔离

- 单元测试通过 Moq 隔离依赖，每个 `[Fact]` 独立构造 Mock。
- 集成测试通过 `Guid.NewGuid().ToString()` 为每个测试分配独立 InMemory 数据库，避免数据串扰。

## 6. 测试覆盖范围

当前已覆盖 `UserService` 的核心业务逻辑：

| 分类 | 覆盖场景 |
|------|----------|
| 查询 | 有效 ID 返回用户、无效 ID 抛出 `NotFoundException`、获取全部用户列表 |
| 创建 | 有效数据创建用户并返回 DTO、缓存失效 |
| 更新 | 有效数据更新用户、更新不存在用户抛出异常、缓存失效 |
| 删除 | 有效 ID 删除用户、删除不存在用户抛出异常、缓存失效 |
| 缓存协作 | 验证写操作触发 `RemoveAsync` / `RemoveByPatternAsync` |

推荐扩展覆盖方向：

- **Controller API 层**：基于 `WebApplicationFactory` 启动测试服务器，验证 HTTP 状态码、响应结构与路由。
- **权限校验**：验证 `[Authorize]` 特性与匿名访问拦截。
- **数据权限过滤**：验证 `IDataScopeService` 对查询结果的作用域限制。
- **Service 层其他模块**：角色、菜单、部门、字典等服务的 CRUD 与边界条件。

## 7. 运行测试

### 命令行

```bash
# 运行全部测试
dotnet test

# 运行指定项目
dotnet test Chet.Admin.Tests/Chet.Admin.UnitTests
dotnet test Chet.Admin.Tests/Chet.Admin.IntegrationTests

# 生成覆盖率报告（coverlet.collector）
dotnet test --collect:"XPlat Code Coverage"
```

### CI 集成建议

- 在 CI 流水线（GitHub Actions / GitLab CI）的构建阶段执行 `dotnet test`，失败即阻断合并。
- 启用覆盖率采集，设置最低覆盖率阈值（建议核心 Service 层 ≥ 70%）。
- 集成测试依赖 InMemory，无需外部数据库，适合在 CI 容器中快速执行。

## 8. 测试数据与初始化

### 种子数据

集成测试在测试方法内直接通过 `_dbContext.Users.AddAsync` 构造种子数据，密码使用 `BCrypt.Net.BCrypt.HashPassword` 生成真实哈希，确保经过 `PasswordService` 的业务逻辑：

```csharp
var user = new UserEntity
{
    Name = "Test User",
    Email = "test@example.com",
    PasswordHash = BCrypt.Net.BCrypt.HashPassword("password")
};
await _dbContext.Users.AddAsync(user);
await _dbContext.SaveChangesAsync();
```

### 资源清理

`UserServiceIntegrationTests` 实现 `IDisposable`，在每个测试结束后释放数据库上下文与服务容器：

```csharp
public void Dispose()
{
    _dbContext?.Dispose();
    _serviceProvider?.Dispose();
}
```

> InMemory 数据库随 `DbContext` 释放而被回收，配合每个测试的唯一数据库名称，实现零残留的测试隔离。

## 9. 相关文档

- [开发指南](/backend/08-development)
- [架构概览](/backend/01-architecture)
- [缓存策略](/backend/05-caching)
