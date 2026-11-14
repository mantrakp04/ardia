#import "ardia/core/public/ArdiaCore.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/views/widget/widget.h"
#import "ardia/core/ardiacore_tab_internal.h"

@implementation ArdiaCoreWindow (Picture)

+ (void)copyPictureOfChromeWindow:(NSWindow*)window
                       completion:(void (^)(CGImageRef))completion {
  views::Widget* widget =
      window ? views::Widget::GetWidgetForNativeWindow(gfx::NativeWindow(window)) : nullptr;
  ui::Compositor* compositor = widget ? widget->GetCompositor() : nullptr;
  ui::Layer* root = compositor ? compositor->root_layer() : nullptr;
  if (!root) {
    completion(nullptr);
    return;
  }
  void (^done)(CGImageRef) = [completion copy];
  root->RequestCopyOfOutput(std::make_unique<viz::CopyOutputRequest>(
      viz::CopyOutputRequest::ResultFormat::RGBA,
      viz::CopyOutputRequest::ResultDestination::kSystemMemory,
      base::BindOnce(^(std::unique_ptr<viz::CopyOutputResult> result) {
        CGImageRef image = nullptr;
        if (result && !result->IsEmpty()) {
          auto access = result->ScopedAccessSkBitmap();
          image = ardiacore::CreatePicture(access.GetOutScopedBitmap());
        }
        done(image);
        if (image) {
          CGImageRelease(image);
        }
      })));
}

@end
