# Lakutata DTO and Validation

**Lakutata** is a universal application framework based on IoC (Inversion of Control), designed to provide a modular and extensible development experience for TypeScript and Node.js developers. In terms of data handling, Lakutata offers a robust **DTO (Data Transfer Object)** system to facilitate structured data transfer between different layers of an application, ensuring data integrity and consistency through validation mechanisms. This document provides a detailed explanation of DTO definition, validation features, core decorators, and usage examples within the Lakutata framework.

## 1. DTO Functionality Overview

**DTO (Data Transfer Object)** is a design pattern used to transfer data between software application subsystems. In Lakutata, DTOs serve as a structured approach to define the shape of data exchanged between controllers, services, or other components, ensuring clear communication and separation of concerns across layers.

### 1.1 Core Purpose of DTOs
- **Data Structure Definition**: DTOs define the structure of data in client requests, API responses, or internal service calls.
- **Layer Decoupling**: DTOs help decouple the presentation layer (e.g., API controllers) from the business logic layer (e.g., services) and data persistence layer (e.g., entities).
- **Validation and Constraints**: DTOs provide a centralized point to apply data validation rules, ensuring data meets expectations before being processed by business logic.

### 1.2 Integration with Lakutata
Lakutata provides a comprehensive DTO system based on the `DTO` base class and a Joi-based validation library (implemented through the `VLD` module), enabling developers to define data structures with validation rules. Lakutata's IoC container further supports injecting DTOs or related validation services into components or controllers, ensuring seamless integration across the application. Additionally, Lakutata offers various decorators (e.g., `@Expect`, `@Accept`, `@Return`) to define validation logic declaratively.

## 2. Defining DTOs

In Lakutata, DTOs are typically defined as TypeScript classes that inherit from the `DTO` base class, representing the expected or returned data structure. These classes can apply validation rules through decorators.

### 2.1 Basic DTO Definition
Below is a simple DTO class example representing user registration data:

```typescript
import { DTO } from '../../lib/core/DTO.js';

export class UserRegisterDTO extends DTO {
  name: string;
  email: string;
  password: string;
}
```

- **Explanation**: This `UserRegisterDTO` defines the structure of user registration data with `name`, `email`, and `password` properties. Without validation rules, it serves purely as a data structure.

### 2.2 Enhancing DTOs with Validation Decorators
Lakutata provides the `@Expect` decorator to specify validation schemas for DTO properties. These schemas are defined using the `VLD` module, supporting various data types and validation rules.

#### Example: DTO with Validation
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

- **Explanation**:
    - `@Expect(VLD.string().min(2).max(50))` ensures `name` is a string with a length between 2 and 50.
    - `@Expect(VLD.string().email())` validates `email` as a valid email format.
    - `@Expect(VLD.string().min(8))` ensures `password` is a string with a minimum length of 8.

## 3. DTO Validation Mechanism

Validation ensures that incoming data adheres to the rules defined in DTOs. Lakutata provides underlying validation support through the `VLD` module (based on the Joi library). Validation can be automatically triggered during DTO instantiation or manually invoked in controllers or services.

### 3.1 VLD Validation Library
`VLD` is the core validation module in Lakutata, extended from Joi, offering extensive validation capabilities:
- **Schema Definition**: Supports schemas for various data types such as strings (`string()`), numbers (`number()`), objects (`object()`), etc.
- **Custom Rules**: Extends numeric range validation rules like `int8` (values between -128 and 127), `uint8` (values between 0 and 255), and more.
- **Validation Methods**: Provides synchronous (`validate`) and asynchronous (`validateAsync`) validation methods, throwing an `InvalidValueException` on failure.
- **Default Configuration**: Default validation options include `abortEarly: true` (stop at the first error), `stripUnknown: true` (remove unknown fields), and others.

### 3.2 Manual Validation
Developers can manually validate DTO data using validation methods provided by `VLD`.

#### Example: Manual DTO Validation
```typescript
import { VLD } from '../../lib/validation/VLD.js';
import { UserRegisterDTO } from './dtos/UserRegisterDTO.js';

export class UserController {
  async register(data: any): Promise<void> {
    // Create DTO instance (assuming DTO supports direct instantiation)
    const dto = new UserRegisterDTO(data);
    
    // Manual validation (depends on DTO internal implementation)
    try {
      await VLD.validateAsync(dto, VLD.object()); // Assuming DTO has internal Schema definition
      console.log('Validation passed:', dto);
      // Proceed with business logic
    } catch (error) {
      console.error('Validation failed:', error.message);
      throw new Error('Invalid input data');
    }
  }
}
```

- **Explanation**: `VLD.validateAsync` is used to validate the data, throwing an `InvalidValueException` with detailed error information on failure.

### 3.3 Automatic Validation
In Lakutata, DTO validation is often handled internally by the framework, especially when using decorators like `@Accept` or `@Return`, where validation is automatically triggered during method calls or return value processing.

