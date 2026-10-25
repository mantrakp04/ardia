// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_DESKTOP_CAPTURE_H_
#define ARDIA_CORE_AC_DESKTOP_CAPTURE_H_

#include <string>

namespace content {
struct MediaStreamRequest;
class WebContents;
}

namespace ardiacore {

void AllowDesktopCapture(content::WebContents* contents,
                         const std::string& source,
                         const std::string& frame_id,
                         const std::string& origin,
                         const std::string& audio);

bool IsDesktopCaptureSystemAudioSupported();
bool IsDesktopCaptureApplicationAudioSupported();

void ApplyDesktopCaptureGrant(content::WebContents* contents,
                              content::MediaStreamRequest& request);

}

#endif
