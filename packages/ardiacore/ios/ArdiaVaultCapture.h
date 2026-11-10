#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaVaultCapture : NSObject

- (void)noteFieldInFrame:(NSString *)frameId origin:(NSString *)origin;
- (nullable NSString *)originOfFrame:(NSString *)frameId;
- (void)forgetFrame:(NSString *)frameId;

- (BOOL)keepLogin:(NSString *)username password:(NSString *)password origin:(NSString *)origin;
- (nullable NSDictionary<NSString *, NSString *> *)takeLogin:(NSString *)origin;
- (void)discardLogin:(NSString *)origin;

- (void)keepGeneratedPassword:(NSString *)password origin:(NSString *)origin;
- (BOOL)isGeneratedPassword:(NSString *)password origin:(NSString *)origin;
- (nullable NSString *)generatedPasswordFor:(NSString *)origin;
- (nullable NSDictionary<NSString *, NSString *> *)peekLogin:(NSString *)origin;

- (NSString *)awaitFillInFrame:(NSString *)frameId reply:(void (^)(NSArray<NSString *> *filled))reply;
- (void)finishFill:(NSString *)fillId frame:(NSString *)frameId filled:(NSArray<NSString *> *)filled;

- (void)wipe;
+ (void)wipeAll;

@end

NS_ASSUME_NONNULL_END
