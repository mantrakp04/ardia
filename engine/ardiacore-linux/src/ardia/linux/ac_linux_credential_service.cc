#include "ardia/linux/ac_linux_credential_service.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_credentials.h"
#include "ardia/linux/ac_linux_files.h"
#include "ardia/linux/ac_linux_profile_service.h"
#include "ardia/linux/ac_linux_profiles.h"
#include "ardia/linux/ac_linux_sync.h"
#include "base/feature_list.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/strings/utf_string_conversions.h"
#include "base/json/json_reader.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ardia/ac_reauth_linux.h"
#include "chrome/browser/ardia/ac_sensitive_args.h"
#include "chrome/browser/ardia/public/ac_engine.h"
#include "chrome/browser/autofill/personal_data_manager_factory.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/download/download_prefs.h"
#include "chrome/browser/password_manager/factories/profile_password_store_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "components/autofill/core/common/autofill_prefs.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/os_crypt/async/browser/os_crypt_async.h"
#include "components/os_crypt/async/common/encryptor.h"
#include "components/password_manager/core/browser/features/password_features.h"
#include "components/password_manager/core/browser/password_manager_switches.h"
#include "components/password_manager/core/browser/password_store/actionable_error.h"
#include "components/password_manager/core/browser/password_store/password_store_consumer.h"
#include "components/password_manager/core/browser/password_store/password_store_interface.h"
#include "components/password_manager/core/browser/password_store/stored_credential.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_thread.h"
#include "crypto/process_bound_string.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "ui/views/widget/widget.h"

