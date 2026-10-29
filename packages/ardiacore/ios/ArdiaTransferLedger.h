#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaTransferLedger : NSObject

- (NSInteger)prepare:(NSString *)key;
- (NSInteger)holdForReload:(NSString *)key;
- (BOOL)isPrepared:(NSString *)key;
- (NSInteger)park:(NSString *)key;
- (NSInteger)drop:(NSString *)key;
- (void)claim:(NSString *)key;
- (BOOL)expireReloadHold:(NSString *)key generation:(NSInteger)generation;
- (BOOL)retireParked:(NSString *)key generation:(NSInteger)generation;
- (void)unpark:(NSString *)key;
- (NSInteger)parkedGeneration:(NSString *)key;

@end

NS_ASSUME_NONNULL_END
