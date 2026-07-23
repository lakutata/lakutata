# Lakutata Docker Integration

**Lakutata** is a universal application framework based on IoC (Inversion of Control), designed to provide a modular and extensible development experience for TypeScript and Node.js developers. As a modern framework, Lakutata emphasizes code maintainability, type safety, and component-based design. In terms of containerization support, Lakutata offers deep integration with Docker through a preset **Docker Component**, enabling developers to effortlessly manage Docker containers, images, and networks. This document provides a detailed explanation of the design philosophy, core components, data validation mechanisms (DTOs), and use cases of Docker integration within the Lakutata framework.

## 1. Overview of Docker Integration Features

**Docker Integration** is a key functional module in the Lakutata framework, designed to facilitate programmatic interaction with Docker. As a preset component, the **Docker Component** is built into the framework, adhering to Lakutata's IoC design philosophy. This allows developers to invoke Docker-related functionalities anywhere in their application via dependency injection. Lakutata provides a set of structured **DTOs (Data Transfer Objects)** to define parameters and configurations for Docker operations, ensuring type safety and validation of input data. These DTOs cover various aspects such as container management, image building and operations, and network creation, seamlessly integrating with Lakutata's core features (e.g., IoC container, controllers, and services).

### 1.1 Core Objectives of Docker Integration
- **Containerized Management**: Programmatically manage Docker containers, images, and networks to simplify containerized application development and deployment.
- **Type Safety and Data Validation**: Leverage Lakutata's DTO system and `@Expect` decorators to enforce strict type checking and validation of operation parameters, ensuring reliability and security.
- **Enhanced Development and Deployment Efficiency**: Provide a preset Docker Component that allows developers to directly invoke Docker functionalities, reducing manual operations and script writing while maintaining code consistency and maintainability.

### 1.2 Integration with Lakutata's Design Philosophy
Lakutata's design philosophy revolves around IoC, modularity, and type safety, and the Docker integration module fully embodies these principles:
- **IoC and Dependency Injection**: As a preset component, the Docker Component is managed by Lakutata's IoC container, enabling developers to use Docker functionalities in controllers, services, or other components via dependency injection without manually instantiating or managing underlying connections.
- **Modularity and Extensibility**: The Docker Component follows a modular design, allowing developers to extend custom Docker operation logic based on provided DTOs or adjust connection parameters through configuration files.
- **Type Safety with DTO Validation**: Lakutata prioritizes type safety, with all Docker operation parameters defined via DTOs and validated using `@Expect` decorators to ensure input data integrity and completeness, minimizing runtime errors.
- **Convenience of Preset Components**: As a preset component, the Docker Component is built into the framework, eliminating the need for additional installation or configuration, thus reducing the learning curve and integration costs.

### 1.3 Integration with Other Lakutata Modules
Lakutata's Docker integration module is not merely a standalone toolkit; it is closely intertwined with other framework modules (such as controllers, services, and event systems). For instance, developers can invoke the Docker Component within a controller to dynamically build and deploy containers or use DTOs in a service layer to validate user-provided image build parameters. This integration leverages Lakutata's IoC container and modular design, ensuring that Docker functionalities operate seamlessly throughout the application lifecycle.

## 2. Core Components of Docker Integration

Lakutata's Docker integration is primarily provided through the preset **Docker Component**, with operation parameters defined by a set of DTO classes. These DTOs utilize Lakutata's DTO system and `@Expect` decorators for data validation, ensuring that parameters passed by developers meet expected criteria. Below is a detailed analysis based on the provided source files, covering container management, image operations, and network configuration.

### 2.1 Container Management DTOs

#### 2.1.1 ContainerStopOptions
Defines parameters for stopping a container, controlling the behavior of the stop operation.

- **Functionality**: Gracefully stops a Docker container by specifying a stop signal and timeout duration.
- **Fields and Validation Rules**:
  - `signal`: The stop signal (e.g., "SIGTERM"), type string, optional. Validated by `@Expect(DTO.String().optional())` to ensure it is a string if provided.
  - `timeout`: Number of seconds to wait before forcibly killing the container, type number, optional. Validated by `@Expect(DTO.Number().optional())` to ensure it is a numeric value if provided.
