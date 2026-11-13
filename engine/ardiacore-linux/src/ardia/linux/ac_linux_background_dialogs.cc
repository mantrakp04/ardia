#include "ardia/linux/ac_linux_background_dialogs.h"

#include <memory>
#include <utility>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/path_service.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/thread_pool.h"
#include "chrome/common/chrome_paths.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/select_file_dialog_factory.h"
#include "ui/shell_dialogs/select_file_policy.h"
#include "ui/shell_dialogs/selected_file_info.h"

namespace ardiacore {

bool BackgroundInstance();

namespace {

std::vector<std::string> TakeFileChooserPicks(const base::FilePath& directory) {
  if (directory.empty()) return {};
  const base::FilePath answers = directory.AppendASCII(kLinuxFileChooserAnswers);
  std::string text;
  const bool read = base::ReadFileToStringWithMaxSize(answers, &text, kLinuxFileChooserFileLimit);
  base::DeleteFile(answers);
  return read ? LinuxFileChooserPicks(text) : std::vector<std::string>();
}

const char* DialogKind(ui::SelectFileDialog::Type type) {
  switch (type) {
    case ui::SelectFileDialog::SELECT_FOLDER:
    case ui::SelectFileDialog::SELECT_UPLOAD_FOLDER:
    case ui::SelectFileDialog::SELECT_EXISTING_FOLDER:
      return "folder";
    case ui::SelectFileDialog::SELECT_SAVEAS_FILE:
      return "save";
    case ui::SelectFileDialog::SELECT_OPEN_MULTI_FILE:
      return "open (multiple)";
    default:
      return "open";
  }
}

class BackgroundFileDialog : public ui::SelectFileDialog {
 public:
  BackgroundFileDialog(Listener* listener, std::unique_ptr<ui::SelectFilePolicy> policy)
      : ui::SelectFileDialog(listener, std::move(policy)) {}

  bool IsRunning(gfx::NativeWindow) const override { return running_; }
  void ListenerDestroyed() override { listener_ = nullptr; }

 private:
  ~BackgroundFileDialog() override = default;

  void SelectFileImpl(Type type,
                      const std::u16string& title,
                      const base::FilePath& default_path,
                      const FileTypeInfo*,
                      int,
                      const base::FilePath::StringType&,
                      gfx::NativeWindow,
                      const GURL*) override {
    running_ = true;
    base::FilePath directory;
    base::PathService::Get(chrome::DIR_USER_DATA, &directory);
    LOG(WARNING) << "[ardiacore] " << DialogKind(type) << " file dialog (background run, not shown): \""
                 << base::UTF16ToUTF8(title) << "\" at " << default_path.value();
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
        base::BindOnce(&TakeFileChooserPicks, directory),
        base::BindOnce(&BackgroundFileDialog::Answer, base::WrapRefCounted(this), type));
  }

  void Answer(Type type, std::vector<std::string> picks) {
    running_ = false;
    LOG(WARNING) << "[ardiacore] background file dialog "
                 << (picks.empty() ? std::string("cancelled") : "chose " + picks.front());
    if (!listener_) return;
    if (picks.empty()) return listener_->FileSelectionCanceled();
    if (type == SELECT_OPEN_MULTI_FILE) {
      std::vector<ui::SelectedFileInfo> files;
      for (const std::string& pick : picks) files.emplace_back(base::FilePath(pick));
      return listener_->MultiFilesSelected(files);
    }
    listener_->FileSelected(ui::SelectedFileInfo(base::FilePath(picks.front())), 0);
  }

  bool HasMultipleFileTypeChoicesImpl() override { return false; }

  bool running_ = false;
};

class BackgroundFileDialogFactory : public ui::SelectFileDialogFactory {
 public:
  ui::SelectFileDialog* Create(ui::SelectFileDialog::Listener* listener,
                               std::unique_ptr<ui::SelectFilePolicy> policy) override {
    return new BackgroundFileDialog(listener, std::move(policy));
  }
};

}

void InstallLinuxBackgroundFileDialogs() {
  if (!BackgroundInstance()) return;
  ui::SelectFileDialog::SetFactory(std::make_unique<BackgroundFileDialogFactory>());
}

}
