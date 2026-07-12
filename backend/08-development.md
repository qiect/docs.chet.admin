# 后端开发指南

本指南介绍 Chet.Admin 后端的开发约定与新增业务模块的标准流程。架构分层与配置管理请参考 [后端架构](/backend/01-architecture) 与 [配置管理](/backend/02-configuration)。

## 1. 依赖注入约定

DI 注册通过扩展方法组织，集中在 `Chet.Admin.Api/Configurations/` 目录，每个扩展方法对应一个功能域。

### 1.1 仓储注册（`RepositoryConfiguration.cs`）

```csharp
// 通用仓储
services.AddScoped(typeof(IRepository<>), typeof(EfCoreRepository<>));
// 各模块仓储
services.AddScoped<IUserRepository, UserRepository>();
services.AddScoped<IRoleRepository, RoleRepository>();
```

### 1.2 服务注册（`ServiceConfiguration.cs`）

```csharp
services.AddScoped<IUserService, UserService>();
services.AddScoped<IAuthService, AuthService>();
services.AddScoped<IUnitOfWork, UnitOfWork>();
services.AddSingleton<IOnlineUserService, OnlineUserService>();  // 全局单例
services.AddSingleton<CaptchaService>();
```

> 仓储与服务默认 `Scoped`（每次请求一个实例）；全局状态服务（如在线用户）用 `Singleton`。

## 2. 领域实体规范

### 2.1 BaseEntity 基类

所有实体继承 `BaseEntity`，自动获得基础字段：

```csharp
public abstract class BaseEntity
{
    public int Id { get; set; }            // 主键（自增）
    public DateTime CreatedAt { get; set; } // 创建时间（UTC）
    public DateTime UpdatedAt { get; set; } // 更新时间（UTC）
}
```

### 2.2 实体定义示例

以 `UserEntity` 为例：

```csharp
public class UserEntity : BaseEntity
{
    public string Name { get; set; }
    public string Email { get; set; }        // 唯一约束
    public string PasswordHash { get; set; } // BCrypt 哈希
    public string? RefreshToken { get; set; }
    public DateTime? RefreshTokenExpiryTime { get; set; }
    public string? Avatar { get; set; }
    public int? DepartmentId { get; set; }
    public List<UserRoleEntity> UserRoles { get; set; } = [];
    public int LoginFailCount { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime? PasswordChangedAt { get; set; }
    public bool MustChangePassword { get; set; }
}
```

> 安全提示：包含敏感字段（`PasswordHash`、`RefreshToken`）的实体**禁止直接返回客户端**，必须通过 AutoMapper 映射为 DTO。

## 3. 接口契约规范

接口定义在 `Chet.Admin.Contracts` 项目中，按模块组织：

```
Contracts/
├── IRepository.cs            # 通用仓储接口
├── IUnitOfWork.cs           # 工作单元接口
├── User/
│   ├── IUserRepository.cs   # 用户仓储接口
│   └── IUserService.cs      # 用户服务接口
├── Role/
│   ├── IRoleRepository.cs
│   └── IRoleService.cs
└── ...
```

通用仓储接口：

```csharp
public interface IRepository<T> where T : BaseEntity
{
    Task<T?> GetByIdAsync(int id);
    Task<IEnumerable<T>> GetAllAsync();
    Task AddAsync(T entity);
    void Update(T entity);
    void Remove(T entity);
}
```

工作单元接口：

```csharp
public interface IUnitOfWork
{
    IUserRepository Users { get; }
    IRoleRepository Roles { get; }
    // ... 各模块仓储
    Task<int> SaveChangesAsync();
}
```

## 4. 业务服务规范

服务实现位于 `Chet.Admin.Services`，通过依赖注入获取仓储：

```csharp
public class UserService : IUserService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IPasswordService _passwordService;

    public UserService(IUnitOfWork unitOfWork, IPasswordService passwordService)
    {
        _unitOfWork = unitOfWork;
        _passwordService = passwordService;
    }

    public async Task<UserDto> GetUserByIdAsync(int id)
    {
        var user = await _unitOfWork.Users.GetByIdAsync(id)
            ?? throw new NotFoundException($"User {id} not found");
        return _mapper.Map<UserDto>(user);  // 通过 AutoMapper 转换
    }
}
```

