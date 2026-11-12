// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_PICTURE_IN_PICTURE_H_
#define ARDIA_CORE_AC_PICTURE_IN_PICTURE_H_

#include <string>

namespace content {
class WebContents;
}

namespace ardiacore {

void StartPictureInPictureObserver();

bool PictureInPictureTracing();
void TracePictureInPicture(const std::string& line);

void TraceAutoPictureInPictureInputs(content::WebContents* contents, const char* when);

void NoteWindowActivation(const char* change, long window_number);

void NotePictureInPictureExitRequested();

std::string PictureInPictureCloseRecord();

}

#endif
