#include "ardia/linux/ac_linux_import_service.h"

#include <algorithm>
#include <atomic>
#include <iterator>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_import_crypto.h"
#include "ardia/linux/ac_linux_import_formats.h"
#include "ardia/linux/ac_linux_import_keyring.h"
#include "ardia/linux/ac_linux_import_readers.h"
#include "ardia/linux/ac_linux_import_secrets.h"
#include "ardia/linux/ac_linux_profile_service.h"
#include "ardia/linux/ac_linux_profiles.h"
#include "base/callback_list.h"
#include "base/environment.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/memory/ref_counted.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/scoped_observation.h"
#include "base/rand_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/ardia/public/ac_engine.h"
#include "chrome/browser/extensions/api/passwords_private/passwords_private_delegate.h"
#include "chrome/browser/extensions/api/passwords_private/passwords_private_delegate_factory.h"
#include "chrome/browser/lifetime/termination_notification.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "chrome/common/chrome_paths.h"
#include "components/password_manager/core/browser/import/csv_password.h"
#include "components/password_manager/core/browser/import/import_results.h"
#include "components/password_manager/core/browser/import/password_importer.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/password_manager/core/browser/ui/credential_ui_entry.h"
#include "components/password_manager/core/browser/ui/saved_passwords_presenter.h"
#include "content/public/browser/web_contents.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "url/gurl.h"

