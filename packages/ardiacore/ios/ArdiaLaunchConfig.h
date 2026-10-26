#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

NS_SWIFT_NAME(LaunchConfig)
@interface ArdiaLaunchConfig : NSObject

@property(class, readonly) ArdiaLaunchConfig *shared;

- (instancetype)initWithEnvironment:(NSDictionary<NSString *, NSString *> *)environment
              signedForDistribution:(BOOL (^)(void))signedForDistribution NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property(readonly, nullable) NSString *dataDirectory;
@property(readonly) BOOL background;
@property(readonly, nullable) NSNumber *remoteDebuggingPort;
@property(readonly) BOOL prewarm;
@property(readonly) BOOL isolated;
@property(readonly) BOOL testInstance;

- (nullable NSString *)instance:(NSString *)key NS_SWIFT_NAME(instance(_:));
- (BOOL)instanceFlag:(NSString *)key NS_SWIFT_NAME(instanceFlag(_:));
- (nullable NSNumber *)switchOverride:(NSString *)name NS_SWIFT_NAME(switchOverride(_:));
- (BOOL)switchOn:(NSString *)name NS_SWIFT_NAME(switchOn(_:));
- (BOOL)experimentOn:(NSString *)name NS_SWIFT_NAME(experimentOn(_:));
- (BOOL)traced:(NSString *)area NS_SWIFT_NAME(traced(_:));
- (nullable NSString *)testValue:(NSString *)key NS_SWIFT_NAME(testValue(_:));
- (BOOL)testFlag:(NSString *)key NS_SWIFT_NAME(testFlag(_:));

@property(readonly) NSArray<NSString *> *engineSwitches;
@property(readonly) NSDictionary<NSString *, NSString *> *environmentForChildProcesses;
@property(readonly) NSDictionary<NSString *, id> *snapshot;

@end

NS_ASSUME_NONNULL_END