namespace ardia {
namespace {

namespace credentials = linux_credentials;
using Done = base::OnceCallback<void(bool, base::Value)>;

static_assert(std::string_view(password_manager::prefs::kCredentialsEnableService) ==
              credentials::kPasswordsEnabledPref);
static_assert(std::string_view(autofill::prefs::kAutofillProfileEnabled) == credentials::kAddressesEnabledPref);
static_assert(std::string_view(autofill::prefs::kAutofillCreditCardEnabled) == credentials::kCardsEnabledPref);

constexpr int kArgDepth = 2;
constexpr base::TimeDelta kEncryptorTimeout = base::Seconds(10);
constexpr base::TimeDelta kLoginReadTimeout = base::Seconds(30);
constexpr base::TaskTraits kFileTasks = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                         base::TaskShutdownBehavior::BLOCK_SHUTDOWN};

void Fail(Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

credentials::Arg ToArg(const base::Value& value, int depth);

credentials::Arg ObjectArg(const base::DictValue& dict, int depth) {
  std::vector<std::pair<std::string, credentials::Arg>> members;
  for (const auto [key, value] : dict) {
    members.emplace_back(key, ToArg(value, depth));
  }
  return credentials::Arg::Object(std::move(members));
}

credentials::Arg ToArg(const base::Value& value, int depth) {
  switch (value.type()) {
    case base::Value::Type::NONE:
      return credentials::Arg::Null();
    case base::Value::Type::BOOLEAN:
      return credentials::Arg::Bool(value.GetBool());
    case base::Value::Type::INTEGER:
      return credentials::Arg::Number(value.GetInt());
    case base::Value::Type::DOUBLE:
      return credentials::Arg::Number(value.GetDouble());
    case base::Value::Type::STRING:
      return credentials::Arg::String(value.GetString());
    case base::Value::Type::DICT:
      return depth > 0 ? ObjectArg(value.GetDict(), depth - 1) : credentials::Arg::Other();
    case base::Value::Type::BINARY:
    case base::Value::Type::LIST:
      return credentials::Arg::Other();
  }
  return credentials::Arg::Other();
}

using Resolved = base::OnceCallback<void(Profile*, std::string_view code, std::string_view message)>;

void ResolveCredentialProfile(std::string_view engine_profile, bool private_window, Resolved done) {
  namespace profiles = ardiacore::linux_profiles;
  if (private_window) {
    return std::move(done).Run(nullptr, "ERR_PROFILE_PRIVATE", credentials::kPrivateCredentialsMessage);
  }
  const std::optional<profiles::ProfileName> name = profiles::ParseProfileName(engine_profile);
  if (!name) {
    return std::move(done).Run(nullptr, profiles::ProfileErrorCode(profiles::ProfileError::kInvalid),
                               profiles::ProfileErrorMessage(profiles::ProfileError::kInvalid));
  }
  if (name->kind == profiles::ProfileKind::kPrivate) {
    return std::move(done).Run(nullptr, "ERR_PROFILE_PRIVATE", credentials::kPrivateCredentialsMessage);
  }
  ardiacore::ResolveLinuxProfile(engine_profile, base::BindOnce(
      [](Resolved done, Profile* profile, profiles::ProfileError error) {
        if (profile && profile->IsOffTheRecord()) {
          return std::move(done).Run(nullptr, "ERR_PROFILE_PRIVATE", credentials::kPrivateCredentialsMessage);
        }
        if (!profile) {
          return std::move(done).Run(nullptr, profiles::ProfileErrorCode(error), profiles::ProfileErrorMessage(error));
        }
        std::move(done).Run(profile, std::string_view(), std::string_view());
      },
      std::move(done)));
}

credentials::StoreError StoreErrorOf(password_manager::ActionableError error) {
  switch (error) {
    case password_manager::ActionableError::kNoError:
      return credentials::StoreError::kNone;
    case password_manager::ActionableError::kInactionableTemporaryError:
      return credentials::StoreError::kTemporary;
    case password_manager::ActionableError::kKeychainError:
      return credentials::StoreError::kKeychain;
    case password_manager::ActionableError::kInactionable:
      return credentials::StoreError::kInactionable;
    case password_manager::ActionableError::kSignInNeeded:
    case password_manager::ActionableError::kTrustedVaultKeyNeeded:
    case password_manager::ActionableError::kNeedsPassphrase:
      return credentials::StoreError::kOther;
  }
  return credentials::StoreError::kOther;
}

struct Probes {
  credentials::Probe passwords;
  credentials::Probe autofill;
};

credentials::Protection ProtectionOf(const os_crypt_async::Encryptor& encryptor) {
  if (!encryptor.IsEncryptionAvailable()) {
    return credentials::Protection::kNone;
  }
  std::optional<std::vector<uint8_t>> ciphertext = encryptor.EncryptString(credentials::kProtectionProbeText);
  if (!ciphertext) {
    return credentials::Protection::kNone;
  }
  return credentials::ProtectionFromCiphertext(
      std::string_view(reinterpret_cast<const char*>(ciphertext->data()), ciphertext->size()));
}

class EncryptionProbe {
 public:
  using Ready = base::OnceCallback<void(bool encryption, bool decryption, credentials::Protection protection)>;

  static void Run(Ready ready) {
    os_crypt_async::OSCryptAsync* os_crypt = g_browser_process ? g_browser_process->os_crypt_async() : nullptr;
    if (!os_crypt) {
      return std::move(ready).Run(false, false, credentials::Protection::kNone);
    }
    auto* probe = new EncryptionProbe(std::move(ready));
    probe->timeout_.Start(FROM_HERE, kEncryptorTimeout,
                          base::BindOnce(&EncryptionProbe::Finish, probe->weak_factory_.GetWeakPtr(), false, false,
                                         credentials::Protection::kUnknown));
    os_crypt->GetInstance(base::BindOnce(&EncryptionProbe::Arrived, probe->weak_factory_.GetWeakPtr()));
  }

 private:
  explicit EncryptionProbe(Ready ready) : ready_(std::move(ready)) {}

  void Arrived(scoped_refptr<os_crypt_async::Encryptor> encryptor) {
    if (!encryptor) {
      return Finish(false, false, credentials::Protection::kNone);
    }
    Finish(encryptor->IsEncryptionAvailable(), encryptor->IsDecryptionAvailable(), ProtectionOf(*encryptor));
  }

  void Finish(bool encryption, bool decryption, credentials::Protection protection) {
    weak_factory_.InvalidateWeakPtrs();
    timeout_.Stop();
    Ready ready = std::move(ready_);
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
    std::move(ready).Run(encryption, decryption, protection);
  }

  Ready ready_;
  base::OneShotTimer timeout_;
  base::WeakPtrFactory<EncryptionProbe> weak_factory_{this};
};

void AwaitPasswordStore(scoped_refptr<password_manager::PasswordStoreInterface> store,
                        base::TimeTicks started,
                        base::OnceCallback<void(credentials::StoreError)> settled) {
  const credentials::StoreError error = StoreErrorOf(store->GetError());
  if (!credentials::AwaitsStore(error, (base::TimeTicks::Now() - started).InMilliseconds())) {
    return std::move(settled).Run(error);
  }
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, base::BindOnce(&AwaitPasswordStore, std::move(store), started, std::move(settled)),
      base::Milliseconds(credentials::kStoreReadyPollMs));
}

void ProbeEncryption(bool encryption, base::OnceCallback<void(Probes)> then, Probes probes) {
  if (!encryption) {
    return std::move(then).Run(probes);
  }
  EncryptionProbe::Run(base::BindOnce(
      [](Probes probes, base::OnceCallback<void(Probes)> then, bool encryption, bool decryption,
         credentials::Protection protection) {
        for (credentials::Probe* probe : {&probes.passwords, &probes.autofill}) {
          probe->encryption = encryption;
          probe->decryption = decryption;
          probe->protection = protection;
        }
        std::move(then).Run(probes);
      },
      probes, std::move(then)));
}

void WithProbes(Profile* profile, bool passwords, bool encryption, base::OnceCallback<void(Probes)> then) {
  Probes probes;
  scoped_refptr<password_manager::PasswordStoreInterface> store =
      ProfilePasswordStoreFactory::GetForProfile(profile, ServiceAccessType::EXPLICIT_ACCESS);
  probes.passwords.service = !!store;
  probes.autofill.service = !!autofill::PersonalDataManagerFactory::GetForBrowserContext(profile);
  auto next = base::BindOnce(&ProbeEncryption, encryption, std::move(then));
  if (!store || !passwords) {
    return std::move(next).Run(probes);
  }
  AwaitPasswordStore(std::move(store), base::TimeTicks::Now(),
                     base::BindOnce(
                         [](Probes probes, base::OnceCallback<void(Probes)> next, credentials::StoreError error) {
                           probes.passwords.error = error;
                           std::move(next).Run(probes);
                         },
                         probes, std::move(next)));
}

base::DictValue StatusEntry(const credentials::Availability& availability) {
  base::DictValue entry = base::DictValue().Set("available", availability.available);
  if (!availability.available) {
    entry.Set("reason", availability.reason);
    entry.Set("code", availability.code);
    entry.Set("message", availability.message);
  }
  return entry;
}

base::Value Status(const Probes& probes, bool autofill, bool reauth, const std::string& reason) {
  std::string backend =
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(password_manager::kPasswordStore);
  if (backend.empty()) {
    backend = "auto";
  }
  const credentials::Storage storage = credentials::DescribeStorage(backend, probes.passwords.protection);
  base::DictValue status = base::DictValue()
                               .Set("reauth", reauth)
                               .Set("reauthReason", reason)
                               .Set("backend", backend)
                               .Set("protection", storage.protection)
                               .Set("protectionFallback", storage.fallback)
                               .Set("storage", storage.label);
  if (!reauth) {
    status.Set("reauthMessage", credentials::ReauthMessage(reason));
  }
  if (autofill) {
    status.Set("addresses", StatusEntry(credentials::Assess(credentials::Store::kAddresses, probes.autofill)));
    status.Set("cards", StatusEntry(credentials::Assess(credentials::Store::kCards, probes.autofill)));
  } else {
    status.Set("passwords", StatusEntry(credentials::Assess(credentials::Store::kPasswords, probes.passwords)));
  }
  return base::Value(std::move(status));
}

struct PendingCall {
  credentials::Reply reply;
  Done done;
  std::string export_path;
  bool existed_before = false;
};

void ExportFinished(Done done, std::string status, std::string path) {
  base::DictValue result = base::DictValue().Set("status", status);
  if (status == "succeeded") {
    result.Set("path", path);
  }
  std::move(done).Run(true, base::Value(std::move(result)));
}

void CleanUpExport(std::string path, std::string status, bool existed_before) {
  credentials::RemoveFailedExport(path, status, existed_before);
}

void Replied(void* context, const char* json) {
  std::unique_ptr<PendingCall> pending(static_cast<PendingCall*>(context));
  std::optional<base::Value> parsed = json ? base::JSONReader::Read(json, base::JSON_PARSE_RFC) : std::nullopt;
  if (!parsed || !parsed->is_dict()) {
    if (parsed) {
      Cleanse(*parsed);
    }
    return Fail(std::move(pending->done), "ERR_BAD_REPLY", "The engine reply is not JSON");
  }
  const base::DictValue& reply = parsed->GetDict();
  if (const base::Value* error = reply.Find("error")) {
    const credentials::Failure failure =
        credentials::ClassifyEngineError(error->is_string() ? std::string_view(error->GetString()) : std::string_view());
    Cleanse(*parsed);
    return Fail(std::move(pending->done), failure.code, failure.message);
  }
  base::Value result;
  switch (pending->reply) {
    case credentials::Reply::kAsIs:
      result = parsed->Clone();
      break;
    case credentials::Reply::kOk:
      result = base::Value(base::DictValue().Set("ok", true));
      break;
    case credentials::Reply::kUnlocked:
      result = base::Value(base::DictValue().Set("unlocked", reply.FindBool("unlocked").value_or(false)));
      break;
    case credentials::Reply::kPassword: {
      const std::string* password = reply.FindString("password");
      result = base::Value(base::DictValue().Set("password", password ? base::Value(*password) : base::Value()));
      break;
    }
    case credentials::Reply::kCardNumber: {
      const std::string* number = reply.FindString("number");
      result = base::Value(base::DictValue()
                               .Set("number", number ? base::Value(*number) : base::Value())
                               .Set("authenticated", reply.FindBool("authenticated").value_or(false)));
      break;
    }
    case credentials::Reply::kExport: {
      const std::string* found = reply.FindString("status");
      std::string status = found ? *found : std::string("writeFailed");
      Cleanse(*parsed);
      if (status == "succeeded" || pending->export_path.empty()) {
        return ExportFinished(std::move(pending->done), std::move(status), std::move(pending->export_path));
      }
      base::ThreadPool::PostTaskAndReply(
          FROM_HERE, kFileTasks,
          base::BindOnce(&CleanUpExport, pending->export_path, status, pending->existed_before),
          base::BindOnce(&ExportFinished, std::move(pending->done), status, std::string()));
      return;
    }
    case credentials::Reply::kNull:
    case credentials::Reply::kPreferences:
    case credentials::Reply::kPreference:
    case credentials::Reply::kStatus:
      Cleanse(*parsed);
      return Fail(std::move(pending->done), "ERR_BAD_REPLY", "Unexpected engine reply");
  }
  Cleanse(*parsed);
  std::move(pending->done).Run(true, std::move(result));
}

void CallEngine(const base::FilePath& profile_dir,
                credentials::Plan plan,
                Done done,
                std::string export_path = std::string(),
                bool existed_before = false) {
  auto pending = std::make_unique<PendingCall>(
      PendingCall{plan.reply, std::move(done), std::move(export_path), existed_before});
  const std::string dir = profile_dir.value();
  ac_engine_call(plan.service.c_str(), dir.c_str(), plan.args.c_str(), &Replied, pending.release());
  plan.args.Clear();
}

void ExportTo(base::FilePath profile_dir, credentials::Plan plan, std::string path, Done done, bool existed_before) {
  CallEngine(profile_dir, std::move(plan), std::move(done), std::move(path), existed_before);
}

class ExportPicker : public ui::SelectFileDialog::Listener {
 public:
  static void Show(base::FilePath profile_dir,
                   base::FilePath default_dir,
                   LinuxShellWebView* shell,
                   Done done) {
    auto* picker = new ExportPicker(std::move(profile_dir), std::move(done));
    content::WebContents* contents = shell ? shell->GetWebContents() : nullptr;
    picker->dialog_ =
        ui::SelectFileDialog::Create(picker, std::make_unique<ChromeSelectFilePolicy>(contents));
    ui::SelectFileDialog::FileTypeInfo types;
    types.extensions = {{FILE_PATH_LITERAL("csv")}};
    types.include_all_files = true;
    views::Widget* widget = shell ? shell->GetWidget() : nullptr;
    picker->dialog_->SelectFile(ui::SelectFileDialog::SELECT_SAVEAS_FILE, u"Export Passwords",
                                default_dir.Append(FILE_PATH_LITERAL("Ardia Passwords.csv")), &types, 1,
                                FILE_PATH_LITERAL("csv"),
                                widget ? widget->GetNativeWindow() : gfx::NativeWindow());
  }