## 4. Validation Decorators

Lakutata provides several decorators to apply validation rules on DTO classes, methods, and properties.

### 4.1 @Expect (Property Validation)
The `@Expect` decorator is used to specify validation schemas for DTO properties.

#### Example
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

- **Explanation**: The `name` and `email` properties are validated with length constraints and email format rules, respectively.

### 4.2 @Accept (Method Parameter Validation)
The `@Accept` decorator is used to validate method input parameters, supporting multiple DTOs or Schemas as validation rules.

#### Example
```typescript
import { Accept } from '../../decorators/validation/Accept.js';
import { UserDTO } from './UserDTO.js';

export class UserController {
  @Accept(UserDTO)
  async register(data: UserDTO): Promise<void> {
    // data has been validated
    console.log('Registering user:', data);
  }
}
```

- **Explanation**: The `register` method's parameter `data` is validated to conform to the `UserDTO` structure and rules.

### 4.3 @Return (Method Return Value Validation)
The `@Return` decorator is used to validate method return values.

#### Example
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

- **Explanation**: The return value of the `getUser` method is validated to conform to the `UserDTO` structure and rules.

### 4.4 @IndexSignature (Index Signature Validation)
The `@IndexSignature` decorator is used to define validation rules for index signatures in DTO classes, suitable for objects with dynamic keys.

#### Example
```typescript
import { IndexSignature } from '../../decorators/validation/IndexSignature.js';
import { VLD } from '../../lib/validation/VLD.js';
import { DTO } from '../../lib/core/DTO.js';

@IndexSignature(VLD.string())
export class DynamicDataDTO extends DTO {
  [key: string]: string;
}
```

- **Explanation**: The `DynamicDataDTO` class allows any string key, but each key's value must be a string.

## 5. Nested DTOs and Complex Structures

Lakutata supports validation of nested DTOs and complex data structures using `VLD.object()` and `SchemaMap` type definitions for nested schemas.

### Example: Nested DTO
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

- **Explanation**: `UserProfileDTO` includes a nested `address` property of type `AddressDTO`, and validation recursively checks the properties of the nested object.

## 6. Using DTOs in Controllers and Services

DTOs are commonly used in Lakutata within controllers and services to define the structure of input and output data.

### 6.1 Using DTOs in Controllers
Controllers often receive raw data (e.g., JSON from HTTP requests) and map it to DTOs for validation.

#### Example: DTO in Controller
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
    // DTO has been validated
    return await this.userService.registerUser(dto);
  }
}
```

- **Explanation**: The controller uses the `@Accept` decorator to validate that the incoming `dto` conforms to `UserRegisterDTO` before passing it to the service.

### 6.2 Using DTOs in Services
Services can use DTOs to ensure that received or returned data adheres to a specific structure.

#### Example: DTO in Service
```typescript
import { Component } from '../../lib/core/Component.js';
import { UserRegisterDTO } from './dtos/UserRegisterDTO.js';
import { User } from './entities/User.js';

@Component()
export class UserService {
  async registerUser(dto: UserRegisterDTO): Promise<User> {
    // Create user entity from DTO
    const user = new User();
    user.name = dto.name;
    user.email = dto.email;
    // Apply business logic, e.g., password hashing
    user.passwordHash = this.hashPassword(dto.password);
    
    // Save to database (assuming repository injection)
    return await this.userRepository.save(user);
  }

  private hashPassword(password: string): string {
    // Placeholder for password hashing logic
    return `hashed_${password}`;
  }
}
```

- **Explanation**: `UserService` receives a validated `UserRegisterDTO` and uses its properties to create a `User` entity, applying necessary business logic.

## 7. Best Practices for DTOs and Validation

- **Keep DTOs Focused**: Define DTOs for specific use cases (e.g., `UserRegisterDTO`, `UserUpdateDTO`) rather than reusing a single DTO for multiple purposes, ensuring clarity and maintainability.
- **Declarative Validation**: Prefer using decorators (e.g., `@Expect`, `@Accept`) to define validation rules, keeping code concise.
- **Handle Complex Data**: Use nested DTOs and `VLD.object()` for complex data structures to ensure validation covers all levels.
- **Handle Errors Gracefully**: Catch `InvalidValueException` and provide user-friendly error messages to clients.
- **Performance Considerations**: Avoid overly complex validation rules in high-traffic endpoints to minimize performance overhead.

## Summary

Lakutata provides powerful DTO and validation capabilities through the `DTO` base class, the `VLD` validation library, and a set of validation decorators (`@Expect`, `@Accept`, `@Return`, `@IndexSignature`). Developers can easily define data structures with validation rules and apply them to properties, method parameters, and return values, ensuring data integrity and consistency across application layers. Combined with Lakutata's IoC container, DTOs and validation logic can be seamlessly integrated into components, controllers, and services, enhancing the modularity and maintainability of applications.

For detailed information on other Lakutata features, please refer to the relevant documentation sections.