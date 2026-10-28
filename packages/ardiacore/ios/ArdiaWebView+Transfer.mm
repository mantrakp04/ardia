#import "ArdiaWebViewInternal.h"
#import "ArdiaLaunchTabHolder.h"
#import "ArdiaFieldTiming.h"
#import "ArdiaNavigationDownloads.h"
#import "ArdiaServices.h"
#import "ArdiaTabParking.h"

using namespace ardia_web_view;

static NSMutableSet<NSString *> *BoundRestoreKeys() {
  static NSMutableSet *keys = [NSMutableSet set];
  return keys;
}

static const NSUInteger kMaxSavedHistoryBytes = 32 * 1024 * 1024;

static NSString *SavedHistoryGeneration(ArdiaCoreProfile *profile) {
  __block NSString *generation = nil;
  [ArdiaServices call:@"ac_tab_history_generation" profile:ardia_host::ProfileName(profile) args:nil
               completion:^(NSDictionary *result) {
                 if (result[@"error"]) return;
                 if ([result[@"generation"] isKindOfClass:NSString.class]) {
                   generation = result[@"generation"];
                 } else if ([result[@"fromMarker"] isEqual:@YES]) {
                   NSString *marker = [profile.path stringByAppendingPathComponent:@"Ardia Tab History Cleared"];
                   NSString *saved = [NSString stringWithContentsOfFile:marker encoding:NSUTF8StringEncoding error:nil];
                   if (saved || ![NSFileManager.defaultManager fileExistsAtPath:marker])
                     generation = [saved ?: @"" stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
                 }
               }];
  return generation;
}

static ArdiaCoreTab *RestoreSavedHistory(ArdiaWindowController *controller, ArdiaCoreProfile *profile, NSString *key, NSString *url) {
  if (!key.length || !url.length || [BoundRestoreKeys() containsObject:key] || !profile.path.length ||
      profile.offTheRecord || !controller.coreWindow)
    return nil;
  NSData *keyBytes = [key dataUsingEncoding:NSUTF8StringEncoding];
  const unsigned char *raw = (const unsigned char *)keyBytes.bytes;
  NSMutableString *name = [NSMutableString stringWithCapacity:keyBytes.length * 2];
  for (NSUInteger i = 0; i < keyBytes.length; i++) [name appendFormat:@"%02X", raw[i]];
  NSString *file = [[profile.path stringByAppendingPathComponent:@"Ardia Tab History"] stringByAppendingPathComponent:name];
  NSData *data = [NSData dataWithContentsOfFile:file options:NSDataReadingMappedIfSafe error:nil];
  if (!data.length || data.length > kMaxSavedHistoryBytes) return nil;
  NSDictionary *saved = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![saved isKindOfClass:NSDictionary.class] || ![saved[@"version"] isEqual:@1]) return nil;
  NSString *state = [saved[@"state"] isKindOfClass:NSString.class] ? saved[@"state"] : nil;
  NSString *committed = [saved[@"url"] isKindOfClass:NSString.class] ? saved[@"url"] : nil;
  NSString *shown = [saved[@"virtualUrl"] isKindOfClass:NSString.class] ? saved[@"virtualUrl"] : nil;
  if (!state.length || !(SamePage(committed, url) || SamePage(shown, url))) return nil;
  NSString *generation = SavedHistoryGeneration(profile);
  if (!generation || ![saved[@"generation"] isEqual:generation]) return nil;
  controller.hostChanges++;
  ArdiaCoreTab *tab = [controller.coreWindow restoreTab:state profile:profile foreground:NO];
  controller.hostChanges--;
  [tab loadIfNeeded];
  return tab;
}

