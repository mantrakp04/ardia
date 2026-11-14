#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaContentBlocker : NSObject
+ (void)state:(void (^)(NSDictionary<NSString *, id> *state))completion NS_SWIFT_NAME(state(_:));
+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setEnabled(_:completion:));
+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setList(_:enabled:completion:));
+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL allowed))completion NS_SWIFT_NAME(isAllowed(host:completion:));
+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setAllowed(_:host:completion:));
+ (void)addList:(NSString *)url completion:(void (^)(NSDictionary<NSString *, id> *_Nullable list, NSString *_Nullable error))completion
    NS_SWIFT_NAME(addList(_:completion:));
+ (void)removeList:(NSString *)listId completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(removeList(_:completion:));
+ (void)updateList:(NSString *)listId completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(updateList(_:completion:));
+ (void)userFilters:(void (^)(NSString *text, NSString *_Nullable error))completion NS_SWIFT_NAME(userFilters(_:));
+ (void)setUserFilters:(NSString *)text completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setUserFilters(_:completion:));
+ (void)devFailNextMessage;
+ (void)devDelayNextLoad:(double)ms;
@end

NS_ASSUME_NONNULL_END
