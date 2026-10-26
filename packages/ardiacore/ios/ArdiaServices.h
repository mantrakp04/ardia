#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ArdiaCoreResult)(NSDictionary<NSString *, id> *result);
typedef void (^ArdiaServiceReply)(id _Nullable value, NSString *_Nullable error);

@interface ArdiaServices : NSObject

+ (void)call:(NSString *)name
       profile:(NSString *)profile
          args:(nullable NSDictionary<NSString *, id> *)args
    completion:(ArdiaCoreResult)completion NS_SWIFT_NAME(call(_:profile:args:completion:));

+ (void)listPasswords:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(listPasswords(profile:reply:));
+ (void)unlockPasswords:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(unlockPasswords(profile:reply:));
+ (void)password:(NSString *)profile origin:(NSString *)origin username:(NSString *)username reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(password(profile:origin:username:reply:));
+ (void)savePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
               reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(savePassword(profile:origin:username:password:reply:));
+ (void)updatePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
           newUsername:(nullable NSString *)newUsername newPassword:(nullable NSString *)newPassword reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(updatePassword(profile:origin:username:newUsername:newPassword:reply:));
+ (void)deletePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(deletePassword(profile:origin:username:reply:));
+ (void)neverSaveOrigins:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(neverSaveOrigins(profile:reply:));
+ (void)allowSaving:(NSString *)profile origin:(NSString *)origin reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(allowSaving(profile:origin:reply:));
+ (void)exportPasswords:(NSString *)profile path:(nullable NSString *)path reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(exportPasswords(profile:path:reply:));

+ (BOOL)boolPreference:(NSString *)name profile:(NSString *)profile NS_SWIFT_NAME(boolPreference(_:profile:));
+ (void)setBoolPreference:(NSString *)name value:(BOOL)value profile:(NSString *)profile NS_SWIFT_NAME(setBoolPreference(_:value:profile:));

+ (void)addresses:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(addresses(profile:reply:));
+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(saveAddress(_:profile:reply:));
+ (void)cards:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(cards(profile:reply:));
+ (void)saveCard:(NSDictionary<NSString *, id> *)card number:(nullable NSString *)number profile:(NSString *)profile
           reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(saveCard(_:number:profile:reply:));
+ (void)deleteAutofillEntry:(NSString *)entryId profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(deleteAutofillEntry(_:profile:reply:));
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(revealCardNumber(_:profile:reply:));

+ (void)zoomLevels:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(zoomLevels(profile:reply:));
+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host NS_SWIFT_NAME(setZoom(_:profile:host:));

+ (void)listExtensions:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(listExtensions(profile:reply:));
+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path;
+ (void)installExtension:(NSString *)path profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(installExtension(path:profile:reply:));
+ (void)installCrx:(NSString *)path profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(installCrx(path:profile:reply:));
+ (void)setExtension:(NSString *)extensionId enabled:(BOOL)enabled profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(setExtension(_:enabled:profile:reply:));
+ (void)uninstallExtension:(NSString *)extensionId profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(uninstallExtension(_:profile:reply:));
+ (void)reloadExtension:(NSString *)extensionId profile:(NSString *)profile reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(reloadExtension(_:profile:reply:));
+ (void)configureExtension:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary<NSString *, id> *)options
                     reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(configureExtension(_:profile:options:reply:));
+ (void)searchEngineList:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(searchEngineList(profile:reply:));

+ (void)watchDownloadEvents;
+ (void)watchDownloads:(NSString *)profile NS_SWIFT_NAME(watchDownloads(profile:));
+ (void)downloadCommand:(NSString *)command id:(NSString *)downloadId NS_SWIFT_NAME(downloadCommand(_:id:));

+ (void)siteSettings:(NSString *)profile origin:(NSString *)origin reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(siteSettings(profile:origin:reply:));
+ (void)setSiteSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setSiteSetting(_:profile:origin:type:));
+ (void)siteSettingsOrigins:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(siteSettingsOrigins(profile:reply:));
+ (void)resetSiteSettings:(NSString *)profile origin:(NSString *)origin NS_SWIFT_NAME(resetSiteSettings(profile:origin:));
+ (void)clearSiteData:(NSString *)profile origin:(NSString *)origin reply:(ArdiaServiceReply)reply
    NS_SWIFT_NAME(clearSiteData(profile:origin:reply:));

+ (void)externalAppAllowances:(NSString *)profile reply:(ArdiaServiceReply)reply NS_SWIFT_NAME(externalAppAllowances(profile:reply:));
+ (void)removeExternalAppAllowance:(NSString *)profile origin:(NSString *)origin scheme:(NSString *)scheme
    NS_SWIFT_NAME(removeExternalAppAllowance(profile:origin:scheme:));

+ (void)tasks:(ArdiaServiceReply)reply NS_SWIFT_NAME(tasks(_:));
+ (void)components:(ArdiaServiceReply)reply NS_SWIFT_NAME(components(_:));

+ (void)clearBrowsingData:(NSString *)profile types:(NSArray<NSString *> *)types since:(double)sinceMs completion:(void (^)(void))completion
    NS_SWIFT_NAME(clearBrowsingData(profile:types:since:completion:));

@end

NS_ASSUME_NONNULL_END