static ArdiaCoreTab *StartParkedPage(NSString *url, NSString *profileName, NSString *key) {
  if (!url.length || !ArdiaHost.isStarted) return nil;
  NSString *scheme = [NSURLComponents componentsWithString:url].scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return nil;
  profileName = profileName ?: @"";
  if (ardia_host::IsPrivateProfile(profileName) || ardia_host::IsDeletedProfile(profileName)) return nil;
  ArdiaCoreProfile *profile = ardia_host::LoadedProfile(profileName);
  if (!profile || ardia_host::WasNavigationDownload(url, profileName)) return nil;
  ArdiaWindowController *keeper = [ArdiaWindowController strayWindowForProfile:profile];
  if (!keeper) return nil;
  ArdiaCoreTab *tab = RestoreSavedHistory(keeper, profile, key, url);
  keeper.hostChanges++;
  if (!tab) tab = [keeper.coreWindow openTab:url profile:profile foreground:NO];
  keeper.hostChanges--;
  if (!tab) {
    [keeper.coreWindow close];
    return nil;
  }
  ArdiaLaunchTabHolder *holder = [ArdiaLaunchTabHolder new];
  holder.url = url;
  holder.profile = profileName;
  [ArdiaTabParking keepOffscreen:tab holder:holder];
  return tab;
}

@implementation ArdiaWebView (Transfer)

+ (void)prepareTransfer:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  dispatch_async(dispatch_get_main_queue(), ^{
    for (ArdiaWebView *view in LiveViews().allObjects)
      if (view->_tab && [view->_transferKey isEqualToString:key]) view->_handingOff = YES;
  });
}

+ (void)releaseTransfer:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  dispatch_async(dispatch_get_main_queue(), ^{
    for (ArdiaWebView *view in LiveViews().allObjects)
      if ([view->_transferKey isEqualToString:key]) view->_handingOff = NO;
    [ArdiaTabParking releaseTransfer:key];
  });
}

+ (void)startLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profileName {
  [ArdiaTabParking holdLaunchTab:transferKey url:url profile:profileName opening:^ArdiaCoreTab * {
    return StartParkedPage(url, profileName, transferKey);
  }];
}

+ (void)claimLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profile {
  [ArdiaTabParking claimLaunchTab:transferKey url:url profile:profile];
}

+ (void)startLinkTabs:(NSArray<NSString *> *)urls profile:(NSString *)profileName {
  NSString *profile = [profileName copy] ?: @"";
  [ArdiaTabParking holdLinkTabs:urls profile:profile opening:^ArdiaCoreTab *(NSString *url) {
    return StartParkedPage(url, profile, nil);
  }];
}

+ (NSDictionary<NSString *, id> *)routeLinkTabs:(NSArray<NSString *> *)urls {
  return [ArdiaTabParking routeLinkTabs:urls];
}

- (BOOL)takeLinkTab:(NSString *)adoptId {
  ArdiaCoreTab *tab = [ArdiaTabParking parkLinkTab:adoptId forKey:_transferKey];
  if (!tab) return NO;
  if ([self takeTransferredTab]) return YES;
  [ArdiaTabParking discardTab:tab forKey:_transferKey];
  return NO;
}

