#include "ardia/linux/ac_linux_sync_service.h"

#include <cstdlib>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "ardia/core/ac_launch_switches.h"
#include "ardia/linux/ac_linux_credential_service.h"
#include "ardia/linux/ac_linux_files.h"
#include "ardia/linux/ac_linux_sync.h"
#include "ardia/linux/ac_linux_sync_crypto.h"
#include "ardia/linux/ac_linux_sync_json.h"
#include "ardia/linux/ac_linux_sync_keystore.h"
#include "ardia/linux/ac_linux_sync_vault.h"
#include "base/base64.h"
#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/i18n/time_formatting.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/ardia/ac_reauth.h"
#include "chrome/browser/platform_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "chrome/common/chrome_paths.h"
#include "chrome/common/chrome_paths_internal.h"
#include "chrome/common/chrome_switches.h"
#include "components/device_reauth/device_reauth_metrics_util.h"
#include "components/qr_code_generator/bitmap_generator.h"
#include "content/public/browser/browser_thread.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/base/clipboard/clipboard_format_type.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "ui/views/widget/widget.h"

namespace ardia {
namespace {

namespace sync = linux_sync;
using Done = base::OnceCallback<void(bool, base::Value)>;
using Granted = base::OnceCallback<void(bool)>;

constexpr base::TaskTraits kSyncTasks = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                         base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN};
constexpr int kMaxArgDepth = 3;
constexpr size_t kMaxArgs = 8;
constexpr char kLockedMessage[] = "Sync isn't set up on this device.";
constexpr char16_t kDisclosurePurpose[] = u"show your sync recovery phrase";
constexpr char kKeyDirectory[] = "Ardia Sync Keys";
constexpr char kSkippedLogin[] = "skipped";

struct UiState {
  sync::AuthorityLease lease;
  sync::DisclosureWindow disclosure;
};

UiState& Ui() {
  static base::NoDestructor<UiState> state;
  return *state;
}

int64_t NowMs() {
  return (base::TimeTicks::Now() - base::TimeTicks()).InMilliseconds();
}

scoped_refptr<base::SequencedTaskRunner> Runner() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(kSyncTasks));
  return *runner;
}

std::unique_ptr<sync::KeyStore> MakeKeyStore() {
  const auto& command = *base::CommandLine::ForCurrentProcess();
  base::FilePath user_data;
  base::FilePath default_user_data;
  base::PathService::Get(chrome::DIR_USER_DATA, &user_data);
  chrome::GetDefaultUserDataDirectory(&default_user_data);
  if (sync::UseFileKeyStore(ardiacore::BackgroundInstance(), command.HasSwitch(switches::kUserDataDir),
                            user_data.value(), default_user_data.value())) {
    return sync::MakeFileKeyStore(user_data.Append(kKeyDirectory).value());
  }
  return sync::MakeSecretServiceKeyStore();
}

sync::CoreOptions MakeOptions() {
  sync::CoreOptions options;
  const auto configured = ardiacore::InstanceValue("sync-folder");
  if (configured && sync::ValidFolderPath(*configured)) {
    options.default_folder = *configured;
  } else {
    options.default_folder = sync::DefaultFolder(base::GetHomeDir().value());
  }
  return options;
}

sync::SyncCore& Core() {
  static sync::SyncCore* core = new sync::SyncCore(MakeKeyStore(), MakeOptions());
  return *core;
}

std::optional<sync::JsonValue> FromValue(const base::Value& value, int depth) {
  if (depth > kMaxArgDepth) return std::nullopt;
  switch (value.type()) {
    case base::Value::Type::NONE:
      return sync::JsonValue::Null();
    case base::Value::Type::BOOLEAN:
      return sync::JsonValue::Bool(value.GetBool());
    case base::Value::Type::INTEGER:
      return sync::JsonValue::Number(value.GetInt());
    case base::Value::Type::DOUBLE:
      return sync::JsonValue::Number(value.GetDouble());
    case base::Value::Type::STRING:
      return sync::JsonValue::String(value.GetString());
    case base::Value::Type::LIST: {
      sync::JsonValue list = sync::JsonValue::Array();
      for (const base::Value& item : value.GetList()) {
        auto converted = FromValue(item, depth + 1);
        if (!converted) return std::nullopt;
        list.Append(std::move(*converted));
      }
      return list;
    }
    case base::Value::Type::DICT: {
      sync::JsonValue object = sync::JsonValue::Object();
      for (const auto [key, member] : value.GetDict()) {
        auto converted = FromValue(member, depth + 1);
        if (!converted) return std::nullopt;
        object.Set(key, std::move(*converted));
      }
      return object;
    }
    default:
      return std::nullopt;
  }
}

