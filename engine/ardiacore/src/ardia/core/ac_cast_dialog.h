#ifndef ARDIA_CORE_AC_CAST_DIALOG_H_
#define ARDIA_CORE_AC_CAST_DIALOG_H_

#import <Foundation/Foundation.h>

#include <string>

#include "base/functional/callback_helpers.h"

class Profile;

namespace content {
class WebContents;
}

namespace media_router {
class MediaRouterUI;
}

namespace ardiacore {

bool WantsCastDialog(content::WebContents* initiator);
bool HandleCastDialog(content::WebContents* initiator,
                      media_router::MediaRouterUI* ui,
                      base::ScopedClosureRunner* fullscreen_blocker);
bool ShowCastDialog(content::WebContents* contents);
void StartCasting(int dialog_id, const std::string& sink_id, int cast_mode);
void StopCasting(int dialog_id, const std::string& route_id);
void CloseCastDialog(int dialog_id);

void WatchCastRoutes(Profile* profile);
void TerminateCastRoute(const std::string& route_id);

void HostCastRoutes(Profile* profile, NSArray* routes);
void HostCastDialog(content::WebContents* contents, NSDictionary* state);

}

#endif
