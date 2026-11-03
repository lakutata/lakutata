// Node.js run through its embedding API: the host keeps its process. process.exit() and the uncaught exceptions stop
// the environment (node::Stop) instead of ending the process, and Node.js may run again in the same process
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <node.h>
#include <uv.h>

// Initialized once per process (V8 cannot be initialized twice in a process) and never torn down: each run creates an
// environment of its own on the platform made here
static std::shared_ptr<node::InitializationResult> initialization;

/**
 * Run Node.js until its environment ends; the first call takes the arguments (the program, the options of Node.js, the
 * entry and its arguments), the later ones run the same entry again
 * @return the exit code (the one given to process.exit(), 1 after an uncaught exception)
 */
extern "C" __attribute__((visibility("default"))) int lakutata_node_run(int argc, char **argv) {
    if (!initialization) {
        argv = uv_setup_args(argc, argv);
        initialization = node::InitializeOncePerProcess(std::vector<std::string>(argv, argv + argc));
        for (const std::string &error : initialization->errors()) fprintf(stderr, "node: %s\n", error.c_str());
        if (initialization->early_return()) return initialization->exit_code();
    }
    std::vector<std::string> errors;
    std::unique_ptr<node::CommonEnvironmentSetup> setup = node::CommonEnvironmentSetup::Create(
        initialization->platform(), &errors, initialization->args(), initialization->exec_args());
    if (!setup) {
        for (const std::string &error : errors) fprintf(stderr, "node: %s\n", error.c_str());
        return 1;
    }
    v8::Isolate *isolate = setup->isolate();
    node::Environment *env = setup->env();
    int exitCode = 0;
    bool exited = false;
    {
        v8::Locker locker(isolate);
        v8::Isolate::Scope isolateScope(isolate);
        v8::HandleScope handleScope(isolate);
        v8::Context::Scope contextScope(setup->context());
        // Set before the entry runs: an exit while it loads is taken too. The default handler disposes of the
        // platform and calls exit()
        node::SetProcessExitHandler(env, std::function<void(node::Environment *, int)>(
            [&exitCode, &exited](node::Environment *environment, int code) {
                exitCode = code;
                exited = true;
                node::Stop(environment);
            }));
        // No callback: the entry (args[1]) runs as the command line runs it
        node::LoadEnvironment(env, node::StartExecutionCallback{});
        if (!exited) {
            v8::Maybe<int> code = node::SpinEventLoop(env);
            if (!exited) exitCode = code.FromMaybe(1);
        }
    }
    node::Stop(env);
    setup.reset();
    return exitCode;
}
