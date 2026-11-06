// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_DESKTOP_CAPTURE_H_
#define ARDIA_CORE_AC_DESKTOP_CAPTURE_H_

#include <string>

#include "content/public/browser/media_stream_request.h"

namespace content {
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

void SetPagesPickDisplayMedia(bool pages_pick);
bool PagesPickDisplayMedia();
bool AnswerNativeDisplayCapture(content::WebContents* contents,
                                const content::MediaStreamRequest& request,
                                content::MediaResponseCallback* callback);

}

#endif
