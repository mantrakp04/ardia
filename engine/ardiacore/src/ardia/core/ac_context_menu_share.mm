#include "ardia/core/ac_context_menu_share.h"

#import <AppKit/AppKit.h>

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/common/chrome_render_frame.mojom.h"
#include "components/lens/lens_metadata.mojom.h"
#include "content/public/browser/context_menu_params.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/mojom/context_menu/context_menu.mojom.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/size.h"
#include "ardia/core/ac_browser.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

namespace {

using MediaType = blink::mojom::ContextMenuDataMediaType;
using ChromeRenderFrame = mojo::AssociatedRemote<chrome::mojom::ChromeRenderFrame>;

constexpr int kLargestSharedImage = 8192;

bool Web(const GURL& url) {
  return url.SchemeIsHTTPOrHTTPS();
}

NSString* KindName(ContextMenuShare share) {
  switch (share) {
    case ContextMenuShare::kText:
      return @"text";
    case ContextMenuShare::kLink:
      return @"link";
    case ContextMenuShare::kImage:
      return @"image";
    case ContextMenuShare::kVideo:
      return @"video";
    case ContextMenuShare::kAudio:
      return @"audio";
    case ContextMenuShare::kPage:
      return @"page";
  }
}

void Deliver(content::WebContents* contents, NSDictionary* share) {
  if (!WindowHost::ForContents(contents)) {
    return;
  }
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:shareFromContextMenu:)]) {
    [delegate tab:tab shareFromContextMenu:share];
  }
}

NSMutableDictionary* ShareItem(ContextMenuShare share, const gfx::PointF& point) {
  return [@{
    @"kind" : KindName(share),
    @"point" : @[ @(point.x()), @(point.y()) ],
  } mutableCopy];
}

void DeliverImage(base::WeakPtr<content::WebContents> contents,
                  std::unique_ptr<ChromeRenderFrame> frame,
                  const GURL& source,
                  const std::u16string& title,
                  const gfx::PointF& point,
                  const std::vector<uint8_t>& image,
                  const gfx::Size& original_size,
                  const gfx::Size& downscaled_size,
                  const std::string& mime_type,
                  std::vector<lens::mojom::LatencyLogPtr> logs) {
  if (!contents || (image.empty() && !Web(source))) {
    return;
  }
  NSMutableDictionary* item = ShareItem(ContextMenuShare::kImage, point);
  item[@"title"] = base::SysUTF16ToNSString(title);
  if (Web(source)) {
    item[@"url"] = base::SysUTF8ToNSString(source.spec());
  }
  if (!image.empty()) {
    item[@"image"] = [NSData dataWithBytes:image.data() length:image.size()];
    item[@"mimeType"] = base::SysUTF8ToNSString(mime_type);
  }
  Deliver(contents.get(), item);
}

}

std::vector<ContextMenuShare> ContextMenuSharesFor(const content::ContextMenuParams& params) {
  std::vector<ContextMenuShare> shares;
  if (params.is_editable) {
    return shares;
  }
  const bool link = Web(params.link_url);
  const bool selected_link = link && base::CollapseWhitespace(params.selection_text, true) ==
                                         base::CollapseWhitespace(params.link_text, true);
  if (!params.selection_text.empty() && !selected_link) {
    shares.push_back(ContextMenuShare::kText);
  }
  if (link) {
    shares.push_back(ContextMenuShare::kLink);
  }
  if (params.media_type == MediaType::kImage && params.has_image_contents) {
    shares.push_back(ContextMenuShare::kImage);
  }
  if (params.media_type == MediaType::kVideo && Web(params.src_url)) {
    shares.push_back(ContextMenuShare::kVideo);
  }
  if (params.media_type == MediaType::kAudio && Web(params.src_url)) {
    shares.push_back(ContextMenuShare::kAudio);
  }
  if (shares.empty() && params.media_type == MediaType::kNone && Web(params.page_url)) {
    shares.push_back(ContextMenuShare::kPage);
  }
  return shares;
}

