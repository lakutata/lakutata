# Lakutata Helper Functions

**Lakutata** is a universal application framework based on IoC (Inversion of Control), designed to provide a modular and extensible development experience for TypeScript and Node.js developers. In terms of utility support, Lakutata offers the **Helper Functions** system, a set of auxiliary functions aimed at simplifying common tasks during application development. This document provides a detailed explanation of the functionality, categorization, and usage examples of Helper Functions within the Lakutata framework.

## 1. Helper Functions Functionality Overview

**Helper Functions** are a collection of practical utility functions in the Lakutata framework, designed to assist developers in handling common programming tasks. These functions cover various areas such as data transformation, cryptographic hashing, object and array sorting, and template processing, providing developers with convenient ways to address general issues. Lakutata's helper functions are designed as independent modules, easily callable within controllers, services, or other components of the framework, enhancing code reusability and development efficiency.

### 1.1 Core Purpose of Helper Functions
- **Simplify Development Tasks**: Provide ready-to-use utility functions to reduce redundant code writing.
- **Enhance Code Consistency**: Standardize common operations to ensure consistency in code style and results.
- **Support Diverse Scenarios**: Cover multiple application scenarios such as data processing, security encryption, and content generation.

### 1.2 Integration with Lakutata
Lakutata's Helper Functions serve as the framework's foundational utility library, directly importable and usable in any part of an application. These functions do not depend on specific framework components, making them versatile for use in Lakutata controllers and services, as well as in standalone scripts, offering significant flexibility.

## 2. Helper Functions Categories and Features

Lakutata's Helper Functions can be categorized by functionality as follows. Each function's purpose and usage example are described in detail below.

### 2.1 Data Structure Transformation

#### 2.1.1 SetToArray
Converts a `Set` object to an array.

- **Functionality**: Converts a `Set` to an array, supporting generic types.
- **Example**:
  ```typescript
  import { SetToArray } from '../../utils/SetToArray.js';
  
  const mySet = new Set([1, 2, 3]);
  const myArray = SetToArray(mySet); // Result: [1, 2, 3]
  ```
- **Purpose**: Facilitates converting set-type data to arrays for subsequent operations.

#### 2.1.2 UniqueArray
Removes duplicate elements from an array.

- **Functionality**: Removes duplicates from an array using a `Set`.
- **Example**:
  ```typescript
  import { UniqueArray } from '../../utils/UniqueArray.js';
  
  const arr = [1, 2, 2, 3, 3];
  const unique = UniqueArray(arr); // Result: [1, 2, 3]
  ```
- **Purpose**: Simplifies array deduplication, improving data processing efficiency.

### 2.2 Cryptography and Hashing

#### 2.2.1 SHA1
Calculates the SHA1 hash of a string.

- **Functionality**: Computes the SHA1 hash of an input string, prioritizing Node.js native `crypto` module, falling back to `crypto-js` if unavailable.
- **Example**:
  ```typescript
  import { SHA1 } from '../../utils/SHA1.js';
  
  const hash = SHA1("Hello, World!"); // Returns a Buffer of the SHA1 hash
  ```
- **Purpose**: Used for data integrity verification or password hashing scenarios.

#### 2.2.2 SHA256
Calculates the SHA256 hash of a string.

- **Functionality**: Computes the SHA256 hash of an input string, prioritizing Node.js native `crypto` module, falling back to `crypto-js` if unavailable.
- **Example**:
  ```typescript
  import { SHA256 } from '../../utils/SHA256.js';
  
  const hash = SHA256("Hello, World!"); // Returns a Buffer of the SHA256 hash
  ```
- **Purpose**: Provides a more secure hashing algorithm, suitable for sensitive data handling.

### 2.3 Numeric Conversion

#### 2.3.1 SignedToHex
Converts a signed number to a hexadecimal string.

- **Functionality**: Converts a signed number to a hexadecimal string of specified bit length, supporting 8, 16, 32, 64, and 128 bits.
- **Example**:
  ```typescript
  import { SignedToHex } from '../../utils/SignedToHex.js';
  
  const hex = SignedToHex(-123, 32); // Result: "FFFFFF85"
  ```
