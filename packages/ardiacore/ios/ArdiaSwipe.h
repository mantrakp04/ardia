#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol ArdiaSwipeTarget <NSObject>
@property (nonatomic, readonly) BOOL canSwipeBack;
@property (nonatomic, readonly) BOOL canSwipeForward;
@property (nonatomic, readonly) BOOL tracksUnavailableDirections;
@property (nonatomic, readonly) BOOL allowsVerticalMotion;
@property (nonatomic, readonly) BOOL isPager;
@property (nonatomic, readonly) BOOL hasNativePager;
- (void)pagerInput:(NSString *)phase distance:(CGFloat)distance direction:(int)direction timestamp:(NSTimeInterval)timestamp;
- (void)swipeEvent:(NSDictionary<NSString *, id> *)event;
@end

@interface ArdiaSwipe : NSObject

+ (void)performHaptic:(NSString *)pattern;

+ (void)addTarget:(NSView<ArdiaSwipeTarget> *)target;
+ (void)removeTarget:(NSView<ArdiaSwipeTarget> *)target;

@end

@interface ArdiaSwipe (Simulation)

+ (void)simulateInWindow:(NSWindow *)window
                   point:(NSPoint)point
                   steps:(NSArray<NSDictionary<NSString *, id> *> *)steps
  ignoreSystemPreference:(BOOL)ignoreSystemPreference
              completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

@end

NS_ASSUME_NONNULL_END
