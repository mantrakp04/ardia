#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_OPTIONS(NSUInteger, ArdiaLaunchMilestone) {
  ArdiaLaunchEngineStarted = 1 << 0,
  ArdiaLaunchAppKitWillFinish = 1 << 1,
  ArdiaLaunchAppKitDidFinish = 1 << 2,
  ArdiaLaunchJSStarted = 1 << 3,
};

@interface ArdiaLaunchSequence : NSObject

@property(class, readonly) ArdiaLaunchSequence *shared;

@property(nonatomic) BOOL engineRunning;
@property(nonatomic, readonly) BOOL launchedHidden;
@property(nonatomic, readonly) BOOL launchedForDocuments;
@property(nonatomic, readonly) BOOL shutDown;

- (BOOL)reached:(ArdiaLaunchMilestone)milestones;
- (void)reach:(ArdiaLaunchMilestone)milestone;
- (void)appKitFinishedHidden:(BOOL)hidden forDocuments:(BOOL)documents;
- (void)after:(ArdiaLaunchMilestone)milestones do:(dispatch_block_t)block;
- (void)engineShutDown;

@end

NS_ASSUME_NONNULL_END
