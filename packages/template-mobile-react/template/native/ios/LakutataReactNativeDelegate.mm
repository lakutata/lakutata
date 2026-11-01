#import "LakutataReactNativeDelegate.h"
#include "NodeHostTurboModule.h"

@implementation LakutataReactNativeDelegate

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const std::string &)name
                                                      jsInvoker:(std::shared_ptr<facebook::react::CallInvoker>)jsInvoker
{
  if (name == lakutata::NodeHostTurboModule::kModuleName) {
    return std::make_shared<lakutata::NodeHostTurboModule>(jsInvoker);
  }
  return [super getTurboModule:name jsInvoker:jsInvoker];
}

@end
