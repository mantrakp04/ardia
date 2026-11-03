#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaDownloadMover : NSObject

@property(class, readonly) ArdiaDownloadMover *shared;

- (instancetype)initWithHome:(NSString *)home defaults:(nullable NSUserDefaults *)defaults NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (NSDictionary<NSString *, id> *)noteDownloadEvent:(NSDictionary<NSString *, id> *)download NS_SWIFT_NAME(noteDownloadEvent(_:));
- (void)setApprovedFolders:(NSArray<NSString *> *)folders NS_SWIFT_NAME(setApprovedFolders(_:));
- (NSDictionary<NSString *, id> *)moveDownloadAt:(NSString *)path toFolder:(NSString *)folder NS_SWIFT_NAME(moveDownload(at:toFolder:));

+ (NSString *)safeFileName:(NSString *)name;

@end

NS_ASSUME_NONNULL_END
