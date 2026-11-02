#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaContentBlocker : NSObject
+ (void)state:(void (^)(NSDictionary<NSString *, id> *state))completion NS_SWIFT_NAME(state(_:));
+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setEnabled(_:completion:));
+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setList(_:enabled:completion:));
+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL allowed))completion NS_SWIFT_NAME(isAllowed(host:completion:));
+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setAllowed(_:host:completion:));
+ (void)devFailNextMessage;
+ (void)devDelayNextLoad:(double)ms;
@end

NS_ASSUME_NONNULL_END
