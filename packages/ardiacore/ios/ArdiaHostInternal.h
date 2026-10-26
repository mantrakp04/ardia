#import "ArdiaInternal.h"

@interface ArdiaBootstrapDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, readonly) NSMutableArray<NSURL *> *urls;
@end

@interface ArdiaHostEngineDelegate : NSObject <ArdiaCoreEngineDelegate>
@end

namespace ardia_host {

extern id<NSApplicationDelegate> (^gMakeDelegate)(void);
extern id<NSApplicationDelegate> gAppDelegate;
extern BOOL gStarted;
extern NSString *gDataDirectory;
void WatchReservedShortcuts();
NSMutableDictionary<NSString *, ArdiaCoreProfile *> *Profiles();
NSMutableDictionary<NSString *, NSMutableArray *> *ProfileWaiters();
NSMutableSet<NSString *> *DeletedProfiles();
NSMutableSet<NSString *> *ReleasedPrivateNames();
NSMutableDictionary<NSString *, void (^)(ArdiaCoreProfile *)> *DeletionsAfterLoad();
NSString *InstalledDataDirectory();
bool IsTeamSigned();
extern ArdiaBootstrapDelegate *gBootstrap;
extern bool gScratchDataDir;
extern bool gAppKitWillFinish;
extern bool gAppKitDidFinish;
extern NSArray<NSURL *> *gPendingLaunchURLs;
extern NSArray<NSURL *> *gLaunchLinks;
extern bool gLinksHandled;
extern bool gJSStarted;
extern NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts;
void LinksArrived(NSArray<NSURL *> *urls);
void StartLaunchTab();
extern bool gEarlyWindowPending;
void StartEarlyWindow();

}
