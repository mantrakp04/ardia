// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_video_upscaling.h"

#import <AppKit/AppKit.h>

#include <set>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_view_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/visibility.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_launch_switches.h"

namespace ardiacore {

namespace {

NSString* const kLittleArdiaWindow = @"ardia.window.small";

struct Conditions {
  bool enabled = true;
  std::optional<bool> test_low_power;
  std::optional<bool> test_thermal_pressure;
  bool update_posted = false;
  std::set<content::WebContents*> allowed;
};

Conditions& State() {
  static base::NoDestructor<Conditions> state;
  return *state;
}

bool LowPower() {
  if (State().test_low_power) {
    return *State().test_low_power;
  }
  return NSProcessInfo.processInfo.lowPowerModeEnabled;
}

bool ThermalPressure() {
  if (State().test_thermal_pressure) {
    return *State().test_thermal_pressure;
  }
  return NSProcessInfo.processInfo.thermalState >= NSProcessInfoThermalStateSerious;
}

class UpscalingTab : public content::WebContentsObserver,
                     public content::WebContentsUserData<UpscalingTab> {
 public:
  ~UpscalingTab() override { State().allowed.erase(&GetWebContents()); }

  void Apply(bool allowed) {
    content::RenderWidgetHostView* view = GetWebContents().GetRenderWidgetHostView();
    if (allowed) {
      State().allowed.insert(&GetWebContents());
    } else {
      State().allowed.erase(&GetWebContents());
    }
    if (view == view_ && allowed == allowed_) {
      return;
    }
    view_ = view;
    allowed_ = allowed;
    if (view) {
      view->SetVideoSuperResolutionAllowed(allowed);
    }
  }

  bool allowed() const { return allowed_; }

 private:
  explicit UpscalingTab(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<UpscalingTab>(*contents) {}
  friend class content::WebContentsUserData<UpscalingTab>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  void RenderViewHostChanged(content::RenderViewHost* old_host,
                             content::RenderViewHost* new_host) override {
    if (old_host && old_host->GetWidget() && old_host->GetWidget()->GetView()) {
      old_host->GetWidget()->GetView()->SetVideoSuperResolutionAllowed(false);
    }
    view_ = nullptr;
    allowed_ = false;
    VideoUpscalingInputsChanged();
  }
  void RenderViewReady() override { VideoUpscalingInputsChanged(); }
  void RenderViewDeleted(content::RenderViewHost* host) override {
    view_ = nullptr;
    VideoUpscalingInputsChanged();
  }
  void PrimaryPageChanged(content::Page& page) override { VideoUpscalingInputsChanged(); }
  void OnVisibilityChanged(content::Visibility visibility) override {
    VideoUpscalingInputsChanged();
  }
  void DidToggleFullscreenModeForTab(bool entered, bool will_cause_resize) override {
    VideoUpscalingInputsChanged();
  }

  const void* view_ = nullptr;
  bool allowed_ = false;
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(UpscalingTab);

bool WindowShowsVideoFocused(WindowHost* host) {
  NSWindow* window = host->ns_window();
  return window && !host->internal() && !host->closing() && window.isKeyWindow &&
         window.isVisible && !window.isMiniaturized &&
         (window.occlusionState & NSWindowOcclusionStateVisible) &&
         ![window.identifier isEqualToString:kLittleArdiaWindow];
}

content::WebContents* FocusedTab(WindowHost* host) {
  Profile* profile = host->active_profile();
  Browser* browser = profile ? host->ExistingBrowserFor(profile) : nullptr;
  if (!browser) {
    return nullptr;
  }
  content::WebContents* contents = browser->tab_strip_model()->GetActiveWebContents();
  if (!contents || contents->GetVisibility() != content::Visibility::VISIBLE) {
    return nullptr;
  }
  NSView* view = contents->GetNativeView().GetNativeNSView();
  if (view.window != host->ns_window() || view.hiddenOrHasHiddenAncestor) {
    return nullptr;
  }
  return contents;
}

void Update() {
  Conditions& state = State();
  state.update_posted = false;
  const bool global = state.enabled && !LowPower() && !ThermalPressure() && NSApp.isActive;
  std::set<content::WebContents*> allowed;
  std::set<content::WebContents*> seen;
  for (WindowHost* host : WindowHost::All()) {
    content::WebContents* focused =
        global && WindowShowsVideoFocused(host) ? FocusedTab(host) : nullptr;
    if (focused) {
      allowed.insert(focused);
    }
    for (Browser* browser : host->browsers()) {
      TabStripModel* tabs = browser->tab_strip_model();
      for (int i = 0; i < tabs->count(); ++i) {
        seen.insert(tabs->GetWebContentsAt(i));
      }
    }
  }
  for (content::WebContents* contents : std::set<content::WebContents*>(state.allowed)) {
    if (!seen.count(contents)) {
      if (UpscalingTab* tab = UpscalingTab::FromWebContents(contents)) {
        tab->Apply(false);
      }
    }
  }
  for (content::WebContents* contents : seen) {
    UpscalingTab::CreateForWebContents(contents);
    UpscalingTab::FromWebContents(contents)->Apply(allowed.count(contents) > 0);
  }
}

}

void VideoUpscalingInputsChanged() {
  if (!content::BrowserThread::CurrentlyOn(content::BrowserThread::UI)) {
    content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE,
                                                 base::BindOnce(&VideoUpscalingInputsChanged));
    return;
  }
  if (State().update_posted) {
    return;
  }
  State().update_posted = true;
  content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(&Update));
}

void StartVideoUpscaling() {
  NSNotificationCenter* center = NSNotificationCenter.defaultCenter;
  for (NSNotificationName name : @[
         NSApplicationDidBecomeActiveNotification, NSApplicationDidResignActiveNotification,
         NSApplicationDidHideNotification, NSApplicationDidUnhideNotification,
         NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification,
         NSWindowDidMiniaturizeNotification, NSWindowDidDeminiaturizeNotification,
         NSWindowDidChangeOcclusionStateNotification, NSWindowWillCloseNotification,
         NSProcessInfoPowerStateDidChangeNotification,
         NSProcessInfoThermalStateDidChangeNotification
       ]) {
    [center addObserverForName:name
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification*) {
                      VideoUpscalingInputsChanged();
                    }];
  }
  VideoUpscalingInputsChanged();
}

