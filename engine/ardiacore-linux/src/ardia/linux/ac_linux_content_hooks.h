#ifndef ARDIA_LINUX_AC_LINUX_CONTENT_HOOKS_H_
#define ARDIA_LINUX_AC_LINUX_CONTENT_HOOKS_H_

#include <utility>
#include <vector>

#include "content/public/browser/media_player_id.h"

namespace content {
class WebContents;

struct ArdiaLinuxPictureInPictureCandidate {
  MediaPlayerId id;
  bool playing = false;
  bool muted = false;
};

std::vector<ArdiaLinuxPictureInPictureCandidate> ArdiaLinuxPictureInPictureCandidates(WebContents* contents);
bool ArdiaLinuxRequestPictureInPicture(WebContents* contents, const MediaPlayerId& id);
}

#endif