std::string Utf8(const std::string& text) {
  if (base::IsStringUTF8(text)) return text;
  return sync::LossyUtf8(sync::Bytes(text.begin(), text.end()));
}

base::Value ToValue(const sync::JsonValue& value) {
  switch (value.type) {
    case sync::JsonValue::Type::kNull:
      return base::Value();
    case sync::JsonValue::Type::kBool:
      return base::Value(value.flag);
    case sync::JsonValue::Type::kNumber:
      return base::Value(std::strtod(value.text.c_str(), nullptr));
    case sync::JsonValue::Type::kString:
      return base::Value(Utf8(value.text));
    case sync::JsonValue::Type::kArray: {
      base::ListValue list;
      for (const auto& item : value.items) list.Append(ToValue(item));
      return base::Value(std::move(list));
    }
    case sync::JsonValue::Type::kObject: {
      base::DictValue dict;
      for (const auto& [key, member] : value.members) dict.Set(Utf8(key), ToValue(member));
      return base::Value(std::move(dict));
    }
  }
  return base::Value();
}

void Fail(Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

void Reply(Done done, sync::Outcome outcome) {
  if (!outcome.ok) return Fail(std::move(done), outcome.code, outcome.message);
  base::Value value = ToValue(outcome.value);
  sync::WipeJson(outcome.value);
  std::move(done).Run(true, std::move(value));
}

sync::Outcome RunOnCore(std::string method, std::vector<sync::JsonValue> args) {
  sync::Outcome outcome = Core().Dispatch(method, args, sync::NowSeconds());
  for (auto& arg : args) sync::WipeJson(arg);
  return outcome;
}

void Post(std::string method, std::vector<sync::JsonValue> args, base::OnceCallback<void(sync::Outcome)> reply) {
  Runner()->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce(&RunOnCore, std::move(method), std::move(args)),
                                       std::move(reply));
}

void Authorize(base::WeakPtr<Profile> profile, Granted then) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (Ui().disclosure.Fresh(NowMs())) return std::move(then).Run(true);
  if (!profile || profile->IsOffTheRecord()) return std::move(then).Run(false);
  ardia::Reauth(profile.get(), device_reauth::DeviceAuthSource::kPasswordManager, kDisclosurePurpose,
                base::TimeDelta(), base::BindOnce(
                    [](Granted then, bool granted) {
                      if (granted) Ui().disclosure.Grant(NowMs());
                      std::move(then).Run(granted);
                    },
                    std::move(then)));
}

std::string JoinedWords(const sync::JsonValue& words) {
  std::string joined;
  for (const auto& word : words.items) {
    if (!joined.empty()) joined.push_back(' ');
    joined.append(word.text);
  }
  return joined;
}

void Deliver(std::string method, Done done, sync::Outcome words) {
  if (!words.ok) return Fail(std::move(done), words.code, words.message);
  if (method == "ArdiaSync.recoveryWords") return Reply(std::move(done), std::move(words));
  std::string joined = JoinedWords(words.value);
  sync::WipeJson(words.value);
  if (method == "ArdiaSync.copyRecoveryPhrase") {
    sync::ClipboardWrite write = sync::PhraseClipboard(std::move(joined));
    std::u16string text = base::UTF8ToUTF16(write.text);
    {
      ui::ScopedClipboardWriter writer(ui::ClipboardBuffer::kCopyPaste);
      writer.WriteText(text);
      for (const auto& [format, value] : write.raw) {
        writer.WriteRawDataForTest(ui::ClipboardFormatType::CustomPlatformType(format),
                                   std::vector<uint8_t>(value.begin(), value.end()));
      }
      if (write.confidential) writer.MarkAsConfidential();
    }
    sync::Wipe(text.data(), text.size() * sizeof(char16_t));
    sync::Wipe(write.text);
    return std::move(done).Run(true, base::Value(true));
  }
  auto bitmap = qr_code_generator::GenerateBitmap(base::as_byte_span(joined), qr_code_generator::ModuleStyle::kSquares,
                                                  qr_code_generator::LocatorStyle::kSquare,
                                                  qr_code_generator::CenterImage::kNoCenterImage,
                                                  qr_code_generator::QuietZone::kIncluded);
  sync::Wipe(joined);
  if (!bitmap.has_value()) return std::move(done).Run(true, base::Value());
  auto png = gfx::PNGCodec::EncodeBGRASkBitmap(*bitmap, false);
  if (!png) return std::move(done).Run(true, base::Value());
  std::move(done).Run(true, base::Value("data:image/png;base64," + base::Base64Encode(*png)));
}

