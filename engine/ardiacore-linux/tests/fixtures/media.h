#ifndef ARDIA_TEST_MEDIA_H_
#define ARDIA_TEST_MEDIA_H_

#include "page_state.h"

namespace media_session::mojom {
enum class MediaSessionAction {
  kPlay, kPause, kPreviousTrack, kNextTrack, kSeekBackward, kSeekForward, kSkipAd, kStop, kSeekTo, kScrubTo,
  kEnterPictureInPicture, kExitPictureInPicture, kSwitchAudioDevice, kToggleMicrophone, kToggleCamera, kHangUp,
  kRaise, kSetMute, kPreviousSlide, kNextSlide, kEnterAutoPictureInPicture, kSaveVideoFrame,
};
}

namespace base {
inline std::string UTF16ToUTF8(const std::u16string& text) {
  std::string out;
  for (size_t i = 0; i < text.size(); ++i) {
    uint32_t c = text[i];
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.size()) c = 0x10000 + ((c - 0xD800) << 10) + (text[++i] - 0xDC00);
    else if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
    if (c < 0x80) out += char(c);
    else if (c < 0x800) { out += char(0xC0 | (c >> 6)); out += char(0x80 | (c & 63)); }
    else if (c < 0x10000) { out += char(0xE0 | (c >> 12)); out += char(0x80 | ((c >> 6) & 63)); out += char(0x80 | (c & 63)); }
    else { out += char(0xF0 | (c >> 18)); out += char(0x80 | ((c >> 12) & 63)); out += char(0x80 | ((c >> 6) & 63)); out += char(0x80 | (c & 63)); }
  }
  return out;
}
}

#endif
