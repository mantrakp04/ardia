#ifndef ARDIA_LINUX_AC_LINUX_PAGE_COMMANDS_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_COMMANDS_H_

#include <memory>
#include <optional>
#include <string_view>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "content/public/browser/web_contents_observer.h"

class BrowserWindowInterface;
class Profile;

namespace ardiacore {

class LinuxFind;
class LinuxDevToolsLease;
enum class LinuxDevToolsAction;

class LinuxPageCommands : public content::WebContentsObserver {
 public:
  using Owner = base::RepeatingCallback<BrowserWindowInterface*()>;
  using Emit = base::RepeatingCallback<void(base::DictValue)>;
  using Presentation = base::RepeatingCallback<void()>;

  LinuxPageCommands(content::WebContents* contents,
                    Profile* service_profile,
                    Owner owner,
                    Emit emit,
                    bool allow_native_ui,
                    Presentation devtools_presentation);
  ~LinuxPageCommands() override;
  LinuxPageCommands(const LinuxPageCommands&) = delete;
  LinuxPageCommands& operator=(const LinuxPageCommands&) = delete;

  static bool Handles(std::string_view command);
  std::optional<base::DictValue> Dispatch(std::string_view command,
                                          const base::ListValue& args);
  bool AdoptDevTools();
  void Reset();

 private:
  enum class Authority { kCurrent, kStale, kProfile };
  Authority Check() const;
  bool IsCurrent() const;
  void RefreshDevTools();
  void WebContentsDestroyed() override;
  std::optional<base::DictValue> Print(bool system);
  std::optional<base::DictValue> Save();
  std::optional<base::DictValue> DevTools(std::string_view action);
  std::optional<base::DictValue> RunDevTools(LinuxDevToolsAction action);

  base::WeakPtr<content::WebContents> contents_;
  raw_ptr<Profile> service_profile_;
  Owner owner_;
  bool allow_native_ui_;
  Presentation devtools_presentation_;
  std::unique_ptr<LinuxFind> find_;
  std::shared_ptr<LinuxDevToolsLease> devtools_lease_;
  base::WeakPtrFactory<LinuxPageCommands> weak_factory_{this};
};

}

#endif