  ExportPicker(const ExportPicker&) = delete;
  ExportPicker& operator=(const ExportPicker&) = delete;
  ~ExportPicker() override {
    if (dialog_) {
      dialog_->ListenerDestroyed();
    }
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override {
    DeleteLater();
    const base::FilePath path = file.path();
    credentials::Plan plan = credentials::PlanExport(path.value());
    if (!plan.ok()) {
      return Fail(std::move(done_), plan.code, plan.message);
    }
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, kFileTasks, base::BindOnce(&base::PathExists, path),
        base::BindOnce(&ExportTo, profile_dir_, std::move(plan), path.value(), std::move(done_)));
  }

  void FileSelectionCanceled() override {
    DeleteLater();
    ExportFinished(std::move(done_), "cancelled", std::string());
  }

 private:
  ExportPicker(base::FilePath profile_dir, Done done)
      : profile_dir_(std::move(profile_dir)), done_(std::move(done)) {}

  void DeleteLater() { base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this); }

  base::FilePath profile_dir_;
  Done done_;
  scoped_refptr<ui::SelectFileDialog> dialog_;
};

void ShowExport(base::FilePath profile_dir,
                base::FilePath export_dir,
                base::WeakPtr<LinuxShellWebView> shell,
                Done done,
                bool available,
                std::string reason) {
  if (!available) {
    return Fail(std::move(done), "ERR_REAUTH_UNAVAILABLE", credentials::ReauthMessage(reason));
  }
  if (!shell) {
    return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed before the export started");
  }
  ExportPicker::Show(std::move(profile_dir), std::move(export_dir), shell.get(), std::move(done));
}

