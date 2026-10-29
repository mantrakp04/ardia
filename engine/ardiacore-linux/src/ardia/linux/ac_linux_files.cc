#include "ardia/linux/ac_linux_files.h"

#include <fcntl.h>
#include <sys/stat.h>

#include <algorithm>
#include <ctime>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_download_service.h"
#include "ardia/linux/ac_linux_downloads.h"
#include "ardia/linux/ac_linux_picker_slots.h"
#include "base/base64.h"
#include "base/environment.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/nix/xdg_util.h"
#include "base/posix/eintr_wrapper.h"
#include "base/process/kill.h"
#include "base/process/launch.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ardia/public/ac_engine.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/download/download_crx_util.h"
#include "chrome/browser/icon_loader.h"
#include "chrome/browser/icon_manager.h"
#include "chrome/browser/platform_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "components/download/public/common/download_item.h"
#include "components/dbus/thread_linux/dbus_thread_linux.h"
#include "components/dbus/utils/call_method.h"
#include "components/dbus/utils/check_for_service_and_start.h"
#include "components/dbus/xdg/request.h"
#include "components/download/public/common/download_source.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/download_item_utils.h"
#include "content/public/browser/download_manager.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/drop_data.h"
#include "dbus/bus.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"
#include "extensions/browser/webstore_installer.h"
#include "net/base/filename_util.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/base/clipboard/file_info.h"
#include "ui/base/dragdrop/drag_drop_types.h"
#include "ui/base/dragdrop/mojom/drag_drop_types.mojom.h"
#include "ui/base/dragdrop/os_exchange_data.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/compositor/compositor.h"
#include "ui/display/screen.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/image/image.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/select_file_policy.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"

namespace ardiacore {
bool BackgroundInstance();
}

namespace ardia {
namespace {

using Done = base::OnceCallback<void(bool, base::Value)>;
namespace downloads = linux_downloads;

constexpr base::TaskTraits kFileReads = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                         base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN};
constexpr base::TaskTraits kFileWrites = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                          base::TaskShutdownBehavior::BLOCK_SHUTDOWN};
constexpr size_t kMaxDropName = 255;
constexpr char kPortalService[] = "org.freedesktop.portal.Desktop";
constexpr char kPortalPath[] = "/org/freedesktop/portal/desktop";
constexpr char kPortalOpenUri[] = "org.freedesktop.portal.OpenURI";
constexpr char kFileManagerService[] = "org.freedesktop.FileManager1";
constexpr char kFileManagerPath[] = "/org/freedesktop/FileManager1";
constexpr base::TimeDelta kOpenFolderWait = base::Seconds(5);
constexpr base::TimeDelta kPortalWait = base::Seconds(10);

void Fail(Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

int64_t NowMs() {
  return base::Time::Now().InMillisecondsSinceUnixEpoch();
}

bool ListedDownload(download::DownloadItem* item) {
  if (item->IsTransient() || item->GetDownloadSource() == download::DownloadSource::EXTENSION_INSTALLER ||
      extensions::WebstoreInstaller::GetAssociatedApproval(*item)) {
    return false;
  }
  content::BrowserContext* context = content::DownloadItemUtils::GetBrowserContext(item);
  return !context || !download_crx_util::IsTrustedExtensionDownload(Profile::FromBrowserContext(context), *item);
}

content::DownloadManager* PageDownloads(Profile* profile) {
  return profile && !profile->ShutdownStarted() ? profile->GetDownloadManager() : nullptr;
}

std::vector<std::string> DownloadTargets(Profile* profile, bool complete_only) {
  return downloads::DownloadTargets(PageDownloads(profile), &ListedDownload, complete_only);
}

struct ListReply {
  Done done;
  bool off_the_record = false;
  base::WeakPtr<Profile> profile;
};

void ListReplied(void* context, const char* json) {
  std::unique_ptr<ListReply> reply(static_cast<ListReply*>(context));
  const auto value = json ? base::JSONReader::Read(json, base::JSON_PARSE_RFC) : std::nullopt;
  if (value && value->is_dict()) {
    if (const std::string* error = value->GetDict().FindString("error"))
      return Fail(std::move(reply->done), "ERR_ENGINE", *error);
  }
  auto list = value ? downloads::FilterSnapshot(*value, reply->off_the_record) : std::nullopt;
  if (!list) return Fail(std::move(reply->done), "ERR_BAD_REPLY", "The download list is not valid");
  if (reply->off_the_record) {
    Profile* profile = reply->profile.get();
    if (!profile || profile->ShutdownStarted())
      return Fail(std::move(reply->done), "ERR_PROFILE_ENDING", "This private session is closing");
    list->EraseIf([profile](const base::Value& entry) {
      const std::string* id = entry.GetDict().FindString("id");
      return !id || !LinuxDownloadOwned(profile, *id);
    });
  }
  std::move(reply->done).Run(true, base::Value(std::move(*list)));
}

void ListWhenReady(Profile* profile, Done done, bool ready) {
  if (!ready) return Fail(std::move(done), "ERR_DOWNLOADS_UNAVAILABLE", "Download history is unavailable");
  const std::string path = profile->GetOriginalProfile()->GetPath().value();
  ac_engine_call("ac_downloads_list", path.c_str(), "{}", &ListReplied,
                 new ListReply{std::move(done), profile->IsOffTheRecord(), profile->GetWeakPtr()});
}

void ClearWhenReady(Profile* profile, std::vector<std::string> keep, double before, Done done, bool ready) {
  if (!ready) return Fail(std::move(done), "ERR_DOWNLOADS_UNAVAILABLE", "Download history is unavailable");
  const size_t removed = downloads::ClearDownloads(PageDownloads(profile), &ListedDownload, keep, before);
  std::move(done).Run(true, base::Value(static_cast<int>(removed)));
}

std::optional<std::string> PathArgument(const base::ListValue& values, size_t count) {
  if (values.size() != count || !values[0].is_string() || !downloads::ValidLocalPath(values[0].GetString()))
    return std::nullopt;
  return values[0].GetString();
}

bool RegularFile(const std::string& path) {
  struct stat info;
  return lstat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode);
}

