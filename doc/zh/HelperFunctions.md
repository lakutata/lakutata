# Lakutata 辅助函数

**Lakutata** 是一个基于 IoC（控制反转）的通用应用框架，旨在为 TypeScript 和 Node.js 开发者提供模块化且可扩展的开发体验。在工具支持方面，Lakutata 提供了 **辅助函数** 系统，这是一组旨在简化应用开发过程中常见任务的辅助函数。本文档详细解释了 Lakutata 框架中辅助函数的功能、分类和使用示例。

## 1. 辅助函数功能概述

**辅助函数** 是 Lakutata 框架中的一组实用工具函数，旨在帮助开发者处理常见的编程任务。这些函数涵盖了数据转换、加密哈希、对象和数组排序以及模板处理等多个领域，为开发者提供了解决通用问题的便捷方式。Lakutata 的辅助函数设计为独立模块，可以在框架的控制器、服务或其他组件中轻松调用，从而增强代码的可重用性和开发效率。

### 1.1 辅助函数的核心目的
- **简化开发任务**：提供即用型的工具函数，减少重复代码编写。
- **增强代码一致性**：标准化常见操作，确保代码风格和结果的一致性。
- **支持多样化场景**：覆盖多种应用场景，如数据处理、安全加密和内容生成。

### 1.2 与 Lakutata 的集成
Lakutata 的辅助函数作为框架的基础工具库，可以在应用的任何部分直接导入和使用。这些函数不依赖于特定的框架组件，因此既可以在 Lakutata 的控制器和服务中使用，也可以在独立脚本中使用，提供了极大的灵活性。

## 2. 辅助函数分类和特性

Lakutata 的辅助函数按功能分类如下。以下详细描述了每个函数的用途和使用示例。

### 2.1 数据结构转换

#### 2.1.1 SetToArray
将 `Set` 对象转换为数组。

- **功能**：将 `Set` 转换为数组，支持泛型类型。
- **示例**：
  ```typescript
  import { SetToArray } from '../../utils/SetToArray.js';
  
  const mySet = new Set([1, 2, 3]);
  const myArray = SetToArray(mySet); // 结果：[1, 2, 3]
  ```
- **用途**：便于将集合类型数据转换为数组，以便后续操作。

#### 2.1.2 UniqueArray
从数组中移除重复元素。

- **功能**：使用 `Set` 从数组中移除重复项。
- **示例**：
  ```typescript
  import { UniqueArray } from '../../utils/UniqueArray.js';
  
  const arr = [1, 2, 2, 3, 3];
  const unique = UniqueArray(arr); // 结果：[1, 2, 3]
  ```
- **用途**：简化数组去重，提高数据处理效率。

### 2.2 加密和哈希

#### 2.2.1 SHA1
计算字符串的 SHA1 哈希值。

- **功能**：计算输入字符串的 SHA1 哈希值，优先使用 Node.js 原生 `crypto` 模块，如果不可用则回退到 `crypto-js`。
- **示例**：
  ```typescript
  import { SHA1 } from '../../utils/SHA1.js';
  
  const hash = SHA1("Hello, World!"); // 返回 SHA1 哈希值的 Buffer
  ```
- **用途**：用于数据完整性验证或密码哈希场景。

#### 2.2.2 SHA256
计算字符串的 SHA256 哈希值。

- **功能**：计算输入字符串的 SHA256 哈希值，优先使用 Node.js 原生 `crypto` 模块，如果不可用则回退到 `crypto-js`。
- **示例**：
  ```typescript
  import { SHA256 } from '../../utils/SHA256.js';
  
  const hash = SHA256("Hello, World!"); // 返回 SHA256 哈希值的 Buffer
  ```
- **用途**：提供更安全的哈希算法，适用于敏感数据处理。

### 2.3 数值转换

#### 2.3.1 SignedToHex
将有符号数转换为十六进制字符串。

- **功能**：将有符号数转换为指定位长的十六进制字符串，支持 8、16、32、64 和 128 位。
- **示例**：
  ```typescript
  import { SignedToHex } from '../../utils/SignedToHex.js';
  
  const hex = SignedToHex(-123, 32); // 结果："FFFFFF85"
  ```