- **Example**:
  ```typescript
  import { ContainerStopOptions } from '../../utils/docker/ContainerStopOptions.js';
  
  const options = new ContainerStopOptions({
    signal: 'SIGTERM',
    timeout: 10
  });
  ```
- **Purpose**: Within a Lakutata application, developers can use this DTO with the Docker Component to stop containers in a controlled manner, ensuring proper shutdown processes (e.g., avoiding data loss due to abrupt termination).
- **Data Validation Value**: Through DTO validation, the framework ensures that `signal` is a valid string and `timeout` is a reasonable numeric value, preventing container stop failures due to invalid parameters.

#### 2.1.2 ContainerTTYConsoleSizeOptions
Defines parameters for setting the TTY console size of a container, used to adjust terminal display dimensions.

- **Functionality**: Sets the number of columns and rows for a container's terminal, suitable for interactive sessions or debugging scenarios.
- **Fields and Validation Rules**:
    - `cols`: Number of terminal columns, type number, required. Validated by `@Expect(DTO.Number().required())` to ensure it is a numeric value and must be provided.
    - `rows`: Number of terminal rows, type number, required. Validated by `@Expect(DTO.Number().required())` to ensure it is a numeric value and must be provided.
- **Example**:
  ```typescript
  import { ContainerTTYConsoleSizeOptions } from '../../utils/docker/ContainerTTYConsoleSizeOptions.js';
  
  const options = new ContainerTTYConsoleSizeOptions({
    cols: 80,
    rows: 24
  });
  ```
- **Purpose**: In the Lakutata framework, this DTO is used to adjust container terminal sizes via the Docker Component, ensuring a suitable display for developers or users during container interaction, especially in debugging or monitoring tasks.
- **Data Validation Value**: Through DTO's `required()` validation rule, it ensures that both `cols` and `rows` are provided and are numeric, avoiding terminal setup failures due to missing parameters.

### 2.2 Image Operation DTOs

#### 2.2.1 ImageBuildOptions
Defines parameters for building a Docker image, configuring the build context and options.

- **Functionality**: Provides detailed configuration for building images, including context directory, file list, Dockerfile path, target platform, and more, supporting complex build requirements.
- **Key Fields and Validation Rules**:
    - `workdir`: Build context working directory, type string, required. Validated by `@Expect(DTO.String().required())` to ensure a valid directory path is provided.
    - `files`: List of files in the build context, type array of strings, required. Validated by `@Expect(DTO.Array(DTO.String()).required())` to ensure a file list is provided.
    - `dockerfile`: Path to Dockerfile, type string, optional, defaults to "Dockerfile". Validated by `@Expect(DTO.String().optional().default('Dockerfile'))` with a default value.
    - `repoTag`: Image name and tag, type string, optional. Validated by `@Expect(DTO.String().optional())` to ensure correct format if provided.
    - `platform`: Build platform, type string, optional, defaults to empty string. Validated by `@Expect(DTO.String().allow('').optional().default(''))` to allow empty values.
    - `target`: Target build stage, type string, optional, defaults to empty string.
    - `remote`: Git repository or HTTP/HTTPS context URI, type string, optional, for remote build contexts.
    - `quite`: Suppress verbose build output, type boolean, optional, defaults to `false`.
    - `nocache`: Disable cache during build, type boolean, optional, defaults to `false`.
    - `rm`: Remove intermediate containers after successful build, type boolean, optional, defaults to `true`.
    - `forcerm`: Always remove intermediate containers even on failure, type boolean, optional, defaults to `false`.
    - `shmsize`: Size of /dev/shm in bytes, type number, optional.
    - `buildargs`: Build-time variables, type object of string key-value pairs, optional.
    - `auth`: Docker authentication options, type `DockerAuthOptions`, optional.
    - `outputCallback`: Build output callback function, type function, optional.
- **Example**:
  ```typescript
  import { ImageBuildOptions } from '../../utils/docker/ImageBuildOptions.js';
  
  const options = new ImageBuildOptions({
    workdir: '/path/to/context',
    files: ['file1.txt', 'file2.txt'],
    repoTag: 'myimage:latest',
    platform: 'linux/amd64',
    buildargs: { VERSION: '1.0.0' }
  });
  ```
