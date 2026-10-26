#import "ardia/core/public/ArdiaCore.h"

#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/metrics/user_metrics.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/sys_string_conversions.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_toggle_action.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tab_contents/core_tab_helper.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/content_restriction.h"
#include "chrome/common/pref_names.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/policy/core/common/policy_pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_utils.h"
#include "pdf/buildflags.h"
#include "printing/buildflags/buildflags.h"
#include "ui/gfx/geometry/rect.h"
#if BUILDFLAG(ENABLE_PDF)
#include "chrome/browser/pdf/pdf_extension_util.h"
#include "pdf/pdf_features.h"
#endif
#if BUILDFLAG(ENABLE_PRINTING)
#include "chrome/browser/printing/print_view_manager_common.h"
#endif
#if BUILDFLAG(ENABLE_PRINT_PREVIEW)
#include "chrome/browser/printing/print_preview_dialog_controller.h"
#endif
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_devtools_call.h"
#import "ardia/core/ardiacore_internal.h"
#import "ardia/core/ardiacore_tab_internal.h"

namespace {

std::optional<bool> RunPageCommand(content::WebContents* contents, int command) {
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  PrefService* prefs = profile->GetPrefs();
  CoreTabHelper* core = CoreTabHelper::FromWebContents(contents);
  const int restrictions = core ? core->content_restrictions() : 0;
  switch (command) {
#if BUILDFLAG(ENABLE_PRINTING)
    case IDC_PRINT:
    case IDC_BASIC_PRINT: {
      auto* dialogs = web_modal::WebContentsModalDialogManager::FromWebContents(contents);
      const bool can_print = prefs->GetBoolean(prefs::kPrintingEnabled) && !contents->IsCrashed() &&
                             !(dialogs && dialogs->IsDialogActive()) &&
                             !(restrictions & CONTENT_RESTRICTION_PRINT);
      bool preview = false;
#if BUILDFLAG(ENABLE_PRINT_PREVIEW)
      auto* previews = printing::PrintPreviewDialogController::GetInstance();
      preview = previews && (previews->GetPrintPreviewForContents(contents) ||
                             previews->is_creating_print_preview_dialog());
#endif
      if (!can_print && !(command == IDC_BASIC_PRINT && preview &&
                          prefs->GetBoolean(prefs::kPrintingEnabled))) {
        return false;
      }
      if (command == IDC_PRINT) {
        printing::StartPrint(contents, prefs->GetBoolean(prefs::kPrintPreviewDisabled),
                             false);
      } else {
        printing::StartBasicPrint(contents);
      }
      return true;
    }
#endif
    case IDC_SAVE_PAGE: {
      PrefService* local_state = g_browser_process->local_state();
      content::NavigationEntry* entry = contents->GetController().GetLastCommittedEntry();
      if ((local_state && !local_state->GetBoolean(prefs::kAllowFileSelectionDialogs)) ||
          static_cast<policy::DownloadRestriction>(
              prefs->GetInteger(policy::policy_prefs::kDownloadRestrictions)) ==
              policy::DownloadRestriction::ALL_FILES ||
          (restrictions & CONTENT_RESTRICTION_SAVE) ||
          (entry && !content::IsSavableURL(entry->GetURL()))) {
        return false;
      }
      base::RecordAction(base::UserMetricsAction("SavePage"));
#if BUILDFLAG(ENABLE_PDF)
      if (contents->GetContentsMimeType() == "application/pdf" &&
          chrome_pdf::features::IsOopifPdfEnabled() &&
          pdf_extension_util::MaybeDispatchSaveEvent(contents->GetPrimaryMainFrame())) {
        return true;
      }
#endif
      contents->OnSavePage();
      return true;
    }
    case IDC_DEV_TOOLS_CONSOLE:
    case IDC_DEV_TOOLS_INSPECT:
      DevToolsWindow::OpenDevToolsWindow(
          contents,
          command == IDC_DEV_TOOLS_CONSOLE ? DevToolsToggleAction::ShowConsolePanel()
                                           : DevToolsToggleAction::Inspect(),
          DevToolsOpenedByAction::kMainMenuOrMainShortcut);
      return true;
    case IDC_DEV_TOOLS_TOGGLE: {
      DevToolsWindow* tools = DevToolsWindow::GetInstanceForInspectedWebContents(contents);
      if (tools && tools->IsDocked()) {
        if (content::WebContents* docked = DevToolsWindow::GetInTabWebContents(contents, nullptr)) {
          docked->DispatchBeforeUnload(false);
        }
      } else {
        DevToolsWindow::OpenDevToolsWindow(contents, DevToolsToggleAction::Show(),
                                           DevToolsOpenedByAction::kMainMenuOrMainShortcut);
      }
      return true;
    }
    default:
      return std::nullopt;
  }
}

}

@implementation ArdiaCoreTab (Commands)