void RunPreferences(Profile* profile, const credentials::Plan& plan, Done done) {
  PrefService* prefs = profile->GetPrefs();
  auto boolean = [prefs](const std::string& name) -> const PrefService::Preference* {
    const PrefService::Preference* pref = prefs->FindPreference(name);
    return pref && pref->GetValue() && pref->GetValue()->is_bool() ? pref : nullptr;
  };
  for (const auto& [name, value] : plan.writes) {
    const PrefService::Preference* pref = boolean(name);
    if (!pref) {
      return Fail(std::move(done), "ERR_PREFERENCE", "The setting is unavailable");
    }
    if (!pref->IsUserModifiable()) {
      return Fail(std::move(done), "ERR_PREFERENCE_MANAGED", "The setting is managed by policy");
    }
  }
  for (const auto& [name, value] : plan.writes) {
    prefs->SetBoolean(name, value);
  }
  if (plan.reads.empty()) {
    return std::move(done).Run(true, base::Value());
  }
  base::DictValue values;
  for (const auto& [key, name] : plan.reads) {
    const PrefService::Preference* pref = boolean(name);
    if (!pref) {
      return Fail(std::move(done), "ERR_PREFERENCE", "The setting is unavailable");
    }
    values.Set(key, pref->GetValue()->GetBool());
  }
  if (plan.reply == credentials::Reply::kPreference) {
    return std::move(done).Run(true, base::Value(values.FindBool(plan.reads.front().first).value_or(false)));
  }
  std::move(done).Run(true, base::Value(std::move(values)));
}

