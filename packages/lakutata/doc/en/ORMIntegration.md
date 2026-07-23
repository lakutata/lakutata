# Lakutata ORM Integration

**Lakutata** is a universal application framework based on IoC (Inversion of Control), designed to provide a modular and extensible development experience for TypeScript and Node.js developers. For database operations, Lakutata integrates **TypeORM** (a powerful Object-Relational Mapping library) to offer seamless database access and management capabilities. This document provides a detailed explanation of the ORM integration features, configuration methods, core decorators, and usage examples within the Lakutata framework.

## 1. ORM Integration Overview

Lakutata chooses TypeORM as its primary ORM solution due to TypeORM's support for multiple databases (including MySQL, PostgreSQL, SQLite, MongoDB, etc.) and its deep integration with TypeScript, allowing database models to be defined via decorators and classes. Lakutata encapsulates and exports TypeORM functionalities, enabling developers to define entities, perform database operations, and manage relationships seamlessly within the framework.

### 1.1 Core Features
- **Entity Definition**: Map TypeScript classes to database tables or views using decorators (e.g., `@Entity`).
- **Column and Relationship Management**: Support various column types (e.g., `@Column`, `@PrimaryGeneratedColumn`) and relationship definitions (e.g., `@OneToMany`, `@ManyToOne`).
- **Tree Structure Support**: Implement hierarchical data management like nested sets or closure tables using TypeORM's tree structure decorators (e.g., `@Tree`, `@TreeChildren`).
- **Database Operations**: Provide CRUD operations, query building, and transaction management via TypeORM's `Repository` and `EntityManager`.
- **Multi-Database Support**: Allow configuration and connection to multiple database instances for complex application scenarios.
- **IoC Container Integration**: Lakutata offers the `Database` class as a Component or Provider, enabling dependency injection of database connections and entity management through the IoC container, simplifying configuration and lifecycle management.

### 1.2 Integration Approach
Lakutata integrates TypeORM as an optional dependency, allowing developers to configure database connections using the provided `Database` class (implemented as a Component or Provider) and initialize them during application startup. Lakutata also exports TypeORM decorators (e.g., `Entity`, `Column`) for convenient access, eliminating the need to directly import the TypeORM library.

### 1.3 Provided Database Classes
Lakutata provides two versions of the `Database` class for different injection scenarios:
- **Database Component (Singleton)**: Operates in singleton mode, suitable for sharing a single database connection instance across the entire application. Defined with the `@Singleton()` decorator, its lifecycle aligns with the application.
- **Database Provider (Transient)**: Operates in transient mode, creating a new instance for each request, ideal for scenarios requiring independent database connections. Defined with the `@Transient()` decorator.

Both versions support injecting database connection options (`options`) via the `@Configurable()` decorator, with the Provider version additionally supporting configuration of entity lists (`entities`).

## 2. Configuring ORM Connections

In Lakutata, ORM connections are typically defined through application configuration or components. Developers need to specify database connection parameters in the `Application.run()` method and manage database services via the IoC container. Lakutata provides the `BuildDatabaseOptions` method to streamline the construction of database connection options.

### 2.1 Database Connection Configuration
Below is a typical database connection configuration example demonstrating how to initialize TypeORM using the `Database` Component in a Lakutata application:

```typescript
import { Application } from '../lib/core/Application.js';
import { BuildDatabaseOptions } from '../components/Database.js';

// Define database connection configuration
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
      synchronize: true // For development only; set to false in production
    })
  },
  bootstrap: ['db']
}));
```

- **Explanation**: The `BuildDatabaseOptions` method constructs database connection options and registers them as the `db` component. Setting `synchronize: true` enables automatic database schema synchronization, which is suitable only for development environments. The `Database` Component initializes TypeORM's `DataSource` based on the provided `options`.

### 2.2 Using the Provider Version
For scenarios requiring transient database connections, the `Database` Provider version can be used:

