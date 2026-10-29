// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_PIP_AC_PIP_MAC_H_
#define CHROME_BROWSER_ARDIA_PIP_AC_PIP_MAC_H_

#include <optional>
#include <vector>

#include "base/time/time.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"

std::optional<gfx::Rect> LoadArdiaPictureInPictureBounds();
void SaveArdiaPictureInPictureBounds(const gfx::Rect& bounds);

void FadeOutArdiaPictureInPicture(gfx::NativeWindow window,
                                      base::TimeDelta duration);
void ResetArdiaPictureInPictureFade(gfx::NativeWindow window);

struct ArdiaPipNativeControl {
  const char* name;
  gfx::Rect bounds;
  bool hovered;
  bool pressed;
  float opacity;
};

bool PresentArdiaPictureInPictureControls(
    gfx::NativeWindow window,
    const std::vector<ArdiaPipNativeControl>& controls);

#endif
