#ifndef ARDIA_WIN_HOOKS_H_
#define ARDIA_WIN_HOOKS_H_

#include <memory>

class BrowserFrameView;
class BrowserView;
class BrowserWidget;
class ChromeBrowserMainParts;

extern bool g_ardia_win_hosts_normal_windows;

extern std::unique_ptr<BrowserFrameView> (*g_ardia_win_frame_view)(
    BrowserWidget* widget,
    BrowserView* browser_view);

extern void (*g_ardia_win_add_main_parts)(ChromeBrowserMainParts* main_parts);

#endif