bool SessionBus(base::Environment& environment) {
  if (environment.GetVar("DBUS_SESSION_BUS_ADDRESS").value_or("").size()) return true;
  const std::string runtime = environment.GetVar("XDG_RUNTIME_DIR").value_or("");
  return downloads::ValidLocalPath(runtime) && base::PathExists(base::FilePath(runtime).Append("bus"));
}

struct RevealCheck {
  bool exists = false;
  bool session_bus = false;
  downloads::RevealProbe probe;
};

bool FolderHandler(base::Environment& environment) {
  if (!base::ExecutableExistsInPath(&environment, "xdg-mime")) return true;
  std::string handler;
  return base::GetAppOutput(std::vector<std::string>{"xdg-mime", "query", "default", "inode/directory"}, &handler) &&
         !base::TrimWhitespaceASCII(handler, base::TRIM_ALL).empty();
}

RevealCheck CheckReveal(const std::string& path) {
  auto environment = base::Environment::Create();
  RevealCheck check;
  check.exists = base::PathExists(base::FilePath(path));
  check.session_bus = SessionBus(*environment);
  check.probe.xdg_open = base::ExecutableExistsInPath(environment.get(), "xdg-open");
  check.probe.folder_handler = check.probe.xdg_open && FolderHandler(*environment);
  return check;
}

void ProbeService(scoped_refptr<dbus::Bus> bus, const char* name, base::OnceCallback<void(bool)> done) {
  if (!bus) return std::move(done).Run(false);
  dbus_utils::CheckForServiceAndStart(bus, name, base::BindOnce(
      [](base::OnceCallback<void(bool)> done, std::optional<bool> running) {
        std::move(done).Run(running.value_or(false));
      }, std::move(done)));
}

base::ScopedFD OpenForPortal(const std::string& path) {
  return base::ScopedFD(downloads::OpenRevealTarget(path));
}

std::optional<int> RunOpenFolder(std::string folder, base::LaunchOptions options) {
  options.current_directory = base::FilePath(folder);
  options.allow_new_privs = true;
  options.environment["MM_NOTTTY"] = "1";
  base::Process process = base::LaunchProcess(std::vector<std::string>{"xdg-open", "."}, options);
  if (!process.IsValid()) return 127;
  int exit_code = 0;
  if (process.WaitForExitWithTimeout(kOpenFolderWait, &exit_code)) return exit_code;
  base::EnsureProcessGetsReaped(std::move(process));
  return std::nullopt;
}

class RevealRequest {
 public:
  static void Start(base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done,
                    scoped_refptr<dbus::Bus> bus, std::vector<downloads::RevealBackend> order) {
    auto* request = new RevealRequest(std::move(shell), std::move(path), std::move(done), std::move(bus), std::move(order));
    downloads::RevealOutcome outcome;
    request->Continue(request->chain_.Begin(&outcome), outcome);
  }

 private:
  using Backend = downloads::RevealBackend;
  using Answer = downloads::RevealAnswer;

