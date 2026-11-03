#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The lifecycle of the Node.js of the application, for the scene delegate
 */
@interface LakutataNode : NSObject

/**
 * Tell the application it goes to the background and wait until it is ready (its answer, or the timeout); blocks,
 * so it is called off the main thread, within a background task
 * @param timeout the seconds waited at most
 * @return whether the application answered in time
 */
+ (BOOL)pauseWithTimeout:(NSTimeInterval)timeout;

/**
 * Tell the application it came back from the background
 */
+ (void)resume;

@end

NS_ASSUME_NONNULL_END