void WhenUnlocked(base::OnceCallback<void()> then, Done done) {
  Post("ArdiaSync.recoveryWords", {}, base::BindOnce(
      [](base::OnceCallback<void()> then, Done done, sync::Outcome words) {
        sync::WipeJson(words.value);
        if (!words.ok) return Fail(std::move(done), "locked", kLockedMessage);
        std::move(then).Run();
      },
      std::move(then), std::move(done)));
}

void Disclose(std::string method, base::WeakPtr<Profile> profile, Done done) {
  auto split = base::SplitOnceCallback(std::move(done));
  WhenUnlocked(base::BindOnce(
                   [](std::string method, base::WeakPtr<Profile> profile, Done done) {
                     Authorize(profile, base::BindOnce(
                                            [](std::string method, Done done, bool granted) {
                                              if (!granted) return std::move(done).Run(true, base::Value());
                                              Post("ArdiaSync.recoveryWords", {},
                                                   base::BindOnce(&Deliver, std::move(method), std::move(done)));
                                            },
                                            std::move(method), std::move(done)));
                   },
                   std::move(method), profile, std::move(split.first)),
               std::move(split.second));
}

gfx::NativeWindow WindowOf(const base::WeakPtr<LinuxShellWebView>& shell) {
  views::Widget* widget = shell ? shell->GetWidget() : nullptr;
  return widget ? widget->GetNativeWindow() : gfx::NativeWindow();
}

class SyncPicker : public ui::SelectFileDialog::Listener {
 public:
  using Picked = base::OnceCallback<void(std::optional<base::FilePath>)>;

  static void Show(base::WeakPtr<LinuxShellWebView> shell, ui::SelectFileDialog::Type type, std::u16string title,
                   base::FilePath start, Picked picked) {
    auto* picker = new SyncPicker(std::move(picked));
    content::WebContents* contents = shell ? shell->GetWebContents() : nullptr;
    picker->dialog_ = ui::SelectFileDialog::Create(picker, std::make_unique<ChromeSelectFilePolicy>(contents));
    ui::SelectFileDialog::FileTypeInfo types;
    const bool saving = type == ui::SelectFileDialog::SELECT_SAVEAS_FILE;
    if (saving) {
      types.extensions = {{FILE_PATH_LITERAL("txt")}};
      types.include_all_files = true;
    }
    picker->dialog_->SelectFile(type, title, start, saving ? &types : nullptr, saving ? 1 : 0,
                                saving ? FILE_PATH_LITERAL("txt") : base::FilePath::StringType(), WindowOf(shell));
  }