void Proceed(base::FilePath profile_dir,
             base::FilePath export_dir,
             base::WeakPtr<LinuxShellWebView> shell,
             credentials::Plan plan,
             bool autofill_status,
             Done done,
             Probes probes) {
  if (plan.reply == credentials::Reply::kStatus) {
    return ProbeReauth(base::BindOnce(
        [](Probes probes, bool autofill, Done done, bool available, std::string reason) {
          std::move(done).Run(true, Status(probes, autofill, available, reason));
        },
        probes, autofill_status, std::move(done)));
  }
  for (credentials::Store store : plan.requires_stores) {
    const credentials::Availability availability = credentials::Assess(
        store, store == credentials::Store::kPasswords ? probes.passwords : probes.autofill);
    if (!availability.available) {
      return Fail(std::move(done), availability.code, availability.message);
    }
  }
  if (plan.asks_for_path) {
    if (!shell) {
      return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed before the export started");
    }
    return ProbeReauth(base::BindOnce(&ShowExport, std::move(profile_dir), std::move(export_dir), shell,
                                      std::move(done)));
  }
  CallEngine(profile_dir, std::move(plan), std::move(done));
}

void RunFor(base::WeakPtr<LinuxShellWebView> shell,
            credentials::Plan plan,
            bool autofill_status,
            Done done,
            Profile* profile,
            std::string_view code,
            std::string_view message) {
  if (!profile) {
    return Fail(std::move(done), code.empty() ? std::string_view("ERR_PROFILE_UNAVAILABLE") : code, message);
  }
  const bool probing = plan.reply == credentials::Reply::kStatus || !plan.requires_stores.empty();
  if (plan.service.empty() && !probing) {
    return RunPreferences(profile, plan, std::move(done));
  }
  bool encryption = plan.reply == credentials::Reply::kStatus;
  bool passwords = plan.reply == credentials::Reply::kStatus && !autofill_status;
  for (credentials::Store store : plan.requires_stores) {
    encryption = encryption || store != credentials::Store::kAddresses;
    passwords = passwords || store == credentials::Store::kPasswords;
  }
  base::FilePath export_dir;
  if (plan.asks_for_path) {
    export_dir = DownloadPrefs::FromBrowserContext(profile)->DownloadPath();
  }
  WithProbes(profile, passwords, encryption,
             base::BindOnce(&Proceed, profile->GetPath(), std::move(export_dir), std::move(shell), std::move(plan),
                            autofill_status, std::move(done)));
}

