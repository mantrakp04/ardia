#import "ArdiaWebView.h"

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaWebView (VaultCodeSetupInternal)
- (void)noteVaultCodeTarget:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main origin:(nullable NSString *)origin;
- (NSArray<NSMenuItem *> *)takeVaultCodeMenuItems;
- (BOOL)pickVaultCodeMenu:(NSString *)pick redump:(void (^)(NSArray<NSDictionary *> *described))redump;
- (void)noteShownVaultContextItems:(NSArray<NSMenuItem *> *)items;
- (NSArray<NSMenuItem *> *)shownVaultContextItems;
@end

NS_ASSUME_NONNULL_END
