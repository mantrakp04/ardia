#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaEvents : NSObject

+ (void)setSender:(nullable void (^)(NSString *name, NSDictionary<NSString *, id> *data))sender
        forDomain:(NSString *)domain NS_SWIFT_NAME(setSender(_:forDomain:));
+ (BOOL)listens:(NSString *)domain;
+ (void)emit:(NSString *)name data:(NSDictionary<NSString *, id> *)data NS_SWIFT_NAME(emit(_:data:));

@end

NS_ASSUME_NONNULL_END
