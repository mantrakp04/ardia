#include "ardia/linux/ac_linux_document_service.h"

#include <utility>

namespace ardia {

LinuxDocumentService::LinuxDocumentService(
    std::string scope, std::string epoch, LinuxDocuments::Read read,
    LinuxDocuments::Write write)
    : scope_(scope),
      documents_(std::move(scope), std::move(epoch),
          [this, read = std::move(read)](std::string_view name) {
            if (tracking_ && name == kLinuxLiveEnvelope) read_attempted_ = true;
            return read(name);
          },
          [this, write = std::move(write)](const base::DictValue& envelope) {
            const bool ok = write(envelope);
            if (tracking_) {
              if (ok) written_envelope_ = envelope.Clone();
              else write_failed_ = true;
            }
            return ok;
          }) {}

LinuxDocumentDispatchResult LinuxDocumentService::DispatchTracked(
    std::string verb, LinuxDocumentClient client, base::DictValue request,
    LinuxDocuments::Changed changed) {
  if (verb != "commit") return {Dispatch(std::move(verb), std::move(client),
                                         std::move(request), std::move(changed))};
  tracking_ = true;
  read_attempted_ = false;
  write_failed_ = false;
  written_envelope_.reset();
  auto result = Dispatch(verb, client, request.Clone(), std::move(changed));
  tracking_ = false;
  LinuxDocumentDurability durability = LinuxDocumentDurability::kUnchanged;
  if ((result.code == "ERR_DOCUMENT_STORAGE" || result.code == "ERR_DOCUMENT_DATA") &&
      (write_failed_ || read_attempted_) &&
      documents_.PrepareCommit(client, request).admitted)
    durability = LinuxDocumentDurability::kFailed;
  const auto* status = result.value.FindString("status");
  const auto* superseded = result.value.Find("superseded");
  if (result.ok() && status && *status == "committed" && superseded &&
      superseded->is_bool() && !superseded->GetBool() && written_envelope_) {
    const auto* receipt = written_envelope_->FindDict("clients")->FindDict(client.id);
    if (receipt && receipt->Find("operations") && request.Find("operations") &&
        written_envelope_->FindString("epoch") && request.FindString("epoch") &&
        *written_envelope_->FindString("epoch") == *request.FindString("epoch") &&
        receipt->FindString("requestId") && request.FindString("requestId") &&
        *receipt->FindString("requestId") == *request.FindString("requestId") &&
        *receipt->Find("operations") == *request.Find("operations"))
      durability = LinuxDocumentDurability::kCommitted;
  }
  written_envelope_.reset();
  return {std::move(result), durability};
}

LinuxDocumentResult LinuxDocumentService::Dispatch(
    std::string verb, LinuxDocumentClient client, base::DictValue request,
    LinuxDocuments::Changed changed) {
  if (!client.privileged || !client.regular || client.scope != scope_ ||
      client.id.empty() || client.id.size() > 128)
    return {"ERR_DOCUMENT_AUTH", "Document access denied", {}};
  if (verb == "commit") return documents_.Commit(client, request);
  if (verb == "flush") return documents_.Flush(client, request);
  if (verb != "watch" && verb != "unwatch")
    return {"ERR_UNKNOWN_CALL", "Unknown document operation", {}};
  const auto* document = request.FindString("document");
  if (request.size() != 1 || !document || *document != kLinuxLiveDocument)
    return {"ERR_DOCUMENT_REQUEST", "Invalid document subscription", {}};
  if (verb == "watch") return documents_.Watch(client, std::move(changed));
  documents_.Unwatch(client);
  return {};
}

LinuxDocumentResult LinuxDocumentService::Seal(
    LinuxDocumentClient client, std::string close_generation, int watermark,
    bool used_documents) {
  if (!client.privileged || !client.regular || client.scope != scope_ ||
      client.id.empty() || client.id.size() > 128)
    return {"ERR_DOCUMENT_AUTH", "Document access denied", {}};
  if (!used_documents) {
    if (watermark != 0)
      return {"ERR_DOCUMENT_WATERMARK", "Window has no document watermark", {}};
    return {};
  }
  return documents_.Seal(client, close_generation, watermark);
}

LinuxDocumentResult LinuxDocumentService::CancelSeal(
    LinuxDocumentClient client, std::string close_generation) {
  return documents_.CancelSeal(client, close_generation);
}

void LinuxDocumentService::Retire(LinuxDocumentClient client) {
  if (!client.privileged || !client.regular || client.scope != scope_) return;
  documents_.Unwatch(client);
}

}