namespace ardia {
namespace {

namespace li = linux_import;

using Done = base::OnceCallback<void(bool, base::Value)>;
using Emit = base::RepeatingCallback<void(base::Value)>;
using Flag = base::RefCountedData<std::atomic<bool>>;

constexpr size_t kMaxJobs = 8;
constexpr char kCardKeySuffix[] = "#cards";
constexpr base::TaskTraits kBlocking = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                        base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN};
constexpr base::TaskTraits kKeyring = {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
                                       base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN};

void Fail(Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

double NowMs() {
  return (base::TimeTicks::Now() - base::TimeTicks()).InMillisecondsF();
}

std::string Argument(const base::ListValue& values, size_t index) {
  return index < values.size() && values[index].is_string() ? values[index].GetString() : std::string();
}

std::string JobKey(std::string_view owner, std::string_view job) {
  return std::string(owner) + "\n" + std::string(job);
}

li::Environment CurrentEnvironment() {
  std::unique_ptr<base::Environment> environment = base::Environment::Create();
  const std::optional<std::string> home = environment->GetVar("HOME");
  const std::optional<std::string> config = environment->GetVar("XDG_CONFIG_HOME");
  base::FilePath temp;
  base::GetTempDir(&temp);
  base::FilePath own;
  base::PathService::Get(chrome::DIR_USER_DATA, &own);
  return li::MakeEnvironment(home ? home->c_str() : nullptr, config ? config->c_str() : nullptr,
                             temp.value().c_str(), own.value());
}

using ProfileResolved = base::OnceCallback<void(Profile*, std::string)>;

void ResolveImportProfile(std::string_view engine_profile, ProfileResolved done) {
  const li::ProfileTarget target = li::ClassifyProfile(engine_profile);
  if (target == li::ProfileTarget::kPrivate || target == li::ProfileTarget::kInvalid) {
    return std::move(done).Run(nullptr, li::ProfileErrorCode(target));
  }
  ardiacore::ResolveLinuxProfile(
      engine_profile,
      base::BindOnce(
          [](ProfileResolved done, Profile* profile, ardiacore::linux_profiles::ProfileError error) {
            if (!profile) {
              const std::string_view code = ardiacore::linux_profiles::ProfileErrorCode(error);
              return std::move(done).Run(nullptr, code.empty() ? "ERR_PROFILE_UNAVAILABLE" : std::string(code));
            }
            if (profile->IsOffTheRecord()) return std::move(done).Run(nullptr, "ERR_PROFILE_PRIVATE");
            std::move(done).Run(profile, std::string());
          },
          std::move(done)));
}

class JobObserver : public li::ImportObserver {
 public:
  JobObserver(scoped_refptr<Flag> cancelled, scoped_refptr<base::SequencedTaskRunner> ui, Emit emit, std::string job)
      : cancelled_(std::move(cancelled)), ui_(std::move(ui)), emit_(std::move(emit)), job_(std::move(job)) {}

  bool Cancelled() const override { return cancelled_->data.load(); }

  void Progress(std::string_view kind, std::string_view phase, int processed, std::optional<int> total) override {
    base::DictValue event;
    event.Set("jobId", job_);
    event.Set("type", "progress");
    event.Set("kind", kind);
    event.Set("phase", phase);
    event.Set("processed", processed);
    if (total) event.Set("total", *total);
    ui_->PostTask(FROM_HERE, base::BindOnce(emit_, base::Value(std::move(event))));
  }

 private:
  scoped_refptr<Flag> cancelled_;
  scoped_refptr<base::SequencedTaskRunner> ui_;
  Emit emit_;
  std::string job_;
};

struct KeyRead {
  li::KeyringStatus status = li::KeyringStatus::kUnavailable;
  li::SecretBytes key;
};

KeyRead ReadSafeStorageKey(li::SafeStorageItem item) {
  KeyRead read;
  li::KeyringLookup lookup = li::SystemKeyring()->Read(item, li::kKeyringPromptTimeoutMs);
  read.status = lookup.status;
  if (lookup.status == li::KeyringStatus::kOk) {
    read.key = li::DeriveChromiumKey(lookup.secret.value());
    if (read.key.value().size() != li::kChromiumKeyBytes) read.status = li::KeyringStatus::kUnavailable;
  }
  return read;
}

li::FirefoxUnlock ReadFirefoxSecrets(li::Environment environment, std::string browser, li::SecretBytes primary_password,
                                     std::vector<std::string> profiles, std::vector<std::string> kinds) {
  std::unique_ptr<li::Keyring> keyring = li::SystemKeyring();
  return li::UnlockFirefox(environment, browser, std::move(primary_password), profiles, kinds, keyring.get(),
                           li::kKeyringPromptTimeoutMs);
}

std::vector<std::string> UnlockScope(const base::ListValue& values, size_t index, bool profiles) {
  std::vector<std::string> out;
  if (values.size() <= index || !values[index].is_list()) return out;
  for (const base::Value& item : values[index].GetList()) {
    if (!item.is_string()) continue;
    const std::string& text = item.GetString();
    if (profiles ? li::ValidProfileId(text) : (text == "autofill" || text == "passwords" || text == "cookies")) out.push_back(text);
    if (out.size() >= 64) break;
  }
  return out;
}

base::ListValue ListBrowsersWithKeyring(li::Environment environment) {
  std::unique_ptr<li::Keyring> keyring = li::SystemKeyring();
  return li::ListBrowsers(environment, keyring.get());
}

li::ImportOutcome RunImport(li::Environment environment, std::string browser, std::string profile,
                            std::vector<std::string> kinds, li::ImportOptions options, scoped_refptr<Flag> cancelled,
                            scoped_refptr<base::SequencedTaskRunner> ui, Emit emit, std::string job) {
  li::RemoveStaleScratch(environment.temp_root, static_cast<int64_t>(base::Time::Now().ToTimeT()), li::kStaleScratchSeconds);
  JobObserver observer(std::move(cancelled), std::move(ui), std::move(emit), std::move(job));
  li::ImportOutcome outcome = li::ReadBrowserProfile(environment, browser, profile, kinds, options, observer);
  outcome.withheld = outcome.error_code.empty() && !outcome.cancelled && li::OutcomeLeaks(outcome);
  return outcome;
}

base::Value ReadBookmarksFile(std::string path) {
  std::string html;
  const li::FileRead read = li::ReadFileLimited(path, li::kMaxBookmarksHtmlBytes, &html);
  if (read != li::FileRead::kOk) {
    return base::Value(base::DictValue().Set("code", read == li::FileRead::kTooLarge ? "tooLarge" : "unreadable"));
  }
  li::BookmarksParse parse = li::ParseNetscapeBookmarks(html);
  if (!parse.root) return base::Value(base::DictValue().Set("code", parse.error_code).Set("message", parse.error));
  return base::Value(base::DictValue().Set("root", std::move(*parse.root)).Set("links", parse.links));
}

struct CsvRead {
  std::string code;
  std::string message;
  std::optional<li::CsvParse> parse;
};

CsvRead ReadPasswordsFile(std::string path) {
  CsvRead read;
  std::string csv;
  const li::FileRead status = li::ReadFileLimited(path, li::kMaxPasswordsCsvBytes, &csv);
  if (status != li::FileRead::kOk) {
    read.code = status == li::FileRead::kTooLarge ? "tooLarge" : "unreadable";
    read.message = "The passwords file couldn't be read";
    return read;
  }
  li::CsvParse parse = li::ParsePasswordsCsv(csv);
  li::Wipe(csv);
  if (!parse.error_code.empty()) {
    read.code = parse.error_code;
    read.message = parse.error;
    return read;
  }
  read.parse = std::move(parse);
  return read;
}

class FileChooser : public ui::SelectFileDialog::Listener {
 public:
  using Chosen = base::OnceCallback<void(std::optional<base::FilePath>)>;

  explicit FileChooser(Chosen chosen) : chosen_(std::move(chosen)) {}
  FileChooser(const FileChooser&) = delete;
  FileChooser& operator=(const FileChooser&) = delete;
  ~FileChooser() override {
    if (dialog_) dialog_->ListenerDestroyed();
  }

  void Open(content::WebContents* contents, std::string_view kind) {
    dialog_ = ui::SelectFileDialog::Create(this, std::make_unique<ChromeSelectFilePolicy>(contents));
    if (!dialog_) return Finish(std::nullopt);
    ui::SelectFileDialog::FileTypeInfo types;
    if (kind == "bookmarksHTML") types.extensions = {{FILE_PATH_LITERAL("html"), FILE_PATH_LITERAL("htm")}};
    else types.extensions = {{FILE_PATH_LITERAL("csv")}};
    types.include_all_files = true;
    dialog_->SelectFile(ui::SelectFileDialog::SELECT_OPEN_FILE,
                        kind == "bookmarksHTML" ? u"Choose a Bookmarks HTML File" : u"Choose a Passwords CSV File",
                        base::FilePath(), &types, 1, base::FilePath::StringType(),
                        contents ? contents->GetTopLevelNativeWindow() : gfx::NativeWindow());
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override { Finish(file.path()); }
  void FileSelectionCanceled() override { Finish(std::nullopt); }

 private:
  void Finish(std::optional<base::FilePath> path) {
    if (chosen_) std::move(chosen_).Run(std::move(path));
  }

  Chosen chosen_;
  scoped_refptr<ui::SelectFileDialog> dialog_;
};

class PasswordWriter : public ProfileObserver {
 public:
  using Finished = base::OnceCallback<void(bool, base::DictValue)>;
  using Progress = base::RepeatingCallback<void(int processed, int total)>;

  PasswordWriter(Profile* profile, std::vector<li::Credential> credentials, Progress progress, Finished finished)
      : profile_(profile),
        credentials_(std::move(credentials)),
        progress_(std::move(progress)),
        finished_(std::move(finished)) {
    observation_.Observe(profile);
  }
  PasswordWriter(const PasswordWriter&) = delete;
  PasswordWriter& operator=(const PasswordWriter&) = delete;
  ~PasswordWriter() override { ForgetExisting(); }

  void OnProfileWillBeDestroyed(Profile*) override {
    weak_factory_.InvalidateWeakPtrs();
    importer_.reset();
    delegate_.reset();
    observation_.Reset();
    profile_ = nullptr;
    Fail("ERR_PROFILE_UNAVAILABLE", "The profile closed before the passwords were saved");
  }

  void Start() {
    if (!profile_) return Fail("ERR_PROFILE_UNAVAILABLE", "The profile is unavailable");
    delegate_ = extensions::PasswordsPrivateDelegateFactory::GetForBrowserContext(profile_, true);
    if (!delegate_) return Fail("ERR_PASSWORDS_UNAVAILABLE", "The password store is unavailable");
    delegate_->GetSavedPasswordsList(base::BindOnce(&PasswordWriter::Loaded, weak_factory_.GetWeakPtr()));
  }

 private:
  void Loaded(const extensions::PasswordsPrivateDelegate::UiEntries&) {
    password_manager::SavedPasswordsPresenter* presenter = delegate_->GetSavedPasswordsPresenter();
    if (!presenter) return Fail("ERR_PASSWORDS_UNAVAILABLE", "The password store is unavailable");
    for (password_manager::CredentialUIEntry& entry : presenter->GetSavedPasswords()) {
      std::string username = base::UTF16ToUTF8(entry.username);
      std::string password = base::UTF16ToUTF8(entry.password);
      existing_.insert(li::ExistingKey(entry.GetURL().spec(), username, password));
      li::Wipe(password);
      std::fill(entry.password.begin(), entry.password.end(), u'\0');
    }
    importer_ = std::make_unique<password_manager::PasswordImporter>(*presenter);
    NextChunk();
  }

  void NextChunk() {
    if (offset_ >= credentials_.size()) {
      base::DictValue counts = tally_.ToValue();
      return Complete(true, std::move(counts));
    }
    const size_t end = std::min(credentials_.size(), offset_ + li::kPasswordChunk);
    chunk_.clear();
    for (size_t i = offset_; i < end; ++i) chunk_.push_back(std::move(credentials_[i]));
    offset_ = end;
    chunk_existing_ = li::CountExisting(chunk_, existing_);
    chunk_conflicts_ = 0;
    std::vector<password_manager::CSVPassword> rows;
    rows.reserve(chunk_.size());
    for (const li::Credential& credential : chunk_) {
      const GURL url(credential.url);
      if (url.is_valid()) {
        rows.emplace_back(url, credential.username, credential.password, credential.note,
                          password_manager::CSVPassword::Status::kOK);
      } else {
        rows.emplace_back(credential.url, credential.username, credential.password, credential.note,
                          password_manager::CSVPassword::Status::kOK);
      }
    }
    importer_->Import(rows, password_manager::PasswordForm::Store::kProfileStore,
                      base::BindOnce(&PasswordWriter::Imported, weak_factory_.GetWeakPtr()));
  }

  void Imported(const password_manager::ImportResults& results) {
    if (results.status == password_manager::ImportResults::Status::CONFLICTS) {
      chunk_conflicts_ += static_cast<int>(results.displayed_entries.size());
      return importer_->ContinueImport({}, base::BindOnce(&PasswordWriter::Imported, weak_factory_.GetWeakPtr()));
    }
    if (results.status != password_manager::ImportResults::Status::SUCCESS) {
      return Fail("ERR_PASSWORDS_IMPORT", "Chromium's password importer rejected the passwords");
    }
    int invalid = 0;
    for (const password_manager::ImportEntry& entry : results.displayed_entries) {
      if (entry.status != password_manager::ImportEntry::Status::VALID &&
          entry.status != password_manager::ImportEntry::Status::CONFLICT_PROFILE &&
          entry.status != password_manager::ImportEntry::Status::CONFLICT_ACCOUNT) {
        ++invalid;
      }
    }
    tally_.AddChunk(results.number_imported, chunk_existing_, chunk_conflicts_, invalid);
    chunk_.clear();
    progress_.Run(static_cast<int>(offset_), static_cast<int>(credentials_.size()));
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&PasswordWriter::NextChunk, weak_factory_.GetWeakPtr()));
  }

  void Fail(std::string_view code, std::string_view message) {
    Complete(false, base::DictValue().Set("code", code).Set("message", message));
  }

  void Complete(bool ok, base::DictValue payload) {
    credentials_.clear();
    chunk_.clear();
    ForgetExisting();
    if (finished_) std::move(finished_).Run(ok, std::move(payload));
  }

  void ForgetExisting() {
    while (!existing_.empty()) {
      auto node = existing_.extract(existing_.begin());
      li::Wipe(node.value());
    }
  }

  raw_ptr<Profile> profile_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
  std::vector<li::Credential> credentials_;
  std::vector<li::Credential> chunk_;
  std::set<std::string> existing_;
  size_t offset_ = 0;
  size_t chunk_existing_ = 0;
  int chunk_conflicts_ = 0;
  li::PasswordTally tally_;
  Progress progress_;
  Finished finished_;
  scoped_refptr<extensions::PasswordsPrivateDelegate> delegate_;
  std::unique_ptr<password_manager::PasswordImporter> importer_;
  base::WeakPtrFactory<PasswordWriter> weak_factory_{this};
};

class ImportedWriter {
 public:
  using Finished = base::OnceCallback<void(base::DictValue)>;
  using Progress = base::RepeatingCallback<void(std::string_view kind, int processed, int total)>;