- **Purpose**: In the Lakutata framework, this DTO is used with the Docker Component to build custom images, supporting full workflows from local context to remote repositories, ideal for CI/CD pipelines or automated build tasks.
- **Data Validation Value**: Through DTO validation, the framework ensures required fields (e.g., `workdir` and `files`) are provided and data types match expectations (e.g., `buildargs` must be string key-value pairs), preventing build failures due to missing or malformed parameters.

#### 2.2.2 ImageExportOptions
Defines parameters for exporting a Docker image, saving the image to a specified destination.

- **Functionality**: Specifies the destination for exporting an image (filename or writable stream) and related options.
- **Fields and Validation Rules**:
    - `destination`: Export destination, type string or `NodeJS.WritableStream`, required. Validated by `@Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())` to support both types.
    - `repoTag`: Specific image tag to export, type string, optional.
    - `createRepoTagIfNotExists`: Create the tag if it does not exist, type boolean, optional, defaults to `true`.
- **Example**:
  ```typescript
  import { ImageExportOptions } from '../../utils/docker/ImageExportOptions.js';
  
  const options = new ImageExportOptions({
    destination: '/path/to/image.tar',
    repoTag: 'myimage:latest'
  });
  ```
- **Purpose**: In a Lakutata application, developers can use this DTO with the Docker Component to export images for distribution or backup purposes.
- **Data Validation Value**: DTO validation ensures the `destination` field is provided and of the correct type, preventing export failures due to invalid paths or streams.

#### 2.2.3 ImageImportOptions
Defines parameters for importing a Docker image, loading the image from a specified source.

- **Functionality**: Specifies the source for importing an image (filename or readable stream) and related options.
- **Fields and Validation Rules**:
    - `source`: Import source, type string or `NodeJS.ReadableStream`, required. Validated by `@Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())` to support both types.
    - `quiet`: Suppress progress details during import, type boolean, optional, defaults to `false`.
- **Example**:
  ```typescript
  import { ImageImportOptions } from '../../utils/docker/ImageImportOptions.js';
  
  const options = new ImageImportOptions({
    source: '/path/to/image.tar',
    quiet: true
  });
  ```
- **Purpose**: In the Lakutata framework, this DTO is used with the Docker Component to import images, suitable for restoring backups or migrating images across environments.
- **Data Validation Value**: Through DTO validation, it ensures the `source` field is provided and of the correct type, preventing import failures due to invalid sources.

#### 2.2.4 ImagePullOptions
Defines parameters for pulling a Docker image, downloading it from a Docker registry.

- **Functionality**: Configures options for pulling an image from a Docker registry, supporting platform specification and authentication.
- **Fields and Validation Rules**:
    - `repo`: Registry repository address, type string, required. Validated by `@Expect(DTO.String().required())` to ensure it is provided.
    - `tag`: Image tag, type string, optional, defaults to "latest".
    - `platform`: Specific platform, type string, optional.
    - `auth`: Docker authentication options, type `DockerAuthOptions`, optional.
    - `outputCallback`: Output callback function, type function, optional.
- **Example**:
  ```typescript
  import { ImagePullOptions } from '../../utils/docker/ImagePullOptions.js';
  
  const options = new ImagePullOptions({
    repo: 'docker.io/library/nginx',
    tag: 'latest',
    platform: 'linux/amd64'
  });
  ```
- **Purpose**: In a Lakutata application, this DTO is used with the Docker Component to pull images from remote registries, suitable for pre-deployment preparation or dynamic image updates.
- **Data Validation Value**: DTO validation ensures the `repo` field is provided, avoiding pull failures due to missing registry addresses, while also validating the type correctness of other fields.

#### 2.2.5 ImagePushOptions
Defines parameters for pushing a Docker image, uploading a local image to a Docker registry.

