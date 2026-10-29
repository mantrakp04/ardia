#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaSavedDocument : NSObject

+ (nullable NSDictionary *)read:(NSString *)name in:(nullable NSString *)directory oldest:(NSInteger)oldest newest:(NSInteger)newest;
+ (nullable NSDictionary *)parse:(nullable NSData *)data oldest:(NSInteger)oldest newest:(NSInteger)newest;

@end

NS_ASSUME_NONNULL_END
