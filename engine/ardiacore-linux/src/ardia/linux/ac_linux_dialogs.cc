#include "ardia/linux/ac_linux_dialogs.h"

#include <algorithm>
#include <limits>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "content/public/browser/browser_thread.h"

namespace ardia {
namespace {

uint64_t NextSuspension() {
  static uint64_t last = 0;
  if (last >= std::numeric_limits<uint64_t>::max() - 1) return 0;
  return ++last;
}

bool Generation(const std::string& value) {
  return !value.empty() && value.size() <= 20 && value[0] != '0' &&
         value.find_first_not_of("0123456789") == std::string::npos;
}

bool Identity(const std::string& value) {
  return value.size() >= 16 && value.size() <= 96 &&
         value.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_-") == std::string::npos;
}

bool Text(const base::DictValue& options, const char* key,
          size_t limit, std::string* output) {
  const auto* value = options.Find(key);
  if (!value) return true;
  if (!value->is_string() || value->GetString().size() > limit) return false;
  *output = value->GetString();
  return true;
}

bool Parse(const base::DictValue& request, const std::string& window,
           LinuxDialogSpec* spec) {
  const auto* id = request.FindString("dialogId");
  const auto* kind = request.FindString("kind");
  const auto* options = request.FindDict("options");
  if (!id || !Identity(*id) || !kind || (*kind != "confirm" && *kind != "prompt") || !options) return false;
  const auto* title = options->FindString("title");
  const auto* owner = options->Find("windowId");
  if (!title || (owner && (!owner->is_string() || owner->GetString() != window))) return false;
  spec->dialog_id = *id;
  spec->prompt = *kind == "prompt";
  if (!Text(*options, "title", 4096, &spec->title) ||
      !Text(*options, "message", 16384, &spec->message) ||
      !Text(*options, "confirmTitle", 1024, &spec->confirm_title)) return false;
  if (spec->prompt) {
    return Text(*options, "value", 16384, &spec->value) &&
           Text(*options, "placeholder", 4096, &spec->placeholder);
  }
  const auto* destructive = options->Find("destructive");
  if (destructive && !destructive->is_bool()) return false;
  spec->destructive = destructive && destructive->GetBool();
  spec->has_suppression = options->Find("suppression") != nullptr;
  return Text(*options, "cancelTitle", 1024, &spec->cancel_title) &&
         Text(*options, "suppression", 4096, &spec->suppression);
}

base::DictValue Resolved(const std::string& window, const std::string& generation,
                         const LinuxDialogSpec& spec, LinuxDialogResponse response) {
  base::Value result;
  if (spec.prompt) {
    if (response.accepted && !response.forced) {
      const std::string text = base::UTF16ToUTF8(base::TrimWhitespace(
          base::UTF8ToUTF16(response.text), base::TRIM_ALL));
      if (!text.empty()) result = base::Value(text);
    }
  } else {
    base::DictValue confirmation;
    confirmation.Set("confirmed", response.accepted && !response.forced);
    confirmation.Set("suppressed", !response.forced && spec.has_suppression && response.suppressed);
    result = base::Value(std::move(confirmation));
  }
  base::DictValue data;
  data.Set("dialogId", spec.dialog_id);
  data.Set("windowId", window);
  data.Set("rendererGeneration", generation);
  data.Set("result", std::move(result));
  base::DictValue envelope;
  envelope.Set("name", "shell.dialogResolved");
  envelope.Set("data", std::move(data));
  return envelope;
}

}

LinuxDialogController::LinuxDialogController(std::string window_id,
    std::string profile_identity, LinuxDialogPresenter presenter)
    : window_id_(std::move(window_id)),
      profile_identity_(std::move(profile_identity)),
      presenter_(std::move(presenter)) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
}

LinuxDialogController::~LinuxDialogController() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  weak_factory_.InvalidateWeakPtrs();
  parent_alive_ = false;
  generation_.clear();
  auto entries = std::move(entries_);
  surface_.reset();
  for (auto& [id, entry] : entries) {
    std::move(entry.completion).Run(Resolved(window_id_, entry.generation, entry.spec,
        {.forced = true}));
  }
}

base::WeakPtr<LinuxDialogController> LinuxDialogController::GetWeakPtr() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  return weak_factory_.GetWeakPtr();
}

bool LinuxDialogController::Authorized(const LinuxDialogClient& client) const {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  return parent_alive_ && !canceling_ && !generation_.empty() && client.authenticated_shell &&
         client.default_regular_profile && client.window_id == window_id_ &&
         client.profile_identity == profile_identity_ &&
         client.renderer_generation == generation_;
}

bool LinuxDialogController::Admits(const LinuxDialogClient& client) const {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  return !suspended() && Authorized(client);
}

bool LinuxDialogController::Identify(const LinuxDialogClient& client,
                                     base::DictValue* identity) const {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!Admits(client)) return false;
  identity->Set("windowId", window_id_);
  identity->Set("rendererGeneration", generation_);
  return true;
}

