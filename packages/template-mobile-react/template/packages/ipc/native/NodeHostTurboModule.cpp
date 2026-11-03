#include "NodeHostTurboModule.h"
#include "NodeHost.h"

using namespace facebook;

namespace lakutata {

static jsi::Value start(jsi::Runtime &rt, react::TurboModule &, const jsi::Value *args, size_t count) {
    std::vector<std::pair<std::string, std::string>> environment;
    if (count > 0 && args[0].isObject()) {
        jsi::Object object = args[0].getObject(rt);
        jsi::Array names = object.getPropertyNames(rt);
        for (size_t index = 0; index < names.size(rt); index++) {
            std::string name = names.getValueAtIndex(rt, index).getString(rt).utf8(rt);
            jsi::Value value = object.getProperty(rt, name.c_str());
            if (value.isString()) environment.emplace_back(name, value.getString(rt).utf8(rt));
        }
    }
    return jsi::String::createFromUtf8(rt, NodeHost::instance().start(environment));
}

static jsi::Value send(jsi::Runtime &rt, react::TurboModule &, const jsi::Value *args, size_t count) {
    if (count < 1 || !args[0].isString()) throw jsi::JSError(rt, "send(line): the line is a string");
    NodeHost::instance().send(args[0].getString(rt).utf8(rt));
    return jsi::Value::undefined();
}

static jsi::Value listen(jsi::Runtime &rt, react::TurboModule &module, const jsi::Value *args, size_t count) {
    if (count < 1 || !args[0].isObject() || !args[0].getObject(rt).isFunction(rt)) throw jsi::JSError(rt, "listen(callback): the callback is a function");
    auto callback = std::make_shared<jsi::Function>(args[0].getObject(rt).getFunction(rt));
    std::shared_ptr<react::CallInvoker> invoker = static_cast<NodeHostTurboModule &>(module).invoker();
    //The lines arrive on the thread reading the socket: the callback is called on the thread of JavaScript
    NodeHost::instance().listen([callback, invoker](std::string line) {
        invoker->invokeAsync([callback, line = std::move(line)](jsi::Runtime &runtime) {
            callback->call(runtime, jsi::String::createFromUtf8(runtime, line));
        });
    });
    return jsi::Value::undefined();
}

static jsi::Value pause(jsi::Runtime &, react::TurboModule &, const jsi::Value *, size_t) {
    //Not waited for: the application keeps running on Android and HarmonyOS (iOS waits in its scene delegate)
    NodeHost::instance().pause(0);
    return jsi::Value::undefined();
}

static jsi::Value resume(jsi::Runtime &, react::TurboModule &, const jsi::Value *, size_t) {
    NodeHost::instance().resume();
    return jsi::Value::undefined();
}

NodeHostTurboModule::NodeHostTurboModule(std::shared_ptr<react::CallInvoker> jsInvoker) : TurboModule(kModuleName, std::move(jsInvoker)) {
    methodMap_["start"] = MethodMetadata{1, start};
    methodMap_["send"] = MethodMetadata{1, send};
    methodMap_["listen"] = MethodMetadata{1, listen};
    methodMap_["pause"] = MethodMetadata{0, pause};
    methodMap_["resume"] = MethodMetadata{0, resume};
}

}
