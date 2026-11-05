#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaSavedSession : NSObject

@property(class, readonly) NSInteger version;
@property(readonly) NSInteger fileVersion;

+ (nullable instancetype)readFrom:(nullable NSString *)directory;
+ (nullable instancetype)atLaunch:(nullable NSString *)directory;

@property(readonly, nullable) NSString *focusedWindowId;
@property(readonly, nullable) NSString *linkProfile;
@property(readonly, nullable) NSString *launchTabId;
@property(readonly, nullable) NSString *launchTabURL;
@property(readonly, nullable) NSString *launchTabProfile;
@property(readonly, nullable) NSDictionary *launchBackdrop;
@property(readonly) NSDictionary *settings;
@property(readonly, nullable) id profiles;
@property(readonly) NSArray<NSDictionary *> *windows;
@property(readonly) NSArray<NSDictionary *> *tabs;
@property(readonly) NSArray<NSDictionary *> *groups;
@property(readonly) NSArray<NSDictionary *> *splits;

- (nullable NSDictionary *)windowWithId:(NSString *)windowId;
- (nullable id)pinOfTab:(NSDictionary *)tab;
- (NSArray<NSString *> *)tabIdsOfSplit:(NSDictionary *)split;

@end

NS_ASSUME_NONNULL_END