- **Purpose**: Useful for scenarios requiring numeric values to be represented in hexadecimal, such as low-level data processing.

#### 2.3.2 UnsignedToHex
Converts an unsigned number to a hexadecimal string.

- **Functionality**: Converts an unsigned number to a hexadecimal string of specified bit length, supporting 8, 16, 32, 64, and 128 bits.
- **Example**:
  ```typescript
  import { UnsignedToHex } from '../../utils/UnsignedToHex.js';
  
  const hex = UnsignedToHex(123, 32); // Result: "0000007B"
  ```
- **Purpose**: Used to convert positive integers to fixed-length hexadecimal representations.

### 2.4 Sorting and Structuring

#### 2.4.1 SortArray
Sorts an array.

- **Functionality**: Based on the `sort-array` library, supports sorting by multiple fields, custom orders, and computed fields.
- **Example**:
  ```typescript
  import { SortArray } from '../../utils/SortArray.js';
  
  const arr = [{ name: "John", age: 30 }, { name: "Alice", age: 25 }];
  const sorted = SortArray(arr, { by: "age", order: "asc" }); // Sorts by age in ascending order
  ```
- **Purpose**: Provides flexible sorting capabilities for array data, suitable for tabular data or list processing.

#### 2.4.2 SortKeys
Sorts the keys of an object.

- **Functionality**: Sorts the keys of an object, supporting deep sorting and custom comparison functions.
- **Example**:
  ```typescript
  import { SortKeys } from '../../utils/SortKeys.js';
  
  const obj = { b: 2, a: 1, c: 3 };
  const sorted = SortKeys(obj); // Result: { a: 1, b: 2, c: 3 }
  ```
- **Purpose**: Normalizes object structure for easier data comparison or output.

#### 2.4.3 SortObject
Sorts object keys in ascending or descending order.

- **Functionality**: Sorts object keys in ascending or descending order, supporting deep sorting.
- **Example**:
  ```typescript
  import { SortObject } from '../../utils/SortObject.js';
  
  const obj = { b: 2, a: 1, c: 3 };
  const sorted = SortObject(obj, { order: "desc" }); // Result: { c: 3, b: 2, a: 1 }
  ```
- **Purpose**: Offers a simplified interface for sorting object keys, enhancing readability.

### 2.5 Template Processing

#### 2.5.1 Templating
Processes template strings and replaces placeholders.

- **Functionality**: Supports replacing placeholders (e.g., `{key}` or `{{key}}`) with values from a data object, including HTML escaping, ignoring missing values, and custom transformations.
- **Example**:
  ```typescript
  import { Templating } from '../../utils/Templating.js';
  
  const template = "Hello, {name}!";
  const result = Templating(template, { name: "Alice" }); // Result: "Hello, Alice!"
  ```
- **Purpose**: Used for dynamically generating text or HTML content, suitable for template rendering scenarios.

## 3. Helper Functions Use Cases

- **Data Processing and Transformation**: Such as array deduplication, set-to-array conversion, and numeric-to-hexadecimal conversion, simplifying data operations.
- **Data Security**: Such as SHA1 and SHA256 hash calculations for data integrity verification or password handling.
- **Data Structuring**: Such as array and object sorting to ensure consistency and readability in data output.
- **Dynamic Content Generation**: Such as template processing for generating dynamic text or page content.

## 4. Advantages and Features of Helper Functions

- **Comprehensive Functionality**: Covers a wide range of common needs including data transformation, encryption, sorting, and template processing.
- **Strong Independence**: Each helper function is an independent module, callable from anywhere in the framework.
- **High Usability**: Function interfaces are concise with well-designed parameters, making integration into business logic straightforward.
- **Performance Optimization**: For instance, hash functions prioritize native modules to ensure optimal performance.

## Summary

Lakutata's Helper Functions provide a set of practical utility functions covering data processing, encryption, sorting, and template generation. Designed as independent modules with simple and user-friendly interfaces, these functions significantly enhance development efficiency and reduce redundant code. As foundational utility support within the Lakutata framework, Helper Functions are applicable in various scenarios such as controllers, services, and data processing, offering developers powerful auxiliary capabilities.