- **Functionality**: Configures options for pushing an image to a Docker registry, supporting authentication.
- **Fields and Validation Rules**:
    - `repo`: Registry repository address, type string, required. Validated by `@Expect(DTO.String().required())` to ensure it is provided.
    - `tag`: Image tag, type string, optional, defaults to "latest".
    - `auth`: Docker authentication options, type `DockerAuthOptions`, optional.
    - `outputCallback`: Output callback function, type function, optional.
- **Example**:
  ```typescript
  import { ImagePushOptions } from '../../utils/docker/ImagePushOptions.js';
  
  const options = new ImagePushOptions({
    repo: 'docker.io/myuser/myimage',
    tag: 'v1.0.0'
  });
  ```
- **Purpose**: In the Lakutata framework, this DTO is used with the Docker Component to push local images to remote registries, suitable for image publishing and version management.
- **Data Validation Value**: DTO validation ensures the `repo` field is provided, preventing push failures due to missing target registry addresses.

#### 2.2.6 ImageRemoveOptions
Defines parameters for removing a Docker image, used to clean up local images.

- **Functionality**: Configures options for deleting images, supporting forced removal and cleanup control.
- **Fields and Validation Rules**:
    - `force`: Force image removal, type boolean, optional, defaults to `true`.
    - `noprune`: Avoid pruning unused images, type boolean, optional.
- **Example**:
  ```typescript
  import { ImageRemoveOptions } from '../../utils/docker/ImageRemoveOptions.js';
  
  const options = new ImageRemoveOptions({
    force: true,
    noprune: false
  });
  ```
- **Purpose**: In a Lakutata application, this DTO is used with the Docker Component to delete specified images, freeing up storage space.
- **Data Validation Value**: DTO validation ensures field types are correct, reducing the risk of deletion failures due to parameter errors.

#### 2.2.7 ImageTagOptions
Defines parameters for tagging a Docker image, used for image version management.

- **Functionality**: Sets a new repository and tag for an image.
- **Fields and Validation Rules**:
    - `repo`: Target repository address, type string, required. Validated by `@Expect(DTO.String().required())` to ensure it is provided.
    - `tag`: New tag name, type string, optional.
- **Example**:
  ```typescript
  import { ImageTagOptions } from '../../utils/docker/ImageTagOptions.js';
  
  const options = new ImageTagOptions({
    repo: 'myuser/myimage',
    tag: 'v2.0.0'
  });
  ```
- **Purpose**: In the Lakutata framework, this DTO is used with the Docker Component to add new tags to existing images, facilitating version management and image distribution.
- **Data Validation Value**: DTO validation ensures the `repo` field is provided, avoiding tagging operation failures due to missing target repository addresses.

### 2.3 Network Management DTOs

#### 2.3.1 NetworkCreateOptions
Defines parameters for creating a Docker network, used to configure communication networks between containers.

- **Functionality**: Configures a new Docker network's name, driver, and IPAM settings, supporting custom network isolation and communication.
- **Fields and Validation Rules**:
    - `name`: Network name, type string, required. Validated by `@Expect(DTO.String().required())` to ensure it is provided.
    - `options`: Driver-specific options, type object, optional, defaults to an empty object.
    - `driver`: Network driver type, type string, optional, defaults to "bridge". Validated by `@Expect(DTO.String().valid('bridge', 'ipvlan', 'macvlan').optional().default('bridge'))` to restrict to allowed values.
    - `NetworkIPAMConfigs`: Network IPAM configuration array, type array of objects, defaults to an empty array. Validated by `@Expect(DTO.Array(DTO.Object({...})))` to define sub-field validation rules (e.g., `subnet` and `gateway` must be valid IP addresses).
    - `internal`: Restrict external access, type boolean, optional.
    - `enableIPv6`: Enable IPv6 support, type boolean, optional.
- **Example**:
  ```typescript
  import { NetworkCreateOptions } from '../../utils/docker/NetworkCreateOptions.js';
  
  const options = new NetworkCreateOptions({
    name: 'my-network',
    driver: 'bridge',
    NetworkIPAMConfigs: [{ subnet: '192.168.1.0/24', gateway: '192.168.1.1' }]
  });
  ```
