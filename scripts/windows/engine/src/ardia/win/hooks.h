#ifndef ARDIA_WIN_HOOKS_H_
#define ARDIA_WIN_HOOKS_H_

#include <memory>
#include <optional>

#include "base/win/windows_types.h"

namespace base {
class CommandLine;
class FilePath;
}

class BrowserFrameView;
class GURL;
class BrowserView;
class BrowserWidget;
class ChromeBrowserMainParts;

namespace content {
class WeakDocumentPtr;
class WebContents;
}

namespace url {
class Origin;
}

extern bool g_ardia_win_hosts_normal_windows;

extern std::unique_ptr<BrowserFrameView> (*g_ardia_win_frame_view)(
    BrowserWidget* widget,
    BrowserView* browser_view);

extern void (*g_ardia_win_add_main_parts)(ChromeBrowserMainParts* main_parts);

extern HWND (*g_ardia_win_prompt_window)();

extern bool (*g_ardia_win_external_protocol_dialog)(
    const GURL& url,
    content::WebContents* web_contents,
    bool has_user_gesture,
    const std::optional<url::Origin>& initiating_origin,
    content::WeakDocumentPtr initiator_document);

extern bool (*g_ardia_win_relaunched)(const base::CommandLine& command_line,
                                      const base::FilePath& cur_dir);

#endif
