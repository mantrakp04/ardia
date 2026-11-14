#import "ArdiaCore.h"

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaFairPlay : NSObject
@property(class, readonly) BOOL available;
+ (BOOL)servesOrigin:(nullable NSString *)origin;
+ (void)tab:(ArdiaCoreTab *)tab frame:(NSString *)frameId message:(NSDictionary *)message;
+ (void)pageGoneFromTab:(nullable ArdiaCoreTab *)tab;
+ (void)muteChangedInTab:(nullable ArdiaCoreTab *)tab;
+ (BOOL)playsInTab:(nullable ArdiaCoreTab *)tab;
@end

NS_ASSUME_NONNULL_END
