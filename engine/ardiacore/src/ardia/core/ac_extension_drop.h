#ifndef ARDIA_CORE_AC_EXTENSION_DROP_H_
#define ARDIA_CORE_AC_EXTENSION_DROP_H_

namespace content {
struct DropData;
class WebContents;
}

namespace ardiacore {

bool InstallDroppedExtensions(content::WebContents* contents,
                              const content::DropData& drop);

}

#endif
