// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_external_apps.h"

#import <AppKit/AppKit.h>

#include <optional>
#include <string>
#include <utility>

#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"

namespace ardia {
namespace {

const char* const kPairs = prefs::kProtocolHandlerPerOriginAllowedProtocols;

base::DictValue Allowance(const std::string& origin,
                          const std::string& scheme) {
  NSURL* probe = [NSURL
      URLWithString:[base::SysUTF8ToNSString(scheme) stringByAppendingString:@":"]];
  NSURL* app =
      probe ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:probe]
            : nil;
  const std::optional<ExternalApp> described =
      app ? std::optional<ExternalApp>(DescribeExternalApp(app)) : std::nullopt;
  return base::DictValue()
      .Set("origin", origin)
      .Set("scheme", scheme)
      .Set("app", described
                      ? base::Value(base::SysNSStringToUTF8(described->name))
                      : base::Value())
      .Set("icon", described && described->icon
                       ? base::Value(base::SysNSStringToUTF8(described->icon))
                       : base::Value());
}

}

ExternalApp DescribeExternalApp(NSURL* app) {
  constexpr CGFloat kIconPixels = 128;
  NSString* name = [NSFileManager.defaultManager displayNameAtPath:app.path]
                       .stringByDeletingPathExtension;
  NSImage* icon = [NSWorkspace.sharedWorkspace iconForFile:app.path];
  NSBitmapImageRep* rep = [[NSBitmapImageRep alloc]
      initWithBitmapDataPlanes:nil
                    pixelsWide:kIconPixels
                    pixelsHigh:kIconPixels
                 bitsPerSample:8
               samplesPerPixel:4
                      hasAlpha:YES
                      isPlanar:NO
                colorSpaceName:NSDeviceRGBColorSpace
                   bytesPerRow:0
                  bitsPerPixel:0];
  if (!icon || !rep) {
    return {name, nil};
  }
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext =
      [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [icon drawInRect:NSMakeRect(0, 0, kIconPixels, kIconPixels)];
  [NSGraphicsContext restoreGraphicsState];
  NSData* png = [rep representationUsingType:NSBitmapImageFileTypePNG
                                  properties:@{}];
  return {name,
          png ? [@"data:image/png;base64,"
                    stringByAppendingString:[png base64EncodedStringWithOptions:0]]
              : nil};
}

}

AC_PROFILE_CALL(ac_external_apps_allowances) {
  base::ListValue allowances;
  for (const auto [origin, schemes] :
       call.profile()->GetPrefs()->GetDict(ardia::kPairs)) {
    if (!schemes.is_dict()) {
      continue;
    }
    for (const auto [scheme, allowed] : schemes.GetDict()) {
      if (allowed.is_bool() && allowed.GetBool()) {
        allowances.Append(ardia::Allowance(origin, scheme));
      }
    }
  }
  call.TakeReply().Send(
      base::DictValue().Set("allowances", std::move(allowances)));
}

AC_PROFILE_CALL(ac_external_apps_remove) {
  const std::string origin = call.String("origin");
  const std::string scheme = call.String("scheme");
  if (origin.empty() || scheme.empty()) {
    return call.TakeReply().Error("origin and scheme required");
  }
  ScopedDictPrefUpdate pairs(call.profile()->GetPrefs(), ardia::kPairs);
  if (base::DictValue* schemes = pairs->FindDict(origin)) {
    schemes->Remove(scheme);
    if (schemes->empty()) {
      pairs->Remove(origin);
    }
  }
  call.TakeReply().Ok();
}