  ImportedWriter(base::FilePath profile_dir, li::ImportedData data, bool cookies, bool autofill, Progress progress,
                 Finished finished)
      : profile_dir_(std::move(profile_dir)),
        data_(std::move(data)),
        cookies_(cookies),
        autofill_(autofill),
        progress_(std::move(progress)),
        finished_(std::move(finished)) {}
  ImportedWriter(const ImportedWriter&) = delete;
  ImportedWriter& operator=(const ImportedWriter&) = delete;

  void Start() { Next(); }

 private:
  struct Pending {
    base::WeakPtr<ImportedWriter> writer;
    bool cookies = false;
  };

  static void Replied(void* context, const char* json) {
    std::unique_ptr<Pending> pending(static_cast<Pending*>(context));
    if (!pending->writer) return;
    std::optional<base::Value> parsed = json ? base::JSONReader::Read(json, base::JSON_PARSE_RFC) : std::nullopt;
    pending->writer->Answer(pending->cookies, parsed && parsed->is_dict() ? &parsed->GetDict() : nullptr);
  }

  int Count(const base::DictValue& reply, std::string_view key) {
    const std::optional<int> value = reply.FindInt(key);
    return value && *value > 0 ? *value : 0;
  }

  void Answer(bool cookies, const base::DictValue* reply) {
    if (!reply || reply->Find("error")) {
      if (cookies) {
        cookies_failed_ = true;
      } else {
        autofill_failed_ = true;
      }
      return Next();
    }
    if (cookies) {
      written_cookies_ += Count(*reply, "imported");
      rejected_cookies_ += Count(*reply, "rejected");
      existing_cookies_ += Count(*reply, "existing");
      progress_.Run("cookies", static_cast<int>(std::min(cookie_offset_, data_.cookies.size())),
                    static_cast<int>(data_.cookies.size()));
    } else {
      written_addresses_ += Count(*reply, "addresses");
      written_cards_ += Count(*reply, "cards");
      progress_.Run("autofill", static_cast<int>(autofill_offset_),
                    static_cast<int>(std::max(data_.addresses.size(), data_.cards.size())));
    }
    Next();
  }

