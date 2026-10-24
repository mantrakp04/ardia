#include "ardia/core/ac_seams.h"

#include <memory>

#include "base/functional/callback.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/permissions/chooser_controller.h"
#include "components/sessions/core/live_tab.h"
#include "components/sessions/core/session_id.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_install_prompt_client.h"
#include "extensions/common/extension_id.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_cast_dialog.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_device_chooser.h"

namespace ardiacore {

namespace {

bool HandlePasswordBubble(content::WebContents* web_contents) {
  WindowHost* host = WindowHost::ForBrowser(
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(web_contents));
  return host && host->OfferPasswordSave(web_contents);
}

bool HandleExtensionSidePanel(BrowserWindowInterface* browser_window,
                              content::WebContents* web_contents,
                              const extensions::ExtensionId& extension_id,
                              bool open) {
  content::WebContents* contents = web_contents;
  if (!contents && browser_window && browser_window->GetActiveTabInterface()) {
    contents = browser_window->GetActiveTabInterface()->GetContents();
  }
  BrowserWindowInterface* browser =
      contents ? GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents)
               : browser_window;
  if (!contents || !WindowHost::ForBrowser(browser)) {
    return false;
  }
  return HostExtensionSidePanel(contents, extension_id, open);
}

bool LiveTabSkipsRestore(sessions::LiveTab* live_tab, SessionID* source) {
  int32_t source_id = 0;
  if (!live_tab || !IsTemporaryTabId(live_tab->GetSessionID().id(), &source_id)) {
    return false;
  }
  if (source && source_id > 0) {
    *source = SessionID::FromSerializedValue(source_id);
  }
  return true;
}

bool OmitsFromSessionService(const BrowserWindowInterface* browser) {
  return ACBrowserWindow::IsOurs(browser);
}

bool IsHiddenFromExtensions(const BrowserWindowInterface* browser) {
  WindowHost* host = WindowHost::ForBrowser(browser);
  return host && host->internal();
}

bool KeepsWindowWithoutTabs(const BrowserWindowInterface* browser) {
  WindowHost* host = WindowHost::ForBrowser(browser);
  return host && !host->closing() && !browser_shutdown::IsTryingToQuit();
}

std::unique_ptr<BrowserWebContentsDelegate> CreateWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller) {
  ACBrowserWindow* ours = ACBrowserWindow::FromWindow(&window);
  if (!ours) {
    return nullptr;
  }
  ours->Register(browser);
  return std::make_unique<ACWebContentsDelegate>(
      browser, exclusive_access_manager, command_controller, unload_controller,
      app_browser_controller, window, capabilities, browser_ui_controller,
      ours->host_weak());
}

void DevToolsDockChanged(BrowserWindowInterface* browser,
                         content::WebContents* inspected,
                         content::WebContents* devtools) {
  if (WindowHost* host = WindowHost::ForBrowser(browser)) {
    host->DevToolsDockChanged(inspected, devtools);
  }
}

}

void InstallChromeHooks() {
  g_ardia_password_bubble = &HandlePasswordBubble;
  g_ardia_extension_install_prompt = &HostExtensionInstallPrompt;
  g_ardia_device_chooser = &HandleDeviceChooser;
  g_ardia_wants_cast_dialog = &WantsCastDialog;
  g_ardia_cast_dialog = &HandleCastDialog;
  g_ardia_extension_side_panel = &HandleExtensionSidePanel;
  g_ardia_hidden_from_extensions = &IsHiddenFromExtensions;
  g_ardia_keeps_window_without_tabs = &KeepsWindowWithoutTabs;
  g_ardia_devtools_dock_changed = &DevToolsDockChanged;
  g_ardia_create_web_contents_delegate = &CreateWebContentsDelegate;
  g_ardia_initial_main_document_accessed = &InitialMainDocumentAccessed;
  g_ardia_live_tab_skips_restore = &LiveTabSkipsRestore;
  g_ardia_omits_from_session_service = &OmitsFromSessionService;
  g_ardia_viewless_browsers = true;
}

}