```typescript
import { Application } from '../lib/core/Application.js';
import { BuildDatabaseOptions } from '../providers/Database.js';

// Define database connection configuration
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

- **Explanation**: The `Database` Provider operates in transient mode, creating a new database connection instance for each request to `transientDb`, suitable for scenarios needing independent connections.

### 2.3 Injection via IoC Container
Lakutata's IoC container supports injecting database connections or `Repository` instances into components or controllers, simplifying database access:

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

- **Explanation**: `UserService` retrieves the database component via the `@Inject` decorator and extracts the `Repository` for the `User` entity, facilitating subsequent database operations.

## 3. Entities and Decorators

Lakutata integrates TypeORM decorators for defining database entities, columns, relationships, and more. Below are commonly used decorators and their functionalities.

### 3.1 Entity-Related Decorators
- **`@Entity()`**: Marks a class as a database entity, mapping it to a database table.
- **`@ViewEntity()`**: Marks a class as a view entity, mapping it to a database view.
- **`@Unique()`**: Defines a unique constraint on a field or combination of fields.

### 3.2 Column-Related Decorators
- **`@Column()`**: Defines a column in an entity, specifying data type and properties (e.g., `type: 'varchar', length: 255`).
- **`@PrimaryColumn()`**: Defines a primary key column.
- **`@PrimaryGeneratedColumn()`**: Defines an auto-generated primary key column (e.g., auto-incrementing ID).
- **`@CreateDateColumn()`**: Defines a creation date column, automatically recording the entity creation time.
- **`@UpdateDateColumn()`**: Defines an update date column, automatically recording the entity update time.
- **`@VersionColumn()`**: Defines a version column for optimistic locking.
- **`@ViewColumn()`**: Defines a view column, applicable to view entities.
- **`@VirtualColumn()`**: Defines a virtual column, not stored in the database but usable in queries.

### 3.3 Relationship-Related Decorators
- **`@OneToOne()`**: Defines a one-to-one relationship.
- **`@OneToMany()`**: Defines a one-to-many relationship.
- **`@ManyToOne()`**: Defines a many-to-one relationship.
- **`@ManyToMany()`**: Defines a many-to-many relationship.

### 3.4 Tree Structure-Related Decorators
Lakutata supports TypeORM's tree structure functionality for implementing nested sets or closure tables for hierarchical data:
- **`@Tree()`**: Marks an entity as a tree structure entity.
- **`@TreeChildren()`**: Defines the children property of a tree structure.
- **`@TreeParent()`**: Defines the parent property of a tree structure.
- **`@TreeLevelColumn()`**: Defines a level column in a tree structure to record node levels.

### 3.5 Entity Definition Example
Below is a simple entity definition example showcasing the use of TypeORM decorators:

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

- **Explanation**: The `User` entity defines an auto-incrementing primary key `id`, regular columns `name` and `email` (with `email` having a unique constraint), automatic timestamps `createdAt` and `updatedAt`, and a one-to-many relationship with the `Post` entity.

## 4. Database Operations

Lakutata provides comprehensive support for TypeORM database operations through the `Database` class, including CRUD operations, query building, transaction management, and migration operations.

### 4.1 CRUD Operations
Using `Repository`, basic create, read, update, and delete operations can be easily implemented:

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

  // Create a user
  public async createUser(name: string, email: string): Promise<User> {
    const user = this.userRepository.create({ name, email });
    return await this.userRepository.save(user);
  }

  // Retrieve all users
  public async getAllUsers(): Promise<User[]> {
    return await this.userRepository.find();
  }

  // Retrieve a user by ID
  public async getUserById(id: number): Promise<User | null> {
    return await this.userRepository.findOneBy({ id });
  }

  // Update a user
  public async updateUser(id: number, name: string): Promise<User | null> {
    const user = await this.userRepository.findOneBy({ id });
    if (user) {
      user.name = name;
      return await this.userRepository.save(user);
    }
    return null;
  }

  // Delete a user
  public async deleteUser(id: number): Promise<boolean> {
    const result = await this.userRepository.delete(id);
    return result.affected > 0;
  }
}
```

- **Explanation**: `UserService` provides basic operations for the `User` entity, including creation, retrieval, update, and deletion.

### 4.2 Complex Queries
The `Database` class offers the `createQueryBuilder` method to support complex query conditions:

```typescript
public async findUsersByName(name: string): Promise<User[]> {
  return await this.db
    .createQueryBuilder(User, 'user')
    .where('user.name LIKE :name', { name: `%${name}%` })
    .orderBy('user.createdAt', 'DESC')
    .getMany();
}
```

- **Explanation**: The above method uses a query builder to find users whose names contain the specified string, ordered by creation time in descending order.

### 4.3 Transaction Management
The `Database` class supports transactions to ensure the atomicity of data operations:

```typescript
public async createUserWithPost(name: string, email: string, postTitle: string): Promise<User> {
  return await this.db.transaction(async (entityManager) => {
    const user = await entityManager.save(User, { name, email });
    await entityManager.save(Post, { title: postTitle, author: user });
    return user;
  });
}
```

- **Explanation**: Creates a user and an associated post within a transaction, ensuring both operations either succeed or fail together.

### 4.4 Database Migration and Synchronization
The `Database` class provides methods for database schema synchronization and migration management:

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

- **Explanation**: The `synchronize` method syncs the database schema, while `runMigrations` and `undoLastMigration` manage database migrations.

## 5. Multi-Database Support

Lakutata supports configuring multiple database connections, suitable for applications needing access to multiple data sources:

```typescript
import { Application } from '../lib/core/Application.js';
import { BuildDatabaseOptions } from '../components/Database.js';

// Define multiple database connection configurations
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

- **Explanation**: By configuring multiple `Database` components, the application can initialize and manage multiple database connections (MySQL and PostgreSQL) simultaneously.

## 6. Notes and Best Practices

- **Avoid Over-Synchronization**: In production environments, set `synchronize` to `false` and use TypeORM's migration tools to manage schema changes. The `Database` class provides `runMigrations` and `undoLastMigration` methods for migration management.
- **Performance Optimization**: For frequent queries, use indexes (via the `@Index()` decorator) or caching mechanisms to improve performance. The `Database` class offers the `queryResultCache` property for cache management.
- **Connection Management**: Ensure database connections are properly released when the application shuts down. The `Database` class automatically closes connections via the `destroy` method at the end of the component lifecycle.
- **Singleton vs. Transient**: Choose the appropriate `Database` version based on application needs. Singleton is suitable for shared connections, while Transient is ideal for independent connection scenarios.
- **Error Handling**: Implement proper error handling in database operations to ensure application stability.

## Summary

Lakutata, through its integration with TypeORM and the provision of custom `Database` classes (in both Component and Provider modes), delivers robust ORM capabilities. This enables developers to effortlessly define database models, execute complex queries, and manage multiple database connections within the framework. With the `BuildDatabaseOptions` method and deep integration with the IoC container, Lakutata further simplifies database service configuration and dependency management. Whether for simple CRUD operations or complex tree structure data management, Lakutata's ORM integration meets diverse application needs.

For detailed information on other Lakutata features, please refer to the relevant documentation sections.
for your feedback, and I look forward to any further input or confirmation! 😊