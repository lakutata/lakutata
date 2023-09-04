# Lakutata Framework User Guide

## Installation

    npm i -g lakutata

## Key Concepts

Lakutata is developed using TypeScript. However, unlike other languages like C# or Java, Node.js does not have built-in
object lifecycle management. In Lakutata, object lifecycle management is achieved through an IoC (Inversion of Control)
container. Any object that can be loaded by the Lakutata framework must inherit from BaseObject or its subclasses. The
BaseObject class defines the object's initialization and destruction functions, which are automatically called when the
object is loaded by the container and when the container is destroyed, respectively.

Since many operations in Node.js, such as network requests, file I/O, and database access, are asynchronous functions,
the object initialization and destruction functions in BaseObject are also asynchronous methods. Therefore, Lakutata can
be seen as providing an asynchronous object container in the overall framework.

## Framework Base Class

#### [BaseObject](BaseObject.md)

#### [Component](Component.md)

#### [Controller](Controller.md)

#### [Model](Model.md)

#### [Module](Module.md)

#### [DTO](DTO.md)

#### [Container](Container.md)
