#ifndef ARDIA_CORE_AC_MAIN_DELEGATE_H_
#define ARDIA_CORE_AC_MAIN_DELEGATE_H_

#include <optional>

#include "chrome/app/chrome_main_delegate.h"

namespace ardiacore {

class ACMainDelegate : public ChromeMainDelegate {
 public:
  explicit ACMainDelegate(const StartupTimestamps& timestamps);
  ~ACMainDelegate() override;

 protected:
  std::optional<int> BasicStartupComplete() override;
  std::optional<int> PostEarlyInitialization(InvokedIn invoked_in) override;
  void PreSandboxStartup() override;
  content::ContentBrowserClient* CreateContentBrowserClient() override;
  content::ContentRendererClient* CreateContentRendererClient() override;
};

void OnEngineStarted();
void OnEngineShuttingDown();
void ReleaseAppKeepAlive();

}

#endif