  RevealRequest(base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done, scoped_refptr<dbus::Bus> bus,
                std::vector<downloads::RevealBackend> order)
      : shell_(std::move(shell)), path_(std::move(path)), done_(std::move(done)), bus_(std::move(bus)),
        chain_(std::move(order)) {}

  void Continue(std::optional<Backend> next, const downloads::RevealOutcome& outcome) {
    if (outcome.done) {
      if (outcome.ok) std::move(done_).Run(true, base::Value(true));
      else Fail(std::move(done_), outcome.code, outcome.message);
      delete this;
      return;
    }
    if (!next) return;
    if (!shell_ || !shell_->GetBrowserContext()) {
      Fail(std::move(done_), "ERR_WINDOW_CLOSED", "The window closed");
      delete this;
      return;
    }
    switch (*next) {
      case Backend::kPortal: return Portal();
      case Backend::kFileManager:
        return ProbeService(bus_, kFileManagerService,
                            base::BindOnce(&RevealRequest::FileManager, weak_factory_.GetWeakPtr()));
      case Backend::kOpenFolder: return OpenFolder();
      case Backend::kUnavailable: return Answered(Backend::kUnavailable, Answer::kUnavailable);
    }
  }

  void Answered(Backend backend, Answer answer) {
    downloads::RevealOutcome outcome;
    const auto next = chain_.Answer(backend, answer, &outcome);
    Continue(next, outcome);
  }

  void Portal() {
    portal_deadline_.Start(FROM_HERE, kPortalWait,
                           base::BindOnce(&RevealRequest::PortalTimedOut, weak_factory_.GetWeakPtr()));
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileReads, base::BindOnce(&OpenForPortal, path_),
                                                 base::BindOnce(&RevealRequest::PortalOpened, weak_factory_.GetWeakPtr()));
  }

  void PortalTimedOut() {
    portal_.reset();
    Answered(Backend::kPortal, Answer::kTimedOut);
  }

  void PortalOpened(base::ScopedFD fd) {
    if (!fd.is_valid() || !bus_) {
      portal_deadline_.Stop();
      return Answered(Backend::kPortal, Answer::kFailed);
    }
    base::nix::CreateXdgActivationToken(
        base::BindOnce(&RevealRequest::PortalToken, weak_factory_.GetWeakPtr(), std::move(fd)));
  }

  void PortalToken(base::ScopedFD fd, std::string token) {
    if (!portal_deadline_.IsRunning()) return;
    dbus_xdg::Dictionary options;
    options["activation_token"] = dbus_utils::Variant::Wrap<"s">(token);
    portal_ = std::make_unique<dbus_xdg::Request>(
        bus_, bus_->GetObjectProxy(kPortalService, dbus::ObjectPath(kPortalPath)), kPortalOpenUri, "OpenDirectory",
        std::move(options), base::BindOnce(&RevealRequest::PortalAnswered, weak_factory_.GetWeakPtr()), std::string(), fd);
  }

  void PortalAnswered(dbus_xdg::Results results) {
    const Answer answer = results.has_value() ? Answer::kShown
        : results.error() == dbus_xdg::ResponseError::kRequestCancelledByUser ? Answer::kCancelled
        : Answer::kFailed;
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&RevealRequest::PortalFinished, weak_factory_.GetWeakPtr(), answer));
  }

  void PortalFinished(Answer answer) {
    portal_deadline_.Stop();
    portal_.reset();
    Answered(Backend::kPortal, answer);
  }

  void FileManager(bool available) {
    if (!available) return Answered(Backend::kFileManager, Answer::kUnavailable);
    dbus_utils::CallMethod<"ass", "">(
        bus_->GetObjectProxy(kFileManagerService, dbus::ObjectPath(kFileManagerPath)), kFileManagerService,
        "ShowItems", base::BindOnce(&RevealRequest::FileManagerAnswered, weak_factory_.GetWeakPtr()),
        std::vector<std::string>{downloads::FileUrl(path_)}, std::string());
  }

  void FileManagerAnswered(dbus_utils::CallMethodResultSig<""> response) {
    Answered(Backend::kFileManager, response.has_value() ? Answer::kShown : Answer::kFailed);
  }

  void OpenFolder() {
    base::nix::CreateLaunchOptionsWithXdgActivation(
        base::BindOnce(&RevealRequest::OpenFolderLaunch, weak_factory_.GetWeakPtr()));
  }

  void OpenFolderLaunch(base::LaunchOptions options) {
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock(), base::WithBaseSyncPrimitives(), base::TaskPriority::USER_VISIBLE},
        base::BindOnce(&RunOpenFolder, base::FilePath(path_).DirName().value(), std::move(options)),
        base::BindOnce(&RevealRequest::OpenFolderExited, weak_factory_.GetWeakPtr()));
  }

  void OpenFolderExited(std::optional<int> exit_code) {
    Answered(Backend::kOpenFolder, downloads::OpenFolderLaunched(exit_code) ? Answer::kShown : Answer::kFailed);
  }

  base::WeakPtr<LinuxShellWebView> shell_;
  const std::string path_;
  Done done_;
  scoped_refptr<dbus::Bus> bus_;
  downloads::LinuxRevealChain chain_;
  std::unique_ptr<dbus_xdg::Request> portal_;
  base::OneShotTimer portal_deadline_;
  base::WeakPtrFactory<RevealRequest> weak_factory_{this};
};

