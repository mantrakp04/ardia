// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_boost_tab.h"

#include <array>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/no_destructor.h"
#include "base/supports_user_data.h"
#include "chrome/browser/profiles/profile.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/browser/host_zoom_map.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_view_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "net/base/url_util.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "url/gurl.h"
#include "ardia/core/ac_boosts.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_page_channel.h"

namespace ardiacore {

namespace {

struct ProfileBoosts : public base::SupportsUserData::Data {
  std::string json = "[]";
  Boosts boosts;
};

const int kProfileBoostsKey = 0;

ProfileBoosts& BoostsOf(Profile* profile) {
  Profile* original = profile->GetOriginalProfile();
  auto* data = static_cast<ProfileBoosts*>(original->GetUserData(&kProfileBoostsKey));
  if (!data) {
    auto created = std::make_unique<ProfileBoosts>();
    data = created.get();
    original->SetUserData(&kProfileBoostsKey, std::move(created));
  }
  return *data;
}

class BoostTab : public content::WebContentsObserver,
                 public content::WebContentsUserData<BoostTab> {
 public:
  ~BoostTab() override { All().erase(this); }

  static std::set<BoostTab*>& All() {
    static base::NoDestructor<std::set<BoostTab*>> all;
    return *all;
  }

  Profile* original_profile() {
    return Profile::FromBrowserContext(GetWebContents().GetBrowserContext())
        ->GetOriginalProfile();
  }

  void SetPreview(Boost boost) {
    preview_ = std::move(boost);
    Refresh();
  }

  void ClearPreview() {
    if (preview_) {
      preview_.reset();
      Refresh();
    }
  }

  void Refresh() {
    GetWebContents().ForEachRenderFrameHost([&](content::RenderFrameHost* frame) {
      if (!frame->IsRenderFrameLive()) {
        return;
      }
      BoostEffect effect = EffectFor(frame->GetLastCommittedURL());
      if (auto page = PageOf(frame)) {
        page->SetBoost(effect.css, {}, false);
      }
    });
    ApplyPageState();
  }

 private:
  explicit BoostTab(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<BoostTab>(*contents) {
    All().insert(this);
    Refresh();
  }
  friend class content::WebContentsUserData<BoostTab>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  BoostEffect EffectFor(const GURL& url) {
    return EffectOfBoosts(BoostsOf(original_profile()).boosts,
                          preview_ ? &*preview_ : nullptr, url);
  }

  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override {
    content::RenderFrameHost* frame = navigation->GetRenderFrameHost();
    if (navigation->IsSameDocument() || !frame) {
      return;
    }
    const bool restored = navigation->IsPageActivation();
    BoostEffect effect = EffectFor(navigation->GetURL());
    const bool empty = effect.css.empty() && effect.scripts.empty();
    if (empty && !restored && !armed_) {
      return;
    }
    armed_ = !empty && !restored;
    if (auto page = PageOf(frame)) {
      page->SetBoost(effect.css, restored ? std::vector<std::string>() : effect.scripts,
                     !restored);
    }
  }

  void DidFinishNavigation(content::NavigationHandle* navigation) override {
    if (navigation->IsInPrimaryMainFrame() && navigation->HasCommitted() &&
        !navigation->IsSameDocument()) {
      zoom_key_ = {-1, std::string()};
      ApplyPageState();
    }
  }

  void PrimaryPageChanged(content::Page& page) override { ApplyPageState(); }
  void RenderViewHostChanged(content::RenderViewHost* old_host,
                             content::RenderViewHost* new_host) override {
    color_view_ = nullptr;
  }
  void RenderViewReady() override { ApplyPageState(); }

  void ApplyPageState() {
    const GURL url = GetWebContents().GetLastCommittedURL();
    BoostEffect effect = EffectFor(url);
    ApplyZoom(effect.zoom, effect.zoom == 100 ? std::string() : url.host());
    ApplyColor(effect.color);
  }

  void ApplyZoom(int zoom, const std::string& host) {
    zoom::ZoomController* controller = zoom::ZoomController::FromWebContents(&GetWebContents());
    if (!controller || std::make_pair(zoom, host) == zoom_key_) {
      return;
    }
    zoom_key_ = {zoom, host};
    if (zoom == 100) {
      if (controller->zoom_mode() == zoom::ZoomController::ZOOM_MODE_ISOLATED) {
        const GURL url = GetWebContents().GetLastCommittedURL();
        controller->SetZoomLevel(content::HostZoomMap::GetForWebContents(&GetWebContents())
                                     ->GetZoomLevelForHostAndScheme(url.GetScheme(), net::GetHostOrSpecFromURL(url)));
      }
      controller->SetZoomMode(zoom::ZoomController::ZOOM_MODE_DEFAULT);
      return;
    }
    controller->SetZoomMode(zoom::ZoomController::ZOOM_MODE_ISOLATED);
    controller->SetZoomLevel(blink::ZoomFactorToZoomLevel(zoom / 100.0));
  }

  void ApplyColor(const std::optional<std::array<float, 20>>& color) {
    content::RenderWidgetHostView* view = GetWebContents().GetRenderWidgetHostView();
    if (view == color_view_ && color == color_) {
      return;
    }
    color_view_ = view;
    color_ = color;
    if (view) {
      content::ArdiaSetPageColorFilter(view, color ? color->data() : nullptr);
    }
  }

  std::optional<Boost> preview_;
  bool armed_ = false;
  std::pair<int, std::string> zoom_key_{100, std::string()};
  const void* color_view_ = nullptr;
  std::optional<std::array<float, 20>> color_;
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(BoostTab);

}

void AttachBoosts(content::WebContents* contents) {
  BoostTab::CreateForWebContents(contents);
}

bool SetProfileBoosts(Profile* profile, const std::string& json) {
  std::optional<Boosts> parsed = ParseBoosts(json);
  if (!parsed) {
    return false;
  }
  ProfileBoosts& data = BoostsOf(profile);
  data.json = json;
  data.boosts = std::move(*parsed);
  Profile* original = profile->GetOriginalProfile();
  for (BoostTab* tab : std::set<BoostTab*>(BoostTab::All())) {
    if (tab->original_profile() == original) {
      tab->Refresh();
    }
  }
  return true;
}

const std::string& ProfileBoostsJson(Profile* profile) {
  return BoostsOf(profile).json;
}

bool PreviewBoost(content::WebContents* contents, const std::string& json) {
  std::optional<Boost> boost = ParseBoost(json);
  if (!boost) {
    return false;
  }
  AttachBoosts(contents);
  BoostTab::FromWebContents(contents)->SetPreview(std::move(*boost));
  return true;
}

void ClearBoostPreview(content::WebContents* contents) {
  if (BoostTab* tab = BoostTab::FromWebContents(contents)) {
    tab->ClearPreview();
  }
}

}
