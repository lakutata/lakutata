#import "LakutataNode.h"
#include "NodeHost.h"

@implementation LakutataNode

+ (BOOL)pauseWithTimeout:(NSTimeInterval)timeout
{
  return lakutata::NodeHost::instance().pause(static_cast<int>(timeout * 1000));
}

+ (void)resume
{
  lakutata::NodeHost::instance().resume();
}

@end