void StartReveal(base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done, scoped_refptr<dbus::Bus> bus,
                 downloads::RevealProbe probe) {
  if (!shell || !shell->GetBrowserContext()) return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed");
  auto order = downloads::RevealOrder(probe);
  if (order.empty()) {
    return Fail(std::move(done), "ERR_REVEAL_UNAVAILABLE", downloads::RevealFailureMessage({}));
  }
  RevealRequest::Start(std::move(shell), std::move(path), std::move(done), std::move(bus), std::move(order));
}

void Reveal(base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done, RevealCheck check) {
  if (!shell || !shell->GetBrowserContext()) return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed");
  if (!check.exists) return Fail(std::move(done), "ERR_FILE_MISSING", "The file no longer exists");
  scoped_refptr<dbus::Bus> bus = check.session_bus ? dbus_thread_linux::GetSharedSessionBus() : nullptr;
  ProbeService(bus, kPortalService, base::BindOnce(
      [](scoped_refptr<dbus::Bus> bus, base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done,
         downloads::RevealProbe probe, bool portal) {
        probe.portal = portal;
        probe.file_manager = portal;
        if (portal) return StartReveal(shell, std::move(path), std::move(done), bus, probe);
        ProbeService(bus, kFileManagerService, base::BindOnce(
            [](scoped_refptr<dbus::Bus> bus, base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done,
               downloads::RevealProbe probe, bool file_manager) {
              probe.file_manager = file_manager;
              StartReveal(shell, std::move(path), std::move(done), bus, probe);
            }, bus, shell, std::move(path), std::move(done), probe));
      }, bus, shell, std::move(path), std::move(done), check.probe));
}

downloads::TrashOutcome Trash(const std::string& path) {
  auto environment = base::Environment::Create();
  const std::string data = environment->GetVar("XDG_DATA_HOME").value_or("");
  const std::string home = environment->GetVar("HOME").value_or("");
  return downloads::MoveToTrash(path, downloads::TrashDirectory(data.c_str(), home.c_str()), std::time(nullptr));
}

base::ListValue FileStatus(const std::vector<std::string>& paths, const std::vector<bool>& listed) {
  base::ListValue result;
  for (size_t index = 0; index < paths.size(); ++index) {
    result.Append(listed[index] && base::PathExists(base::FilePath(paths[index])));
  }
  return result;
}

bool XdgOpenAvailable() {
  auto environment = base::Environment::Create();
  return base::ExecutableExistsInPath(environment.get(), "xdg-open");
}

IconLoader::IconSize IconSize(double size) {
  if (size <= 16) return IconLoader::SMALL;
  if (size <= 32) return IconLoader::NORMAL;
  return IconLoader::LARGE;
}

void ReplyIcon(Done done, gfx::Image image) {
  if (image.IsEmpty()) return std::move(done).Run(true, base::Value());
  const SkBitmap* bitmap = image.ToSkBitmap();
  auto png = bitmap ? gfx::PNGCodec::EncodeBGRASkBitmap(*bitmap, false) : std::nullopt;
  if (!png) return std::move(done).Run(true, base::Value());
  std::move(done).Run(true, base::Value("data:image/png;base64," + base::Base64Encode(*png)));
}

void StartDrag(base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done) {
  views::Widget* widget = shell ? shell->GetWidget() : nullptr;
  switch (downloads::ChooseDragStart(widget && widget->GetRootView(), widget && widget->dragged_view(),
                                     aura::Env::GetInstance()->IsLeftMouseButtonDown())) {
    case downloads::DragStart::kWindowClosed:
      return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed");
    case downloads::DragStart::kDragActive:
      return Fail(std::move(done), "ERR_DRAG_ACTIVE", "A drag is already in progress");
    case downloads::DragStart::kButtonReleased:
      return Fail(std::move(done), "ERR_DRAG_RELEASED", "The mouse button was released before the drag started");
    case downloads::DragStart::kStart:
      break;
  }
  std::move(done).Run(true, base::Value(true));
  auto data = std::make_unique<ui::OSExchangeData>();
  data->SetFilename(base::FilePath(path));
  gfx::Point location = display::Screen::Get()->GetCursorScreenPoint();
  views::View::ConvertPointFromScreen(widget->GetRootView(), &location);
  widget->RunDragDropLoop(shell.get(), std::move(data), location,
                          ui::DragDropTypes::DRAG_COPY | ui::DragDropTypes::DRAG_LINK,
                          ui::mojom::DragEventSource::kMouse);
}

