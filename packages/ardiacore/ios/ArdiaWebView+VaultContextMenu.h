#import "ArdiaWebView.h"

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaWebView (VaultContextMenuInternal)
- (void)noteVaultContext:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main origin:(nullable NSString *)origin;
- (NSArray<NSMenuItem *> *)takeVaultContextMenuItems;
- (BOOL)takeVaultContextFill;
- (BOOL)pickVaultContextMenu:(NSString *)pick redump:(void (^)(NSArray<NSDictionary *> *described))redump;
- (NSArray<NSDictionary *> *)describeVaultContextItems:(NSArray<NSMenuItem *> *)items;
@end

NS_ASSUME_NONNULL_END
