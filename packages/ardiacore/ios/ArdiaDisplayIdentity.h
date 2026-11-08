#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaDisplayIdentity : NSObject

+ (nullable NSString *)identifierOfScreen:(nullable NSScreen *)screen NS_SWIFT_NAME(identifier(of:));
+ (nullable NSScreen *)screenWithIdentifier:(nullable NSString *)identifier NS_SWIFT_NAME(screen(withIdentifier:));
+ (NSRect)frame:(NSRect)frame onScreen:(NSScreen *)screen NS_SWIFT_NAME(frame(_:on:));

@end

NS_ASSUME_NONNULL_END
