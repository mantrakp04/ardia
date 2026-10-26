#import <AppKit/AppKit.h>

@class ArdiaCoreTab;

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaEarlyWindow : NSObject
+ (void)setDataDirectory:(nullable NSString *)directory;
+ (void)noteLayoutChangeIn:(nullable NSWindow *)window;
+ (void)recordNow;
+ (void)prefetchForSession:(NSDictionary *)session;
+ (void)discardPrefetch;
+ (BOOL)canShowWindow:(NSString *)windowId session:(NSDictionary *)session;
+ (BOOL)showWindow:(NSString *)windowId
             frame:(NSArray<NSNumber *> *)frame
               key:(NSString *)key
           profile:(NSString *)profile
          backdrop:(NSDictionary *)backdrop;
+ (void)attachPage:(ArdiaCoreTab *)tab key:(NSString *)key;
+ (BOOL)showLittleWindowForLink:(ArdiaCoreTab *)tab
                           mark:(NSString *)mark
                            url:(NSString *)url
                          frame:(NSArray<NSNumber *> *)frame
                        profile:(NSString *)profile
                       backdrop:(NSDictionary *)backdrop
                           like:(nullable NSString *)windowId;
+ (nullable NSWindow *)claimLittleWindowForLink:(NSString *)mark profile:(nullable NSString *)profile;
+ (void)forgetPictures;
+ (void)forgetPicturesNow;
+ (BOOL)holdsPage:(ArdiaCoreTab *)tab;
+ (nullable NSWindow *)claimForAppWindow:(nullable NSString *)windowId profile:(nullable NSString *)profile;
+ (BOOL)takeDismissed:(nullable NSString *)windowId;
+ (nullable NSView *)coverInWindow:(nullable NSWindow *)window;
+ (void)rootEmbedded:(NSView *)root inWindow:(NSWindow *)window;
@end

@interface ArdiaEarlyWindow (Pages)
+ (void)pageMoved:(ArdiaCoreTab *)tab;
+ (void)pageNavigated:(nullable ArdiaCoreTab *)tab launchURL:(nullable NSString *)launchURL;
+ (BOOL)veils:(nullable ArdiaCoreTab *)tab;
+ (void)requestFocus:(nullable ArdiaCoreTab *)tab;
+ (void)page:(nullable ArdiaCoreTab *)tab shownURL:(nullable NSString *)url;
+ (void)pageCommitted:(nullable ArdiaCoreTab *)tab shownURL:(nullable NSString *)url;
+ (void)page:(nullable ArdiaCoreTab *)tab emitted:(nullable NSString *)url;
+ (void)dropPage:(nullable ArdiaCoreTab *)tab;
@end

NS_ASSUME_NONNULL_END