  void Next() {
    const std::string dir = profile_dir_.value();
    if (cookies_ && cookie_offset_ < data_.cookies.size()) {
      const size_t end = std::min(data_.cookies.size(), cookie_offset_ + li::kCookieBatch);
      int dropped = 0;
      li::SecretBytes payload = li::CookiesPayload(data_.cookies, cookie_offset_, end, &dropped);
      rejected_cookies_ += dropped;
      cookie_offset_ = end;
      auto pending = std::make_unique<Pending>(Pending{weak_factory_.GetWeakPtr(), true});
      ac_engine_call("ac_cookies_import", dir.c_str(), payload.value().c_str(), &ImportedWriter::Replied,
                     pending.release());
      return;
    }
    const size_t autofill_total = std::max(data_.addresses.size(), data_.cards.size());
    if (autofill_ && autofill_offset_ < autofill_total) {
      const size_t end = std::min(autofill_total, autofill_offset_ + li::kAutofillBatch);
      li::SecretBytes payload = li::AutofillPayload(data_.addresses, data_.cards, autofill_offset_, end);
      autofill_offset_ = end;
      auto pending = std::make_unique<Pending>(Pending{weak_factory_.GetWeakPtr(), false});
      ac_engine_call("ac_autofill_import", dir.c_str(), payload.value().c_str(), &ImportedWriter::Replied,
                     pending.release());
      return;
    }
    data_ = li::ImportedData();
    base::DictValue counts;
    counts.Set("cookies", written_cookies_);
    counts.Set("cookiesRejected", rejected_cookies_);
    counts.Set("cookiesExisting", existing_cookies_);
    counts.Set("addresses", written_addresses_);
    counts.Set("cards", written_cards_);
    if (cookies_failed_) counts.Set("cookiesFailed", 1);
    if (autofill_failed_) counts.Set("autofillFailed", 1);
    if (finished_) std::move(finished_).Run(std::move(counts));
  }

  base::FilePath profile_dir_;
  li::ImportedData data_;
  bool cookies_;
  bool autofill_;
  bool cookies_failed_ = false;
  bool autofill_failed_ = false;
  size_t cookie_offset_ = 0;
  size_t autofill_offset_ = 0;
  int written_cookies_ = 0;
  int rejected_cookies_ = 0;
  int existing_cookies_ = 0;
  int written_addresses_ = 0;
  int written_cards_ = 0;
  Progress progress_;
  Finished finished_;
  base::WeakPtrFactory<ImportedWriter> weak_factory_{this};
};

class ImportService {
 public:
  static ImportService& Get() {
    static base::NoDestructor<ImportService> service;
    return *service;
  }