- (void)ensureTab {
  if (_tab || _creating || _offerClosed || !self.window || !ArdiaHost.isStarted || !self.controller) return;
  if ([self takeTransferredTab]) return;
  if ([_adoptId hasPrefix:@"link:"]) {
    NSString *link = _adoptId;
    _adoptId = nil;
    if ([ArdiaTabParking takeDismissedLinkMark:link]) {
      _offerClosed = YES;
      __weak ArdiaWebView *weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        [weakSelf emit:@"windowClose" payload:@{}];
      });
      return;
    }
    if (!_standalone && !_extensionHost.length && [self takeLinkTab:link]) return;
  }
  if ([_adoptId hasPrefix:@"ardiacore:"] || [_adoptId hasPrefix:@"tab:"]) {
    ArdiaCoreTab *offered = [ArdiaTabRegistry takeOffered:_adoptId];
    _adoptId = nil;
    if (offered.closed) {
      _offerClosed = YES;
      __weak ArdiaWebView *weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        [weakSelf emit:@"windowClose" payload:@{}];
      });
      return;
    }
    if (offered && ![self canTake:offered]) {
      if (!offered.closed) [offered closeNow];
      offered = nil;
    }
    if (offered && !offered.closed) return [self attach:offered];
  }
  NSString *kind = nil, *key = nil;
  NSRange colon = _adoptId ? [_adoptId rangeOfString:@":"] : NSMakeRange(NSNotFound, 0);
  if (colon.location != NSNotFound) {
    kind = [_adoptId substringToIndex:colon.location];
    key = [_adoptId substringFromIndex:NSMaxRange(colon)];
  }
  _adoptId = nil;
  _creating = YES;
  const NSUInteger generation = ++_createGeneration;
  __weak ArdiaWebView *weakSelf = self;
  ardia_host::WithProfile(_profile, ^(ArdiaCoreProfile *profile) {
    ArdiaWebView *view = weakSelf;
    if (!view || view->_createGeneration != generation) return;
    view->_creating = NO;
    ArdiaWindowController *controller = view.controller;
    if (!profile || view->_tab || !controller) return;
    const BOOL standalone = view->_standalone;
    NSString *url = view->_pendingURL ?: view->_initialURL;
    view->_pendingURL = nil;
    view->_creatingURL = url;
    view->_creatingAt = CACurrentMediaTime();
    if (view->_extensionHost.length && url.length && controller.coreWindow) {
      if (ArdiaCoreTab *tab = [controller.coreWindow openExtensionView:url profile:profile kind:view->_extensionHost])
        return [view attach:tab];
    }
    if (standalone) controller = [ArdiaWindowController standaloneWindowForProfile:profile] ?: controller;
    if (!standalone && [kind isEqualToString:@"clone"] && [view cloneTab:key profile:profile]) return;
    if (!standalone && [kind isEqualToString:@"restore"] && url.length && !ardia_host::IsPrivateProfile(view->_profile) && controller.coreWindow) {
      view->_creating = YES;
      [ArdiaServices call:@"ac_tab_restore_take" profile:view->_profile args:@{@"key" : key}
                completion:^(NSDictionary *result) {
                  ArdiaWebView *later = weakSelf;
                  if (!later || later->_createGeneration != generation) return;
                  later->_creating = NO;
                  ArdiaWindowController *now = later.controller;
                  if (later->_tab || !now) return;
                  NSString *state = [result[@"state"] isKindOfClass:NSString.class] ? result[@"state"] : nil;
                  ArdiaCoreTab *tab = nil;
                  now.hostChanges++;
                  if (state.length) tab = [now.coreWindow restoreTab:state profile:profile foreground:NO];
                  if (!tab) tab = [now.coreWindow openTab:url profile:profile foreground:NO];
                  now.hostChanges--;
                  if (tab) [later attach:tab];
                }];
      return;
    }
    const BOOL userInitiated = view->_pendingUserInitiated;
    if (url.length && [view skipsNavigationDownload:url userInitiated:userInitiated]) url = nil;
    if (url.length) ArdiaFieldMarkNow(view->_transferKey, @"request");
    ArdiaCoreTab *tab = !standalone && !userInitiated && !ardia_host::IsPrivateProfile(view->_profile)
                            ? RestoreSavedHistory(controller, profile, view->_transferKey, url)
                            : nil;
    controller.hostChanges++;
    if (!tab) tab = [controller.coreWindow openTab:url.length ? url : @"" profile:profile foreground:NO];
    controller.hostChanges--;
    if (url.length && tab.loading) ArdiaFieldMarkNow(view->_transferKey, @"start");
    if (tab) [view attach:tab];
    if (tab && url.length) [view focusAfterLoad];
  });
}

- (BOOL)cloneTab:(NSString *)sourceKey profile:(ArdiaCoreProfile *)profile {
  ArdiaWindowController *controller = self.controller;
  if (!controller.coreWindow) return NO;
  ArdiaCoreTab *source = nil;
  for (ArdiaWebView *other in LiveViews())
    if (other != self && [other.transferKey isEqualToString:sourceKey] && other->_tab && !other->_tab.closed) source = other->_tab;
  if (!source || source.profile != profile) return NO;
  ArdiaWindowController *holder = [ArdiaWindowController holding:source];
  _pendingURL = nil;
  controller.hostChanges++;
  holder.hostChanges++;
  ArdiaCoreTab *tab = [controller.coreWindow duplicateTab:source profile:profile foreground:NO];
  holder.hostChanges--;
  controller.hostChanges--;
  if (!tab) return NO;
  [self attach:tab];
  return YES;
}

