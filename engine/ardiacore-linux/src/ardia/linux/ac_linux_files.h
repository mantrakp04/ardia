#ifndef ARDIA_LINUX_AC_LINUX_FILES_H_
#define ARDIA_LINUX_AC_LINUX_FILES_H_

#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_file_drop.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/values.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/views/controls/webview/webview.h"

class Profile;

namespace ardia {

class LinuxShellWebView : public views::WebView {
  METADATA_HEADER(LinuxShellWebView, views::WebView)

 public:
  explicit LinuxShellWebView(content::BrowserContext* context);
  ~LinuxShellWebView() override;

  bool CanDragEnter(content::WebContents* source, const content::DropData& data,
                    blink::DragOperationsMask operations_allowed) override;

  linux_downloads::LinuxDropLedger& drops() { return drops_; }
  base::CancelableTaskTracker& icon_tracker() { return icon_tracker_; }
  base::WeakPtr<LinuxShellWebView> GetLinuxWeakPtr() { return weak_factory_.GetWeakPtr(); }

 private:
  linux_downloads::LinuxDropLedger drops_;
  base::CancelableTaskTracker icon_tracker_;
  base::WeakPtrFactory<LinuxShellWebView> weak_factory_{this};
};

bool LinuxDownloadsHandles(std::string_view name);
bool LinuxDownloadOwned(Profile* profile, const std::string& id);
void LinuxDownloadsCall(Profile* profile, const std::string& name, const base::DictValue& input,
                        base::OnceCallback<void(bool, base::Value)> done);

void LinuxPickFolder(gfx::NativeWindow window, const base::ListValue& values,
                     base::OnceCallback<void(bool, base::Value)> done);

void LinuxPickFiles(gfx::NativeWindow window, const base::ListValue& values,
                    base::OnceCallback<void(bool, base::Value)> done);

bool LinuxFilesHandles(std::string_view method);
void LinuxFilesInvoke(Profile* profile, LinuxShellWebView* shell, const std::string& method,
                      const base::ListValue& values,
                      base::OnceCallback<void(bool, base::Value)> done);

}

#endif