## 5. 控制器规范

控制器位于 `Chet.Admin.Api/Controllers`，遵循 RESTful 风格：

```csharp
[ApiController]
[Route("api/v{version:apiVersion}/[controller]")]  // 统一路由前缀 + 版本
[Authorize]                                          // 默认需要认证
[SwaggerTag("模块描述")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAllUsers()
    {
        var users = await _userService.GetAllUsersAsync();
        return Ok(ApiResponse.Ok(users, "Users retrieved successfully"));
    }
}
```

- 所有响应通过 `ApiResponse` 统一包装
- 使用 `[ProducesResponseType]` 标注响应类型，供 Swagger 生成文档
- 控制器不写业务逻辑，仅转发到 Service

## 6. 新增业务模块流程

以新增「文章管理」模块为例，按层依次添加。

### 6.1 核心层 - 定义实体与接口

```
1. Domain/Article/ArticleEntity.cs       // 实体
2. Contracts/Article/
   ├── IArticleRepository.cs              // 仓储接口
   └── IArticleService.cs                 // 服务接口
```

### 6.2 基础设施层 - 实现数据访问

```
3. Data/Article/
   ├── ArticleConfig.cs                   // EF Core 实体配置
   └── ArticleRepository.cs               // 仓储实现
4. Data/AppDbContext.cs                  // 添加 DbSet<ArticleEntity>
```

EF Core 实体配置示例：

```csharp
public class ArticleConfig : IEntityTypeConfiguration<ArticleEntity>
{
    public void Configure(EntityTypeBuilder<ArticleEntity> builder)
    {
        builder.ToTable("Articles");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Title).HasMaxLength(200).IsRequired();
    }
}
```

### 6.3 应用层 - 实现业务逻辑

```
5. Services/Article/ArticleService.cs     // 服务实现
6. Mapping/Article/MappingProfile.cs      // AutoMapper 配置
```

### 6.4 表示层 - 添加控制器并注册

```
7. Controllers/ArticlesController.cs       // API 控制器
```

注册到 DI 容器：

```csharp
// RepositoryConfiguration.cs
services.AddScoped<IArticleRepository, ArticleRepository>();

// ServiceConfiguration.cs
services.AddScoped<IArticleService, ArticleService>();

// IUnitOfWork.cs（添加仓储属性）
IArticleRepository Articles { get; }

// UnitOfWork.cs（实现属性）
public IArticleRepository Articles => new ArticleRepository(_context);
```

### 6.5 数据库迁移

```bash
cd Chet.Admin.Api
dotnet ef migrations add AddArticles \
  --project ../Chet.Admin.Infrastructure/Chet.Admin.Data \
  --startup-project .
dotnet ef database update \
  --project ../Chet.Admin.Infrastructure/Chet.Admin.Data \
  --startup-project .
```

## 7. 测试规范

### 7.1 单元测试

位于 `Chet.Admin.UnitTests`，使用 xUnit + Moq：

```csharp
public class UserServiceTests
{
    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly UserService _service;

    public UserServiceTests()
    {
        _service = new UserService(_unitOfWork.Object, ...);
    }

    [Fact]
    public async Task GetUserByIdAsync_ExistingUser_ReturnsUserDto()
    {
        // Arrange / Act / Assert
    }
}
```

运行测试：

```bash
# 所有单元测试
dotnet test --filter "Category=Unit" --project Chet.Admin.Tests/Chet.Admin.UnitTests

# 测试覆盖率
dotnet test --collect:"XPlat Code Coverage" --results-directory ./TestResults
```

### 7.2 集成测试

位于 `Chet.Admin.IntegrationTests`，使用 TestServer + In-Memory Database。

## 8. 代码规范

- **命名空间**：PascalCase，与目录结构一致
- **类 / 方法**：PascalCase（方法动词开头）
- **变量**：camelCase
- **异步方法**：以 `Async` 结尾
- **接口**：以 `I` 开头
- 遵循 Microsoft C# 编码约定
