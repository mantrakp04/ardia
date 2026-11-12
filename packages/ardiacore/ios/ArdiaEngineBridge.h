#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaEngineBridge : NSObject
+ (void)call:(NSString *)name
       profile:(NSString *)profile
          args:(nullable NSString *)args
    completion:(void (^)(NSString *json))completion NS_SWIFT_NAME(call(_:profile:args:completion:));
+ (void)callWithSecret:(NSString *)name
               profile:(NSString *)profile
                  args:(NSMutableData *)args
            completion:(void (^)(NSString *json))completion NS_SWIFT_NAME(callWithSecret(_:profile:args:completion:));
+ (void)callForSecretReply:(NSString *)name
                   profile:(NSString *)profile
                   timeout:(NSTimeInterval)timeout
                completion:(void (^)(NSDictionary<NSString *, id> *_Nullable reply))completion
    NS_SWIFT_NAME(callForSecretReply(_:profile:timeout:completion:));
+ (void)forwardEngineEvents;
+ (void)observe:(NSString *)topic handler:(void (^)(NSDictionary<NSString *, id> *payload))handler;
@end

NS_ASSUME_NONNULL_END
