#import "ArdiaCore.h"

@class ArdiaWebView;

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaTabRegistry : NSObject
+ (void)setView:(nullable ArdiaWebView *)view forTab:(ArdiaCoreTab *)tab;
+ (nullable ArdiaWebView *)viewForTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab prefix:(NSString *)prefix;
+ (nullable ArdiaCoreTab *)takeOffered:(NSString *)adoptId;
+ (nullable ArdiaCoreTab *)offeredTab:(NSString *)adoptId;
+ (void)forget:(ArdiaCoreTab *)tab;
@end

NS_ASSUME_NONNULL_END