- (void)openBlockedPopup:(NSString*)popupId always:(BOOL)always {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self openBlockedPopup:popupId always:always];
    });
    return;
  }
  if (!_contents) {
    return;
  }
  auto* popups = blocked_content::PopupBlockerTabHelper::FromWebContents(_contents);
  int id_number = 0;
  if (!popups || !base::StringToInt(base::SysNSStringToUTF8(popupId), &id_number) ||
      !popups->GetBlockedPopupRequests().contains(id_number)) {
    return;
  }
  if (always) {
    HostContentSettingsMapFactory::GetForProfile(_contents->GetBrowserContext())
        ->SetContentSettingDefaultScope(_contents->GetLastCommittedURL(), GURL(),
                                        ContentSettingsType::POPUPS,
                                        CONTENT_SETTING_ALLOW);
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  ardiacore::WindowHost* host = ardiacore::WindowHost::ForBrowser(browser);
  std::optional<base::AutoReset<ardiacore::WindowHost::PendingOpen>> pending;
  if (host) {
    pending.emplace(&host->pending_open(),
                    ardiacore::WindowHost::PendingOpen{
                        WindowOpenDisposition::NEW_FOREGROUND_TAB,
                        _contents->GetWeakPtr()});
  }
  popups->ShowBlockedPopup(id_number, WindowOpenDisposition::NEW_FOREGROUND_TAB);
}

- (BOOL)executeChromeCommand:(int)command {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self executeChromeCommand:command];
    });
    return YES;
  }
  if (!_contents) {
    return NO;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return NO;
  }
  TabStripModel* model = browser->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(_contents);
  const int active = model->active_index();
  if (index == TabStripModel::kNoTab) {
    return NO;
  }
  if (index == active) {
    return chrome::ExecuteCommand(browser, command);
  }
  if (std::optional<bool> ran = RunPageCommand(_contents, command)) {
    return *ran;
  }
  if (command == IDC_CARET_BROWSING_TOGGLE) {
    return chrome::ExecuteCommand(browser, command);
  }
  return NO;
}

- (void)devToolsCall:(NSString*)method
              params:(NSDictionary*)params
             timeout:(NSTimeInterval)timeout
          completion:(void (^)(NSDictionary* result, NSString* error))completion {
  base::DictValue dict;
  if (params.count) {
    NSData* data = [NSJSONSerialization dataWithJSONObject:params options:0 error:nil];
    std::optional<base::DictValue> parsed =
        data ? base::JSONReader::ReadDict(
                   std::string_view(static_cast<const char*>(data.bytes), data.length),
                   base::JSON_PARSE_RFC)
             : std::nullopt;
    if (!parsed) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(nil, @"params aren't JSON");
      });
      return;
    }
    dict = std::move(*parsed);
  }
  ardiacore::CallDevTools(
      _contents, base::SysNSStringToUTF8(method), std::move(dict),
      timeout > 0 ? std::optional<base::TimeDelta>(base::Seconds(timeout)) : std::nullopt,
      base::BindOnce(
          [](void (^completion)(NSDictionary*, NSString*),
             std::optional<base::DictValue> result, std::optional<std::string> error) {
            if (!result) {
              completion(nil, base::SysUTF8ToNSString(error.value_or("error")));
              return;
            }
            std::optional<std::string> json = base::WriteJson(*result);
            NSData* data = json ? [NSData dataWithBytes:json->data() length:json->size()] : nil;
            id object = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                             : nil;
            if (![object isKindOfClass:NSDictionary.class]) {
              completion(nil, @"the reply isn't JSON");
              return;
            }
            completion(object, nil);
          },
          completion));
}

- (void)showDevTools {
  if (_contents) {
    DevToolsWindow::OpenDevToolsWindow(_contents, DevToolsToggleAction::Show(),
                                       DevToolsOpenedByAction::kUnknown);
  }
}

- (void)closeDevTools {
  if (!_contents) {
    return;
  }
  if (content::WebContents* devtools =
          DevToolsWindow::GetInTabWebContents(_contents, nullptr)) {
    devtools->ClosePage();
  }
}

- (NSView*)devToolsView {
  if (!_contents) {
    return nil;
  }
  content::WebContents* devtools =
      DevToolsWindow::GetInTabWebContents(_contents, nullptr);
  return devtools ? devtools->GetNativeView().GetNativeNSView() : nil;
}

- (void)devToolsLayoutForSize:(NSSize)size
                     devTools:(NSRect*)devToolsFrame
                         page:(NSRect*)pageFrame {
  DevToolsContentsResizingStrategy strategy;
  gfx::Rect devtools_bounds, page_bounds;
  gfx::Rect container(0, 0, size.width, size.height);
  if (_contents && DevToolsWindow::GetInTabWebContents(_contents, &strategy)) {
    ApplyDevToolsContentsResizingStrategy(strategy, container, &devtools_bounds,
                                          &page_bounds);
  } else {
    page_bounds = container;
  }
  if (devToolsFrame) {
    *devToolsFrame = devtools_bounds.ToCGRect();
  }
  if (pageFrame) {
    *pageFrame = page_bounds.ToCGRect();
  }
}

@end
