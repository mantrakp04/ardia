#import "ArdiaWebView.h"

NS_ASSUME_NONNULL_BEGIN

NSUInteger ArdiaVaultContextIndex(NSArray<NSString *> *titles);

@interface ArdiaWebView (VaultContextMenuInternal)
- (void)noteVaultContext:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main origin:(nullable NSString *)origin;
- (NSArray<NSMenuItem *> *)takeVaultContextMenuItems;
+ (void)ensureVaultContextMenuHook;
- (BOOL)takeVaultContextFill;
- (BOOL)pickVaultContextMenu:(NSString *)pick redump:(void (^)(NSArray<NSDictionary *> *described))redump;
- (NSArray<NSDictionary *> *)describeVaultContextItems:(NSArray<NSMenuItem *> *)items;
@end

NS_ASSUME_NONNULL_END
