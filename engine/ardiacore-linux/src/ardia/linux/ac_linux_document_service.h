#ifndef ARDIA_LINUX_AC_LINUX_DOCUMENT_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_DOCUMENT_SERVICE_H_

#include <optional>

#include "ardia/linux/ac_linux_documents.h"

namespace ardia {

enum class LinuxDocumentDurability { kUnchanged, kFailed, kCommitted };

struct LinuxDocumentDispatchResult {
  LinuxDocumentResult result;
  LinuxDocumentDurability durability = LinuxDocumentDurability::kUnchanged;
};

class LinuxDocumentService {
 public:
  LinuxDocumentService(std::string scope, std::string epoch,
                       LinuxDocuments::Read read, LinuxDocuments::Write write);
  LinuxDocumentService(const LinuxDocumentService&) = delete;
  LinuxDocumentService& operator=(const LinuxDocumentService&) = delete;
  LinuxDocumentService(LinuxDocumentService&&) = delete;
  LinuxDocumentService& operator=(LinuxDocumentService&&) = delete;
  LinuxDocumentResult Dispatch(std::string verb, LinuxDocumentClient client,
                               base::DictValue request,
                               LinuxDocuments::Changed changed);
  LinuxDocumentDispatchResult DispatchTracked(std::string verb,
                                              LinuxDocumentClient client,
                                              base::DictValue request,
                                              LinuxDocuments::Changed changed);
  LinuxDocumentResult Seal(LinuxDocumentClient client,
                           std::string close_generation, int watermark,
                           bool used_documents);
  LinuxDocumentResult CancelSeal(LinuxDocumentClient client,
                                 std::string close_generation);
  void Retire(LinuxDocumentClient client);

 private:
  const std::string scope_;
  std::optional<base::DictValue> written_envelope_;
  bool tracking_ = false;
  bool read_attempted_ = false;
  bool write_failed_ = false;
  LinuxDocuments documents_;
};

}

#endif
