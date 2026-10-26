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
+ (void)forwardEngineEvents;
+ (void)observe:(NSString *)topic handler:(void (^)(NSDictionary<NSString *, id> *payload))handler;
@end

NS_ASSUME_NONNULL_END