void SetVideoUpscalingEnabled(bool enabled) {
  if (State().enabled == enabled) {
    return;
  }
  State().enabled = enabled;
  VideoUpscalingInputsChanged();
}

void SetVideoUpscalingTestConditions(std::optional<bool> low_power,
                                     std::optional<bool> thermal_pressure) {
  if (!BackgroundInstance() || !TestInstance()) {
    return;
  }
  State().test_low_power = low_power;
  State().test_thermal_pressure = thermal_pressure;
  VideoUpscalingInputsChanged();
}

NSDictionary* VideoUpscalingState() {
  NSMutableArray* tabs = [NSMutableArray array];
  for (WindowHost* host : WindowHost::All()) {
    for (Browser* browser : host->browsers()) {
      TabStripModel* strip = browser->tab_strip_model();
      for (int i = 0; i < strip->count(); ++i) {
        content::WebContents* contents = strip->GetWebContentsAt(i);
        UpscalingTab* tab = UpscalingTab::FromWebContents(contents);
        [tabs addObject:@{
          @"tabId" : @(sessions::SessionTabHelper::IdForTab(contents).id()),
          @"url" : base::SysUTF8ToNSString(contents->GetLastCommittedURL().spec()),
          @"allowed" : @(tab && tab->allowed()),
        }];
      }
    }
  }
  NSMutableArray* windows = [NSMutableArray array];
  for (WindowHost* host : WindowHost::All()) {
    NSWindow* window = host->ns_window();
    content::WebContents* focused = FocusedTab(host);
    [windows addObject:@{
      @"key" : @(window.isKeyWindow),
      @"visible" : @(window.isVisible),
      @"miniaturized" : @(window.isMiniaturized),
      @"occlusionVisible" : @((window.occlusionState & NSWindowOcclusionStateVisible) != 0),
      @"littleArdia" : @([window.identifier isEqualToString:kLittleArdiaWindow]),
      @"internal" : @(host->internal()),
      @"focusedTab" : focused ? base::SysUTF8ToNSString(focused->GetLastCommittedURL().spec()) : @"",
    }];
  }
  return @{
    @"windows" : windows,
    @"enabled" : @(State().enabled),
    @"lowPower" : @(LowPower()),
    @"thermalPressure" : @(ThermalPressure()),
    @"appActive" : @(NSApp.isActive),
    @"tabs" : tabs,
  };
}

}
