#ifndef ARDIA_LINUX_AC_LINUX_EXTENSION_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_EXTENSION_SERVICE_H_

#include <string>
#include <string_view>

#include "base/functional/callback.h"
#include "base/values.h"
#include "ui/gfx/native_ui_types.h"

class BrowserWindowInterface;
class Profile;

namespace content {
class WebContents;
}

namespace ardia {

class LinuxExtensionSurfaces;

using LinuxExtensionsDone = base::OnceCallback<void(bool, base::Value)>;

struct LinuxExtensionWindow {
  LinuxExtensionWindow();
  LinuxExtensionWindow(const LinuxExtensionWindow&);
  LinuxExtensionWindow& operator=(const LinuxExtensionWindow&);
  ~LinuxExtensionWindow();

  Profile* profile = nullptr;
  int window = 0;
  base::RepeatingCallback<gfx::NativeWindow()> native_window;
  base::RepeatingCallback<content::WebContents*(std::string_view)> tab;
};

struct LinuxExtensionsDelegate {
  LinuxExtensionsDelegate();
  LinuxExtensionsDelegate(LinuxExtensionsDelegate&&);
  LinuxExtensionsDelegate& operator=(LinuxExtensionsDelegate&&);
  ~LinuxExtensionsDelegate();

  base::RepeatingCallback<bool(int window, std::string_view name, base::DictValue data)> deliver;
  base::RepeatingCallback<int(Profile*, content::WebContents*, int excluded)> window_for;
  base::RepeatingCallback<int(const BrowserWindowInterface*)> window_of_browser;
  base::RepeatingCallback<std::string(int window, content::WebContents*)> tab_key;
  base::RepeatingCallback<LinuxExtensionSurfaces*(int window)> surfaces;
  base::RepeatingCallback<void(Profile*, std::string_view name, base::DictValue data)> broadcast;
};

void LinuxExtensionsProfile(std::string_view requested, base::OnceCallback<void(Profile*, std::string)> done);
Profile* LinuxExtensionViewProfile(Profile* page_profile, std::string_view requested, std::string* code);

bool LinuxExtensionsHandles(std::string_view name);
void LinuxExtensionsCall(const LinuxExtensionWindow& window, std::string_view requested_profile,
                         const std::string& name, const base::Value* args, LinuxExtensionsDone done);

std::string LinuxExecuteExtensionAction(content::WebContents* contents, const base::ListValue& values);

void StartLinuxExtensions(LinuxExtensionsDelegate delegate);
void LinuxExtensionsWindowRetired(int window);
void LinuxExtensionsWindowClosing(int window);

}

#endif