void Run(std::string_view engine_profile,
         bool private_window,
         LinuxShellWebView* shell,
         credentials::Plan plan,
         bool autofill_status,
         Done done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!plan.ok()) {
    return Fail(std::move(done), plan.code, plan.message);
  }
  ResolveCredentialProfile(
      engine_profile, private_window,
      base::BindOnce(&RunFor, shell ? shell->GetLinuxWeakPtr() : base::WeakPtr<LinuxShellWebView>(), std::move(plan),
                     autofill_status, std::move(done)));
}

class SyncLoginReader : public password_manager::PasswordStoreConsumer {
 public:
  using Read = base::OnceCallback<void(linux_sync::LoginRead)>;

  static void Start(scoped_refptr<password_manager::PasswordStoreInterface> store, Read read) {
    auto* reader = new SyncLoginReader(std::move(read));
    reader->timeout_.Start(FROM_HERE, kLoginReadTimeout,
                           base::BindOnce(&SyncLoginReader::Finish, reader->weak_factory_.GetWeakPtr(),
                                          linux_sync::LoginRead()));
    store->GetAutofillableLogins(reader->weak_factory_.GetWeakPtr());
  }

  SyncLoginReader(const SyncLoginReader&) = delete;
  SyncLoginReader& operator=(const SyncLoginReader&) = delete;
  ~SyncLoginReader() override = default;

  void OnGetPasswordStoreResultsOrErrorFrom(
      password_manager::PasswordStoreInterface*,
      base::expected<std::vector<password_manager::StoredCredential>, password_manager::PasswordStoreBackendError>
          results) override {
    linux_sync::LoginRead read;
    if (results.has_value()) {
      read.complete = true;
      read.logins.reserve(results->size());
      for (password_manager::StoredCredential& credential : *results) {
        if (!credential.blocked_by_user && !credential.federation_origin.IsValid()) {
          crypto::SecureU16String password = credential.password_value.secure_value();
          std::string utf8 = SecretUTF8(std::u16string_view(password.data(), password.size()));
          read.logins.emplace_back(credential.signon_realm, base::UTF16ToUTF8(credential.username_value),
                                   std::move(utf8),
                                   credential.date_created.is_null()
                                       ? 0
                                       : credential.date_created.InMillisecondsFSinceUnixEpochIgnoringNull());
        }
        credential.password_value.clear();
      }
    }
    Finish(std::move(read));
  }

 private:
  explicit SyncLoginReader(Read read) : read_(std::move(read)) {}

  void Finish(linux_sync::LoginRead read) {
    weak_factory_.InvalidateWeakPtrs();
    timeout_.Stop();
    Read done = std::move(read_);
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
    std::move(done).Run(std::move(read));
  }

  Read read_;
  base::OneShotTimer timeout_;
  base::WeakPtrFactory<SyncLoginReader> weak_factory_{this};
};