void Open(base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done, bool xdg_open) {
  if (!shell || !shell->GetBrowserContext()) return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed");
  if (downloads::ChooseOpenBackend(xdg_open) == downloads::OpenBackend::kUnavailable)
    return Fail(std::move(done), "ERR_OPEN_UNAVAILABLE", "xdg-open is not available to open files");
  platform_util::OpenItem(Profile::FromBrowserContext(shell->GetBrowserContext()), base::FilePath(path),
                          platform_util::OPEN_FILE,
      base::BindOnce([](Done done, platform_util::OpenOperationResult result) {
        switch (result) {
          case platform_util::OPEN_SUCCEEDED:
            return std::move(done).Run(true, base::Value(true));
          case platform_util::OPEN_FAILED_PATH_NOT_FOUND:
            return Fail(std::move(done), "ERR_FILE_MISSING", "The file no longer exists");
          case platform_util::OPEN_FAILED_INVALID_TYPE:
            return Fail(std::move(done), "ERR_FILE_TYPE", "The download is not a file");
          case platform_util::OPEN_FAILED_NO_HANLDER_FOR_FILE_TYPE:
            return Fail(std::move(done), "ERR_OPEN_UNAVAILABLE", "No desktop application opens this file");
          case platform_util::OPEN_FAILED_FILE_ERROR:
            return Fail(std::move(done), "ERR_OPEN", "The desktop could not open the file");
        }
        Fail(std::move(done), "ERR_OPEN", "The desktop could not open the file");
      }, std::move(done)));
}

bool ChooserShowing(const ui::SelectFileDialog* dialog, gfx::NativeWindow window) {
  if (!dialog) return false;
  if (dialog->IsRunning(window)) return true;
  gfx::NativeWindow root = window ? window->GetRootWindow() : gfx::NativeWindow();
  return root && root != window && dialog->IsRunning(root);
}

class DownloadFolderPicker;

linux_files::PickerSlots<gfx::NativeWindow, DownloadFolderPicker>& FolderPickers() {
  static base::NoDestructor<linux_files::PickerSlots<gfx::NativeWindow, DownloadFolderPicker>> slots;
  return *slots;
}

class DownloadFolderPicker : public ui::SelectFileDialog::Listener {
 public:
  static void Start(gfx::NativeWindow window, const base::FilePath& current, const std::u16string& title, Done done) {
    auto* picker = new DownloadFolderPicker(window, std::move(done));
    FolderPickers().Hold(window, picker);
    picker->dialog_ = ui::SelectFileDialog::Create(picker, std::make_unique<ChromeSelectFilePolicy>(nullptr));
    if (!picker->dialog_) {
      Done failed = std::move(picker->done_);
      picker->Finish();
      return Fail(std::move(failed), "ERR_FOLDER_PICKER_UNAVAILABLE", "No folder dialog is available on this desktop");
    }
    picker->dialog_->SelectFile(ui::SelectFileDialog::SELECT_FOLDER, title, current,
                                nullptr, 0, base::FilePath::StringType(), window);
  }

  bool Showing(gfx::NativeWindow window) const { return ChooserShowing(dialog_.get(), window); }

  void Abandon() {
    FileSelectionCanceled();
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override {
    Done done = std::move(done_);
    const std::string path = file.path().value();
    Finish();
    if (!done) return;
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileReads,
        base::BindOnce(&downloads::CheckDownloadFolder, path),
        base::BindOnce([](std::string path, Done done, downloads::FolderCheck check) {
          if (!check.ok) return Fail(std::move(done), check.code, check.message);
          std::move(done).Run(true, base::Value(std::move(path)));
        }, path, std::move(done)));
  }

  void FileSelectionCanceled() override {
    Done done = std::move(done_);
    Finish();
    if (done) std::move(done).Run(true, base::Value());
  }

  ~DownloadFolderPicker() override = default;

 private:
  DownloadFolderPicker(gfx::NativeWindow window, Done done) : window_(window), done_(std::move(done)) {}