  SyncPicker(const SyncPicker&) = delete;
  SyncPicker& operator=(const SyncPicker&) = delete;
  ~SyncPicker() override {
    if (dialog_) dialog_->ListenerDestroyed();
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override { Finish(file.path()); }
  void FileSelectionCanceled() override { Finish(std::nullopt); }

 private:
  explicit SyncPicker(Picked picked) : picked_(std::move(picked)) {}

  void Finish(std::optional<base::FilePath> path) {
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
    if (picked_) std::move(picked_).Run(std::move(path));
  }

  Picked picked_;
  scoped_refptr<ui::SelectFileDialog> dialog_;
};

void ChooseFolder(base::WeakPtr<LinuxShellWebView> shell, const std::vector<sync::JsonValue>& args, Done done) {
  base::FilePath start;
  if (!args.empty() && args[0].is_string() && sync::ValidFolderPath(args[0].text)) start = base::FilePath(args[0].text);
  SyncPicker::Show(shell, ui::SelectFileDialog::SELECT_FOLDER, u"Choose a Sync Folder", start, base::BindOnce(
      [](Done done, std::optional<base::FilePath> path) {
        if (!path || !sync::ValidFolderPath(path->value()) || !base::IsStringUTF8(path->value()))
          return std::move(done).Run(true, base::Value());
        std::move(done).Run(true, base::Value(path->value()));
      },
      std::move(done)));
}

void SaveKit(base::WeakPtr<LinuxShellWebView> shell, base::WeakPtr<Profile> profile,
             const std::vector<sync::JsonValue>& args, Done done) {
  if (args.empty() || !args[0].is_string() || args[0].text != "text")
    return Fail(std::move(done), "ERR_SYNC_UNSUPPORTED", "On Linux the Recovery Kit is saved as a text file");
  auto split = base::SplitOnceCallback(std::move(done));
  WhenUnlocked(base::BindOnce(
                   [](base::WeakPtr<LinuxShellWebView> shell, base::WeakPtr<Profile> profile, Done done) {
                     SyncPicker::Show(shell, ui::SelectFileDialog::SELECT_SAVEAS_FILE, u"Save Recovery Kit",
                                      base::GetHomeDir().Append(sync::kKitTextName), base::BindOnce(
                         [](base::WeakPtr<Profile> profile, Done done, std::optional<base::FilePath> path) {
                           if (!path) return std::move(done).Run(true, base::Value());
                           Authorize(profile, base::BindOnce(
                               [](base::FilePath path, Done done, bool granted) {
                                 if (!granted) return std::move(done).Run(true, base::Value());
                                 const std::string created =
                                     base::UTF16ToUTF8(base::TimeFormatFriendlyDate(base::Time::Now()));
                                 Runner()->PostTaskAndReplyWithResult(
                                     FROM_HERE, base::BindOnce([](std::string path, std::string created) {
                                       return Core().SaveKit(path, created);
                                     }, path.value(), created),
                                     base::BindOnce(&Reply, std::move(done)));
                               },
                               std::move(*path), std::move(done)));
                         },
                         profile, std::move(done)));
                   },
                   shell, profile, std::move(split.first)),
               std::move(split.second));
}

void ReadPasswords(const std::vector<sync::JsonValue>& args, Done done) {
  auto profile = sync::ReadPasswordsProfile(args);
  if (!profile) return Fail(std::move(done), "ERR_SYNC_ARGUMENT", "A profile is required");
  LinuxCredentialsReadLogins(*profile, base::BindOnce(
      [](Done done, sync::LoginRead read) {
        Runner()->PostTaskAndReplyWithResult(
            FROM_HERE, base::BindOnce([](sync::LoginRead read) { return Core().SealLogins(std::move(read)); },
                                      std::move(read)),
            base::BindOnce(&Reply, std::move(done)));
      },
      std::move(done)));
}

void SavePassword(const std::vector<sync::JsonValue>& args, Done done) {
  auto parsed = sync::ParsePasswordSave(args);
  if (!parsed) return Fail(std::move(done), "ERR_SYNC_ARGUMENT", "A profile, login, sealed password and flag are required");
  if (!parsed->holdable) return std::move(done).Run(true, base::Value(kSkippedLogin));
  const std::string profile = parsed->profile;
  Runner()->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce([](sync::PasswordSave save) { return Core().OpenLogin(save); }, std::move(*parsed)),
      base::BindOnce(
          [](std::string profile, Done done, std::optional<sync::StoredLogin> login) {
            if (!login) return std::move(done).Run(true, base::Value(false));
            LinuxCredentialsSaveLogin(profile, std::move(*login), base::BindOnce(
                [](Done done, LinuxSyncedSave saved) {
                  if (saved == LinuxSyncedSave::kSkipped) return std::move(done).Run(true, base::Value(kSkippedLogin));
                  std::move(done).Run(true, base::Value(saved == LinuxSyncedSave::kSaved));
                },
                std::move(done)));
          },
          profile, std::move(done)));
}

void SyncStatus(base::WeakPtr<Profile> profile, Done done) {
  Post("ArdiaSync.status", {}, base::BindOnce(
      [](base::WeakPtr<Profile> profile, Done done, sync::Outcome outcome) {
        if (sync::JsonValue* passwords = outcome.ok ? outcome.value.Find("passwords") : nullptr)
          passwords->flag = profile && LinuxCredentialsPasswordsUsable(profile.get());
        Reply(std::move(done), std::move(outcome));
      },
      profile, std::move(done)));
}

