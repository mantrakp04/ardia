#import "ArdiaCore.h"

@class ArdiaWebView;

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaWindowController : NSObject <ArdiaCoreWindowDelegate>
+ (nullable ArdiaWindowController *)forNSWindow:(nullable NSWindow *)window;
+ (NSArray<ArdiaWindowController *> *)all;
@property(nonatomic, readonly) ArdiaCoreWindow *coreWindow;
@property(nonatomic, strong, nullable) NSView *root;
@property(nonatomic) NSInteger hostChanges;
@property(nonatomic, copy, nullable) NSString *appWindowId;
+ (ArdiaWindowController *)strayWindowForProfile:(ArdiaCoreProfile *)profile;
+ (nullable ArdiaWindowController *)chromeMadeWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL stray;
+ (ArdiaWindowController *)standaloneWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL standalone;
- (void)noteClosing:(ArdiaCoreTab *)tab;
+ (nullable ArdiaWindowController *)holding:(ArdiaCoreTab *)tab;
+ (nullable ArdiaWebView *)hostingViewForProfile:(nullable ArdiaCoreProfile *)profile;
+ (BOOL)userSees:(nullable NSWindow *)window;
+ (nullable instancetype)claimChromeMadeWindow:(nullable NSString *)token;
- (instancetype)initWithCoreWindow:(ArdiaCoreWindow *)coreWindow;
@end
extern NSNotificationName const ArdiaWindowSeenDidChange;

NS_ASSUME_NONNULL_END