  void Finish() {
    if (finished_) return;
    finished_ = true;
    FolderPickers().Release(window_, this);
    if (dialog_) dialog_->ListenerDestroyed();
    base::SingleThreadTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
  }

  gfx::NativeWindow window_;
  Done done_;
  bool finished_ = false;
  scoped_refptr<ui::SelectFileDialog> dialog_;
};

class OpenFilesPicker;

linux_files::PickerSlots<gfx::NativeWindow, OpenFilesPicker>& FilesPickers() {
  static base::NoDestructor<linux_files::PickerSlots<gfx::NativeWindow, OpenFilesPicker>> slots;
  return *slots;
}

class OpenFilesPicker : public ui::SelectFileDialog::Listener {
 public:
  static void Start(gfx::NativeWindow window, Done done) {
    auto* picker = new OpenFilesPicker(window, std::move(done));
    FilesPickers().Hold(window, picker);
    picker->dialog_ = ui::SelectFileDialog::Create(picker, std::make_unique<ChromeSelectFilePolicy>(nullptr));
    if (!picker->dialog_) {
      Done failed = std::move(picker->done_);
      picker->Finish();
      return Fail(std::move(failed), "ERR_FILE_PICKER_UNAVAILABLE", "No file dialog is available on this desktop");
    }
    picker->dialog_->SelectFile(ui::SelectFileDialog::SELECT_OPEN_MULTI_FILE, u"Open File", base::FilePath(),
                                nullptr, 0, base::FilePath::StringType(), window);
  }

  bool Showing(gfx::NativeWindow window) const { return ChooserShowing(dialog_.get(), window); }

  void Abandon() {
    FileSelectionCanceled();
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override { Reply({file}); }
  void MultiFilesSelected(const std::vector<ui::SelectedFileInfo>& files) override { Reply(files); }
  void FileSelectionCanceled() override { Reply({}); }

  ~OpenFilesPicker() override = default;

 private:
  OpenFilesPicker(gfx::NativeWindow window, Done done) : window_(window), done_(std::move(done)) {}

  void Reply(const std::vector<ui::SelectedFileInfo>& files) {
    Done done = std::move(done_);
    base::ListValue urls;
    for (const auto& file : files) urls.Append(net::FilePathToFileURL(file.path()).spec());
    Finish();
    if (done) std::move(done).Run(true, base::Value(std::move(urls)));
  }

  void Finish() {
    if (finished_) return;
    finished_ = true;
    FilesPickers().Release(window_, this);
    if (dialog_) dialog_->ListenerDestroyed();
    base::SingleThreadTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
  }

  gfx::NativeWindow window_;
  Done done_;
  bool finished_ = false;
  scoped_refptr<ui::SelectFileDialog> dialog_;
};
}

void LinuxPickFolder(gfx::NativeWindow window, const base::ListValue& values, Done done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (values.size() > 2 || std::ranges::any_of(values, [](const base::Value& value) {
        return !value.is_string() && !value.is_none();
      })) {
    return Fail(std::move(done), "ERR_FOLDER_REQUEST", "A current folder and button title, or null, are expected");
  }
  const std::string current = !values.empty() && values[0].is_string() ? values[0].GetString() : std::string();
  const std::string prompt = values.size() == 2 && values[1].is_string() ? values[1].GetString() : std::string();
  if (ardiacore::BackgroundInstance()) {
    LOG(INFO) << "Ardia background instance: folder picker requested";
    return std::move(done).Run(true, base::Value());
  }
  if (!ChromeSelectFilePolicy::FileSelectDialogsAllowed())
    return Fail(std::move(done), "ERR_FILE_CHOOSER_DISABLED", "File choosers are disabled by policy");
  switch (FolderPickers().Admit(window, [](const DownloadFolderPicker* picker, gfx::NativeWindow owner) { return picker->Showing(owner); })) {
    case linux_files::PickerAdmission::kAlreadyShowing:
      return Fail(std::move(done), "ERR_FOLDER_PICKER_OPEN", "A folder dialog is already open in this window");
    case linux_files::PickerAdmission::kReplaceStale:
      FolderPickers().Held(window)->Abandon();
      break;
    case linux_files::PickerAdmission::kOpen:
      break;
  }
  const std::u16string title = !prompt.empty() && prompt.size() <= 200 && base::IsStringUTF8(prompt)
                                   ? base::UTF8ToUTF16(prompt) : std::u16string(u"Choose a Download Folder");
  DownloadFolderPicker::Start(window, downloads::ValidLocalPath(current) ? base::FilePath(current) : base::FilePath(),
                              title, std::move(done));
}