void SyncPasswords(const std::string& method, const std::vector<sync::JsonValue>& args, Done done) {
  if (method == "ArdiaSync.readPasswords") return ReadPasswords(args, std::move(done));
  SavePassword(args, std::move(done));
}

bool RevokesDisclosure(std::string_view method) {
  return method == "ArdiaSync.forget" || method == "ArdiaSync.createPhrase" || method == "ArdiaSync.enterPhrase";
}

}

bool LinuxSyncInvokes(std::string_view method) {
  return sync::RouteOf(method).has_value();
}

void AppendLinuxSyncCapabilities(base::ListValue& capabilities) {
  for (const auto& method : sync::kMethods) capabilities.Append(method.name);
}

void LinuxSyncInvoke(const LinuxSyncCaller& caller, Profile* app_profile, LinuxShellWebView* shell,
                     const std::string& method, const base::ListValue& values, Done done) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  const auto route = sync::RouteOf(method);
  if (!route) return Fail(std::move(done), "ERR_UNKNOWN_CALL", "Unknown sync operation");
  if (caller.private_window || !app_profile || app_profile->IsOffTheRecord())
    return Fail(std::move(done), "ERR_PRIVATE_SERVICE", "Sync isn't available in private windows");
  if (values.size() > kMaxArgs) return Fail(std::move(done), "ERR_SYNC_ARGUMENT", "Too many sync arguments");
  std::vector<sync::JsonValue> args;
  for (const base::Value& value : values) {
    auto converted = FromValue(value, 0);
    if (!converted) return Fail(std::move(done), "ERR_SYNC_ARGUMENT", "Unsupported sync argument");
    args.push_back(std::move(*converted));
  }
  const auto weak_shell = shell ? shell->GetLinuxWeakPtr() : base::WeakPtr<LinuxShellWebView>();
  const auto weak_profile = app_profile->GetWeakPtr();
  switch (*route) {
    case sync::Route::kClaim: {
      const bool granted = !caller.utility && Ui().lease.Claim(caller.key, NowMs());
      return std::move(done).Run(true, base::Value(base::DictValue()
          .Set("granted", granted).Set("leaseMs", static_cast<double>(sync::kAuthorityLeaseMs))));
    }
    case sync::Route::kRelease:
      Ui().lease.Release(caller.key);
      return std::move(done).Run(true, base::Value());
    case sync::Route::kLeased:
      if (!Ui().lease.Holds(caller.key, NowMs()))
        return Fail(std::move(done), "ERR_SYNC_NOT_AUTHORITY", "Another Ardia window is running sync");
      if (RevokesDisclosure(method)) Ui().disclosure.Revoke();
      return Post(method, std::move(args), base::BindOnce(
          [](bool revoke, Done done, sync::Outcome outcome) {
            if (revoke) Ui().disclosure.Revoke();
            Reply(std::move(done), std::move(outcome));
          },
          RevokesDisclosure(method), std::move(done)));
    case sync::Route::kPasswords:
      if (!Ui().lease.Holds(caller.key, NowMs()))
        return Fail(std::move(done), "ERR_SYNC_NOT_AUTHORITY", "Another Ardia window is running sync");
      SyncPasswords(method, args, std::move(done));
      for (auto& arg : args) sync::WipeJson(arg);
      return;
    case sync::Route::kCore:
      if (method == "ArdiaSync.status") return SyncStatus(weak_profile, std::move(done));
      return Post(method, std::move(args), base::BindOnce(&Reply, std::move(done)));
    case sync::Route::kDisclose:
      return Disclose(method, weak_profile, std::move(done));
    case sync::Route::kChooseFolder:
      return ChooseFolder(weak_shell, args, std::move(done));
    case sync::Route::kSaveKit:
      return SaveKit(weak_shell, weak_profile, args, std::move(done));
    case sync::Route::kReveal:
      if (args.empty() || !args[0].is_string() || !sync::ValidFolderPath(args[0].text))
        return Fail(std::move(done), "ERR_SYNC_ARGUMENT", "The sync folder must be an absolute path");
      platform_util::OpenItem(app_profile, base::FilePath(args[0].text), platform_util::OPEN_FOLDER, base::DoNothing());
      return std::move(done).Run(true, base::Value());
    case sync::Route::kNothing:
      return std::move(done).Run(true, base::Value());
  }
}

}
