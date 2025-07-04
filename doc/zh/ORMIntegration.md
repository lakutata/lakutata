# Lakutata ORM 集成

**Lakutata** 是一个基于 IoC（控制反转）的通用应用框架，旨在为 TypeScript 和 Node.js 开发者提供模块化且可扩展的开发体验。在数据库操作方面，Lakutata 集成了 **TypeORM**（一个强大的对象关系映射库），提供了无缝的数据库访问和管理能力。本文档详细解释了 Lakutata 框架中的 ORM 集成特性、配置方法、核心装饰器以及使用示例。

## 1. ORM 集成概述

Lakutata 选择 TypeORM 作为主要的 ORM 解决方案，因为 TypeORM 支持多种数据库（包括 MySQL、PostgreSQL、SQLite、MongoDB 等），并与 TypeScript 深度集成，允许通过装饰器和类定义数据库模型。Lakutata 封装并导出了 TypeORM 的功能，使开发者能够在框架内无缝定义实体、执行数据库操作和管理关系。

### 1.1 核心特性
- **实体定义**：使用装饰器（如 `@Entity`）将 TypeScript 类映射到数据库表或视图。
- **列和关系管理**：支持多种列类型（如 `@Column`、`@PrimaryGeneratedColumn`）和关系定义（如 `@OneToMany`、`@ManyToOne`）。
- **树结构支持**：使用 TypeORM 的树结构装饰器（如 `@Tree`、`@TreeChildren`）实现嵌套集或闭包表等层次数据管理。
- **数据库操作**：通过 TypeORM 的 `Repository` 和 `EntityManager` 提供 CRUD 操作、查询构建和事务管理。
- **多数据库支持**：允许多个数据库实例的配置和连接，适用于复杂的应用场景。
- **IoC 容器集成**：Lakutata 提供了作为组件或提供者的 `Database` 类，通过 IoC 容器实现数据库连接和实体管理的依赖注入，简化配置和生命周期管理。

### 1.2 集成方式
Lakutata 将 TypeORM 集成作为可选依赖，允许开发者使用提供的 `Database` 类（实现为组件或提供者）配置数据库连接，并在应用启动时初始化。Lakutata 还导出了 TypeORM 装饰器（如 `Entity`、`Column`），方便访问，无需直接导入 TypeORM 库。

### 1.3 提供的数据库类
Lakutata 提供了两个版本的 `Database` 类，适用于不同的注入场景：
- **Database 组件（单例）**：以单例模式运行，适用于在整个应用中共享单个数据库连接实例。用 `@Singleton()` 装饰器定义，其生命周期与应用一致。
- **Database 提供者（瞬态）**：以瞬态模式运行，每次请求创建一个新实例，适用于需要独立数据库连接的场景。用 `@Transient()` 装饰器定义。

两个版本都支持通过 `@Configurable()` 装饰器注入数据库连接选项（`options`），提供者版本还额外支持配置实体列表（`entities`）。

## 2. 配置 ORM 连接

在 Lakutata 中，ORM 连接通常通过应用配置或组件定义。开发者需要在 `Application.run()` 方法中指定数据库连接参数，并通过 IoC 容器管理数据库服务。Lakutata 提供了 `BuildDatabaseOptions` 方法来简化数据库连接选项的构建。

### 2.1 数据库连接配置
以下是一个典型的数据库连接配置示例，展示如何在 Lakutata 应用中使用 `Database` 组件初始化 TypeORM：

```typescript
import { Application } from '../lib/core/Application.js';
import { BuildDatabaseOptions } from '../components/Database.js';

// 定义数据库连接配置
Application.run(() => ({
  id: 'test.app',
  name: 'TestApp',
  timezone: 'auto',
  components: {
    db: BuildDatabaseOptions({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',
      password: 'password',
      database: 'test_db',
      entities: [__dirname + '/entities/*.js'],
      synchronize: true // 仅用于开发环境；生产环境应设置为 false
    })
  },
  bootstrap: ['db']
}));
```

- **说明**：`BuildDatabaseOptions` 方法构建数据库连接选项并将其注册为 `db` 组件。设置 `synchronize: true` 启用自动数据库模式同步，仅适用于开发环境。`Database` 组件根据提供的 `options` 初始化 TypeORM 的 `DataSource`。

### 2.2 使用提供者版本
对于需要瞬态数据库连接的场景，可以使用 `Database` 提供者版本：

```typescript
import { Application } from '../lib/core/Application.js';
import { BuildDatabaseOptions } from '../providers/Database.js';

// 定义数据库连接配置
Application.run(() => ({
  id: 'test.app',
  name: 'TestApp',
  timezone: 'auto',
  providers: {
    transientDb: BuildDatabaseOptions({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'password',
      database: 'test_db',
      entities: [__dirname + '/entities/*.js'],
      synchronize: true
    })
  }
}));
```

