#ifndef ARDIA_CORE_AC_CONTEXT_MENU_SHARE_H_
#define ARDIA_CORE_AC_CONTEXT_MENU_SHARE_H_

#include <string>
#include <vector>

namespace content {
class RenderFrameHost;
struct ContextMenuParams;
}

namespace ardiacore {

enum class ContextMenuShare { kText, kLink, kImage, kVideo, kAudio, kPage };

std::vector<ContextMenuShare> ContextMenuSharesFor(const content::ContextMenuParams& params);

std::u16string ContextMenuShareTitle(ContextMenuShare share, bool only);

std::vector<int> ContextMenuShareNeighbours(ContextMenuShare share);

void ShareFromContextMenu(content::RenderFrameHost& frame,
                          const content::ContextMenuParams& params,
                          ContextMenuShare share);

}

#endif