std::u16string ContextMenuShareTitle(ContextMenuShare share, bool only) {
  if (only) {
    return u"Share…";
  }
  switch (share) {
    case ContextMenuShare::kText:
      return u"Share Text…";
    case ContextMenuShare::kLink:
      return u"Share Link…";
    case ContextMenuShare::kImage:
      return u"Share Image…";
    case ContextMenuShare::kVideo:
      return u"Share Video…";
    case ContextMenuShare::kAudio:
      return u"Share Audio…";
    case ContextMenuShare::kPage:
      return u"Share Page…";
  }
}

std::vector<int> ContextMenuShareNeighbours(ContextMenuShare share) {
  switch (share) {
    case ContextMenuShare::kText:
      return {IDC_CONTENT_CONTEXT_COPY};
    case ContextMenuShare::kLink:
      return {IDC_CONTENT_CONTEXT_COPYLINKLOCATION, IDC_CONTENT_CONTEXT_SAVELINKAS};
    case ContextMenuShare::kImage:
      return {IDC_CONTENT_CONTEXT_COPYIMAGELOCATION, IDC_CONTENT_CONTEXT_COPYIMAGE,
              IDC_CONTENT_CONTEXT_SAVEIMAGEAS};
    case ContextMenuShare::kVideo:
    case ContextMenuShare::kAudio:
      return {IDC_CONTENT_CONTEXT_COPYAVLOCATION, IDC_CONTENT_CONTEXT_SAVEAVAS};
    case ContextMenuShare::kPage:
      return {IDC_PRINT, IDC_SAVE_PAGE};
  }
}

void ShareFromContextMenu(content::RenderFrameHost& frame,
                          const content::ContextMenuParams& params,
                          ContextMenuShare share) {
  content::WebContents* contents = content::WebContents::FromRenderFrameHost(&frame);
  content::RenderWidgetHostView* view = contents ? contents->GetRenderWidgetHostView() : nullptr;
  if (!view) {
    return;
  }
  NSView* page = view->GetNativeView().GetNativeNSView();
  const NSPoint in_window =
      [page convertPoint:NSMakePoint(params.x, NSHeight(page.bounds) - params.y) toView:nil];
  const gfx::PointF point(in_window.x, in_window.y);
  NSMutableDictionary* item = ShareItem(share, point);
  switch (share) {
    case ContextMenuShare::kText:
      item[@"text"] = base::SysUTF16ToNSString(params.selection_text);
      break;
    case ContextMenuShare::kLink:
      item[@"url"] = base::SysUTF8ToNSString(params.link_url.spec());
      item[@"title"] = base::SysUTF16ToNSString(params.link_text);
      break;
    case ContextMenuShare::kVideo:
    case ContextMenuShare::kAudio:
      item[@"url"] = base::SysUTF8ToNSString(params.src_url.spec());
      break;
    case ContextMenuShare::kPage:
      item[@"url"] = base::SysUTF8ToNSString(params.page_url.spec());
      item[@"title"] = base::SysUTF16ToNSString(contents->GetTitle());
      break;
    case ContextMenuShare::kImage: {
      auto remote = std::make_unique<ChromeRenderFrame>();
      frame.GetRemoteAssociatedInterfaces()->GetInterface(remote.get());
      ChromeRenderFrame* requester = remote.get();
      (*requester)->RequestImageForContextNode(
          0, gfx::Size(kLargestSharedImage, kLargestSharedImage),
          chrome::mojom::ImageFormat::ORIGINAL, chrome::mojom::kDefaultQuality,
          base::BindOnce(&DeliverImage, contents->GetWeakPtr(), std::move(remote), params.src_url,
                         !params.alt_text.empty() ? params.alt_text : params.title_text, point));
      return;
    }
  }
  Deliver(contents, item);
}

}