- **说明**：`Database` 提供者以瞬态模式运行，每次请求 `transientDb` 时创建一个新的数据库连接实例，适用于需要独立连接的场景。

### 2.3 通过 IoC 容器注入
Lakutata 的 IoC 容器支持将数据库连接或 `Repository` 实例注入到组件或控制器中，简化数据库访问：

```typescript
import { Component } from '../../lib/core/Component.js';
import { Inject } from '../../decorators/di/Inject.js';
import { Repository } from 'typeorm';
import { User } from './entities/User.js';
import { Database } from '../../components/Database.js';

export class UserService extends Component {
  @Inject('db')
  protected readonly db: Database;

  protected userRepository: Repository<User>;

  protected async init(): Promise<void> {
    this.userRepository = this.db.getRepository(User);
    console.log('UserService initialized with repository');
  }

  public async getAllUsers(): Promise<User[]> {
    return this.userRepository.find();
  }
}
```

- **说明**：`UserService` 通过 `@Inject` 装饰器获取数据库组件，并提取 `User` 实体的 `Repository`，便于后续数据库操作。

## 3. 实体和装饰器

Lakutata 集成了 TypeORM 装饰器，用于定义数据库实体、列、关系等。以下是常用的装饰器及其功能。

### 3.1 实体相关装饰器
- **`@Entity()`**：将类标记为数据库实体，映射到数据库表。
- **`@ViewEntity()`**：将类标记为视图实体，映射到数据库视图。
- **`@Unique()`**：在字段或字段组合上定义唯一约束。

### 3.2 列相关装饰器
- **`@Column()`**：在实体中定义列，指定数据类型和属性（如 `type: 'varchar', length: 255`）。
- **`@PrimaryColumn()`**：定义主键列。
- **`@PrimaryGeneratedColumn()`**：定义自动生成的主键列（如自增 ID）。
- **`@CreateDateColumn()`**：定义创建日期列，自动记录实体创建时间。
- **`@UpdateDateColumn()`**：定义更新日期列，自动记录实体更新时间。
- **`@VersionColumn()`**：定义版本列，用于乐观锁。
- **`@ViewColumn()`**：定义视图列，适用于视图实体。
- **`@VirtualColumn()`**：定义虚拟列，不存储在数据库中，但可在查询中使用。

### 3.3 关系相关装饰器
- **`@OneToOne()`**：定义一对一关系。
- **`@OneToMany()`**：定义一对多关系。
- **`@ManyToOne()`**：定义多对一关系。
- **`@ManyToMany()`**：定义多对多关系。

### 3.4 树结构相关装饰器
Lakutata 支持 TypeORM 的树结构功能，用于实现嵌套集或闭包表的层次数据：
- **`@Tree()`**：将实体标记为树结构实体。
- **`@TreeChildren()`**：定义树结构的子节点属性。
- **`@TreeParent()`**：定义树结构的父节点属性。
- **`@TreeLevelColumn()`**：定义树结构中的级别列，记录节点级别。

### 3.5 实体定义示例
以下是一个简单的实体定义示例，展示 TypeORM 装饰器的使用：

```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Post } from './Post.js';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];
}
```

- **说明**：`User` 实体定义了一个自增主键 `id`，普通列 `name` 和 `email`（`email` 具有唯一约束），自动时间戳 `createdAt` 和 `updatedAt`，以及与 `Post` 实体的一对多关系。

## 4. 数据库操作

Lakutata 通过 `Database` 类全面支持 TypeORM 的数据库操作，包括 CRUD 操作、查询构建、事务管理和迁移操作。

### 4.1 CRUD 操作
使用 `Repository`，可以轻松实现基本的创建、读取、更新和删除操作：

```typescript
import { Component } from '../../lib/core/Component.js';
import { Inject } from '../../decorators/di/Inject.js';
import { Repository } from 'typeorm';
import { User } from './entities/User.js';
import { Database } from '../../components/Database.js';

export class UserService extends Component {
  @Inject('db')
  protected readonly db: Database;

  protected userRepository: Repository<User>;

  protected async init(): Promise<void> {
    this.userRepository = this.db.getRepository(User);
    console.log('UserService initialized with repository');
  }

  // 创建用户
  public async createUser(name: string, email: string): Promise<User> {
    const user = this.userRepository.create({ name, email });
    return await this.userRepository.save(user);
  }

  // 获取所有用户
  public async getAllUsers(): Promise<User[]> {
    return await this.userRepository.find();
  }

  // 根据 ID 获取用户
  public async getUserById(id: number): Promise<User | null> {
    return await this.userRepository.findOneBy({ id });
  }

  // 更新用户
  public async updateUser(id: number, name: string): Promise<User | null> {
    const user = await this.userRepository.findOneBy({ id });
    if (user) {
      user.name = name;
      return await this.userRepository.save(user);
    }
    return null;
  }

  // 删除用户
  public async deleteUser(id: number): Promise<boolean> {
    const result = await this.userRepository.delete(id);
    return result.affected > 0;
  }
}
```