- **Purpose**: In the Lakutata framework, this DTO is used with the Docker Component to create custom networks, supporting communication configuration and network isolation between containers, ideal for multi-container application deployments.
- **Data Validation Value**: DTO validation ensures the `name` field is provided, the `driver` field value is within the allowed range, and IP addresses in `NetworkIPAMConfigs` are correctly formatted, preventing network creation failures due to configuration errors.

## 3. Design Advantages of Docker Component as a Preset Component

In the Lakutata framework, the Docker Component exists as a preset component, offering the following design advantages:
- **Ready-to-Use**: The Docker Component is built into the framework, allowing developers to directly access instances via the IoC container without additional installation or configuration, lowering the entry barrier.
- **Unified Management**: Through Lakutata's IoC container, the Docker Component's lifecycle and dependencies are uniformly managed by the framework, ensuring consistent behavior across different environments.
- **Deep Integration with the Framework**: The Docker Component seamlessly collaborates with other Lakutata modules (e.g., controllers, services, event systems), enabling developers to directly invoke Docker functionalities within business logic, such as dynamically building images in a controller or managing containers in a service layer.
- **Extensibility Support**: Developers can extend the Docker Component's functionalities based on provided DTOs and interfaces, such as adding custom Docker operations or adjusting connection parameters to meet specific needs.

## 4. Use Cases for Docker Integration

- **Containerized Development and Testing**: Using `ContainerStopOptions` and `ContainerTTYConsoleSizeOptions`, developers can manage container lifecycles and interactive terminals, suitable for development and testing environments. For example, dynamically adjusting terminal sizes during application debugging or gracefully stopping containers after testing.
- **Image Building and Distribution**: With `ImageBuildOptions`, `ImageExportOptions`, and `ImageImportOptions`, developers can build, export, and import custom images, supporting CI/CD workflows. For instance, automatically building images and exporting them to specified locations in a CI pipeline via Lakutata.
- **Image Registry Management**: Through `ImagePullOptions` and `ImagePushOptions`, developers can pull images from or push images to Docker registries, suitable for image version management and deployment. For example, pulling the latest image version via Lakutata before deployment.
- **Network Configuration**: Using `NetworkCreateOptions`, developers can create custom networks to optimize communication and isolation between containers. For instance, creating an internal network via Lakutata for secure communication between services in a multi-container application.
- **Automation and Scheduling**: Combined with Lakutata's event system and scheduled tasks, developers can automate Docker operations, such as periodically cleaning unused images or regularly pulling updates.

## 5. Advantages and Features of Docker Integration

- **Type Safety and Strict Validation**: Through DTOs and `@Expect` decorators, input parameters are strictly validated to ensure legitimacy and completeness, reducing runtime errors. For example, `ImageBuildOptions` ensures `workdir` and `files` fields are provided and of the correct type.
- **Modularity and IoC Integration**: The Docker Component adheres to Lakutata's modular design, managed by the IoC container, supporting dependency injection and modular invocation, enhancing code maintainability.
- **Comprehensive Functionality Coverage**: Covers multiple aspects of container management, image operations, and network configuration, meeting the needs of containerized application development, testing, and deployment.
- **Ease of Use and Consistency**: DTOs are intuitively designed with flexible parameter configurations, allowing developers to quickly adopt Docker operations, while the framework's unified parameter validation and component management ensure consistent operation behavior.
- **Performance and Stability**: Through preset components and DTO validation mechanisms, the Docker integration module ensures performance and stability, such as avoiding Docker operation failures due to parameter errors.

## Summary

Lakutata's Docker integration module, through the preset **Docker Component** and a set of structured DTOs, provides developers with a programmatic interface to interact with Docker, covering key functionalities like container management, image operations, and network configuration. As a preset component within the Lakutata framework, the Docker Component leverages the framework's IoC design philosophy and modular characteristics, ensuring seamless operation within applications via dependency injection and type safety mechanisms. The DTO system, combined with `@Expect` decorators, offers strict data validation for operation parameters, reducing runtime errors and enhancing code reliability. The Docker integration module is applicable to various scenarios in containerized development, testing, building, and deployment, providing developers with powerful and user-friendly support in containerized environments.