void ReadLoginsFor(base::OnceCallback<void(linux_sync::LoginRead)> done, Profile* profile, std::string_view,
                   std::string_view) {
  if (!profile || base::FeatureList::IsEnabled(password_manager::features::kSkipUndecryptablePasswords)) {
    return std::move(done).Run(linux_sync::LoginRead());
  }
  WithProbes(profile, true, true, base::BindOnce(
      [](base::WeakPtr<Profile> profile, base::OnceCallback<void(linux_sync::LoginRead)> done, Probes probes) {
        scoped_refptr<password_manager::PasswordStoreInterface> store =
            profile ? ProfilePasswordStoreFactory::GetForProfile(profile.get(), ServiceAccessType::EXPLICIT_ACCESS)
                    : nullptr;
        if (!store || !credentials::Assess(credentials::Store::kPasswords, probes.passwords).available) {
          return std::move(done).Run(linux_sync::LoginRead());
        }
        SyncLoginReader::Start(std::move(store), std::move(done));
      },
      profile->GetWeakPtr(), std::move(done)));
}

}

bool LinuxCredentialsHandles(std::string_view name) {
  return credentials::HandlesCall(name);
}

void LinuxCredentialsCall(const std::string& engine_profile,
                          bool private_window,
                          const std::string& name,
                          const base::DictValue& input,
                          Done done) {
  Run(engine_profile, private_window, nullptr, credentials::PlanCall(name, ObjectArg(input, kArgDepth)), false,
      std::move(done));
}

bool LinuxCredentialsInvokes(std::string_view method) {
  return credentials::ClaimsInvoke(method);
}

void LinuxCredentialsInvoke(bool private_window,
                            LinuxShellWebView* shell,
                            const std::string& method,
                            const base::ListValue& values,
                            Done done) {
  std::vector<credentials::Arg> args;
  args.reserve(values.size());
  for (const base::Value& value : values) {
    args.push_back(ToArg(value, kArgDepth));
  }
  const std::string engine_profile = !values.empty() && values[0].is_string() ? values[0].GetString() : std::string();
  credentials::Plan plan = credentials::PlanWindowInvoke(private_window, method, args);
  args.clear();
  Run(engine_profile, private_window, shell, std::move(plan), method == "ArdiaAutofill.status", std::move(done));
}

void LinuxCredentialsReadLogins(const std::string& engine_profile,
                                base::OnceCallback<void(linux_sync::LoginRead)> done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  ResolveCredentialProfile(engine_profile, false, base::BindOnce(&ReadLoginsFor, std::move(done)));
}

void LinuxCredentialsSaveLogin(const std::string& engine_profile, linux_sync::StoredLogin login,
                               base::OnceCallback<void(LinuxSyncedSave)> done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  credentials::SyncedLoginPlans plans =
      credentials::PlanSyncedLogin(engine_profile, login.realm, login.username, login.password);
  if (!plans.storable) {
    return std::move(done).Run(LinuxSyncedSave::kSkipped);
  }
  Done saved = base::BindOnce(
      [](base::OnceCallback<void(LinuxSyncedSave)> done, bool ok, base::Value) {
        std::move(done).Run(ok ? LinuxSyncedSave::kSaved : LinuxSyncedSave::kFailed);
      },
      std::move(done));
  Run(engine_profile, false, nullptr, std::move(plans.remove), false, base::BindOnce(
      [](std::string engine_profile, credentials::Plan save, Done saved, bool removed, base::Value) {
        if (!removed) {
          return std::move(saved).Run(false, base::Value());
        }
        Run(engine_profile, false, nullptr, std::move(save), false, std::move(saved));
      },
      engine_profile, std::move(plans.save), std::move(saved)));
}

bool LinuxCredentialsPasswordsUsable(Profile* profile) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  scoped_refptr<password_manager::PasswordStoreInterface> store =
      profile && !profile->IsOffTheRecord()
          ? ProfilePasswordStoreFactory::GetForProfile(profile, ServiceAccessType::EXPLICIT_ACCESS)
          : nullptr;
  return credentials::PasswordsSyncUsable(
      base::FeatureList::IsEnabled(password_manager::features::kSkipUndecryptablePasswords), !!store,
      store ? StoreErrorOf(store->GetError()) : credentials::StoreError::kOther);
}

}