void LinuxPickFiles(gfx::NativeWindow window, const base::ListValue& values, Done done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!values.empty()) return Fail(std::move(done), "ERR_FILES_REQUEST", "Choosing files to open takes no arguments");
  if (ardiacore::BackgroundInstance()) {
    LOG(INFO) << "Ardia background instance: file picker requested";
    return std::move(done).Run(true, base::Value(base::ListValue()));
  }
  if (!ChromeSelectFilePolicy::FileSelectDialogsAllowed())
    return Fail(std::move(done), "ERR_FILE_CHOOSER_DISABLED", "File choosers are disabled by policy");
  switch (FilesPickers().Admit(window, [](const OpenFilesPicker* picker, gfx::NativeWindow owner) { return picker->Showing(owner); })) {
    case linux_files::PickerAdmission::kAlreadyShowing:
      return Fail(std::move(done), "ERR_FILE_PICKER_OPEN", "A file dialog is already open in this window");
    case linux_files::PickerAdmission::kReplaceStale:
      FilesPickers().Held(window)->Abandon();
      break;
    case linux_files::PickerAdmission::kOpen:
      break;
  }
  OpenFilesPicker::Start(window, std::move(done));
}

LinuxShellWebView::LinuxShellWebView(content::BrowserContext* context) : views::WebView(context) {}

LinuxShellWebView::~LinuxShellWebView() = default;

bool LinuxShellWebView::CanDragEnter(content::WebContents* source, const content::DropData& data,
                                     blink::DragOperationsMask operations_allowed) {
  std::vector<std::string> paths;
  if (source == GetWebContents() && !data.did_originate_from_renderer) {
    for (const auto& file : data.filenames) paths.push_back(file.path.value());
  }
  if (paths.empty()) drops_.Clear();
  else drops_.Record(std::move(paths), NowMs());
  return views::WebView::CanDragEnter(source, data, operations_allowed);
}

BEGIN_METADATA(LinuxShellWebView)
END_METADATA

bool LinuxDownloadsHandles(std::string_view name) {
  return name == "downloads.list" || name == "downloads.remove" || name == "downloads.clear";
}

bool LinuxDownloadOwned(Profile* profile, const std::string& id) {
  content::DownloadManager* manager = PageDownloads(profile);
  download::DownloadItem* item = manager ? manager->GetDownloadByGuid(id) : nullptr;
  return item && ListedDownload(item);
}

void LinuxDownloadsCall(Profile* profile, const std::string& name, const base::DictValue& input, Done done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  content::DownloadManager* manager = PageDownloads(profile);
  if (!manager) return Fail(std::move(done), "ERR_PROFILE_UNAVAILABLE", "This window's downloads are unavailable");
  if (name == "downloads.remove") {
    const std::string* id = input.FindString("id");
    const std::string error = id ? downloads::RemoveDownload(manager, &ListedDownload, *id) : "no such download";
    if (!error.empty()) return Fail(std::move(done), "ERR_ENGINE", error);
    return std::move(done).Run(true, base::Value());
  }
  if (name == "downloads.clear") {
    return downloads::DownloadsReady::Wait(manager,
        base::BindOnce(&ClearWhenReady, base::Unretained(profile), downloads::KeptIds(input),
                       downloads::ClearCutoff(input), std::move(done)));
  }
  downloads::DownloadsReady::Wait(manager, base::BindOnce(&ListWhenReady, base::Unretained(profile), std::move(done)));
}

bool LinuxFilesHandles(std::string_view method) {
  for (const auto handled : {"ArdiaSystem.fileStatus", "ArdiaSystem.openFile", "ArdiaSystem.revealFile",
                             "ArdiaSystem.moveToTrash", "ArdiaSystem.fileIcon", "ArdiaFileDrop.takeDrop",
                             "ArdiaFileDrag.begin"}) {
    if (method == handled) return true;
  }
  return false;
}

