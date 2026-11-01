#pragma once

#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>
#include <memory>

namespace lakutata {

/**
 * The TurboModule of the Node.js of the application (hand written, the same on Android, iOS and HarmonyOS):
 * start(environment), send(line), listen(callback), pause(), resume()
 */
class NodeHostTurboModule : public facebook::react::TurboModule {
public:
    static constexpr const char *kModuleName = "LakutataNodeHost";
    explicit NodeHostTurboModule(std::shared_ptr<facebook::react::CallInvoker> jsInvoker);

    std::shared_ptr<facebook::react::CallInvoker> invoker() const {
        return jsInvoker_;
    }
};

}
