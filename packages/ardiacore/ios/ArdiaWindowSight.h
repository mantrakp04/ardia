#import <AppKit/AppKit.h>

namespace ardia_window {

struct WindowSight {
  bool pageFullScreen;
  bool transitioning;
  bool settling;
  bool visible;
  bool applicationActive;
  bool mainWindow;
  bool keyWindow;
  bool ignoresFocus;
};

bool WindowSeen(const WindowSight &state);
NSArray *ObserveWindowAttention(NSWindow *window, dispatch_block_t changed);

}