bool LinuxDialogController::ReplaceRenderer(const std::string& generation) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!parent_alive_ || canceling_ || renderer_history_exhausted_ || !Generation(generation)) return false;
  if (generation == generation_) return true;
  if (retired_generations_.contains(generation)) return false;
  const std::string incoming = generation;
  if (!generation_.empty()) {
    if (retired_generations_.size() >= kMaxRetiredGenerations) renderer_history_exhausted_ = true;
    else retired_generations_.insert(generation_);
  }
  generation_.clear();
  auto weak = GetWeakPtr();
  CancelAll();
  if (!weak || !weak->parent_alive_ || weak->renderer_history_exhausted_ || !weak->generation_.empty()) return false;
  weak->generation_ = incoming;
  return true;
}

bool LinuxDialogController::Begin(const LinuxDialogClient& client,
    const base::DictValue& request, LinuxDialogCompletion completion,
    std::string* error) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  LinuxDialogSpec spec;
  if (!Authorized(client)) { *error = "Dialog requester is not current"; return false; }
  if (suspended()) { *error = "Dialogs are suspended for this window"; return false; }
  if (!completion || !Parse(request, window_id_, &spec)) { *error = "Invalid dialog request"; return false; }
  if (entries_.contains(spec.dialog_id)) { *error = "Dialog is already pending"; return false; }
  if (entries_.size() >= kMaxPending || sequence_ == std::numeric_limits<uint64_t>::max()) {
    *error = "Dialog queue is full";
    return false;
  }
  const std::string id = spec.dialog_id;
  entries_.emplace(id, Entry{std::move(spec), generation_, ++sequence_, std::move(completion)});
  Pump();
  return true;
}

bool LinuxDialogController::Cancel(const LinuxDialogClient& client,
                                    const std::string& dialog_id) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!Authorized(client) || !Identity(dialog_id)) return false;
  const auto found = entries_.find(dialog_id);
  if (found != entries_.end()) Complete(dialog_id, found->second.sequence, {.forced = true});
  return true;
}

void LinuxDialogController::RetireRenderer(const std::string& generation) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (generation_.empty() || generation != generation_) return;
  if (retired_generations_.size() >= kMaxRetiredGenerations) renderer_history_exhausted_ = true;
  else retired_generations_.insert(generation_);
  generation_.clear();
  CancelAll();
}

void LinuxDialogController::ParentDestroyed() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  parent_alive_ = false;
  generation_.clear();
  CancelAll();
}

LinuxDialogSuspension LinuxDialogController::Suspend() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  uint64_t token = NextSuspension();
  if (!token || suspensions_.size() >= kMaxSuspensions) {
    suspensions_exhausted_ = true;
    token = 0;
  } else {
    suspensions_.insert(token);
  }
  CancelAll();
  return LinuxDialogSuspension(token);
}

bool LinuxDialogController::Resume(const LinuxDialogSuspension& suspension) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  return suspension && suspensions_.erase(suspension.value_) == 1;
}

void LinuxDialogController::CancelAll() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (canceling_) return;
  canceling_ = true;
  auto weak = GetWeakPtr();
  while (weak && !weak->entries_.empty()) {
    const auto& [id, entry] = *weak->entries_.begin();
    weak->Complete(id, entry.sequence, {.forced = true});
  }
  if (weak) weak->canceling_ = false;
}

void LinuxDialogController::Pump() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (pumping_ || active_sequence_ || suspended() || generation_.empty() || !parent_alive_) return;
  pumping_ = true;
  auto weak = GetWeakPtr();
  while (weak && !weak->entries_.empty() && !weak->active_sequence_ && !weak->suspended() &&
         !weak->generation_.empty() && weak->parent_alive_) {
    auto next = std::min_element(weak->entries_.begin(), weak->entries_.end(),
        [](const auto& a, const auto& b) { return a.second.sequence < b.second.sequence; });
    const auto spec = next->second.spec;
    const auto sequence = next->second.sequence;
    weak->active_sequence_ = sequence;
    auto presenter = weak->presenter_;
    auto surface = presenter.Run(spec, base::BindOnce(
        &LinuxDialogController::Complete, weak, spec.dialog_id, sequence));
    if (!weak) return;
    if (weak->active_sequence_ == sequence) {
      if (surface) weak->surface_ = std::move(surface);
      else weak->Complete(spec.dialog_id, sequence, {.forced = true});
    }
  }
  if (weak) weak->pumping_ = false;
}

void LinuxDialogController::Complete(std::string id, uint64_t sequence,
                                      LinuxDialogResponse response) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  const auto found = entries_.find(id);
  if (found == entries_.end() || found->second.sequence != sequence) return;
  auto entry = std::move(found->second);
  entries_.erase(found);
  const auto window = window_id_;
  const bool was_pumping = pumping_;
  pumping_ = true;
  if (active_sequence_ == sequence) {
    active_sequence_ = 0;
    surface_.reset();
  }
  auto weak = GetWeakPtr();
  std::move(entry.completion).Run(Resolved(window, entry.generation, entry.spec, std::move(response)));
  if (!weak) return;
  weak->pumping_ = was_pumping;
  if (!was_pumping) weak->Pump();
}

}
