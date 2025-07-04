# Lakutata DTO 和验证

**Lakutata** 是一个基于 IoC（控制反转）的通用应用框架，旨在为 TypeScript 和 Node.js 开发者提供模块化且可扩展的开发体验。在数据处理方面，Lakutata 提供了强大的 **DTO（数据传输对象）** 系统，以促进应用不同层之间的结构化数据传输，通过验证机制确保数据的完整性和一致性。本文档详细解释了 Lakutata 框架中 DTO 的定义、验证功能、核心装饰器以及使用示例。

## 1. DTO 功能概述

**DTO（数据传输对象）** 是一种用于在软件应用子系统之间传输数据的设计模式。在 Lakutata 中，DTO 提供了一种结构化的方法来定义控制器、服务或其他组件之间交换数据的形状，确保跨层通信的清晰性和关注点分离。

### 1.1 DTO 的核心目的
- **数据结构定义**：DTO 定义客户端请求、API 响应或内部服务调用的数据结构。
- **层间解耦**：DTO 有助于将表示层（如 API 控制器）与业务逻辑层（如服务）和数据持久化层（如实体）解耦。
- **验证和约束**：DTO 提供了一个集中点来应用数据验证规则，确保数据在被业务逻辑处理前符合预期。

### 1.2 与 Lakutata 的集成
Lakutata 基于 `DTO` 基类和基于 Joi 的验证库（通过 `VLD` 模块实现）提供了一个全面的 DTO 系统，使开发者能够定义带有验证规则的数据结构。Lakutata 的 IoC 容器进一步支持将 DTO 或相关验证服务注入到组件或控制器中，确保在整个应用中无缝集成。此外，Lakutata 提供了多种装饰器（如 `@Expect`、`@Accept`、`@Return`）来以声明式方式定义验证逻辑。

## 2. 定义 DTO

在 Lakutata 中，DTO 通常定义为继承自 `DTO` 基类的 TypeScript 类，表示预期或返回的数据结构。这些类可以通过装饰器应用验证规则。

### 2.1 基本 DTO 定义
以下是一个简单的 DTO 类示例，表示用户注册数据：

```typescript
import { DTO } from '../../lib/core/DTO.js';

export class UserRegisterDTO extends DTO {
  name: string;
  email: string;
  password: string;
}
```

- **说明**：此 `UserRegisterDTO` 定义了用户注册数据的结构，具有 `name`、`email` 和 `password` 属性。在没有验证规则的情况下，它纯粹作为数据结构使用。

### 2.2 使用验证装饰器增强 DTO
Lakutata 提供了 `@Expect` 装饰器来为 DTO 属性指定验证模式。这些模式使用 `VLD` 模块定义，支持各种数据类型和验证规则。

#### 示例：带有验证的 DTO
```typescript
import { DTO } from '../../lib/core/DTO.js';
import { Expect } from '../../decorators/validation/Expect.js';
import { VLD } from '../../lib/validation/VLD.js';

export class UserRegisterDTO extends DTO {
  @Expect(VLD.string().min(2).max(50))
  name: string;

  @Expect(VLD.string().email())
  email: string;

  @Expect(VLD.string().min(8))
  password: string;
}
```

- **说明**：
  - `@Expect(VLD.string().min(2).max(50))` 确保 `name` 是一个长度在 2 到 50 之间的字符串。
  - `@Expect(VLD.string().email())` 验证 `email` 为有效的电子邮件格式。
  - `@Expect(VLD.string().min(8))` 确保 `password` 是一个最短长度为 8 的字符串。

## 3. DTO 验证机制

验证确保传入数据符合 DTO 中定义的规则。Lakutata 通过 `VLD` 模块（基于 Joi 库）提供底层的验证支持。验证可以在 DTO 实例化时自动触发，也可以在控制器或服务中手动调用。

### 3.1 VLD 验证库
`VLD` 是 Lakutata 中的核心验证模块，扩展自 Joi，提供了广泛的验证能力：
- **模式定义**：支持多种数据类型的模式，如字符串（`string()`）、数字（`number()`）、对象（`object()`）等。
- **自定义规则**：扩展了数值范围验证规则，如 `int8`（值在 -128 到 127 之间）、`uint8`（值在 0 到 255 之间）等。
- **验证方法**：提供同步（`validate`）和异步（`validateAsync`）验证方法，失败时抛出 `InvalidValueException`。
- **默认配置**：默认验证选项包括 `abortEarly: true`（在第一个错误时停止）、`stripUnknown: true`（移除未知字段）等。

