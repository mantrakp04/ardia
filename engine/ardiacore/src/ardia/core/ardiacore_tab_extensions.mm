#import "ardia/core/public/ArdiaCore.h"

#include <optional>
#include <string>
#include <vector>

#include "base/base64.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"
#import "ardia/core/ardiacore_tab_internal.h"

using ardiacore::NS;

namespace {

id HexColor(SkColor color) {
  if (!SkColorGetA(color)) {
    return NSNull.null;
  }
  return [NSString stringWithFormat:@"#%02x%02x%02x", SkColorGetR(color),
                                    SkColorGetG(color), SkColorGetB(color)];
}

NSString* PngDataURL(const gfx::Image& image) {
  if (image.IsEmpty()) {
    return @"";
  }
  const gfx::ImageSkiaRep& rep = image.ToImageSkia()->GetRepresentation(2.0f);
  std::optional<std::vector<uint8_t>> png = gfx::PNGCodec::EncodeBGRASkBitmap(
      rep.GetBitmap(), false);
  if (!png) {
    return @"";
  }
  return NS("data:image/png;base64," + base::Base64Encode(*png));
}

}

@implementation ArdiaCoreTab (Extensions)

- (NSString*)executeExtensionAction:(NSString*)extensionId {
  if (!_contents) {
    return @"none";
  }
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(_contents->GetBrowserContext())
          ->enabled_extensions()
          .GetByID(base::SysNSStringToUTF8(extensionId));
  auto* runner = extensions::ExtensionActionRunner::GetForWebContents(_contents);
  if (!extension || !runner) {
    return @"none";
  }
  switch (runner->RunAction(extension, true)) {
    case extensions::ExtensionAction::ShowAction::kShowPopup:
      return @"popup";
    case extensions::ExtensionAction::ShowAction::kToggleSidePanel:
      return @"sidePanel";
    case extensions::ExtensionAction::ShowAction::kNone:
      return @"none";
  }
  return @"none";
}

- (NSDictionary<NSString*, NSDictionary*>*)actionStatesForExtensions:
    (NSArray<NSString*>*)extensionIds {
  NSMutableDictionary* states = [NSMutableDictionary dictionary];
  if (!_contents) {
    return states;
  }
  content::BrowserContext* context = _contents->GetBrowserContext();
  const int tab_id = self.tabId;
  for (NSString* extensionId in extensionIds) {
    const extensions::Extension* extension =
        extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(
            base::SysNSStringToUTF8(extensionId));
    extensions::ExtensionAction* action =
        extension ? extensions::ExtensionActionManager::Get(context)
                        ->GetExtensionAction(*extension)
                  : nullptr;
    if (!action) {
      continue;
    }
    gfx::Image icon = action->GetExplicitlySetIcon(tab_id);
    if (icon.IsEmpty()) {
      icon = action->GetDeclarativeIcon(tab_id);
    }
    NSString* badge = NS(action->GetDisplayBadgeText(tab_id));
    states[extensionId] = @{
      @"title" : NS(action->GetTitle(tab_id)),
      @"badgeText" : [badge hasPrefix:@"<<"] ? @"" : badge,
      @"badgeColor" : HexColor(action->GetBadgeBackgroundColor(tab_id)),
      @"badgeTextColor" : HexColor(action->GetBadgeTextColor(tab_id)),
      @"popup" : NS(action->GetPopupUrl(tab_id).spec()),
      @"enabled" : @(action->GetIsVisible(tab_id)),
      @"icon" : PngDataURL(icon),
    };
  }
  return states;
}

- (NSString*)sidePanelURLForExtension:(NSString*)extensionId {
  if (!_contents) {
    return nil;
  }
  content::BrowserContext* context = _contents->GetBrowserContext();
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(
          base::SysNSStringToUTF8(extensionId));
  auto* service = extension ? extensions::SidePanelService::Get(context) : nullptr;
  if (!service) {
    return nil;
  }
  auto options = service->GetOptions(*extension, self.tabId);
  if (!options.path || !options.enabled.value_or(false)) {
    return nil;
  }
  return NS(extension->GetResourceURL(*options.path).spec());
}

@end
