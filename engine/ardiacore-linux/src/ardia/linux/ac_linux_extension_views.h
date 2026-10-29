#ifndef ARDIA_LINUX_AC_LINUX_EXTENSION_VIEWS_H_
#define ARDIA_LINUX_AC_LINUX_EXTENSION_VIEWS_H_

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_extensions.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "chrome/browser/ui/extensions/extension_popup_types.h"

class BrowserWindowInterface;
class Profile;

namespace content {
class WebContents;
}

namespace views {
class View;
}

namespace ardia {

class LinuxExtensionSurfaces {
 public:
  using Emit = base::RepeatingCallback<void(int id, base::DictValue event)>;
  using Done = base::OnceCallback<void(bool, base::Value)>;

  LinuxExtensionSurfaces(BrowserWindowInterface* browser, views::View* parent, Emit emit);
  LinuxExtensionSurfaces(const LinuxExtensionSurfaces&) = delete;
  LinuxExtensionSurfaces& operator=(const LinuxExtensionSurfaces&) = delete;
  ~LinuxExtensionSurfaces();

  static bool Handles(std::string_view method);
  void Invoke(const std::string& method, const base::DictValue& args, Profile* profile, uint64_t generation,
              double scale, Done done);
  void RetireOlderThan(uint64_t generation);
  void CloseAll();

  void ExpectPopup(std::string extension_id, ShowPopupCallback callback);
  std::optional<ShowPopupCallback> TakePendingPopup();

  void SurfaceClosed(int id, bool report);
  void SurfaceEvent(int id, base::DictValue event);
  size_t size() const { return surfaces_.size(); }

 private:
  class Surface;

  void Create(const base::DictValue& args, Profile* profile, uint64_t generation, Done done);
  void Viewport(const base::DictValue& args, uint64_t generation, double scale, Done done);
  void Command(const base::DictValue& args, uint64_t generation, Done done);
  void Release(const base::DictValue& args, uint64_t generation, Done done);
  Surface* Owned(const base::DictValue& args, uint64_t generation);
  void Destroy(int id);
  void ExpirePending();
  void FailPending();

  raw_ptr<BrowserWindowInterface> browser_;
  raw_ptr<views::View> parent_;
  Emit emit_;
  linux_extensions::SurfaceBook book_;
  std::map<int, std::unique_ptr<Surface>> surfaces_;
  linux_extensions::PendingPopup<ShowPopupCallback> pending_;
  base::OneShotTimer pending_timer_;
  base::WeakPtrFactory<LinuxExtensionSurfaces> weak_factory_{this};
};

}

#endif