### 3.2 手动验证
开发者可以使用 `VLD` 提供的验证方法手动验证 DTO 数据。

#### 示例：手动 DTO 验证
```typescript
import { VLD } from '../../lib/validation/VLD.js';
import { UserRegisterDTO } from './dtos/UserRegisterDTO.js';

export class UserController {
  async register(data: any): Promise<void> {
    // 创建 DTO 实例（假设 DTO 支持直接实例化）
    const dto = new UserRegisterDTO(data);
    
    // 手动验证（取决于 DTO 内部实现）
    try {
      await VLD.validateAsync(dto, VLD.object()); // 假设 DTO 有内部模式定义
      console.log('Validation passed:', dto);
      // 继续业务逻辑
    } catch (error) {
      console.error('Validation failed:', error.message);
      throw new Error('Invalid input data');
    }
  }
}
```

- **说明**：`VLD.validateAsync` 用于验证数据，失败时抛出 `InvalidValueException`，并提供详细的错误信息。

### 3.3 自动验证
在 Lakutata 中，DTO 验证通常由框架内部处理，尤其是在使用 `@Accept` 或 `@Return` 等装饰器时，验证会在方法调用或返回值处理期间自动触发。

## 4. 验证装饰器

Lakutata 提供了多个装饰器，用于在 DTO 类、方法和属性上应用验证规则。

### 4.1 @Expect（属性验证）
`@Expect` 装饰器用于为 DTO 属性指定验证模式。

#### 示例
```typescript
import { DTO } from '../../lib/core/DTO.js';
import { Expect } from '../../decorators/validation/Expect.js';
import { VLD } from '../../lib/validation/VLD.js';

export class UserDTO extends DTO {
  @Expect(VLD.string().min(2).max(50))
  name: string;

  @Expect(VLD.string().email())
  email: string;
}
```

- **说明**：`name` 和 `email` 属性分别通过长度约束和电子邮件格式规则进行验证。

### 4.2 @Accept（方法参数验证）
`@Accept` 装饰器用于验证方法输入参数，支持多个 DTO 或模式作为验证规则。

#### 示例
```typescript
import { Accept } from '../../decorators/validation/Accept.js';
import { UserDTO } from './UserDTO.js';

export class UserController {
  @Accept(UserDTO)
  async register(data: UserDTO): Promise<void> {
    // 数据已通过验证
    console.log('Registering user:', data);
  }
}
```

- **说明**：`register` 方法的参数 `data` 被验证以符合 `UserDTO` 的结构和规则。

### 4.3 @Return（方法返回值验证）
`@Return` 装饰器用于验证方法返回值。

#### 示例
```typescript
import { Return } from '../../decorators/validation/Return.js';
import { UserDTO } from './UserDTO.js';

export class UserService {
  @Return(UserDTO)
  async getUser(): Promise<UserDTO> {
    return new UserDTO({ name: 'John', email: 'john@example.com' });
  }
}
```

- **说明**：`getUser` 方法的返回值被验证以符合 `UserDTO` 的结构和规则。

### 4.4 @IndexSignature（索引签名验证）
`@IndexSignature` 装饰器用于为 DTO 类中的索引签名定义验证规则，适用于具有动态键的对象。

#### 示例
```typescript
import { IndexSignature } from '../../decorators/validation/IndexSignature.js';
import { VLD } from '../../lib/validation/VLD.js';
import { DTO } from '../../lib/core/DTO.js';

@IndexSignature(VLD.string())
export class DynamicDataDTO extends DTO {
  [key: string]: string;
}
```

- **说明**：`DynamicDataDTO` 类允许任何字符串键，但每个键的值必须是字符串。

## 5. 嵌套 DTO 和复杂结构

Lakutata 支持使用 `VLD.object()` 和 `SchemaMap` 类型定义来验证嵌套 DTO 和复杂数据结构。

