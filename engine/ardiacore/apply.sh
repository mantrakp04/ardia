#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}

mode=apply
[[ "${1:-}" == --check ]] && mode=check
drift=0

read -r -d '' hooklib <<'PY' || true
import sys
mode, path, name = sys.argv[1:4]
s = open(path).read()
HOOKS = '#include "ardia/core/ac_hooks.h"  // nogncheck\n'
CONTENT_HOOKS = '#include "ardia/core/ac_content_hooks.h"  // nogncheck\n'


def with_include(text, line):
    if line in text:
        return text
    at = text.index("\n", text.index("#include ")) + 1
    return text[:at] + line + text[at:]


def hook(markers, edit, include=None):
    wanted = list(markers) + ([include] if include else [])
    if mode == "check":
        missing = [m for m in wanted if m not in s]
        if missing:
            sys.exit(f"apply.sh --check: {name} is not in {path} (missing {missing[0].strip()!r})")
        return
    present = [m for m in markers if m in s]
    if present and len(present) < len(markers):
        sys.exit(f"apply.sh: {name} is partly in {path} (has {present[0].strip()!r}): "
                 "restore the file from the series base (docs/engine-build.md)")
    result = s if present else edit(s)
    if include:
        result = with_include(result, include)
    for m in wanted:
        if result.count(m) != 1:
            sys.exit(f"apply.sh: {name}: {m.strip()!r} is {result.count(m)} times in {path}, not once")
    if result != s:
        open(path, "w").write(result)
        print("hooked " + name)
PY

hook() {
  local status=0
  python3 -c "$hooklib"$'\n'"$(cat)" "$mode" "$1" "$2" || status=$?
  if [[ $status -ne 0 ]]; then
    [[ $mode == check ]] && { drift=1; return 0; }
    exit "$status"
  fi
}

if [[ $mode == check ]]; then
  diff -r "$here/src/ardia" "$src/ardia" >/dev/null || { echo "apply.sh --check: $src/ardia differs from the repo" >&2; drift=1; }
else
  mkdir -p "$src/ardia"
  rsync -r --delete --checksum "$here/src/ardia/" "$src/ardia/"
fi

hook "$src/chrome/BUILD.gn" "//chrome:chrome_dll" <<'PY'
line = '      "//ardia/core",  # Ardia: ArdiaCore (engine/ardiacore)\n'
def edit(s):
    mac = s.index('target(_dll_target_type, "chrome_dll")')
    anchor = '      "//third_party/cld_3/src/src:cld_3",\n'
    at = s.index(anchor, mac) + len(anchor)
    return s[:at] + line + s[at:]
hook([line], edit)
PY

hook "$src/chrome/app/chrome_main.cc" "ChromeMain's ACMainDelegate" <<'PY'
old = """#else  // BUILDFLAG(IS_WIN)
  ChromeMainDelegate chrome_main_delegate(
      {.exe_entry_point_ticks = base::TimeTicks::Now()});"""
new = """#else  // BUILDFLAG(IS_WIN)
  // Ardia: ArdiaCore's delegate (engine/ardiacore), a ChromeMainDelegate.
  ardiacore::ACMainDelegate chrome_main_delegate(
      {.exe_entry_point_ticks = base::TimeTicks::Now()});"""
inc_old = '#if BUILDFLAG(IS_MAC)\n#include "chrome/app/chrome_main_mac.h"\n'
inc = '#include "ardia/core/ac_main_delegate.h"  // nogncheck\n'
def edit(s):
    assert s.count(old) == 1 and s.count(inc_old) == 1
    return s.replace(old, new).replace(inc_old, inc_old + inc)
hook(["  ardiacore::ACMainDelegate chrome_main_delegate(\n", inc], edit)
PY

hook "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" "BrowserWindowFeatures' WebContentsDelegate" <<'PY'
at = "BrowserWindowFeatures::BrowserWindowFeatures() = default;\n"
decl = """// Ardia: ArdiaCore (engine/ardiacore) makes the WebContentsDelegate of the Browsers it hosts.
std::unique_ptr<BrowserWebContentsDelegate> (
    *g_ardia_create_web_contents_delegate)(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller) = nullptr;

"""
old = """  browser_web_contents_delegate_ = std::make_unique<BrowserWebContentsDelegate>(
      browser, *exclusive_access_manager_, *browser_command_controller_,
      *unload_controller_, app_browser_controller_.get(),
      *BrowserWindow::FromBrowser(browser),
      *desktop_browser_window_capabilities_, *browser_ui_controller_);
"""
new = """  // Ardia: ArdiaCore
  if (g_ardia_create_web_contents_delegate) {
    browser_web_contents_delegate_ = g_ardia_create_web_contents_delegate(
        browser, *exclusive_access_manager_, *browser_command_controller_,
        *unload_controller_, app_browser_controller_.get(),
        *BrowserWindow::FromBrowser(browser),
        *desktop_browser_window_capabilities_, *browser_ui_controller_);
  }
  if (!browser_web_contents_delegate_) {
    browser_web_contents_delegate_ = std::make_unique<BrowserWebContentsDelegate>(
        browser, *exclusive_access_manager_, *browser_command_controller_,
        *unload_controller_, app_browser_controller_.get(),
        *BrowserWindow::FromBrowser(browser),
        *desktop_browser_window_capabilities_, *browser_ui_controller_);
  }
"""
def edit(s):
    assert s.count(at) == 1 and s.count(old) == 1
    return s.replace(at, decl + at).replace(old, new)
