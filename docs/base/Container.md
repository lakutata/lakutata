## Description

Lakutata's dependency injection container is heavily inspired by [Awilix](https://github.com/jeffijoe/awilix). Although
Node.js itself does not provide a
built-in object destructor, the container division and management of container lifecycles in Lakutata allow for the
management of object lifecycles within the container. In Lakutata, for objects with a Transient lifecycle, the destroy
function within the object will still be called when the container is destroyed. This is achieved by using WeakRef to
manage the object references. If a Transient object still exists when the container is destroyed, its destroy function
will be explicitly called for cleanup.

The dependency injection container in the Lakutata framework is designed for asynchronous loading and registration of
modules. Therefore, the initialization functions in the BaseObject are all asynchronous functions. The registered
objects loaded using the @Inject() decorator within the objects, when loaded into the object, have already completed
their asynchronous initialization. Thus, they can be called normally within the object. However, for manual container
registration and retrieval of registered objects, the await keyword needs to be used for asynchronous waiting.