### 示例：嵌套 DTO
```typescript
import { DTO } from '../../lib/core/DTO.js';
import { Expect } from '../../decorators/validation/Expect.js';
import { VLD } from '../../lib/validation/VLD.js';

export class AddressDTO extends DTO {
  @Expect(VLD.string())
  street: string;

  @Expect(VLD.string())
  city: string;
}

export class UserProfileDTO extends DTO {
  @Expect(VLD.string().min(2))
  name: string;

  @Expect(VLD.string().email())
  email: string;

  @Expect(VLD.object())
  address: AddressDTO;
}
```

- **说明**：`UserProfileDTO` 包含一个嵌套的 `address` 属性，类型为 `AddressDTO`，验证会递归检查嵌套对象的属性。

## 6. 在控制器和服务中使用 DTO

DTO 在 Lakutata 中常用于控制器和服务中，以定义输入和输出数据的结构。

### 6.1 在控制器中使用 DTO
控制器通常接收原始数据（例如来自 HTTP 请求的 JSON），并将其映射到 DTO 进行验证。

#### 示例：控制器中的 DTO
```typescript
import { Controller } from '../../lib/core/Controller.js';
import { Accept } from '../../decorators/validation/Accept.js';
import { UserRegisterDTO } from './dtos/UserRegisterDTO.js';
import { UserService } from './UserService.js';
import { Inject } from '../../decorators/di/Inject.js';

@Controller()
export class UserController {
  @Inject('userService')
  protected readonly userService: UserService;

  @Accept(UserRegisterDTO)
  async register(dto: UserRegisterDTO): Promise<any> {
    // DTO 已通过验证
    return await this.userService.registerUser(dto);
  }
}
```

- **说明**：控制器使用 `@Accept` 装饰器验证传入的 `dto` 符合 `UserRegisterDTO`，然后将其传递给服务。

### 6.2 在服务中使用 DTO
服务可以使用 DTO 确保接收或返回的数据符合特定结构。

#### 示例：服务中的 DTO
```typescript
import { Component } from '../../lib/core/Component.js';
import { UserRegisterDTO } from './dtos/UserRegisterDTO.js';
import { User } from './entities/User.js';

@Component()
export class UserService {
  async registerUser(dto: UserRegisterDTO): Promise<User> {
    // 从 DTO 创建用户实体
    const user = new User();
    user.name = dto.name;
    user.email = dto.email;
    // 应用业务逻辑，例如密码哈希
    user.passwordHash = this.hashPassword(dto.password);
    
    // 保存到数据库（假设注入了存储库）
    return await this.userRepository.save(user);
  }

  private hashPassword(password: string): string {
    // 密码哈希逻辑的占位符
    return `hashed_${password}`;
  }
}
```

- **说明**：`UserService` 接收一个已验证的 `UserRegisterDTO`，并使用其属性创建 `User` 实体，应用必要的业务逻辑。

## 7. DTO 和验证的最佳实践

- **保持 DTO 专注**：为特定用例定义 DTO（例如 `UserRegisterDTO`、`UserUpdateDTO`），而不是为多个用途重用单个 DTO，确保清晰性和可维护性。
- **声明式验证**：优先使用装饰器（例如 `@Expect`、`@Accept`）定义验证规则，保持代码简洁。
- **处理复杂数据**：对复杂数据结构使用嵌套 DTO 和 `VLD.object()`，确保验证覆盖所有层次。
- **优雅处理错误**：捕获 `InvalidValueException` 并向客户端提供用户友好的错误消息。
- **性能考虑**：在高流量端点中避免过于复杂的验证规则，以减少性能开销。

## 总结

Lakutata 通过 `DTO` 基类、`VLD` 验证库和一组验证装饰器（`@Expect`、`@Accept`、`@Return`、`@IndexSignature`）提供了强大的 DTO 和验证功能。开发者可以轻松定义带有验证规则的数据结构，并将其应用于属性、方法参数和返回值，确保跨应用层的数据完整性和一致性。结合 Lakutata 的 IoC 容器，DTO 和验证逻辑可以无缝集成到组件、控制器和服务中，增强了应用模块化和可维护性。

有关 Lakutata 其他功能的详细信息，请参阅相关文档章节。