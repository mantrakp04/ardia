#include "ardia/linux/ac_linux_documents.h"

#include <algorithm>
#include <limits>
#include <utility>

#include "ardia/linux/ac_linux_document_reducer.h"
#include "base/json/json_writer.h"

namespace ardia {
namespace {

LinuxDocumentResult Error(std::string code, std::string message) {
  return {std::move(code), std::move(message), {}};
}

bool Fits(const base::DictValue& value) {
  auto json = base::WriteJsonWithOptions(
      value, base::OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION, 48);
  return json && json->size() <= kLinuxLiveMaxBytes;
}

}

LinuxDocuments::LinuxDocuments(std::string scope, std::string epoch,
                               Read read, Write write)
    : scope_(std::move(scope)), epoch_(std::move(epoch)),
      read_(std::move(read)), write_(std::move(write)) {}

bool LinuxDocuments::Reserved(std::string_view name) {
  return name == kLinuxLiveDocument || name == kLinuxLiveEnvelope;
}

bool LinuxDocuments::Authorized(const LinuxDocumentClient& client) const {
  return client.privileged && client.regular && !client.id.empty() &&
         client.id.size() <= 128 && client.scope == scope_;
}

LinuxDocumentResult LinuxDocuments::Load() {
  if (loaded_) return {};
  auto stored = read_(kLinuxLiveEnvelope);
  if (stored.state == LinuxDocumentRead::State::kError)
    return Error("ERR_DOCUMENT_STORAGE", "Cannot read canonical document");
  if (stored.state == LinuxDocumentRead::State::kFound) {
    auto next = stored.value.Clone();
    if (const auto* payload = next.FindDict("payload"))
      if (auto current = NormalizeLinuxLive(*payload)) next.Set("payload", std::move(*current));
    if (!ValidLinuxLiveEnvelope(next) || !Fits(next))
      return Error("ERR_DOCUMENT_DATA", "Invalid canonical document");
    next.Set("epoch", epoch_);
    auto generations = next.FindDict("generations")->Clone();
    for (const auto& [id, owner] : *next.FindDict("owners"))
      if (!AdvanceLinuxLiveGeneration(generations, id))
        return Error("ERR_DOCUMENT_LIMIT", "Document generation exhausted");
    next.Set("generations", std::move(generations));
    next.Set("owners", base::DictValue());
    if (!ValidLinuxLiveEnvelope(next)) return Error("ERR_DOCUMENT_DATA", "Invalid document recovery");
    if (!write_(next)) return Error("ERR_DOCUMENT_STORAGE", "Cannot recover document authority");
    envelope_ = std::move(next);
    loaded_ = true;
    return {};
  }
  auto legacy = read_(kLinuxLiveDocument);
  if (legacy.state == LinuxDocumentRead::State::kError)
    return Error("ERR_DOCUMENT_STORAGE", "Cannot read legacy document");
  auto payload = NormalizeLinuxLive(legacy.value);
  if (!payload) payload = NormalizeLinuxLive(base::DictValue());
  base::DictValue envelope;
  envelope.Set("format", base::Value(1));
  envelope.Set("epoch", epoch_);
  envelope.Set("revision", base::Value(0));
  envelope.Set("payload", std::move(*payload));
  base::DictValue incarnations;
  const auto* folders = envelope.FindDict("payload")->FindDict("folders");
  for (const auto& [id, folder] : *folders) incarnations.Set(id, "folder:" + std::string(id));
  envelope.Set("incarnations", std::move(incarnations));
  envelope.Set("tombstones", base::DictValue());
  envelope.Set("generations", base::DictValue());
  envelope.Set("owners", base::DictValue());
  envelope.Set("clients", base::DictValue());
  if (!ValidLinuxLiveEnvelope(envelope) || !Fits(envelope) || !write_(envelope))
    return Error("ERR_DOCUMENT_STORAGE", "Cannot initialize canonical document");
  envelope_ = std::move(envelope);
  loaded_ = true;
  return {};
}

LinuxDocumentResult LinuxDocuments::ReadCurrent() {
  auto stored = read_(kLinuxLiveEnvelope);
  if (stored.state != LinuxDocumentRead::State::kFound)
    return Error("ERR_DOCUMENT_STORAGE", "Canonical document is unavailable");
  if (!ValidLinuxLiveEnvelope(stored.value) || !Fits(stored.value) ||
      *stored.value.FindString("epoch") != *envelope_.FindString("epoch") ||
      LinuxDocumentInteger(stored.value, "revision") < LinuxDocumentInteger(envelope_, "revision"))
    return Error("ERR_DOCUMENT_DATA", "Canonical document authority changed");
  envelope_ = std::move(stored.value);
  return {};
}

base::DictValue LinuxDocuments::Snapshot(const std::string& client) const {
  base::DictValue value;
  value.Set("document", kLinuxLiveDocument);
  value.Set("scope", scope_);
  value.Set("clientId", client);
  value.Set("epoch", *envelope_.FindString("epoch"));
  for (auto key : {"revision", "payload", "incarnations", "generations"})
    value.Set(key, envelope_.Find(key)->Clone());
  const auto* receipt = envelope_.FindDict("clients")->FindDict(client);
  value.Set("watermark", base::Value(receipt ? LinuxDocumentInteger(*receipt, "sequence", 0) : 0));
  return value;
}

LinuxDocumentResult LinuxDocuments::Watch(const LinuxDocumentClient& client,
                                         Changed changed) {
  if (!Authorized(client)) return Error("ERR_DOCUMENT_AUTH", "Document access denied");
  if (!watchers_.contains(client.id) && watchers_.size() >= 64)
    return Error("ERR_DOCUMENT_LIMIT", "Too many document subscriptions");
  watchers_.insert_or_assign(client.id, std::move(changed));
  auto result = Load();
  if (!result.ok()) { watchers_.erase(client.id); return result; }
  result.value = Snapshot(client.id);
  return result;
}

LinuxDocumentResult LinuxDocuments::CommitAccess(
    const LinuxDocumentClient& client) const {
  if (!Authorized(client) || !watchers_.contains(client.id))
    return Error("ERR_DOCUMENT_AUTH", "Document subscription required");
  if (generation_exhausted_) return Error("ERR_DOCUMENT_LIMIT", "Document generation exhausted");
  if (seals_.contains(client.id)) return Error("ERR_DOCUMENT_CLOSING", "Document client is sealed for close");
  return {};
}

LinuxDocuments::CommitPreparation LinuxDocuments::PrepareCommit(
    const LinuxDocumentClient& client, const base::DictValue& request) const {
  auto access = CommitAccess(client);
  if (!access.ok()) return {std::move(access)};
  const auto* document = request.FindString("document");
  const auto* epoch = request.FindString("epoch");
  const auto* request_id = request.FindString("requestId");
  const auto* operations = request.Find("operations");
  int observed = LinuxDocumentInteger(request, "observedRevision");
  if (request.size() != 5 || !document || *document != kLinuxLiveDocument ||
      !epoch || !request_id || !operations || !operations->is_list() ||
      operations->GetList().size() == 0 ||
      operations->GetList().size() > kLinuxLiveMaxOperations ||
      observed < 0 || !Fits(request) || !ValidLinuxLiveOperations(operations->GetList()))
    return {Error("ERR_DOCUMENT_REQUEST", "Invalid document commit")};
  if (*epoch != *envelope_.FindString("epoch"))
    return {Error("ERR_DOCUMENT_EPOCH", "Document authority requires reconnect")};
  const auto* clients = envelope_.FindDict("clients");
  const auto* receipt = clients->FindDict(client.id);
  const int accepted = receipt ? LinuxDocumentInteger(*receipt, "sequence", 0) : 0;
  const std::string expected_id = client.id + ":" + std::to_string(accepted + 1);
  bool duplicate = receipt && receipt->FindString("requestId") &&
                   *receipt->FindString("requestId") == *request_id;
  if (!duplicate && accepted >= 2147483000) return {Error("ERR_DOCUMENT_LIMIT", "Document request sequence exhausted")};
  if (duplicate && *receipt->Find("operations") != *operations)
    return {Error("ERR_DOCUMENT_REQUEST", "Request identity was reused")};
  if (!duplicate && *request_id != expected_id)
    return {Error("ERR_DOCUMENT_REQUEST", "Request sequence is not current")};
  base::DictValue next = envelope_.Clone();
  bool superseded = false;
  if (!duplicate) {
    auto owners = next.FindDict("owners")->Clone();
    auto generations = next.FindDict("generations")->Clone();
    for (const auto& [id, owner] : *next.FindDict("owners")) {
      const auto retired = retired_generations_.find(std::string(id));
      const int generation = LinuxDocumentInteger(generations, id, 0);
      if (watchers_.contains(owner.GetString()) && !retired_clients_.contains(owner.GetString()) &&
          (retired == retired_generations_.end() || retired->second <= generation)) continue;
      owners.Remove(id);
      if (!AdvanceLinuxLiveGeneration(generations, id,
          retired == retired_generations_.end() ? 0 : retired->second))
        return {Error("ERR_DOCUMENT_LIMIT", "Document generation exhausted")};
    }
    next.Set("owners", std::move(owners));
    next.Set("generations", std::move(generations));
    if (LinuxDocumentInteger(envelope_, "revision") == std::numeric_limits<int>::max())
      return {Error("ERR_DOCUMENT_LIMIT", "Document revision exhausted")};
    auto outcome = ApplyLinuxLiveOperations(next, operations->GetList(), client.id, observed);
    superseded = outcome == "superseded";
    if (outcome == "limit") return {Error("ERR_DOCUMENT_LIMIT", "Document generation exhausted")};
    if (outcome == "invalid") return {Error("ERR_DOCUMENT_REQUEST", "Invalid document operations")};
    if (outcome == "conflict" || outcome == "notOwner") {
      base::DictValue value;
      value.Set("status", "conflict");
      if (outcome == "notOwner" && operations->GetList().size() == 1) value.Set("reason", "notOwner");
      value.Set("requestId", *request_id);
      value.Set("snapshot", Snapshot(client.id));
      return {LinuxDocumentResult{{}, {}, std::move(value)}};
    }
    base::DictValue receipt_value;
    receipt_value.Set("sequence", base::Value(accepted + 1));
    receipt_value.Set("requestId", *request_id);
    receipt_value.Set("operations", operations->Clone());
    auto next_clients = clients->Clone();
    if (!receipt && next_clients.size() >= 256)
      return {Error("ERR_DOCUMENT_LIMIT", "Document client history is full")};
    next_clients.Set(client.id, std::move(receipt_value));
    next.Set("clients", std::move(next_clients));
    next.Set("revision", base::Value(LinuxDocumentInteger(envelope_, "revision") + 1));
    if (!ValidLinuxLiveEnvelope(next)) return {Error("ERR_DOCUMENT_REQUEST", "Invalid document operations")};
    if (!Fits(next)) return {Error("ERR_DOCUMENT_LIMIT", "Document storage limit reached")};
  }
  return {{}, std::move(next), true, duplicate, superseded};
}

LinuxDocumentResult LinuxDocuments::Commit(const LinuxDocumentClient& client,
                                           const base::DictValue& request) {
  auto access = CommitAccess(client);
  if (!access.ok()) return access;
  auto current = ReadCurrent();
  if (!current.ok()) return current;
  auto prepared = PrepareCommit(client, request);
  if (!prepared.admitted) return std::move(prepared.result);
  if (!prepared.duplicate) {
    if (!write_(prepared.next)) return Error("ERR_DOCUMENT_STORAGE", "Cannot persist document commit");
    envelope_ = std::move(prepared.next);
    retired_clients_.clear();
  }
  const auto* request_id = request.FindString("requestId");
  base::DictValue value;
  value.Set("status", "committed");
  value.Set("superseded", base::Value(prepared.superseded));
  value.Set("requestId", *request_id);
  value.Set("snapshot", Snapshot(client.id));
  if (!prepared.duplicate) {
    for (const auto& [id, changed] : watchers_) {
      base::DictValue event;
      event.Set("snapshot", Snapshot(id));
      event.Set("clientId", client.id);
      event.Set("requestId", *request_id);
      changed(std::move(event));
    }
  }
  return {{}, {}, std::move(value)};
}

LinuxDocumentResult LinuxDocuments::Flush(const LinuxDocumentClient& client,
                                          const base::DictValue& request) {
  if (!Authorized(client) || !watchers_.contains(client.id))
    return Error("ERR_DOCUMENT_AUTH", "Document subscription required");
  auto current = ReadCurrent();
  if (!current.ok()) return current;
  auto document = request.FindString("document");
  auto epoch = request.FindString("epoch");
  int watermark = LinuxDocumentInteger(request, "watermark");
  if (request.size() != 3 || !document || *document != kLinuxLiveDocument ||
      !epoch || *epoch != *envelope_.FindString("epoch") || watermark < 0)
    return Error("ERR_DOCUMENT_REQUEST", "Invalid document flush");
  const auto* receipt = envelope_.FindDict("clients")->FindDict(client.id);
  int accepted = receipt ? LinuxDocumentInteger(*receipt, "sequence", 0) : 0;
  if (watermark > accepted)
    return Error("ERR_DOCUMENT_WATERMARK", "Document watermark is not durable");
  return {{}, {}, Snapshot(client.id)};
}

void LinuxDocuments::Unwatch(const LinuxDocumentClient& client) {
  if (!Authorized(client)) return;
  watchers_.erase(client.id);
  if (!loaded_) return;
  retired_clients_.insert(client.id);
  if (!ReadCurrent().ok()) return;
  auto next = envelope_.Clone();
  auto owners = next.FindDict("owners")->Clone();
  auto generations = next.FindDict("generations")->Clone();
  for (const auto& [id, owner] : *envelope_.FindDict("owners")) {
    if (owner.GetString() != client.id) continue;
    owners.Remove(id);
    auto& retired = retired_generations_[std::string(id)];
    const int previous = std::max(retired, LinuxDocumentInteger(generations, id, 0));
    if (previous >= kLinuxLiveMaxGeneration) { generation_exhausted_ = true; return; }
    retired = previous + 1;
    if (!AdvanceLinuxLiveGeneration(generations, id, retired)) { generation_exhausted_ = true; return; }
  }
  next.Set("owners", std::move(owners));
  next.Set("generations", std::move(generations));
  if (ValidLinuxLiveEnvelope(next) && Fits(next) && write_(next)) { envelope_ = std::move(next); retired_clients_.erase(client.id); }
}

LinuxDocumentResult LinuxDocuments::Seal(const LinuxDocumentClient& client,
                                        const std::string& close_generation,
                                        int watermark) {
  if (!Authorized(client) || !watchers_.contains(client.id))
    return Error("ERR_DOCUMENT_AUTH", "Document subscription required");
  auto current = ReadCurrent();
  if (!current.ok()) return current;
  if (close_generation.empty() || close_generation.size() > 128 || watermark < 0)
    return Error("ERR_DOCUMENT_REQUEST", "Invalid close generation");
  auto sealed = seals_.find(client.id);
  if (sealed != seals_.end()) {
    if (sealed->second != std::make_pair(close_generation, watermark))
      return Error("ERR_DOCUMENT_CLOSING", "Another close generation is sealed");
    return {{}, {}, Snapshot(client.id)};
  }
  const auto* receipt = envelope_.FindDict("clients")->FindDict(client.id);
  int accepted = receipt ? LinuxDocumentInteger(*receipt, "sequence", 0) : 0;
  if (accepted != watermark)
    return Error("ERR_DOCUMENT_WATERMARK", "Final watermark does not match durable work");
  seals_.emplace(client.id, std::make_pair(close_generation, watermark));
  return {{}, {}, Snapshot(client.id)};
}

LinuxDocumentResult LinuxDocuments::CancelSeal(const LinuxDocumentClient& client,
                                              const std::string& close_generation) {
  if (!Authorized(client)) return Error("ERR_DOCUMENT_AUTH", "Document access denied");
  auto sealed = seals_.find(client.id);
  if (sealed == seals_.end()) return {};
  if (sealed->second.first != close_generation)
    return Error("ERR_DOCUMENT_CLOSING", "Close generation does not match");
  seals_.erase(sealed);
  return {};
}

}