  void Invoke(LinuxImportRequester requester, const std::string& method, const base::ListValue& values, Done done) {
    vault_.Expire(NowMs());
    imported_.Expire(NowMs());
    unlocked_.Expire(NowMs());
    if (terminating_) return Fail(std::move(done), "ERR_SHUTTING_DOWN", "Ardia is quitting");
    if (method == "ArdiaImport.listBrowsers") return ListBrowsers(std::move(done));
    if (method == "ArdiaImport.startImport") return StartImport(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.cancelImport") {
      auto found = jobs_.find(JobKey(requester.owner, Argument(values, 0)));
      if (found != jobs_.end()) found->second->data.store(true);
      return std::move(done).Run(true, base::Value(found != jobs_.end()));
    }
    if (method == "ArdiaImport.writePasswords") return WritePasswords(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.discardPasswords") {
      return std::move(done).Run(true, base::Value(vault_.Discard(requester.owner, Argument(values, 0))));
    }
    if (method == "ArdiaImport.forgetUnlockedKeys") {
      vault_.DiscardOwner(requester.owner);
      ForgetSecrets(requester.owner);
      return std::move(done).Run(true, base::Value());
    }
    if (method == "ArdiaImport.unlockBrowser") return Unlock(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.writeImported") return WriteImported(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.discardImported") {
      return std::move(done).Run(true, base::Value(imported_.Discard(requester.owner, Argument(values, 0))));
    }
    if (method == "ArdiaImport.chooseImportFile") return Choose(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.cancelChooser") {
      auto found = choosers_.find(requester.owner);
      const bool cancelled = found != choosers_.end() && found->second.request == Argument(values, 0);
      if (cancelled) choosers_.erase(found);
      return std::move(done).Run(true, base::Value(cancelled));
    }
    if (method == "ArdiaImport.importBookmarksHTML") return ReadBookmarks(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.importPasswordsCSV") return ReadPasswords(std::move(requester), values, std::move(done));
    if (method == "ArdiaImport.listExtensions") {
      const std::string browser = Argument(values, 0);
      const std::string profile = Argument(values, 1);
      if (!li::ValidBrowserId(browser) || !li::ValidProfileId(profile)) return Fail(std::move(done), "invalid", "Invalid extension request");
      base::ThreadPool::PostTaskAndReplyWithResult(
          FROM_HERE, kBlocking,
          base::BindOnce([](li::Environment environment, std::string browser, std::string profile) {
            return li::ListExtensions(environment, browser, profile);
          }, CurrentEnvironment(), browser, profile),
          base::BindOnce([](Done done, base::ListValue list) { std::move(done).Run(true, base::Value(std::move(list))); },
                         std::move(done)));
      return;
    }
    Fail(std::move(done), "unsupported", "Unsupported import method");
  }

  void WindowClosed(std::string_view owner) {
    const std::string prefix = std::string(owner) + "\n";
    for (auto it = jobs_.begin(); it != jobs_.end();) {
      if (it->first.rfind(prefix, 0) == 0) {
        it->second->data.store(true);
        it = jobs_.erase(it);
      } else {
        ++it;
      }
    }
    vault_.DiscardOwner(owner);
    ForgetSecrets(owner);
    chosen_.Forget(owner);
    choosers_.erase(std::string(owner));
  }

 private:
  friend class base::NoDestructor<ImportService>;

  struct OpenChooser {
    std::string request;
    std::unique_ptr<FileChooser> chooser;
  };

  ImportService()
      : terminating_subscription_(browser_shutdown::AddAppTerminatingCallback(
            base::BindOnce(&ImportService::Terminate, base::Unretained(this)))) {}

  void Terminate() {
    terminating_ = true;
    for (auto& [key, flag] : jobs_) flag->data.store(true);
    jobs_.clear();
    vault_.Clear();
    imported_.Clear();
    unlocked_.Clear();
    choosers_.clear();
    imported_writers_.clear();
  }

  void ForgetSecrets(std::string_view owner) {
    unlocked_.Forget(owner);
    imported_.DiscardOwner(owner);
    ++secret_generation_[std::string(owner)];
  }

  int SecretGeneration(const std::string& owner) {
    return secret_generation_[owner];
  }

  void Unlock(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string request = Argument(values, 0);
    const std::string browser_id = Argument(values, 1);
    if (!li::ValidJobId(request) || !li::ValidBrowserId(browser_id)) return Fail(std::move(done), "invalid", "Invalid unlock request");
    const li::BrowserDefinition* browser = li::FindBrowser(browser_id);
    if (!browser) return Fail(std::move(done), "notFound", "Unknown browser");
    if (browser->family == li::Family::kFirefox) {
      const bool given = values.size() > 2 && values[2].is_string();
      if (given && values[2].GetString().size() > 4096) return Fail(std::move(done), "invalid", "Invalid unlock request");
      if (unlocking_.contains(requester.owner)) return Fail(std::move(done), "busy", "An unlock is already waiting");
      unlocking_.insert(requester.owner);
      std::move(done).Run(true, base::Value(true));
      base::ThreadPool::PostTaskAndReplyWithResult(
          FROM_HERE, kKeyring,
          base::BindOnce(&ReadFirefoxSecrets, CurrentEnvironment(), browser_id,
                         li::SecretBytes(given ? values[2].GetString() : std::string()), UnlockScope(values, 3, true),
                         UnlockScope(values, 4, false)),
          base::BindOnce(&ImportService::FirefoxUnlocked, weak_factory_.GetWeakPtr(), requester.owner, request,
                         browser_id, SecretGeneration(requester.owner), requester.emit));
      return;
    }
    std::optional<li::SafeStorageItem> item = li::SafeStorageFor(browser_id);
    if (!item) return Fail(std::move(done), "unsupported", "This browser has no Safe Storage key");
    if (unlocking_.contains(requester.owner)) return Fail(std::move(done), "busy", "An unlock is already waiting");
    unlocking_.insert(requester.owner);
    std::move(done).Run(true, base::Value(true));
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, kKeyring, base::BindOnce(&ReadSafeStorageKey, std::move(*item)),
        base::BindOnce(&ImportService::Unlocked, weak_factory_.GetWeakPtr(), requester.owner, request, browser_id,
                       std::string(browser->name), SecretGeneration(requester.owner), requester.emit));
  }

  void Unlocked(std::string owner, std::string request, std::string browser, std::string name, int generation, Emit emit,
                KeyRead read) {
    unlocking_.erase(owner);
    base::DictValue event;
    event.Set("jobId", request);
    if (generation != SecretGeneration(owner) || terminating_) {
      event.Set("type", "failed");
      event.Set("code", "cancelled");
      event.Set("message", "The unlock was cancelled");
    } else if (read.status == li::KeyringStatus::kOk) {
      unlocked_.Set(owner, browser, std::move(read.key), NowMs());
      event.Set("type", "unlocked");
    } else {
      event.Set("type", "failed");
      event.Set("code", li::KeyringErrorCode(read.status));
      event.Set("message", li::KeyringErrorMessage(read.status, name));
    }
    emit.Run(base::Value(std::move(event)));
  }

  void FirefoxUnlocked(std::string owner, std::string request, std::string browser, int generation, Emit emit,
                       li::FirefoxUnlock unlock) {
    unlocking_.erase(owner);
    base::DictValue event;
    event.Set("jobId", request);
    if (generation != SecretGeneration(owner) || terminating_) {
      event.Set("type", "failed");
      event.Set("code", "cancelled");
      event.Set("message", "The unlock was cancelled");
    } else if (!unlock.code.empty()) {
      event.Set("type", "failed");
      event.Set("code", unlock.code);
      event.Set("message", unlock.message);
    } else {
      if (unlock.primary_password) unlocked_.Set(owner, browser, std::move(*unlock.primary_password), NowMs());
      if (unlock.card_key) unlocked_.Set(owner, browser + kCardKeySuffix, std::move(*unlock.card_key), NowMs());
      event.Set("type", "unlocked");
      event.Set("cardsLocked", unlock.cards_locked);
    }
    emit.Run(base::Value(std::move(event)));
  }

