#import "ArdiaTabParking.h"

@class ArdiaWebView;

@interface ArdiaLaunchTabHolder : NSObject <ArdiaParkedPageHolder>
@property (nonatomic, copy) NSString *url;
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, readonly) BOOL closedByChrome;
- (void)replayTo:(ArdiaWebView *)view tab:(ArdiaCoreTab *)tab;
@end
