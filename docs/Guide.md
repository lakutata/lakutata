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

## How to Use

#### [Logging program events](how/LoggingProgramEvents.md)

#### [Creating child worker processes](how/CreatingChildWorkerProcesses.md)

#### [Using child threads to handle tasks](how/UsingChildThreadsToHandleTasks.md)

#### [Using permission management to control access](how/UsingPermissionManagementToControlAccess.md)

## Framework Base Class

#### [BaseObject](base/BaseObject.md)

#### [Component](base/Component.md)

#### [Controller](base/Controller.md)

#### [Model](base/Model.md)

#### [Module](base/Module.md)

#### [Application](base/Application.md)

#### [DTO](base/DTO.md)

#### [Container](base/Container.md)

## Framework Utility Tools

#### [Time](tools/Time.md)

#### [HttpRequest](tools/HttpRequest.md)

#### [Validator](tools/Validator.md)

#### [Hash](tools/Hash.md)

#### [Crypto](tools/Crypto.md)

#### [Helper](tools/Helper.md)

#### [ORM](tools/ORM.md)
