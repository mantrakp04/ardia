#import "ArdiaCoreInternal.h"
#import "ArdiaCoreWebView.h"

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaCoreWebView ()
- (void)openedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition;
- (void)openedRoutedTab:(ArdiaCoreTab *)tab placement:(NSDictionary<NSString *, id> *)placement;
- (void)tabRemovedFromWindow:(ArdiaCoreWindow *)window;
- (void)tabActivatedByChrome:(BOOL)chromes;
- (void)requestFocusRestore;
- (void)requestFocusRestoreIn:(NSWindow *)window;
- (void)devToolsChanged:(nullable NSView *)devToolsView;
- (void)emit:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
- (void)exitPictureInPictureInFrame:(nullable NSString *)frameId;
+ (void)keepTransfersOfWindow:(NSWindow *)window;
@property(class, nonatomic, readonly, nullable) ArdiaCoreTab *launchTab;
@property(class, nonatomic, readonly, nullable) ArdiaCoreTab *firstLinkTab;
+ (nullable NSString *)linkMarkForTab:(ArdiaCoreTab *)tab;
+ (nullable NSDictionary *)linkDecisionForTab:(ArdiaCoreTab *)tab;
+ (BOOL)holdRoutedTab:(ArdiaCoreTab *)tab placement:(NSDictionary *)placement source:(nullable ArdiaCoreTab *)source;
+ (void)dismissLinkTab:(ArdiaCoreTab *)tab;
@end

NS_ASSUME_NONNULL_END
