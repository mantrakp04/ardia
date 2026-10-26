#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaFavicons : NSObject
+ (void)fetch:(NSString *)url
       profile:(NSString *)profile
          name:(nullable NSString *)name
    completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(fetch(_:profile:name:completion:));
@end

NS_ASSUME_NONNULL_END