hook(["    *g_ardia_create_web_contents_delegate)(\n",
      "    browser_web_contents_delegate_ = g_ardia_create_web_contents_delegate(\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc" "ReadAnythingSidePanelController" <<'PY'
old = """    if (!webui_browser::IsWebUIBrowserEnabled()) {
      CHECK_IS_TEST();
    }"""
new = """    // Ardia: ArdiaCore's Browsers have no BrowserView, so no side panel UI.
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !g_ardia_viewless_browsers) {
      CHECK_IS_TEST();
    }"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["    // Ardia: ArdiaCore's Browsers have no BrowserView, so no side panel UI.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/toasts/toast_controller.cc" "ToastController" <<'PY'
old = """    if (!webui_browser::IsWebUIBrowserEnabled()) {
      CHECK_IS_TEST();
    }"""
new = """    // Ardia: ArdiaCore's Browsers have no BrowserView to anchor a toast to.
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !(browser_window_interface_ && g_ardia_viewless_browsers)) {
      CHECK_IS_TEST();
    }"""
show_old = """bool ToastController::MaybeShowToast(ToastParams params) {
  if (!CanShowToast(params.toast_id)) {"""
show_new = """// Ardia: ArdiaCore (engine/ardiacore) runs this process: its Browsers may have no
// BrowserView (reading mode's side panel controller reads it too).
bool g_ardia_viewless_browsers = false;

bool ToastController::MaybeShowToast(ToastParams params) {
  // Ardia: ArdiaCore shows no toast without an anchor, before any state is set.
  if (browser_window_interface_ && g_ardia_viewless_browsers) {
    const ToastSpecification* spec =
        toast_registry_->GetToastSpecification(params.toast_id);
    if (!spec || !GetAnchorView(spec->is_global_scope())) {
      RecordToastFailedToShow(params.toast_id);
      return false;
    }
  }
  if (!CanShowToast(params.toast_id)) {"""
def edit(s):
    assert s.count(old) == 1 and s.count(show_old) == 1
    return s.replace(old, new).replace(show_old, show_new)
hook(["    // Ardia: ArdiaCore's Browsers have no BrowserView to anchor a toast to.\n",
      "bool g_ardia_viewless_browsers = false;\n",
      "  // Ardia: ArdiaCore shows no toast without an anchor, before any state is set.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/browser_commands.cc" "CloseTab's pinned tab toast" <<'PY'
old = """  ToastController* toast_controller = ToastController::From(browser);
  if (!toast_controller) {"""
new = """  ToastController* toast_controller = ToastController::From(browser);
  // Ardia: ArdiaCore's Browsers have no BrowserView, so no pinned tab toast.
  if (!toast_controller || (g_ardia_viewless_browsers &&
                            !BrowserView::GetBrowserViewForBrowser(browser))) {"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore's Browsers have no BrowserView, so no pinned tab toast.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/webui/settings/settings_clear_browsing_data_handler.cc" "ClearBrowsingDataHandler" <<'PY'
old = """    CHECK(browser_element);
    ui::ElementTracker::GetFrameworkDelegate()->NotifyCustomEvent(
        browser_element,
        browsing_data_important_sites_util::kClearBrowsingDataHistoryEventId);
  }"""
new = """    // Ardia: ArdiaCore's Browsers have no BrowserView element.
    CHECK(browser_element || g_ardia_viewless_browsers);
    if (browser_element) {
      ui::ElementTracker::GetFrameworkDelegate()->NotifyCustomEvent(
          browser_element,
          browsing_data_important_sites_util::kClearBrowsingDataHistoryEventId);
    }
  }"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["    // Ardia: ArdiaCore's Browsers have no BrowserView element.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/browser.cc" "Browser window creation" <<'PY'
old_ctor = "Browser::Browser(BrowserWindowCreateParams params)\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) supplies the window of a Browser it hosts.\n"
        "BrowserWindow* (*g_ardia_browser_window_factory)(Browser*) = nullptr;\n\n")
old = """  features_->Init(this);

  if (custom_window) {
    CHECK_IS_TEST() << "BrowserWindowCreateParams::window is a test-only param";
  }
  window_ =
      custom_window
          ? std::unique_ptr<BrowserWindow, BrowserWindowDeleter>(custom_window)
          : BrowserWindow::CreateBrowserWindow(this, user_gesture,
                                               in_tab_dragging);
"""
new = """  features_->Init(this);

  // Ardia: ArdiaCore's own window for a Browser it makes (tests only, otherwise).
  if (custom_window && !g_ardia_browser_window_factory) {
    CHECK_IS_TEST() << "BrowserWindowCreateParams::window is a test-only param";
  }
  // Ardia: ArdiaCore may host a Browser Chrome makes itself.
  BrowserWindow* const hosted_window =
      !custom_window && g_ardia_browser_window_factory
          ? g_ardia_browser_window_factory(this)
          : nullptr;
  window_ =
      custom_window || hosted_window
          ? std::unique_ptr<BrowserWindow, BrowserWindowDeleter>(
                custom_window ? custom_window : hosted_window)
          : BrowserWindow::CreateBrowserWindow(this, user_gesture,
                                               in_tab_dragging);
"""
def edit(s):
    assert s.count(old_ctor) == 1 and s.count(old) == 1
    return s.replace(old_ctor, decl + old_ctor).replace(old, new)
hook(["BrowserWindow* (*g_ardia_browser_window_factory)(Browser*) = nullptr;\n",
      "  // Ardia: ArdiaCore's own window for a Browser it makes (tests only, otherwise).\n",
      "          ? g_ardia_browser_window_factory(this)\n"], edit, HOOKS)
PY

hook "$src/chrome/app/chrome_main_delegate.cc" "ChromeMainDelegate (embedder, ResourceBundle delegate)" <<'PY'
def gate(s, start, end, why):
    i = s.index(start)
    j = s.index(end, i) + len(end)
    body = "".join(("  " + l if l.strip() and not l.startswith("#") else l)
                   for l in s[i:j].splitlines(True))
    return s[:i] + "  // Ardia: ArdiaCore " + why + "\n  if (!g_ardia_embedder) {\n" + body + "  }\n" + s[j:]
decl_at = """#if BUILDFLAG(IS_ANDROID)
ChromeMainDelegate::ChromeMainDelegate()
    : ChromeMainDelegate(StartupTimestamps{}) {}
#endif
"""
decl = """// Ardia: ArdiaCore (engine/ardiacore) embeds Chrome: it does some of Chrome's startup itself.
bool g_ardia_embedder = false;
// Ardia: ArdiaCore's ResourceBundle delegate (its product strings).
ui::ResourceBundle::Delegate* g_ardia_resource_bundle_delegate = nullptr;

"""
reps = [
("""  std::string actual_locale = LoadLocalState(
      chrome_feature_list_creator, invoked_in_browser->is_running_test);
""",
"""  std::string actual_locale = LoadLocalState(
      chrome_feature_list_creator,
      g_ardia_resource_bundle_delegate,  // Ardia: ArdiaCore
      invoked_in_browser->is_running_test);
"""),
("""            locale, nullptr, ui::ResourceBundle::LOAD_COMMON_RESOURCES);
""",
"""            locale, g_ardia_resource_bundle_delegate,  // Ardia: ArdiaCore
            ui::ResourceBundle::LOAD_COMMON_RESOURCES);
"""),
("""  bool record = true;
#if BUILDFLAG(IS_ANDROID)
  record =
      base::FeatureList::IsEnabled(chrome::android::kUmaBackgroundSessions);
#endif
""",
"""  // Ardia: ArdiaCore records no core system profile.
  bool record = !g_ardia_embedder;
#if BUILDFLAG(IS_ANDROID)
  record =
      base::FeatureList::IsEnabled(chrome::android::kUmaBackgroundSessions);
#endif
"""),
]
start1 = "  crash_reporter::InitializeCrashKeys();\n"
end1 = "#endif  // !defined(BUILDING_CHROME_RENDERER)\n"
start2 = "#if BUILDFLAG(IS_POSIX) && !BUILDFLAG(IS_MAC)\n  // Zygote needs to call InitCrashReporter() in RunZygote().\n"
end2 = "  crash_keys::SetCrashKeysFromCommandLine(command_line);\n"
def edit(s):
    assert s.count(decl_at) == 1 and s.count(start1) == 1 and s.count(start2) == 1 and s.count(end2) == 1
    s = s.replace(decl_at, decl + decl_at)
    for old, new in reps:
        assert s.count(old) == 1, old
        s = s.replace(old, new)
    s = gate(s, start1, end1, "has no crash reporter, and sets up its data dir itself.")
    return gate(s, start2, end2, "has no crash reporter.")
hook(["bool g_ardia_embedder = false;\n",
      "      g_ardia_resource_bundle_delegate,  // Ardia: ArdiaCore\n",
      "            locale, g_ardia_resource_bundle_delegate,  // Ardia: ArdiaCore\n",
      "  bool record = !g_ardia_embedder;\n",
      "  // Ardia: ArdiaCore has no crash reporter, and sets up its data dir itself.\n",
      "  // Ardia: ArdiaCore has no crash reporter.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/chrome_browser_main.cc" "ChromeBrowserMainParts (embedder)" <<'PY'
old = """  // This step is costly.
  if (browser_creator_->Start(*base::CommandLine::ForCurrentProcess(),
                              base::FilePath(), profile_info,
                              last_opened_profiles)) {"""
new = """  // This step is costly.
  // Ardia: ArdiaCore opens its own windows and runs the main loop itself.
  if (!g_ardia_embedder &&
      browser_creator_->Start(*base::CommandLine::ForCurrentProcess(),
                              base::FilePath(), profile_info,
                              last_opened_profiles)) {"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore opens its own windows and runs the main loop itself.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/chrome_browser_main_mac.mm" "ChromeBrowserMainPartsMac (embedder)" <<'PY'
start = "  // Create the app delegate by requesting the shared AppController.\n"
end = "  [app_controller mainMenuCreated];\n"
old = "  [AppController.sharedController didEndMainMessageLoop];\n"
new = ("  // Ardia: ArdiaCore\n  if (!g_ardia_embedder) {\n"
       "    [AppController.sharedController didEndMainMessageLoop];\n  }\n")
def edit(s):
    assert s.count(start) == 1 and s.count(end) == 1 and s.count(old) == 1
    i = s.index(start); j = s.index(end, i) + len(end)
    body = "".join(("  " + l if l.strip() else l) for l in s[i:j].splitlines(True))
    s = s[:i] + ("  // Ardia: ArdiaCore's app has its own NSApp delegate and main menu.\n"
                 "  if (!g_ardia_embedder) {\n") + body + "  }\n" + s[j:]
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore's app has its own NSApp delegate and main menu.\n", new], edit, HOOKS)
PY

hook "$src/chrome/browser/chrome_content_browser_client.cc" "ChromeContentBrowserClient's URL handlers (embedder)" <<'PY'
old = """  // chrome: & friends.
  handler->AddHandlerPair(&ChromeContentBrowserClient::HandleWebUI,
                          &ChromeContentBrowserClient::HandleWebUIReverse);
"""
new = """  // chrome: & friends.
  // Ardia: ArdiaCore maps its own URLs (as CEF's build did).
  if (!g_ardia_embedder) {
    handler->AddHandlerPair(&ChromeContentBrowserClient::HandleWebUI,
                            &ChromeContentBrowserClient::HandleWebUIReverse);
  }
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore maps its own URLs (as CEF's build did).\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/policy/chrome_browser_policy_connector.cc" "ChromeBrowserPolicyConnector's platform provider (embedder)" <<'PY'
old = """ChromeBrowserPolicyConnector::CreatePlatformProvider() {
"""
new = """ChromeBrowserPolicyConnector::CreatePlatformProvider() {
  // Ardia: ArdiaCore reads no platform policy (as CEF's build, which made none without a policy id).
  if (g_ardia_embedder) {
    return nullptr;
  }
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore reads no platform policy (as CEF's build, which made none without a policy id).\n"],
     edit, HOOKS)
PY

hook "$src/chrome/browser/ui/views/permissions/permission_prompt_factory.cc" "the permission prompt factory" <<'PY'
at = """}  // namespace

bool ShouldShowPermissionPromptEvenIfOmniboxEditedOrEmpty(
"""
decl = """}  // namespace

// Ardia: ArdiaCore (engine/ardiacore) shows the prompts of the tabs it hosts.
std::unique_ptr<permissions::PermissionPrompt> (
    *g_ardia_create_permission_prompt)(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling) = nullptr;

bool ShouldShowPermissionPromptEvenIfOmniboxEditedOrEmpty(
"""
old = """std::unique_ptr<permissions::PermissionPrompt> CreatePermissionPrompt(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate) {
"""
new = old + """  // Ardia: ArdiaCore
  if (g_ardia_create_permission_prompt) {
    bool default_handling = true;
    auto prompt = g_ardia_create_permission_prompt(web_contents, delegate,
                                                       &default_handling);
    if (prompt) {
      return prompt;
    }
    if (!default_handling) {
      return nullptr;
    }
  }
"""
def edit(s):
    assert s.count(at) == 1 and s.count(old) == 1
    return s.replace(at, decl).replace(old, new)
hook(["    *g_ardia_create_permission_prompt)(\n",
      "    auto prompt = g_ardia_create_permission_prompt(web_contents, delegate,\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/sad_tab_controller.cc" "SadTabController" <<'PY'
old = """  BrowserView* browser_view = BrowserView::GetBrowserViewForBrowser(browser);
  DCHECK(browser_view);
"""
new = """  BrowserView* browser_view = BrowserView::GetBrowserViewForBrowser(browser);
  // Ardia: ArdiaCore's Browsers have no BrowserView (engine/ardiacore).
  if (!browser_view) {
    return nullptr;
  }
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore's Browsers have no BrowserView (engine/ardiacore).\n"], edit)
PY

hook "$src/chrome/browser/ui/autofill/autofill_popup_controller_impl.cc" "AutofillPopupControllerImpl" <<'PY'
old_fn = "void AutofillPopupControllerImpl::Show(\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) hears of each dropdown shown.\n"
        "void (*g_ardia_autofill_suggestions_shown)(\n"
        "    content::WebContents* web_contents,\n"
        "    base::span<const Suggestion> suggestions) = nullptr;\n\n")
old = """  delegate_->OnSuggestionsShown(non_filtered_suggestions_, GetPopupMetadata());
"""
new = """  // Ardia: ArdiaCore
  if (g_ardia_autofill_suggestions_shown && IsRootPopup() && web_contents_) {
    g_ardia_autofill_suggestions_shown(web_contents_.get(),
                                           non_filtered_suggestions_);
  }
""" + old
old2 = """    if (!view_->Show(autoselect_first_suggestion)) {
      return;
    }
"""
new2 = """    auto ardia_alive = GetWeakPtr();
    if (!view_->Show(autoselect_first_suggestion)) {
      // Ardia: ArdiaCore hears of a dropdown on screen whose search bar couldn't
      // take focus (an app that isn't active), which Chrome doesn't count as shown.
      if (ardia_alive && view_ && g_ardia_autofill_suggestions_shown &&
          IsRootPopup() && web_contents_) {
        g_ardia_autofill_suggestions_shown(web_contents_.get(),
                                               non_filtered_suggestions_);
      }
      return;
    }
"""
def edit(s):
    assert s.count(old_fn) == 1 and s.count(old) == 1 and s.count(old2) == 1
    return s.replace(old_fn, decl + old_fn).replace(old, new).replace(old2, new2)
hook(["void (*g_ardia_autofill_suggestions_shown)(\n",
      "  if (g_ardia_autofill_suggestions_shown && IsRootPopup() && web_contents_) {\n",
      "    auto ardia_alive = GetWeakPtr();\n"], edit, HOOKS)
PY

hook "$src/content/browser/renderer_host/render_widget_host_view_base.cc" "RenderWidgetHostViewBase" <<'PY'
old_fn = "void RenderWidgetHostViewBase::CopyBackgroundColorIfPresentFrom(\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) has a translucent page background.\n"
        "bool g_ardia_opacity_from_default_color = false;\n\n")
old = """  bool was_opaque = IsBackgroundColorOpaque();
  content_background_color_ = other_base.content_background_color_;
  default_background_color_ = other_base.default_background_color_;
  UpdateBackgroundColor();
  bool opaque = IsBackgroundColorOpaque();
"""
new = """  bool was_opaque = IsBackgroundColorOpaque();
  // Ardia: ArdiaCore
  const auto ardia_opaque = [this] {
    return !default_background_color_ ||
           SkColorGetA(*default_background_color_) == SK_AlphaOPAQUE;
  };
  if (g_ardia_opacity_from_default_color) {
    was_opaque = ardia_opaque();
  }
  content_background_color_ = other_base.content_background_color_;
  default_background_color_ = other_base.default_background_color_;
  UpdateBackgroundColor();
  bool opaque = g_ardia_opacity_from_default_color ? ardia_opaque()
                                                       : IsBackgroundColorOpaque();
"""
def edit(s):
    assert s.count(old_fn) == 1 and s.count(old) == 1
    return s.replace(old_fn, decl + old_fn).replace(old, new)
hook(["bool g_ardia_opacity_from_default_color = false;\n",
      "  if (g_ardia_opacity_from_default_color) {\n"], edit, CONTENT_HOOKS)
PY

hook "$src/chrome/browser/external_protocol/external_protocol_handler.cc" "external protocol dialog" <<'PY'
old_ns = "\nnamespace {\n"
decl = """
// Ardia: ArdiaCore (engine/ardiacore) shows this dialog itself for the tabs it hosts.
bool (*g_ardia_external_protocol_dialog)(
    const GURL& url,
    content::WebContents* web_contents,
    const std::optional<url::Origin>& initiating_origin,
    content::WeakDocumentPtr initiator_document,
    const std::u16string& program_name) = nullptr;
"""
old = """  DCHECK(web_contents);
  if (delegate) {
    delegate->RunExternalProtocolDialog(url, web_contents, page_transition,"""
new = """  DCHECK(web_contents);
  // Ardia: ArdiaCore
  if (!delegate && g_ardia_external_protocol_dialog &&
      g_ardia_external_protocol_dialog(url, web_contents, initiating_origin,
                                           initiator_document, program_name)) {
    return;
  }
  if (delegate) {
    delegate->RunExternalProtocolDialog(url, web_contents, page_transition,"""
def edit(s):
    assert s.count(old) == 1
    at = s.index(old_ns)
    return (s[:at] + decl + s[at:]).replace(old, new)
hook(["bool (*g_ardia_external_protocol_dialog)(\n",
      "      g_ardia_external_protocol_dialog(url, web_contents, initiating_origin,\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/history/history_tab_helper.cc" "HistoryTabHelper" <<'PY'
old_fn = "bool HistoryTabHelper::IsEligibleTab(\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) keeps its own pages out of history.\n"
        "bool (*g_ardia_history_eligible)(content::WebContents*) = nullptr;\n\n")
old = """  if (force_eligible_tab_for_testing_) {
    return true;
  }
"""
new = old + """  // Ardia: ArdiaCore
  if (g_ardia_history_eligible && web_contents() &&
      !g_ardia_history_eligible(web_contents())) {
    return false;
  }
"""
def edit(s):
    assert s.count(old_fn) == 1 and s.count(old) == 1
    return s.replace(old_fn, decl + old_fn).replace(old, new)
hook(["bool (*g_ardia_history_eligible)(content::WebContents*) = nullptr;\n",
      "      !g_ardia_history_eligible(web_contents())) {\n"], edit, HOOKS)
PY

hook "$src/extensions/browser/api/declarative_net_request/action_tracker.cc" "declarativeNetRequest's ActionTracker" <<'PY'
old_ns = "namespace extensions::declarative_net_request {\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) counts what extensions' rules did to a tab's requests.\n"
        "void (*g_ardia_dnr_rule_matched)(\n"
        "    content::BrowserContext* browser_context,\n"
        "    int tab_id,\n"
        "    const extensions::declarative_net_request::RequestAction& action,\n"
        "    const extensions::WebRequestInfo& request) = nullptr;\n\n")
old = """  const int tab_id =
      GetTabIdForMatchedRule(browser_context_, request_info.frame_data.tab_id);
"""
new = old + """  // Ardia: ArdiaCore
  if (g_ardia_dnr_rule_matched) {
    g_ardia_dnr_rule_matched(browser_context_, tab_id, request_action,
                                 request_info);
  }
"""
def edit(s):
    assert s.count(old_ns) == 1 and s.count(old) == 1
    return s.replace(old_ns, decl + old_ns).replace(old, new)
hook(["void (*g_ardia_dnr_rule_matched)(\n",
      "    g_ardia_dnr_rule_matched(browser_context_, tab_id, request_action,\n"], edit, CONTENT_HOOKS)
PY

hook "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" "declarativeNetRequest's RulesMonitorService" <<'PY'
old_ns = "namespace extensions {\nnamespace declarative_net_request {\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) holds a profile's navigations until a content blocker's\n"
        "// rulesets are in force.\n"
        "void (*g_ardia_dnr_rulesets_in_force)(\n"
        "    content::BrowserContext* browser_context,\n"
        "    const extensions::ExtensionId& extension_id,\n"
        "    bool all_loaded) = nullptr;\n\n")
old = """  update_dynamic_or_session_rules_queue_map_[load_data.extension_id]
      .SetReadyToExecuteApiCalls();
}

void RulesMonitorService::OnNewStaticRulesetsLoaded(
"""
new = """  update_dynamic_or_session_rules_queue_map_[load_data.extension_id]
      .SetReadyToExecuteApiCalls();

  // Ardia: ArdiaCore
  if (g_ardia_dnr_rulesets_in_force) {
    g_ardia_dnr_rulesets_in_force(
        context_, load_data.extension_id,
        !notify_ruleset_failed_to_load && !global_rule_limit_exceeded);
  }
}

void RulesMonitorService::OnNewStaticRulesetsLoaded(
"""
old_load = """      if (!helper.GetStaticRulesetChecksum(extension->id(), source.id(),
                                           expected_ruleset_checksum)) {
        // This might happen on prefs corruption.
        LogLoadRulesetResult(LoadRulesetResult::kErrorChecksumNotFound);
        ruleset_failed_to_load = true;
        continue;
      }

      RulesetInfo static_ruleset(std::move(source));
      static_ruleset.set_expected_checksum(expected_ruleset_checksum);
      load_data.rulesets.push_back(std::move(static_ruleset));
"""
new_load = """      const bool indexed = helper.GetStaticRulesetChecksum(
          extension->id(), source.id(), expected_ruleset_checksum);
      // Ardia: ArdiaCore. A component extension was never installed, so
      // nothing indexed its rulesets: index them now, as for a ruleset
      // enabled after install (no expected checksum), and keep the checksum.
      if (!indexed &&
          !Manifest::IsComponentLocation(extension->location())) {
        // This might happen on prefs corruption.
        LogLoadRulesetResult(LoadRulesetResult::kErrorChecksumNotFound);
        ruleset_failed_to_load = true;
        continue;
      }

      RulesetInfo static_ruleset(std::move(source));
      if (indexed) {
        static_ruleset.set_expected_checksum(expected_ruleset_checksum);
      }
      load_data.rulesets.push_back(std::move(static_ruleset));
"""
def edit(s):
    assert s.count(old_ns) == 1 and s.count(old) == 1 and s.count(old_load) == 1
    return s.replace(old_ns, decl + old_ns).replace(old, new).replace(old_load, new_load)
hook(["void (*g_ardia_dnr_rulesets_in_force)(\n",
      "    g_ardia_dnr_rulesets_in_force(\n",
      "      // Ardia: ArdiaCore. A component extension was never installed, so\n"], edit, CONTENT_HOOKS)
PY

hook "$src/chrome/browser/extensions/browser_window_util.cc" "extensions' browser_window_util" <<'PY'
old = """  if (restrict_to_normal_browsers &&
      browser.GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return false;
  }
"""
new = old + """
  // Ardia: ArdiaCore. The host's own hidden pages are no extension's window.
  if (g_ardia_hidden_from_extensions &&
      g_ardia_hidden_from_extensions(&browser)) {
    return false;
  }
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  // Ardia: ArdiaCore. The host's own hidden pages are no extension's window.\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/extensions/extension_install_ui_desktop.cc" "the extension post-install UI" <<'PY'
old_ns = "using content::BrowserThread;\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) shows the post-install UI for the windows it hosts.\n"
        "bool (*g_ardia_extension_installed)(\n"
        "    Profile* profile,\n"
        "    scoped_refptr<const extensions::Extension> extension,\n"
        "    const SkBitmap* icon) = nullptr;\n\n")
old = """  // Extensions aren't enabled by default in incognito so we confirm
  // the install in a normal window.
"""
new = """  // Ardia: ArdiaCore
  if (g_ardia_extension_installed &&
      g_ardia_extension_installed(profile(), extension, icon)) {
    return;
  }

""" + old
def edit(s):
    assert s.count(old_ns) == 1 and s.count(old) == 1
    return s.replace(old_ns, decl + old_ns).replace(old, new)
hook(["bool (*g_ardia_extension_installed)(\n",
      "      g_ardia_extension_installed(profile(), extension, icon)) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/download/download_crx_util.cc" "download_crx_util's install prompt" <<'PY'
old_ns = "namespace download_crx_util {\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) shows the install prompt itself, without a tab.\n"
        "bool g_ardia_prompts_without_tab = false;\n\n")
old = """  if (!web_contents) {
    BrowserWindowInterface* browser =
"""
new = """  // Ardia: ArdiaCore
  if (!web_contents && g_ardia_prompts_without_tab) {
    return std::make_unique<ExtensionInstallPrompt>(
        profile, gfx::NativeWindow(),
        std::make_unique<extensions::InstallPromptData>(
            extensions::InstallPromptData::UNSET_PROMPT_TYPE));
  }
""" + old
def edit(s):
    assert s.count(old_ns) == 1 and s.count(old) == 1
    return s.replace(old_ns, old_ns + "\n" + decl, 1).replace(old, new)
hook(["bool g_ardia_prompts_without_tab = false;\n",
      "  if (!web_contents && g_ardia_prompts_without_tab) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.h" "auto picture-in-picture's tab strip observer (header)" <<'PY'
old = """ private:
  void UpdateIsTabActivated(const TabStripModel* tab_strip_model);
"""
new = """  // Ardia: ArdiaCore's host showed or hid `contents`: if it is this helper's tab, read it
  // again, as on a strip change (true).
  bool ArdiaHostVisibilityChanged(content::WebContents* contents);

""" + old
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  bool ArdiaHostVisibilityChanged(content::WebContents* contents);\n"], edit)
PY

hook "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.cc" "auto picture-in-picture's tab strip observer" <<'PY'
old_fn = "// static\nstd::unique_ptr<AutoPictureInPictureTabObserverHelperBase>\n"
decl = """// Ardia: ArdiaCore (engine/ardiacore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
int (*g_ardia_tab_shown_by_host)(content::WebContents*) = nullptr;

namespace {
// Ardia: ArdiaCore: the helpers observing a strip, to tell of the host's changes.
std::set<AutoPictureInPictureTabStripObserverHelper*>& ArdiaObserving() {
  static base::NoDestructor<std::set<AutoPictureInPictureTabStripObserverHelper*>> helpers;
  return *helpers;
}
}  // namespace

// Ardia: ArdiaCore
void ArdiaAutoPictureInPictureHostVisibilityChanged(
    content::WebContents* contents) {
  for (AutoPictureInPictureTabStripObserverHelper* helper : ArdiaObserving()) {
    if (helper->ArdiaHostVisibilityChanged(contents)) {
      return;
    }
  }
}

bool AutoPictureInPictureTabStripObserverHelper::ArdiaHostVisibilityChanged(
    content::WebContents* contents) {
  if (!is_observing_ || GetObservedWebContents() != contents) {
    return false;
  }
  const bool old_is_tab_activated = is_tab_activated_;
  UpdateIsTabActivated(GetCurrentTabStripModel());
  if (is_tab_activated_ != old_is_tab_activated) {
    RunCallback(is_tab_activated_);
  }
  return true;
}

"""
include = '#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.h"\n'
includes = include + "\n#include <set>\n\n#include \"base/no_destructor.h\"\n"
start_old = """  is_observing_ = true;
"""
start_new = start_old + """  ArdiaObserving().insert(this);  // Ardia: ArdiaCore
"""
stop_old = """  is_observing_ = false;
"""
stop_new = stop_old + """  ArdiaObserving().erase(this);  // Ardia: ArdiaCore
"""
update_old = """  if (tab_strip_model) {
    // If there is not currently a selected tab, then the tabstrip is still
"""
update_new = """  if (tab_strip_model) {
    // Ardia: ArdiaCore (a split's other pane is shown, a tab under the host's own page isn't)
    const int shown = g_ardia_tab_shown_by_host
                          ? g_ardia_tab_shown_by_host(GetObservedWebContents())
                          : -1;
    if (shown >= 0) {
      is_tab_activated_ = shown == 1;
      return;
    }
    // If there is not currently a selected tab, then the tabstrip is still
"""
active_old = """  return observed_tab_strip_model_->GetActiveWebContents();
}
"""
active_new = """  content::WebContents* active = observed_tab_strip_model_->GetActiveWebContents();
  // Ardia: ArdiaCore (a tab the host hides isn't the one the user went to)
  if (active && g_ardia_tab_shown_by_host &&
      g_ardia_tab_shown_by_host(active) == 0) {
    return nullptr;
  }
  return active;
}
"""
def edit(s):
    for old in (old_fn, include, start_old, stop_old, update_old, active_old):
        assert s.count(old) == 1, old
    return (s.replace(include, includes).replace(old_fn, decl + old_fn).replace(start_old, start_new)
             .replace(stop_old, stop_new).replace(update_old, update_new).replace(active_old, active_new))
hook(["int (*g_ardia_tab_shown_by_host)(content::WebContents*) = nullptr;\n",
      "void ArdiaAutoPictureInPictureHostVisibilityChanged(\n",
      "  ArdiaObserving().insert(this);  // Ardia: ArdiaCore\n",
      "  ArdiaObserving().erase(this);  // Ardia: ArdiaCore\n",
      "                          ? g_ardia_tab_shown_by_host(GetObservedWebContents())\n",
      "      g_ardia_tab_shown_by_host(active) == 0) {\n"], edit, HOOKS)
PY

hook "$src/components/permissions/permission_request_manager.cc" "the permission request manager's tab activation" <<'PY'
old_ns = "namespace permissions {\n"
decl = """// Ardia: ArdiaCore (engine/ardiacore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
int (*g_ardia_permission_tab_shown)(content::WebContents*) = nullptr;

"""
helper = """
namespace {
// Ardia: ArdiaCore: whether a tab can prompt, as the host shows it (or `chrome_says`).
bool ArdiaTabActive(content::WebContents* contents, bool chrome_says) {
  const int shown = g_ardia_permission_tab_shown && contents
                        ? g_ardia_permission_tab_shown(contents)
                        : -1;
  return shown < 0 ? chrome_says : shown == 1;
}
}  // namespace
"""
vis_old = """  // If `tab_subscriptions_` isn't empty, defer to those listeners instead.
  if (!tab_subscriptions_.empty()) {
    return;
  }
  bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = visibility != content::Visibility::HIDDEN;
"""
vis_new = """  // If `tab_subscriptions_` isn't empty, defer to those listeners instead.
  // Ardia: ArdiaCore (unless the host says)
  const bool host_says =
      g_ardia_permission_tab_shown &&
      g_ardia_permission_tab_shown(web_contents()) >= 0;
  if (!tab_subscriptions_.empty() && !host_says) {
    return;
  }
  bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = ArdiaTabActive(
      web_contents(), visibility != content::Visibility::HIDDEN);
"""
adopt_old = """  tab_is_active_ = tab_interface->IsActivated();
"""
adopt_new = """  tab_is_active_ =
      ArdiaTabActive(web_contents(), tab_interface->IsActivated());  // Ardia: ArdiaCore
"""
status_old = """  const bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = is_active;
"""
status_new = """  const bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = ArdiaTabActive(web_contents(), is_active);  // Ardia: ArdiaCore
"""
def edit(s):
    for old in (old_ns, vis_old, adopt_old, status_old):
        assert s.count(old) == 1, old
    return (s.replace(old_ns, decl + old_ns + helper, 1).replace(vis_old, vis_new)
             .replace(adopt_old, adopt_new).replace(status_old, status_new))
hook(["int (*g_ardia_permission_tab_shown)(content::WebContents*) = nullptr;\n",
      "bool ArdiaTabActive(content::WebContents* contents, bool chrome_says) {\n",
      "  // Ardia: ArdiaCore (unless the host says)\n",
      "      ArdiaTabActive(web_contents(), tab_interface->IsActivated());  // Ardia: ArdiaCore\n",
      "  tab_is_active_ = ArdiaTabActive(web_contents(), is_active);  // Ardia: ArdiaCore\n"],
     edit, CONTENT_HOOKS)
PY

hook "$src/chrome/browser/ui/views/file_system_access/file_system_access_restore_permission_bubble_view.cc" "the File System Access restore prompt" <<'PY'
old = """void ShowFileSystemAccessRestorePermissionDialog(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)> callback,
    content::WebContents* web_contents) {
"""
decl = """// Ardia: ArdiaCore (engine/ardiacore) asks its host; it takes `callback` when it does.
bool (*g_ardia_file_system_restore_prompt)(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)>& callback,
    content::WebContents* web_contents) = nullptr;

"""
new = decl + old + """  // Ardia: ArdiaCore
  if (g_ardia_file_system_restore_prompt &&
      g_ardia_file_system_restore_prompt(request, callback, web_contents)) {
    return;
  }
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["bool (*g_ardia_file_system_restore_prompt)(\n",
      "      g_ardia_file_system_restore_prompt(request, callback, web_contents)) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/tabs/tab_dialog_manager.cc" "TabDialogManager's visibility" <<'PY'
old = """  return GetWidgetVisibility(tab_interface_->IsVisible(), is_minimized,
                             params_->should_show_callback);
"""
new = """  // Ardia: ArdiaCore (the host's reading, when it gave one)
  const int shown =
      g_ardia_tab_shown_by_host
          ? g_ardia_tab_shown_by_host(tab_interface_->GetContents())
          : -1;
  return GetWidgetVisibility(
      shown < 0 ? tab_interface_->IsVisible() : shown == 1, is_minimized,
      params_->should_show_callback);
"""
bg_old = """void TabDialogManager::TabWillEnterBackground(TabInterface* tab_interface) {
  if (widget_) {
"""
bg_new = """void TabDialogManager::TabWillEnterBackground(TabInterface* tab_interface) {
  // Ardia: ArdiaCore
  if (widget_ && g_ardia_tab_shown_by_host &&
      g_ardia_tab_shown_by_host(tab_interface_->GetContents()) == 1) {
    return;
  }
  if (widget_) {
"""
def edit(s):
    assert s.count(old) == 1 and s.count(bg_old) == 1
    return s.replace(old, new).replace(bg_old, bg_new)
hook(["          ? g_ardia_tab_shown_by_host(tab_interface_->GetContents())\n",
      "      g_ardia_tab_shown_by_host(tab_interface_->GetContents()) == 1) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/extensions/api/extension_action/extension_action_api.cc" "chrome.action.openPopup" <<'PY'
old_ns = "namespace extensions {\n"
decl = ("// Ardia: ArdiaCore (engine/ardiacore) shows action popups in the host's own panel. Empty: not\n"
        "// its Browser; true: shown (it runs `callback`); false: refused, with `error`.\n"
        "std::optional<bool> (*g_ardia_open_action_popup)(\n"
        "    BrowserWindowInterface& browser,\n"
        "    const extensions::Extension& extension,\n"
        "    ShowPopupCallback& callback,\n"
        "    std::string* error) = nullptr;\n\n")
old = """                        ShowPopupCallback callback) {
#if !BUILDFLAG(IS_ANDROID)
"""
new = """                        ShowPopupCallback callback) {
  // Ardia: ArdiaCore
  if (g_ardia_open_action_popup) {
    if (std::optional<bool> shown = g_ardia_open_action_popup(
            browser, extension, callback, error)) {
      return *shown;
    }
  }
#if !BUILDFLAG(IS_ANDROID)
"""
inc_old = "#include <memory>\n"
def edit(s):
    assert s.count(old) == 1 and s.count(inc_old) == 1
    i = s.index(old_ns)
    s = s[:i] + decl + s[i:]
    return s.replace(old, new).replace(inc_old, inc_old + "#include <optional>\n", 1)
hook(["std::optional<bool> (*g_ardia_open_action_popup)(\n",
      "    if (std::optional<bool> shown = g_ardia_open_action_popup(\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/views/extensions/extension_keybinding_registry_views.cc" "extension commands' reserved keys" <<'PY'
decl = ("// Ardia: ArdiaCore. True when the key being pressed runs one of the host's reserved commands.\n"
        "bool (*g_ardia_reserved_accelerator)(const ui::Accelerator& accelerator) = nullptr;\n\n")
ctor = "ExtensionKeybindingRegistryViews::ExtensionKeybindingRegistryViews(\n"
old = """    const ui::Accelerator& accelerator) {
  return ExtensionKeybindingRegistry::NotifyEventTargets(accelerator);
"""
new = """    const ui::Accelerator& accelerator) {
  if (g_ardia_reserved_accelerator && g_ardia_reserved_accelerator(accelerator)) {
    return false;
  }
  return ExtensionKeybindingRegistry::NotifyEventTargets(accelerator);
"""
def edit(s):
    assert s.count(old) == 1 and s.count(ctor) >= 1
    i = s.index(ctor)
    return (s[:i] + decl + s[i:]).replace(old, new)
hook(["bool (*g_ardia_reserved_accelerator)(const ui::Accelerator& accelerator) = nullptr;\n",
      "  if (g_ardia_reserved_accelerator && g_ardia_reserved_accelerator(accelerator)) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/ui/views/extensions/extension_action_delegate_desktop.cc" "extension actions' reserved keys" <<'PY'
old = """    const ui::Accelerator& accelerator) {
  return model_->TryHandleAcceleratorPress();
"""
new = """    const ui::Accelerator& accelerator) {
  if (g_ardia_reserved_accelerator && g_ardia_reserved_accelerator(accelerator)) {
    return false;
  }
  return model_->TryHandleAcceleratorPress();
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  if (g_ardia_reserved_accelerator && g_ardia_reserved_accelerator(accelerator)) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/extensions/extension_commands_global_registry.cc" "global extension commands' reserved keys" <<'PY'
stale = "g_ardia_host_takes_global_accelerator"
if stale in s:
    sys.exit(f"apply.sh: {name}: {path} still has a3258b69's OnKeyPressed hook: restore the file from the series base (docs/engine-build.md)")
decl = ("// Ardia: ArdiaCore. True when the accelerator is bound to one of the host's reserved commands.\n"
        "bool (*g_ardia_reserved_global_accelerator)(const ui::Accelerator& accelerator) = nullptr;\n"
        "// Ardia: ArdiaCore. Called when shortcut handling resumes.\n"
        "void (*g_ardia_global_shortcuts_resumed)() = nullptr;\n\n")
old_ns = "namespace extensions {\n"
old = """  auto* instance = GetGlobalAcceleratorListener();
  if (!instance) {
    return false;
  }
  return instance->RegisterAccelerator(accelerator, this);
"""
new = """  auto* instance = GetGlobalAcceleratorListener();
  if (!instance) {
    return false;
  }
  if (g_ardia_reserved_global_accelerator &&
      g_ardia_reserved_global_accelerator(accelerator)) {
    return false;
  }
  return instance->RegisterAccelerator(accelerator, this);
"""
resume_old = """    registry_for_active_window()->SetShortcutHandlingSuspended(suspended);
  }
}
"""
resume_new = """    registry_for_active_window()->SetShortcutHandlingSuspended(suspended);
  }
  if (!suspended && g_ardia_global_shortcuts_resumed) {
    g_ardia_global_shortcuts_resumed();
  }
}
"""
tail_old = "}  // namespace extensions\n"
tail_new = """namespace {

class ArdiaGlobalRegistryAccess : public ExtensionCommandsGlobalRegistry {
 public:
  static void Reregister(ExtensionCommandsGlobalRegistry* registry,
                         content::BrowserContext* context) {
    for (const scoped_refptr<const Extension>& extension :
         ExtensionRegistry::Get(context)->enabled_extensions()) {
      (registry->*(&ArdiaGlobalRegistryAccess::RemoveExtensionKeybinding))(
          extension.get(), std::string());
      (registry->*(&ArdiaGlobalRegistryAccess::AddExtensionKeybindings))(
          extension.get(), std::string());
    }
  }
};

}  // namespace

void ArdiaReregisterGlobalCommands(content::BrowserContext* context) {
  if (ExtensionCommandsGlobalRegistry* registry =
          ExtensionCommandsGlobalRegistry::Get(context)) {
    ArdiaGlobalRegistryAccess::Reregister(registry, context);
  }
}

}  // namespace extensions
"""
inc_old = '#include "extensions/common/extension.h"\n'
def edit(s):
    assert s.count(old) == 1 and s.count(old_ns) == 1 and s.count(tail_old) == 1 and s.count(inc_old) == 1
    assert s.count(resume_old) == 1
    i = s.index(old_ns)
    s = s[:i] + decl + s[i:]
    s = s.replace(old, new).replace(tail_old, tail_new).replace(resume_old, resume_new)
    return s.replace(inc_old, inc_old + '#include "extensions/browser/extension_registry.h"\n')
hook(["bool (*g_ardia_reserved_global_accelerator)(const ui::Accelerator& accelerator) = nullptr;\n",
      "  if (g_ardia_reserved_global_accelerator &&\n",
      "void ArdiaReregisterGlobalCommands(content::BrowserContext* context) {\n",
      "  if (!suspended && g_ardia_global_shortcuts_resumed) {\n"], edit, HOOKS)
PY

hook "$src/chrome/browser/performance_manager/user_tuning/cpu_health_tracker.cc" "CpuHealthTracker's sampling" <<'PY'
at = "namespace performance_manager::user_tuning {\n"
decl = """bool g_ardia_skip_cpu_health_sampling = false;

"""
old = """  std::unique_ptr<system_cpu::CpuProbe> cpu_probe =
      system_cpu::CpuProbe::Create();
  if (cpu_probe) {"""
new = """  std::unique_ptr<system_cpu::CpuProbe> cpu_probe =
      g_ardia_skip_cpu_health_sampling ? nullptr
                                       : system_cpu::CpuProbe::Create();
  if (cpu_probe) {"""
def edit(s):
    assert s.count(at) == 1 and s.count(old) == 1
    i = s.index(at)
    return s[:i] + decl + s[i:].replace(old, new)
hook(["bool g_ardia_skip_cpu_health_sampling = false;\n",
      "      g_ardia_skip_cpu_health_sampling ? nullptr\n"], edit, HOOKS)
PY

hook "$src/components/memory_pressure/system_memory_pressure_evaluator_mac.cc" "the disk space check's relaxed period" <<'PY'
at = "namespace memory_pressure::mac {\n"
decl = """int g_ardia_disk_space_check_seconds = 0;

namespace {
constexpr base::ByteSize kArdiaRelaxedDiskSpace = base::GiB(20);
}

"""
old = """  if (disk_pressure_vote_ != new_disk_vote) {
    disk_pressure_vote_ = new_disk_vote;
    UpdatePressureAndManageNotifications();
  }
"""
new = """  if (disk_pressure_vote_ != new_disk_vote) {
    disk_pressure_vote_ = new_disk_vote;
    UpdatePressureAndManageNotifications();
  }

  if (g_ardia_disk_space_check_seconds > 0) {
    const base::TimeDelta period =
        disk_space_info.has_value() &&
                disk_space_info->available > kArdiaRelaxedDiskSpace
            ? base::Seconds(g_ardia_disk_space_check_seconds)
            : kDiskSpaceCheckPeriod;
    if (disk_space_check_timer_.GetCurrentDelay() != period) {
      disk_space_check_timer_.Start(
          FROM_HERE, period,
          base::BindRepeating(&SystemMemoryPressureEvaluator::CheckDiskSpace,
                              weak_ptr_factory_.GetWeakPtr()));
    }
  }
"""
def edit(s):
    assert s.count(at) == 1 and s.count(old) == 1
    i = s.index(at)
    return s[:i] + decl + s[i:].replace(old, new)
hook(["int g_ardia_disk_space_check_seconds = 0;\n",
      "  if (g_ardia_disk_space_check_seconds > 0) {\n"], edit, CONTENT_HOOKS)
PY

hook "$src/extensions/browser/api/storage/settings_storage_quota_enforcer.cc" "unlimited storage writes skip the usage scan" <<'PY'
at = "namespace extensions {\n"
decl = """bool g_ardia_lazy_storage_usage = false;

namespace {

template <typename Write>
value_store::ValueStore::WriteResult ArdiaWriteAfterValueRestore(Write write) {
  value_store::ValueStore::WriteResult result = write();
  if (result.status().restore_status ==
      value_store::ValueStore::VALUE_RESTORE_DELETE_SUCCESS) {
    result = write();
  }
  return result;
}

}

"""
edits = [
    ("""    WriteOptions options, const std::string& key, const base::Value& value) {
  LazyCalculateUsage();
""", """    WriteOptions options, const std::string& key, const base::Value& value) {
  if (g_ardia_lazy_storage_usage && !usage_calculated_ &&
      (options & IGNORE_QUOTA)) {
    return ArdiaWriteAfterValueRestore(
        [&] { return HandleResult(delegate_->Set(options, key, value)); });
  }
  LazyCalculateUsage();
"""),
    ("""    const base::DictValue& values) {
  LazyCalculateUsage();
""", """    const base::DictValue& values) {
  if (g_ardia_lazy_storage_usage && !usage_calculated_ &&
      (options & IGNORE_QUOTA)) {
    return ArdiaWriteAfterValueRestore(
        [&] { return HandleResult(delegate_->Set(options, values)); });
  }
  LazyCalculateUsage();
"""),
    ("""    const std::string& key) {
  LazyCalculateUsage();
  WriteResult result = HandleResult(delegate_->Remove(key));
""", """    const std::string& key) {
  if (g_ardia_lazy_storage_usage && !usage_calculated_) {
    return ArdiaWriteAfterValueRestore(
        [&] { return HandleResult(delegate_->Remove(key)); });
  }
  LazyCalculateUsage();
  WriteResult result = HandleResult(delegate_->Remove(key));
"""),
    ("""ValueStore::WriteResult SettingsStorageQuotaEnforcer::Clear() {
  LazyCalculateUsage();
""", """ValueStore::WriteResult SettingsStorageQuotaEnforcer::Clear() {
  if (g_ardia_lazy_storage_usage && !usage_calculated_) {
    return ArdiaWriteAfterValueRestore(
        [&] { return HandleResult(delegate_->Clear()); });
  }
  LazyCalculateUsage();
"""),
]
def edit(s):
    assert s.count(at) == 1
    for old, _ in edits:
        assert s.count(old) == 1, old
    i = s.index(at)
    s = s[:i] + decl + s[i:]
    for old, new in edits:
        s = s.replace(old, new)
    return s
hook(["bool g_ardia_lazy_storage_usage = false;\n",
      "value_store::ValueStore::WriteResult ArdiaWriteAfterValueRestore(Write write) {\n",
      "        [&] { return HandleResult(delegate_->Set(options, key, value)); });\n",
      "        [&] { return HandleResult(delegate_->Set(options, values)); });\n",
      "        [&] { return HandleResult(delegate_->Remove(key)); });\n",
      "        [&] { return HandleResult(delegate_->Clear()); });\n"], edit, CONTENT_HOOKS)
PY

hook "$src/device/fido/cable/v2_discovery.h" "hybrid WebAuthn scans only while its sheet shows" <<'PY'
edits = [
    ("""  void StartInternal() override;

""", """  void StartInternal() override;

  static void SetHybridUiShown(const void* model, bool shown);

"""),
    ("""  bool device_committed_ = false;
""", """  bool device_committed_ = false;
  bool scan_wanted_ = false;
"""),
]
def edit(s):
    for old, _ in edits:
        assert s.count(old) == 1, old
    for old, new in edits:
        s = s.replace(old, new)
    return s
hook(["  static void SetHybridUiShown(const void* model, bool shown);\n", "  bool scan_wanted_ = false;\n"], edit)
PY

hook "$src/device/fido/cable/v2_discovery.cc" "hybrid WebAuthn scans only while its sheet shows" <<'PY'
edits = [
    ("""#include "base/metrics/histogram_functions.h"
""", """#include "base/metrics/histogram_functions.h"
#include "base/no_destructor.h"
"""),
    ("""namespace device::cablev2 {

namespace {
""", """bool g_ardia_hybrid_scan_on_demand = false;

namespace device::cablev2 {

namespace {

base::flat_set<const void*>& ModelsShowingHybrid() {
  static base::NoDestructor<base::flat_set<const void*>> models;
  return *models;
}

std::vector<base::WeakPtr<Discovery>>& ScanWaiters() {
  static base::NoDestructor<std::vector<base::WeakPtr<Discovery>>> waiters;
  return *waiters;
}
"""),
    ("""      event_callback_));
}

void Discovery::PairingIsInvalid(""", """      event_callback_));
  if (g_ardia_hybrid_scan_on_demand && scan_wanted_ && !discovery_session_) {
    StartCableDiscovery();
  }
}

void Discovery::PairingIsInvalid("""),
    ("""void Discovery::StartCableDiscovery() {
""", """void Discovery::SetHybridUiShown(const void* model, bool shown) {
  base::flat_set<const void*>& models = ModelsShowingHybrid();
  const bool was_shown = !models.empty();
  if (shown) {
    models.insert(model);
  } else {
    models.erase(model);
  }
  if (was_shown == !models.empty()) {
    return;
  }
  std::vector<base::WeakPtr<Discovery>> live;
  for (const base::WeakPtr<Discovery>& waiter : ScanWaiters()) {
    if (waiter) {
      live.push_back(waiter);
    }
  }
  ScanWaiters() = live;
  for (const base::WeakPtr<Discovery>& discovery : live) {
    if (!discovery) {
      continue;
    }
    if (!models.empty()) {
      discovery->StartCableDiscovery();
    } else if (discovery->tunnels_pending_advert_.empty()) {
      discovery->discovery_session_.reset();
    }
  }
}

void Discovery::StartCableDiscovery() {
  if (g_ardia_hybrid_scan_on_demand) {
    if (!scan_wanted_) {
      scan_wanted_ = true;
      std::erase_if(ScanWaiters(),
                    [](const base::WeakPtr<Discovery>& waiter) { return !waiter; });
      ScanWaiters().push_back(weak_factory_.GetWeakPtr());
    }
    if (ModelsShowingHybrid().empty() && tunnels_pending_advert_.empty()) {
      return;
    }
  }
"""),
    ("""  FIDO_LOG(DEBUG) << "Discovery session started.";
  SetDiscoverySession(std::move(session));
""", """  FIDO_LOG(DEBUG) << "Discovery session started.";
  if (g_ardia_hybrid_scan_on_demand && ModelsShowingHybrid().empty() &&
      tunnels_pending_advert_.empty()) {
    return;
  }
  SetDiscoverySession(std::move(session));
"""),
    ("""Discovery::~Discovery() {
  if (adapter_) {
""", """Discovery::~Discovery() {
  if (scan_wanted_) {
    std::erase_if(ScanWaiters(), [this](const base::WeakPtr<Discovery>& waiter) {
      return !waiter || waiter.get() == this;
    });
  }
  if (adapter_) {
"""),
    ("""}  // namespace device::cablev2
""", """}  // namespace device::cablev2

void ArdiaSetHybridUiShown(const void* model, bool shown) {
  device::cablev2::Discovery::SetHybridUiShown(model, shown);
}
"""),
]
def edit(s):
    for old, _ in edits:
        assert s.count(old) == 1, old
    for old, new in edits:
        s = s.replace(old, new)
    return s
hook(["bool g_ardia_hybrid_scan_on_demand = false;\n",
      "base::flat_set<const void*>& ModelsShowingHybrid() {\n",
      "void Discovery::SetHybridUiShown(const void* model, bool shown) {\n",
      "  if (g_ardia_hybrid_scan_on_demand && scan_wanted_ && !discovery_session_) {\n",
      "  if (g_ardia_hybrid_scan_on_demand && ModelsShowingHybrid().empty() &&\n",
      "void ArdiaSetHybridUiShown(const void* model, bool shown) {\n",
      "      return !waiter || waiter.get() == this;\n"], edit, CONTENT_HOOKS)
PY

hook "$src/chrome/browser/webauthn/authenticator_request_dialog_model.cc" "hybrid WebAuthn scans only while its sheet shows" <<'PY'
edits = [
    ("""AuthenticatorRequestDialogModel::~AuthenticatorRequestDialogModel() {
""", """AuthenticatorRequestDialogModel::~AuthenticatorRequestDialogModel() {
  ArdiaSetHybridUiShown(this, false);
"""),
    ("""  const StepUIType previous_ui_type = step_ui_type(step_);
  step_ = step;
""", """  const StepUIType previous_ui_type = step_ui_type(step_);
  step_ = step;
  if (g_ardia_hybrid_scan_on_demand) {
    ArdiaSetHybridUiShown(this, step_ == Step::kCableV2QRCode ||
                                    step_ == Step::kCableV2Connecting ||
                                    step_ == Step::kCableV2Connected);
  }
"""),
]
def edit(s):
    for old, _ in edits:
        assert s.count(old) == 1, old
    for old, new in edits:
        s = s.replace(old, new)
    return s
hook(["  ArdiaSetHybridUiShown(this, false);\n",
      "    ArdiaSetHybridUiShown(this, step_ == Step::kCableV2QRCode ||\n"], edit, CONTENT_HOOKS)
PY

hook "$src/device/bluetooth/bluetooth_low_energy_adapter_apple.h" "Bluetooth LE state updates reach the Mac adapter" <<'PY'
old = """  virtual void TriggerSystemPermissionPrompt() = 0;
"""
new = """  virtual void TriggerSystemPermissionPrompt() = 0;
  virtual void OnLowEnergyCentralManagerStateUpdated() {}
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  virtual void OnLowEnergyCentralManagerStateUpdated() {}\n"], edit)
PY

hook "$src/device/bluetooth/bluetooth_low_energy_adapter_apple.mm" "Bluetooth LE state updates reach the Mac adapter" <<'PY'
old = """        device_mac->DidDisconnectPeripheral(nullptr);
      }
    }
  }
}
"""
new = """        device_mac->DidDisconnectPeripheral(nullptr);
      }
    }
  }
  OnLowEnergyCentralManagerStateUpdated();
}
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  OnLowEnergyCentralManagerStateUpdated();\n}\n"], edit)
PY

hook "$src/device/bluetooth/bluetooth_adapter_mac.h" "the Bluetooth adapter polls on demand" <<'PY'
old = """  void PollAdapter();
"""
new = """  void PollAdapter();
  void PollAdapterOnDemand();
  void OnLowEnergyCentralManagerStateUpdated() override;

  bool poll_pending_ = false;
  bool poll_dirty_ = false;
  base::TimeTicks last_poll_completed_;
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  void PollAdapterOnDemand();\n", "  bool poll_dirty_ = false;\n", "  base::TimeTicks last_poll_completed_;\n"], edit)
PY

hook "$src/device/bluetooth/bluetooth_adapter_mac.mm" "the Bluetooth adapter polls on demand" <<'PY'
at = "namespace device {\n"
decl = """bool g_ardia_bluetooth_poll_on_demand = false;

"""
edits = [
    ("""void BluetoothAdapterMac::LazyInitialize() {
  if (lazy_initialized_)
    return;
""", """void BluetoothAdapterMac::LazyInitialize() {
  if (lazy_initialized_) {
    if (g_ardia_bluetooth_poll_on_demand) {
      PollAdapterOnDemand();
    }
    return;
  }
"""),
    ("""void BluetoothAdapterMac::PollAdapter() {
  const bool was_present = IsPresent();
""", """void BluetoothAdapterMac::PollAdapter() {
  poll_pending_ = true;
  poll_dirty_ = false;
  const bool was_present = IsPresent();
"""),
    ("""  RemoveTimedOutDevices();
  AddPairedDevices();

  ui_task_runner_->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&BluetoothAdapterMac::PollAdapter,
                     weak_ptr_factory_.GetWeakPtr()),
      base::Milliseconds(kPollIntervalMs));
""", """  RemoveTimedOutDevices();
  AddPairedDevices();

  if (g_ardia_bluetooth_poll_on_demand && !IsDiscovering()) {
    poll_pending_ = false;
    last_poll_completed_ = base::TimeTicks::Now();
    if (poll_dirty_) {
      PollAdapterOnDemand();
    }
  } else {
    ui_task_runner_->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&BluetoothAdapterMac::PollAdapter,
                       weak_ptr_factory_.GetWeakPtr()),
        base::Milliseconds(kPollIntervalMs));
  }
"""),
    ("""void BluetoothAdapterMac::ClassicDeviceAdded(
""", """void BluetoothAdapterMac::PollAdapterOnDemand() {
  if (poll_pending_) {
    return;
  }
  poll_pending_ = true;
  const base::TimeDelta wait = last_poll_completed_ +
                               base::Milliseconds(kPollIntervalMs) -
                               base::TimeTicks::Now();
  if (wait.is_positive()) {
    ui_task_runner_->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&BluetoothAdapterMac::PollAdapter,
                       weak_ptr_factory_.GetWeakPtr()),
        wait);
    return;
  }
  PollAdapter();
}

void BluetoothAdapterMac::OnLowEnergyCentralManagerStateUpdated() {
  if (!g_ardia_bluetooth_poll_on_demand || !lazy_initialized_) {
    return;
  }
  if (poll_pending_) {
    poll_dirty_ = true;
    return;
  }
  PollAdapterOnDemand();
}

void BluetoothAdapterMac::ClassicDeviceAdded(
"""),
    ("""  for (auto& observer : observers_)
    observer.AdapterDiscoveringChanged(this, true);
  DCHECK(callback);
""", """  for (auto& observer : observers_)
    observer.AdapterDiscoveringChanged(this, true);
  if (g_ardia_bluetooth_poll_on_demand) {
    PollAdapterOnDemand();
  }
  DCHECK(callback);
"""),
]
def edit(s):
    assert s.count(at) >= 1
    for old, _ in edits:
        assert s.count(old) == 1, old
    i = s.index(at)
    s = s[:i] + decl + s[i:]
    for old, new in edits:
        s = s.replace(old, new)
    return s
hook(["bool g_ardia_bluetooth_poll_on_demand = false;\n",
      "  if (g_ardia_bluetooth_poll_on_demand && !IsDiscovering()) {\n",
      "void BluetoothAdapterMac::PollAdapterOnDemand() {\n",
      "void BluetoothAdapterMac::OnLowEnergyCentralManagerStateUpdated() {\n",
      "    poll_dirty_ = true;\n",
      "  if (g_ardia_bluetooth_poll_on_demand) {\n    PollAdapterOnDemand();\n  }\n  DCHECK(callback);\n"], edit)
PY

hook "$src/chrome/browser/extensions/extension_action_storage_manager.cc" "restored browser action defaults notify" <<'PY'
old = """  SetDefaultsFromValue(value->GetDict(), action);
}
"""
new = """  SetDefaultsFromValue(value->GetDict(), action);
  if (g_ardia_embedder) {
    ExtensionActionDispatcher::Get(browser_context_)
        ->NotifyChange(action, nullptr, browser_context_);
  }
}
"""
def edit(s):
    assert s.count(old) == 1
    return s.replace(old, new)
hook(["  if (g_ardia_embedder) {\n    ExtensionActionDispatcher::Get(browser_context_)\n"], edit, HOOKS)
PY

hook "$src/extensions/browser/extension_user_script_loader.cc" "a script loader made once extensions are ready starts at once" <<'PY'
at = "namespace extensions {\n"
decl = """bool g_ardia_script_loader_ready_at_once = false;

"""
old = """  ExtensionSystem::Get(browser_context)
      ->ready()
      .Post(FROM_HERE,
            base::BindOnce(&ExtensionUserScriptLoader::OnExtensionSystemReady,
                           weak_factory_.GetWeakPtr()));
}
"""
new = """  if (g_ardia_script_loader_ready_at_once &&
      ExtensionSystem::Get(browser_context)->ready().is_signaled()) {
    OnExtensionSystemReady();
    return;
  }
  ExtensionSystem::Get(browser_context)
      ->ready()
      .Post(FROM_HERE,
            base::BindOnce(&ExtensionUserScriptLoader::OnExtensionSystemReady,
                           weak_factory_.GetWeakPtr()));
}
"""
def edit(s):
    assert s.count(at) == 1 and s.count(old) == 1
    i = s.index(at)
    return s[:i] + decl + s[i:].replace(old, new)
hook(["bool g_ardia_script_loader_ready_at_once = false;\n",
      "  if (g_ardia_script_loader_ready_at_once &&\n"], edit, CONTENT_HOOKS)
PY

hook "$src/chrome/browser/extensions/user_script_listener.cc" "navigations wait for content scripts at the response, not the request" <<'PY'
at = "namespace extensions {\n"
decl = """bool g_ardia_scripts_wait_at_response = false;

"""
old = """  ThrottleCheckResult WillStartRequest() override {
    // Only defer requests if Resume has not yet been called.
    if (should_defer_) {
      did_defer_ = true;
      return DEFER;
    }
    return PROCEED;
  }
"""
new = """  ThrottleCheckResult WillStartRequest() override {
    // Only defer requests if Resume has not yet been called.
    if (should_defer_ && !g_ardia_scripts_wait_at_response) {
      did_defer_ = true;
      return DEFER;
    }
    return PROCEED;
  }

  ThrottleCheckResult WillProcessResponse() override {
    if (should_defer_ && g_ardia_scripts_wait_at_response) {
      did_defer_ = true;
      return DEFER;
    }
    return PROCEED;
  }
"""
def edit(s):
    assert s.count(at) == 1 and s.count(old) == 1
    i = s.index(at)
    return s[:i] + decl + s[i:].replace(old, new)
hook(["bool g_ardia_scripts_wait_at_response = false;\n",
      "  ThrottleCheckResult WillProcessResponse() override {\n    if (should_defer_ && g_ardia_scripts_wait_at_response) {\n"], edit, CONTENT_HOOKS)
PY

if [[ $mode == check ]]; then
  exit "$drift"
fi
