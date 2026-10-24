#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ArdiaCoreResult)(NSDictionary<NSString *, id> *result);

@interface ArdiaCoreServices : NSObject

+ (void)call:(NSString *)name
       profile:(NSString *)profile
          args:(nullable NSDictionary<NSString *, id> *)args
    completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(call(_:profile:args:completion:));

+ (void)listPasswords:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(listPasswords(profile:completion:));
+ (void)unlockPasswords:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(unlockPasswords(profile:completion:));
+ (void)password:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(password(profile:origin:username:completion:));
+ (void)savePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
          completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(savePassword(profile:origin:username:password:completion:));
+ (void)updatePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
           newUsername:(nullable NSString *)newUsername newPassword:(nullable NSString *)newPassword completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(updatePassword(profile:origin:username:newUsername:newPassword:completion:));
+ (void)deletePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(deletePassword(profile:origin:username:completion:));
+ (void)neverSaveOrigins:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(neverSaveOrigins(profile:completion:));
+ (void)allowSaving:(NSString *)profile origin:(NSString *)origin completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(allowSaving(profile:origin:completion:));
+ (void)exportPasswords:(NSString *)profile path:(nullable NSString *)path completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(exportPasswords(profile:path:completion:));

+ (BOOL)boolPreference:(NSString *)name profile:(NSString *)profile NS_SWIFT_NAME(boolPreference(_:profile:));
+ (void)setBoolPreference:(NSString *)name value:(BOOL)value profile:(NSString *)profile NS_SWIFT_NAME(setBoolPreference(_:value:profile:));

+ (void)addresses:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(addresses(profile:completion:));
+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(saveAddress(_:profile:completion:));
+ (void)cards:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(cards(profile:completion:));
+ (void)saveCard:(NSDictionary<NSString *, id> *)card number:(nullable NSString *)number profile:(NSString *)profile
      completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(saveCard(_:number:profile:completion:));
+ (void)deleteAutofillEntry:(NSString *)entryId profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(deleteAutofillEntry(_:profile:completion:));
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(revealCardNumber(_:profile:completion:));

+ (void)zoomLevels:(NSString *)profile completion:(void (^)(NSDictionary<NSString *, NSNumber *> *levels))completion
    NS_SWIFT_NAME(zoomLevels(profile:completion:));
+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host NS_SWIFT_NAME(setZoom(_:profile:host:));

@property(class, nonatomic, copy, nullable) void (^extensionsHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)listExtensions:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(listExtensions(profile:completion:));
+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path;
+ (void)installExtension:(NSString *)path profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(installExtension(path:profile:completion:));
+ (void)installCrx:(NSString *)path profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(installCrx(path:profile:completion:));
+ (void)setExtension:(NSString *)extensionId enabled:(BOOL)enabled profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(setExtension(_:enabled:profile:completion:));
+ (void)uninstallExtension:(NSString *)extensionId profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(uninstallExtension(_:profile:completion:));
+ (void)reloadExtension:(NSString *)extensionId profile:(NSString *)profile completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(reloadExtension(_:profile:completion:));
+ (void)configureExtension:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary<NSString *, id> *)options
                completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(configureExtension(_:profile:options:completion:));
+ (void)searchEngineList:(NSString *)profile completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(searchEngineList(profile:completion:));

@property(class, nonatomic, copy, nullable) void (^downloadsHandler)(NSDictionary<NSString *, id> *download);
+ (void)watchDownloads:(NSString *)profile NS_SWIFT_NAME(watchDownloads(profile:));
+ (void)downloadCommand:(NSString *)command id:(NSString *)downloadId NS_SWIFT_NAME(downloadCommand(_:id:));

+ (void)siteSettings:(NSString *)profile origin:(NSString *)origin completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(siteSettings(profile:origin:completion:));
+ (void)setSiteSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setSiteSetting(_:profile:origin:type:));
+ (void)siteSettingsOrigins:(NSString *)profile completion:(void (^)(NSArray<NSString *> *origins))completion
    NS_SWIFT_NAME(siteSettingsOrigins(profile:completion:));
+ (void)resetSiteSettings:(NSString *)profile origin:(NSString *)origin NS_SWIFT_NAME(resetSiteSettings(profile:origin:));
+ (void)clearSiteData:(NSString *)profile origin:(NSString *)origin completion:(ArdiaCoreResult)completion
    NS_SWIFT_NAME(clearSiteData(profile:origin:completion:));

+ (void)externalAppAllowances:(NSString *)profile completion:(void (^)(NSArray *allowances))completion
    NS_SWIFT_NAME(externalAppAllowances(profile:completion:));
+ (void)removeExternalAppAllowance:(NSString *)profile origin:(NSString *)origin scheme:(NSString *)scheme
    NS_SWIFT_NAME(removeExternalAppAllowance(profile:origin:scheme:));

+ (void)tasks:(void (^)(NSArray *tasks))completion NS_SWIFT_NAME(tasks(_:));
+ (void)components:(void (^)(NSArray *components))completion NS_SWIFT_NAME(components(_:));

+ (void)clearBrowsingData:(NSString *)profile types:(NSArray<NSString *> *)types since:(double)sinceMs completion:(void (^)(void))completion
    NS_SWIFT_NAME(clearBrowsingData(profile:types:since:completion:));

@end

@interface ArdiaCoreContentBlocker : NSObject
+ (void)state:(void (^)(NSDictionary<NSString *, id> *state))completion NS_SWIFT_NAME(state(_:));
+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setEnabled(_:completion:));
+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setList(_:enabled:completion:));
+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL allowed))completion NS_SWIFT_NAME(isAllowed(host:completion:));
+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setAllowed(_:host:completion:));
+ (void)setProvider:(NSString *)provider clickConsent:(BOOL)clickConsent completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setProvider(_:clickConsent:completion:));
+ (void)devFailNextMessage;
+ (void)devDelayNextLoad:(double)ms;
@end

NS_ASSUME_NONNULL_END