- **用途**：适用于需要将数值以十六进制表示的场景，如低级数据处理。

#### 2.3.2 UnsignedToHex
将无符号数转换为十六进制字符串。

- **功能**：将无符号数转换为指定位长的十六进制字符串，支持 8、16、32、64 和 128 位。
- **示例**：
  ```typescript
  import { UnsignedToHex } from '../../utils/UnsignedToHex.js';
  
  const hex = UnsignedToHex(123, 32); // 结果："0000007B"
  ```
- **用途**：用于将正整数转换为固定长度的十六进制表示。

### 2.4 排序和结构化

#### 2.4.1 SortArray
对数组进行排序。

- **功能**：基于 `sort-array` 库，支持按多个字段、自定义顺序和计算字段进行排序。
- **示例**：
  ```typescript
  import { SortArray } from '../../utils/SortArray.js';
  
  const arr = [{ name: "John", age: 30 }, { name: "Alice", age: 25 }];
  const sorted = SortArray(arr, { by: "age", order: "asc" }); // 按年龄升序排序
  ```
- **用途**：为数组数据提供灵活的排序功能，适用于表格数据或列表处理。

#### 2.4.2 SortKeys
对对象的键进行排序。

- **功能**：对对象的键进行排序，支持深度排序和自定义比较函数。
- **示例**：
  ```typescript
  import { SortKeys } from '../../utils/SortKeys.js';
  
  const obj = { b: 2, a: 1, c: 3 };
  const sorted = SortKeys(obj); // 结果：{ a: 1, b: 2, c: 3 }
  ```
- **用途**：规范化对象结构，便于数据比较或输出。

#### 2.4.3 SortObject
按升序或降序排列对象键。

- **功能**：按升序或降序排列对象键，支持深度排序。
- **示例**：
  ```typescript
  import { SortObject } from '../../utils/SortObject.js';
  
  const obj = { b: 2, a: 1, c: 3 };
  const sorted = SortObject(obj, { order: "desc" }); // 结果：{ c: 3, b: 2, a: 1 }
  ```
- **用途**：提供简化的对象键排序接口，增强可读性。

### 2.5 模板处理

#### 2.5.1 Templating
处理模板字符串并替换占位符。

- **功能**：支持用数据对象中的值替换占位符（如 `{key}` 或 `{{key}}`），包括 HTML 转义、忽略缺失值和自定义转换。
- **示例**：
  ```typescript
  import { Templating } from '../../utils/Templating.js';
  
  const template = "Hello, {name}!";
  const result = Templating(template, { name: "Alice" }); // 结果："Hello, Alice!"
  ```
- **用途**：用于动态生成文本或 HTML 内容，适用于模板渲染场景。

## 3. 辅助函数的应用场景

- **数据处理和转换**：如数组去重、集合到数组的转换以及数值到十六进制的转换，简化数据操作。
- **数据安全**：如 SHA1 和 SHA256 哈希计算，用于数据完整性验证或密码处理。
- **数据结构化**：如数组和对象排序，确保数据输出的一致性和可读性。
- **动态内容生成**：如模板处理，用于生成动态文本或页面内容。

## 4. 辅助函数的优势和特点

- **功能全面**：覆盖了数据转换、加密、排序和模板处理等多种常见需求。
- **独立性强**：每个辅助函数都是独立模块，可在框架的任何位置调用。
- **易用性高**：函数接口简洁，参数设计合理，便于集成到业务逻辑中。
- **性能优化**：例如，哈希函数优先使用原生模块以确保最佳性能。

## 总结

Lakutata 的辅助函数提供了一组实用的工具函数，涵盖了数据处理、加密、排序和模板生成。它们设计为独立模块，接口简单且用户友好，显著提高了开发效率并减少了重复代码。作为 Lakutata 框架中的基础工具支持，辅助函数适用于控制器、服务和数据处理等多种场景，为开发者提供了强大的辅助能力。