+ (void)keepTransfersOfWindow:(NSWindow *)window {
  ArdiaWindowController *closing = [ArdiaWindowController forNSWindow:window];
  if (!closing.coreWindow) return;
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_handingOff && view->_tab && !view->_tab.closed && [ArdiaWindowController holding:view->_tab] == closing)
      [view closeBrowser];
  [ArdiaTabParking rehomeFromWindow:closing];
}

- (BOOL)canTake:(ArdiaCoreTab *)tab {
  ArdiaCoreProfile *profile = tab.profile;
  if (!profile || tab.closed || profile.offTheRecord != ardia_host::IsPrivateProfile(_profile)) return NO;
  if (profile.offTheRecord) return ardia_host::IsOffTheRecordOf(profile, _profile);
  return [ardia_host::ProfileName(profile) isEqualToString:_profile ?: @""];
}

- (BOOL)takeTransferredTab {
  if (!_transferKey.length) return NO;
  if ([ArdiaTabParking launchWasClosed:_transferKey]) {
    if (!_launchCloseSent) {
      _launchCloseSent = YES;
      __weak ArdiaWebView *weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        ArdiaWebView *view = weakSelf;
        if (view && !view->_tab) [view emit:@"windowClose" payload:@{}];
      });
    }
    return YES;
  }
  ArdiaCoreTab *tab = [ArdiaTabParking parkedTabForKey:_transferKey];
  if (tab && ![self canTake:tab]) return NO;
  if (tab) [ArdiaTabParking unpark:_transferKey];
  if (!tab) {
    for (ArdiaWebView *other in LiveViews().allObjects) {
      if (other == self || ![other.transferKey isEqualToString:_transferKey] || !other->_tab) continue;
      if (![self canTake:other->_tab]) return NO;
      tab = other->_tab;
      [other detach];
      break;
    }
  }
  if (!tab || tab.closed) return NO;
  [ArdiaTabParking tookTransfer:_transferKey];
  _adoptId = nil;
  ArdiaLaunchTabHolder *launch = (ArdiaLaunchTabHolder *)[ArdiaTabParking takeHolderOfTab:tab];
  _transferredURL = launch.url ?: tab.url;
  if (SamePage(_pendingURL, _transferredURL)) _pendingURL = nil;
  [self attach:tab];
  if (launch) {
    _loadedOnce = YES;
    _requestedURL = launch.url;
    [launch replayTo:self tab:tab];
    [self focusAfterLoad];
  }
  return YES;
}

- (void)bindRestoreKey {
  if (!_tab || !_transferKey.length || ardia_host::IsPrivateProfile(_profile) || !ArdiaHost.isStarted) return;
  [BoundRestoreKeys() addObject:_transferKey];
  [ArdiaServices call:@"ac_tab_restore_tag" profile:_profile args:@{@"tab" : @(_tab.tabId), @"key" : _transferKey}
            completion:^(NSDictionary *) {}];
}

- (void)closeBrowser {
  _createGeneration++;
  _creating = NO;
  if (!_tab) return;
  ArdiaCoreTab *tab = _tab;
  if (_handingOff && _transferKey.length && !tab.closed) {
    [self detach];
    [ArdiaTabParking park:tab forKey:_transferKey];
    return;
  }
  _closing = YES;
  if (_transferKey.length && !ardia_host::IsPrivateProfile(_profile) && ArdiaHost.isStarted)
    [ArdiaServices call:@"ac_tab_restore_tag" profile:_profile args:@{@"tab" : @(tab.tabId), @"key" : _transferKey}
              completion:^(NSDictionary *) {}];
  [[ArdiaWindowController holding:tab] noteClosing:tab];
  ArdiaWebView *holder = _lentTo;
  [self detach];
  if (![holder closesLentTab:tab]) [tab closeNow];
}

@end
