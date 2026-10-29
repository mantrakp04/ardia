#ifndef ARDIA_CORE_AC_DEVICE_CHOOSER_H_
#define ARDIA_CORE_AC_DEVICE_CHOOSER_H_

#import <Foundation/Foundation.h>

#include <memory>

#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"

namespace content {
class RenderFrameHost;
class WebContents;
}

namespace permissions {
class ChooserController;
}

namespace ardiacore {

bool HandleDeviceChooser(content::WebContents* contents,
                         std::unique_ptr<permissions::ChooserController>* controller,
                         base::ScopedClosureRunner* fullscreen_blocker,
                         base::OnceClosure* close_closure);
void SelectDevice(int chooser_id, int index);
void CancelDeviceChooser(int chooser_id);
void RefreshDeviceChooser(int chooser_id);
void OpenDeviceChooserSettings(int chooser_id);
bool ShowTestBluetoothChooser(content::WebContents* contents, bool unauthorized);
NSArray<NSDictionary*>* TestChooserEvents();

void HostDeviceChooser(content::WebContents* contents, NSDictionary* state);

}

#endif