void LinuxFilesInvoke(Profile* profile, LinuxShellWebView* shell, const std::string& method,
                      const base::ListValue& values, Done done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!profile || profile->ShutdownStarted() || !shell)
    return Fail(std::move(done), "ERR_PROFILE_UNAVAILABLE", "This window's files are unavailable");
  auto weak = shell->GetLinuxWeakPtr();
  if (method == "ArdiaSystem.fileStatus") {
    if (values.size() != 1 || !values[0].is_list() || values[0].GetList().size() > downloads::kMaxStatusPaths)
      return Fail(std::move(done), "ERR_FILE_PATH", "A bounded list of paths is required");
    std::vector<std::string> paths;
    for (const auto& path : values[0].GetList()) {
      if (!path.is_string() || path.GetString().size() > downloads::kMaxPathBytes)
        return Fail(std::move(done), "ERR_FILE_PATH", "Paths must be strings");
      paths.push_back(path.GetString());
    }
    std::vector<bool> listed = downloads::ListedPaths(paths, DownloadTargets(profile, false));
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileReads,
        base::BindOnce(&FileStatus, std::move(paths), std::move(listed)),
        base::BindOnce([](Done done, base::ListValue result) {
          std::move(done).Run(true, base::Value(std::move(result)));
        }, std::move(done)));
    return;
  }
  if (method == "ArdiaSystem.fileIcon") {
    if (values.size() != 2 || !values[0].is_string() || values[0].GetString().empty() ||
        values[0].GetString().size() > downloads::kMaxPathBytes ||
        values[0].GetString().find('\0') != std::string::npos || !(values[1].is_int() || values[1].is_double()))
      return Fail(std::move(done), "ERR_FILE_PATH", "A file name and icon size are required");
    if (!downloads::IconPathAllowed(values[0].GetString(), DownloadTargets(profile, false)))
      return Fail(std::move(done), "ERR_FILE_NOT_ALLOWED", "Icons are only available for downloads and file names");
    IconManager* icons = g_browser_process ? g_browser_process->icon_manager() : nullptr;
    if (!icons) return std::move(done).Run(true, base::Value());
    float scale = 1.0f;
    if (views::Widget* widget = shell->GetWidget(); widget && widget->GetCompositor())
      scale = widget->GetCompositor()->device_scale_factor();
    icons->LoadIcon(base::FilePath(values[0].GetString()), IconSize(values[1].GetDouble()), scale,
                    base::BindOnce(&ReplyIcon, std::move(done)), &shell->icon_tracker());
    return;
  }
  if (method == "ArdiaFileDrop.takeDrop") {
    if (values.size() != 1 || !values[0].is_list() ||
        values[0].GetList().size() > linux_downloads::LinuxDropLedger::kMaxFiles)
      return Fail(std::move(done), "ERR_FILE_DROP", "Dropped file names are required");
    std::vector<std::string> names;
    for (const auto& name : values[0].GetList()) {
      if (!name.is_string() || name.GetString().empty() || name.GetString().size() > kMaxDropName)
        return Fail(std::move(done), "ERR_FILE_DROP", "Dropped file names are invalid");
      names.push_back(name.GetString());
    }
    const auto paths = shell->drops().Take(names, NowMs());
    if (!paths) return Fail(std::move(done), "ERR_NO_FILE_DROP", "No matching desktop file drop is pending");
    base::ListValue urls;
    for (const auto& path : *paths) urls.Append(downloads::FileUrl(path));
    return std::move(done).Run(true, base::Value(std::move(urls)));
  }
  const bool reveal = method == "ArdiaSystem.revealFile";
  const auto path = PathArgument(values, 1);
  if (!path) return Fail(std::move(done), "ERR_FILE_PATH", "An absolute file path is required");
  if (!downloads::PathListed(*path, DownloadTargets(profile, !reveal)))
    return Fail(std::move(done), "ERR_FILE_NOT_ALLOWED", reveal ? "Only downloaded files can be shown"
                                                                : "Only finished downloads can be used");
  if (method == "ArdiaSystem.openFile") {
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileReads, base::BindOnce(&XdgOpenAvailable),
                                                 base::BindOnce(&Open, weak, *path, std::move(done)));
    return;
  }
  if (reveal) {
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileReads,
        base::BindOnce(&CheckReveal, *path),
        base::BindOnce(&Reveal, weak, *path, std::move(done)));
    return;
  }
  if (method == "ArdiaSystem.moveToTrash") {
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileWrites,
        base::BindOnce(&Trash, *path),
        base::BindOnce([](Done done, downloads::TrashOutcome outcome) {
          if (!outcome.ok) return Fail(std::move(done), outcome.code, outcome.message);
          std::move(done).Run(true, base::Value(true));
        }, std::move(done)));
    return;
  }
  if (method == "ArdiaFileDrag.begin") {
    base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, kFileReads,
        base::BindOnce(&RegularFile, *path),
        base::BindOnce([](base::WeakPtr<LinuxShellWebView> shell, std::string path, Done done, bool regular) {
          if (!regular) return Fail(std::move(done), "ERR_FILE_MISSING", "The download is no longer a file");
          StartDrag(shell, std::move(path), std::move(done));
        }, weak, *path, std::move(done)));
    return;
  }
  Fail(std::move(done), "ERR_UNKNOWN_CALL", "Unsupported file operation");
}

}