  void StoreImported(const std::string& owner, li::ImportOutcome& outcome, base::DictValue& reply,
                     base::ListValue& failed, base::ListValue& warnings) {
    li::ImportedData data;
    data.cookies = std::move(outcome.cookies);
    data.addresses = std::move(outcome.addresses);
    data.cards = std::move(outcome.cards);
    if (data.empty()) return;
    const std::string token = base::HexEncodeLower(base::RandBytesAsVector(16));
    if (!imported_.Put(owner, token, std::move(data), NowMs())) {
      for (const char* kind : {"cookies", "autofill"}) {
        failed.Append(kind);
        warnings.Append(base::DictValue().Set("kind", kind).Set("code", "unavailable").Set(
            "message", "The imported data couldn't be held for saving"));
      }
      return;
    }
    reply.Set("vaultToken", token);
    base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&ImportService::ExpireVault, weak_factory_.GetWeakPtr()),
        base::Milliseconds(li::kVaultLifetimeMs + 1));
  }

  void WriteImported(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string request = Argument(values, 0);
    const std::string token = Argument(values, 1);
    if (!li::ValidJobId(request) || !li::ValidToken(token)) return Fail(std::move(done), "invalid", "Invalid import write");
    const std::string engine_profile = Argument(values, 2);
    bool cookies = false;
    bool autofill = false;
    if (values.size() > 3 && values[3].is_list()) {
      for (const base::Value& kind : values[3].GetList()) {
        if (!kind.is_string()) continue;
        cookies |= kind.GetString() == "cookies";
        autofill |= kind.GetString() == "autofill";
      }
    }
    const li::ProfileTarget target = li::ClassifyProfile(engine_profile);
    if (target == li::ProfileTarget::kPrivate || target == li::ProfileTarget::kInvalid) {
      imported_.Discard(requester.owner, token);
      return Fail(std::move(done), li::ProfileErrorCode(target), "Imported data can't be saved into that profile");
    }
    std::optional<li::ImportedData> data = imported_.Take(requester.owner, token, NowMs());
    if (!data) return Fail(std::move(done), "expired", "The imported data is no longer available");
    std::move(done).Run(true, base::Value(true));
    auto taken = std::make_unique<li::ImportedData>(std::move(*data));
    ResolveImportProfile(engine_profile,
                         base::BindOnce(&ImportService::ImportedResolved, weak_factory_.GetWeakPtr(), request,
                                        std::move(taken), cookies, autofill, requester.emit));
  }

  void ImportedResolved(std::string request, std::unique_ptr<li::ImportedData> data, bool cookies, bool autofill,
                        Emit emit, Profile* profile, std::string code) {
    if (!profile) {
      emit.Run(base::Value(base::DictValue()
                               .Set("jobId", request)
                               .Set("type", "failed")
                               .Set("code", code)
                               .Set("message", "Imported data can't be saved into that profile")));
      return;
    }
    const int id = ++next_writer_;
    auto writer = std::make_unique<ImportedWriter>(
        profile->GetPath(), std::move(*data), cookies, autofill,
        base::BindRepeating(
            [](Emit emit, std::string request, std::string_view kind, int processed, int total) {
              emit.Run(base::Value(base::DictValue()
                                       .Set("jobId", request)
                                       .Set("type", "progress")
                                       .Set("kind", kind)
                                       .Set("phase", "progress")
                                       .Set("processed", processed)
                                       .Set("total", total)));
            },
            emit, request),
        base::BindOnce(&ImportService::ImportedWritten, weak_factory_.GetWeakPtr(), id, request, emit));
    ImportedWriter* started = writer.get();
    imported_writers_[id] = std::move(writer);
    started->Start();
  }

  void ImportedWritten(int id, std::string request, Emit emit, base::DictValue counts) {
    auto found = imported_writers_.find(id);
    if (found != imported_writers_.end()) {
      base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, std::move(found->second));
      imported_writers_.erase(found);
    }
    counts.Set("jobId", request);
    counts.Set("type", "importedWritten");
    emit.Run(base::Value(std::move(counts)));
  }

  void Store(const std::string& owner, std::vector<li::Credential> credentials, base::DictValue& reply,
             base::ListValue& failed, base::ListValue& warnings) {
    if (credentials.empty()) return;
    const int count = static_cast<int>(credentials.size());
    const std::string token = base::HexEncodeLower(base::RandBytesAsVector(16));
    if (!vault_.Put(owner, token, std::move(credentials), NowMs())) {
      failed.Append("passwords");
      warnings.Append(base::DictValue()
                          .Set("kind", "passwords")
                          .Set("code", "unavailable")
                          .Set("message", "The imported passwords couldn't be held for saving"));
      return;
    }
    reply.Set("passwords", base::DictValue().Set("token", token).Set("count", count));
    base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&ImportService::ExpireVault, weak_factory_.GetWeakPtr()),
        base::Milliseconds(li::kVaultLifetimeMs + 1));
  }

  void ExpireVault() {
    vault_.Expire(NowMs());
    imported_.Expire(NowMs());
    unlocked_.Expire(NowMs());
  }

  void ListBrowsers(Done done) {
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, kKeyring, base::BindOnce(&ListBrowsersWithKeyring, CurrentEnvironment()),
        base::BindOnce([](Done done, base::ListValue list) { std::move(done).Run(true, base::Value(std::move(list))); },
                       std::move(done)));
  }

  void StartImport(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string job = Argument(values, 0);
    const std::string browser = Argument(values, 1);
    const std::string profile = Argument(values, 2);
    if (!li::ValidJobId(job) || !li::ValidBrowserId(browser) || !li::ValidProfileId(profile)) {
      return Fail(std::move(done), "invalid", "Invalid import request");
    }
    if (!li::FindBrowser(browser)) return Fail(std::move(done), "notFound", "Unknown browser");
    const std::vector<std::string> kinds =
        li::RequestedKinds(values.size() > 3 && values[3].is_list() ? &values[3].GetList() : nullptr);
    li::ImportOptions options;
    if (values.size() > 4 && values[4].is_dict()) {
      const base::DictValue& given = values[4].GetDict();
      if (std::optional<int> limit = given.FindInt("historyLimit"); limit && *limit > 0) options.history_limit = limit;
      if (std::optional<double> since = given.FindDouble("historySince"); since && *since > 0) options.history_since = since;
    }
    options.now_ms = base::Time::Now().InMillisecondsFSinceUnixEpoch();
    if (std::optional<li::SecretBytes> secret = unlocked_.Copy(requester.owner, browser, NowMs())) {
      if (li::FindBrowser(browser)->family == li::Family::kChromium) {
        options.chromium_key = std::move(secret);
      } else {
        options.firefox_primary_password = std::move(secret);
      }
    }
    if (li::FindBrowser(browser)->family == li::Family::kFirefox) {
      options.firefox_card_key = unlocked_.Copy(requester.owner, browser + kCardKeySuffix, NowMs());
    }
    const std::string key = JobKey(requester.owner, job);
    if (jobs_.contains(key)) return Fail(std::move(done), "busy", "That import is already running");
    if (jobs_.size() >= kMaxJobs) return Fail(std::move(done), "busy", "Too many imports are running");
    auto cancelled = base::MakeRefCounted<Flag>(std::in_place, false);
    jobs_[key] = cancelled;
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, kBlocking,
        base::BindOnce(&RunImport, CurrentEnvironment(), browser, profile, kinds, std::move(options), cancelled,
                       base::SequencedTaskRunner::GetCurrentDefault(), requester.emit, job),
        base::BindOnce(&ImportService::Imported, weak_factory_.GetWeakPtr(), requester.owner, job, requester.emit));
    std::move(done).Run(true, base::Value(true));
  }

  void Imported(std::string owner, std::string job, Emit emit, li::ImportOutcome outcome) {
    auto found = jobs_.find(JobKey(owner, job));
    if (found == jobs_.end()) return;
    const bool cancelled = outcome.cancelled || found->second->data.load();
    jobs_.erase(found);
    base::DictValue event;
    event.Set("jobId", job);
    if (cancelled) {
      event.Set("type", "failed");
      event.Set("code", "cancelled");
      event.Set("message", "Import cancelled");
    } else if (!outcome.error_code.empty()) {
      event.Set("type", "failed");
      event.Set("code", outcome.error_code);
      event.Set("message", outcome.error);
    } else {
      if (outcome.withheld) {
        event.Set("type", "failed");
        event.Set("code", "ERR_SECRET_IN_REPLY");
        event.Set("message", "The import result was withheld because it contained a password");
      } else {
        base::ListValue failed;
        base::ListValue warnings;
        if (base::ListValue* listed = outcome.result.FindList("failed")) failed = std::move(*listed);
        if (base::ListValue* listed = outcome.result.FindList("warnings")) warnings = std::move(*listed);
        Store(owner, std::move(outcome.credentials), outcome.result, failed, warnings);
        StoreImported(owner, outcome, outcome.result, failed, warnings);
        outcome.result.Set("failed", std::move(failed));
        outcome.result.Set("warnings", std::move(warnings));
        event.Set("type", "done");
        event.Set("result", std::move(outcome.result));
      }
    }
    outcome.credentials.clear();
    outcome.cookies.clear();
    outcome.addresses.clear();
    outcome.cards.clear();
    emit.Run(base::Value(std::move(event)));
  }

  void WritePasswords(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string request = Argument(values, 0);
    const std::string token = Argument(values, 1);
    if (!li::ValidJobId(request) || !li::ValidToken(token)) return Fail(std::move(done), "invalid", "Invalid password write");
    const std::string engine_profile = Argument(values, 2);
    const li::ProfileTarget target = li::ClassifyProfile(engine_profile);
    if (target == li::ProfileTarget::kPrivate || target == li::ProfileTarget::kInvalid) {
      vault_.Discard(requester.owner, token);
      return Fail(std::move(done), li::ProfileErrorCode(target), "Passwords can't be imported into that profile");
    }
    if (!vault_.Contains(requester.owner, token, NowMs())) {
      return Fail(std::move(done), "expired", "The imported passwords are no longer available");
    }
    std::move(done).Run(true, base::Value(true));
    ResolveImportProfile(engine_profile, base::BindOnce(&ImportService::WriteResolved, weak_factory_.GetWeakPtr(),
                                                        requester.owner, request, token, requester.emit));
  }

  void WriteResolved(std::string owner, std::string request, std::string token, Emit emit, Profile* profile,
                     std::string code) {
    auto failed = [&](std::string_view failure, std::string_view message) {
      emit.Run(base::Value(base::DictValue()
                               .Set("jobId", request)
                               .Set("type", "failed")
                               .Set("code", failure)
                               .Set("message", message)));
    };
    if (!profile) {
      vault_.Discard(owner, token);
      return failed(code, "Passwords can't be imported into that profile");
    }
    std::optional<std::vector<li::Credential>> credentials = vault_.Take(owner, token, NowMs());
    if (!credentials) return failed("expired", "The imported passwords are no longer available");
    const int id = ++next_writer_;
    auto writer = std::make_unique<PasswordWriter>(
        profile, std::move(*credentials),
        base::BindRepeating(
            [](Emit emit, std::string request, int processed, int total) {
              emit.Run(base::Value(base::DictValue()
                                       .Set("jobId", request)
                                       .Set("type", "progress")
                                       .Set("kind", "passwords")
                                       .Set("phase", "progress")
                                       .Set("processed", processed)
                                       .Set("total", total)));
            },
            emit, request),
        base::BindOnce(&ImportService::Written, weak_factory_.GetWeakPtr(), id, request, emit));
    PasswordWriter* started = writer.get();
    writers_[id] = std::move(writer);
    started->Start();
  }

  void Written(int id, std::string request, Emit emit, bool ok, base::DictValue payload) {
    auto found = writers_.find(id);
    if (found != writers_.end()) {
      base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, std::move(found->second));
      writers_.erase(found);
    }
    payload.Set("jobId", request);
    payload.Set("type", ok ? "written" : "failed");
    emit.Run(base::Value(std::move(payload)));
  }

  void Choose(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string request = Argument(values, 0);
    const std::string kind = Argument(values, 1);
    if (!li::ValidJobId(request)) return Fail(std::move(done), "invalid", "Invalid chooser request");
    if (!li::ValidChooserKind(kind)) return Fail(std::move(done), "unsupported", "That file type can't be imported on Linux");
    if (choosers_.contains(requester.owner)) return Fail(std::move(done), "busy", "A file chooser is already open");
    if (!ChromeSelectFilePolicy::FileSelectDialogsAllowed()) {
      return Fail(std::move(done), "ERR_FILE_CHOOSER_DISABLED", "File choosers are disabled by policy");
    }
    auto chooser = std::make_unique<FileChooser>(base::BindOnce(
        &ImportService::Chosen, weak_factory_.GetWeakPtr(), requester.owner, request, kind, requester.emit));
    FileChooser* opening = chooser.get();
    choosers_[requester.owner] = OpenChooser{request, std::move(chooser)};
    std::move(done).Run(true, base::Value(true));
    opening->Open(requester.contents.get(), kind);
  }

  void Chosen(std::string owner, std::string request, std::string kind, Emit emit, std::optional<base::FilePath> path) {
    auto found = choosers_.find(owner);
    if (found != choosers_.end() && found->second.request == request) {
      base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, std::move(found->second.chooser));
      choosers_.erase(found);
    }
    base::DictValue event;
    event.Set("jobId", request);
    event.Set("type", "chosen");
    if (path && li::ValidLocalFile(path->value())) {
      chosen_.Remember(owner, kind, path->value(), NowMs());
      event.Set("path", path->value());
    } else {
      event.Set("path", base::Value());
    }
    emit.Run(base::Value(std::move(event)));
  }

  bool TakeChosen(const LinuxImportRequester& requester, std::string_view kind, const std::string& path) {
    return li::ValidLocalFile(path) && chosen_.Take(requester.owner, kind, path, NowMs());
  }

  void ReadBookmarks(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string path = Argument(values, 0);
    if (!TakeChosen(requester, "bookmarksHTML", path)) {
      return Fail(std::move(done), "ERR_FILE_NOT_CHOSEN", "Choose the file to import first");
    }
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, kBlocking, base::BindOnce(&ReadBookmarksFile, path),
        base::BindOnce(
            [](Done done, base::Value reply) {
              const bool ok = reply.is_dict() && !reply.GetDict().contains("code");
              std::move(done).Run(ok, std::move(reply));
            },
            std::move(done)));
  }

  void ReadPasswords(LinuxImportRequester requester, const base::ListValue& values, Done done) {
    const std::string path = Argument(values, 0);
    if (!TakeChosen(requester, "passwordsCSV", path)) {
      return Fail(std::move(done), "ERR_FILE_NOT_CHOSEN", "Choose the file to import first");
    }
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, kBlocking, base::BindOnce(&ReadPasswordsFile, path),
        base::BindOnce(&ImportService::PasswordsRead, weak_factory_.GetWeakPtr(), requester.owner, std::move(done)));
  }

  void PasswordsRead(std::string owner, Done done, CsvRead read) {
    if (!read.parse) return Fail(std::move(done), read.code, read.message);
    li::CsvParse& parse = *read.parse;
    base::DictValue reply;
    reply.Set("entries", li::CredentialSummaries(parse.credentials));
    reply.Set("rows", parse.rows);
    reply.Set("duplicates", parse.duplicates);
    reply.Set("invalid", parse.invalid);
    if (li::ReplyLeaksSecret(base::Value(reply.Clone()), parse.credentials)) {
      return Fail(std::move(done), "ERR_SECRET_IN_REPLY", "The passwords file reply was withheld");
    }
    base::ListValue failed;
    base::ListValue warnings;
    Store(owner, std::move(parse.credentials), reply, failed, warnings);
    if (!failed.empty()) return Fail(std::move(done), "unavailable", "The imported passwords couldn't be held for saving");
    std::move(done).Run(true, base::Value(std::move(reply)));
  }

  bool terminating_ = false;
  base::CallbackListSubscription terminating_subscription_;
  std::map<std::string, scoped_refptr<Flag>> jobs_;
  li::CredentialVault vault_;
  li::ChosenFiles chosen_;
  std::map<std::string, OpenChooser> choosers_;
  std::map<int, std::unique_ptr<PasswordWriter>> writers_;
  std::map<int, std::unique_ptr<ImportedWriter>> imported_writers_;
  li::ImportedVault imported_;
  li::UnlockedKeys unlocked_;
  std::set<std::string> unlocking_;
  std::map<std::string, int> secret_generation_;
  int next_writer_ = 0;
  base::WeakPtrFactory<ImportService> weak_factory_{this};
};

}

bool LinuxImportHandles(std::string_view method) {
  return std::any_of(std::begin(li::kImportCapabilities), std::end(li::kImportCapabilities),
                     [method](const char* known) { return method == known; });
}

void LinuxImportInvoke(LinuxImportRequester requester, const std::string& method, const base::ListValue& values,
                       base::OnceCallback<void(bool, base::Value)> done) {
  ImportService::Get().Invoke(std::move(requester), method, values, std::move(done));
}

void LinuxImportWindowClosed(std::string_view owner) {
  ImportService::Get().WindowClosed(owner);
}

}
