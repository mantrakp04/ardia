#import "ArdiaInternal.h"
#import "ArdiaContentBlocker.h"
#import "ArdiaServices.h"

@interface ArdiaContentBlockerPage : NSObject <ArdiaCoreTabDelegate>
@property(readonly) ArdiaCoreTab *tab;
@property(readonly) NSString *origin;
@property(readonly) BOOL dead;
- (instancetype)initWithTab:(ArdiaCoreTab *)tab origin:(NSString *)origin;
- (BOOL)onOwnPage;
- (void)run:(NSString *)script completion:(void (^)(id value, NSString *error))completion;
- (void)leftOwnPage;
- (void)next;
- (void)fail:(NSString *)error;
@end

namespace ardia_content_blocker {

NSString *ExtensionId();
extern NSString *const kLiteId;
extern NSString *const kLiteReaderName;
extern NSString *const kLiteMovedMarker;
extern bool gFailNextMessage;
NSString *ScriptWith(NSString *format, NSArray *args);
extern NSString *const kProfile;
NSMutableOrderedSet<NSString *> *LoadedProfiles();
NSMutableDictionary<NSString *, ArdiaContentBlockerPage *> *Pages();
ArdiaContentBlockerPage *HiddenPage(NSString *key, NSString *profile, ArdiaCoreProfile *p, NSString *extensionId, NSString *file);
void LoadIntoProfile(NSString *profile, void (^then)(NSString *error));
extern NSString *const kOffDirective;
void Call(NSString *profile, NSString *expression, void (^completion)(id value, NSString *error));
bool LiteSettingsPending(ArdiaCoreProfile *p);
void MoveLiteSettings(NSString *profile, ArdiaCoreProfile *p, void (^done)(void));

}