- **说明**：`UserService` 为 `User` 实体提供了基本操作，包括创建、获取、更新和删除。

### 4.2 复杂查询
`Database` 类提供了 `createQueryBuilder` 方法，支持复杂查询条件：

```typescript
public async findUsersByName(name: string): Promise<User[]> {
  return await this.db
    .createQueryBuilder(User, 'user')
    .where('user.name LIKE :name', { name: `%${name}%` })
    .orderBy('user.createdAt', 'DESC')
    .getMany();
}
```

- **说明**：上述方法使用查询构建器查找名称包含指定字符串的用户，并按创建时间降序排列。

### 4.3 事务管理
`Database` 类支持事务，确保数据操作的原子性：

```typescript
public async createUserWithPost(name: string, email: string, postTitle: string): Promise<User> {
  return await this.db.transaction(async (entityManager) => {
    const user = await entityManager.save(User, { name, email });
    await entityManager.save(Post, { title: postTitle, author: user });
    return user;
  });
}
```

- **说明**：在事务中创建用户及其关联的帖子，确保两个操作要么都成功，要么都失败。

### 4.4 数据库迁移和同步
`Database` 类提供了数据库模式同步和迁移管理的方法：

```typescript
public async syncDatabaseSchema(dropBeforeSync: boolean = false): Promise<void> {
  await this.db.synchronize(dropBeforeSync);
  console.log('Database schema synchronized');
}

public async runDatabaseMigrations(): Promise<void> {
  const migrations = await this.db.runMigrations({ transaction: 'all' });
  console.log('Migrations run:', migrations);
}

public async undoLastMigration(): Promise<void> {
  await this.db.undoLastMigration({ transaction: 'all' });
  console.log('Last migration undone');
}
```

- **说明**：`synchronize` 方法同步数据库模式，而 `runMigrations` 和 `undoLastMigration` 管理数据库迁移。

## 5. 多数据库支持

Lakutata 支持配置多个数据库连接，适用于需要访问多个数据源的应用：

```typescript
import { Application } from '../lib/core/Application.js';
import { BuildDatabaseOptions } from '../components/Database.js';

// 定义多个数据库连接配置
Application.run(() => ({
  id: 'test.app',
  name: 'TestApp',
  timezone: 'auto',
  components: {
    primaryDb: BuildDatabaseOptions({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',
      password: 'password',
      database: 'primary_db',
      entities: [__dirname + '/entities/primary/*.js'],
      synchronize: true
    }),
    secondaryDb: BuildDatabaseOptions({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'password',
      database: 'secondary_db',
      entities: [__dirname + '/entities/secondary/*.js'],
      synchronize: true
    })
  },
  bootstrap: ['primaryDb', 'secondaryDb']
}));
```

- **说明**：通过配置多个 `Database` 组件，应用可以同时初始化和管理多个数据库连接（MySQL 和 PostgreSQL）。

## 6. 注意事项和最佳实践

- **避免过度同步**：在生产环境中，将 `synchronize` 设置为 `false`，并使用 TypeORM 的迁移工具管理模式变更。`Database` 类提供了 `runMigrations` 和 `undoLastMigration` 方法用于迁移管理。
- **性能优化**：对于频繁查询，使用索引（通过 `@Index()` 装饰器）或缓存机制来提高性能。`Database` 类提供了 `queryResultCache` 属性用于缓存管理。
- **连接管理**：确保在应用关闭时正确释放数据库连接。`Database` 类在组件生命周期结束时通过 `destroy` 方法自动关闭连接。
- **单例与瞬态**：根据应用需求选择合适的 `Database` 版本。单例适用于共享连接，而瞬态适用于独立连接场景。
- **错误处理**：在数据库操作中实现适当的错误处理，以确保应用稳定性。

## 总结

Lakutata 通过与 TypeORM 的集成以及提供自定义的 `Database` 类（组件和提供者模式），提供了强大的 ORM 能力。这使开发者能够轻松定义数据库模型、执行复杂查询，并在框架内管理多个数据库连接。借助 `BuildDatabaseOptions` 方法和与 IoC 容器的深度集成，Lakutata 进一步简化了数据库服务的配置和依赖管理。无论是简单的 CRUD 操作还是复杂的树结构数据管理，Lakutata 的 ORM 集成都能满足多样化的应用需求。

有关 Lakutata 其他功能的详细信息，请参阅相关文档章节。