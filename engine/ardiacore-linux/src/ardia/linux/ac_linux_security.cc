#include "ardia/linux/ac_linux_security.h"

#include <utility>

#include "base/strings/string_number_conversions.h"
#include "components/security_state/content/content_utils.h"
#include "components/security_state/core/security_state.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "net/cert/cert_status_flags.h"
#include "net/cert/x509_certificate.h"
#include "net/ssl/ssl_connection_status_flags.h"
#include "url/origin.h"

namespace ardiacore {
namespace {

base::DictValue Principal(const net::CertPrincipal& principal) {
  base::ListValue organizations;
  for (const auto& organization : principal.organization_names)
    organizations.Append(organization);
  return base::DictValue().Set("commonName", principal.common_name)
      .Set("displayName", principal.GetDisplayName())
      .Set("organizations", std::move(organizations)).Set("country", principal.country_name);
}

base::DictValue Certificate(const net::X509Certificate& certificate) {
  auto result = base::DictValue().Set("subject", Principal(certificate.subject()))
      .Set("issuer", Principal(certificate.issuer()))
      .Set("validFrom", certificate.valid_start().InMillisecondsFSinceUnixEpoch())
      .Set("validUntil", certificate.valid_expiry().InMillisecondsFSinceUnixEpoch())
      .Set("chainLength", static_cast<int>(certificate.intermediate_buffers().size() + 1));
  if (!certificate.serial_number().empty())
    result.Set("serialNumber", base::HexEncode(certificate.serial_number()));
  result.Set("sha256", base::HexEncode(net::X509Certificate::CalculateFingerprint256(certificate.cert_buffer())));
  return result;
}

base::ListValue Errors(net::CertStatus status) {
  constexpr std::pair<net::CertStatus, const char*> names[] = {
      {net::CERT_STATUS_COMMON_NAME_INVALID, "nameMismatch"},
      {net::CERT_STATUS_DATE_INVALID, "dateInvalid"},
      {net::CERT_STATUS_AUTHORITY_INVALID, "authorityInvalid"},
      {net::CERT_STATUS_REVOKED, "revoked"},
      {net::CERT_STATUS_INVALID, "invalid"},
      {net::CERT_STATUS_WEAK_SIGNATURE_ALGORITHM, "weakSignature"},
      {net::CERT_STATUS_NON_UNIQUE_NAME, "nonUniqueName"},
      {net::CERT_STATUS_WEAK_KEY, "weakKey"},
      {net::CERT_STATUS_PINNED_KEY_MISSING, "pinnedKeyMissing"},
      {net::CERT_STATUS_NAME_CONSTRAINT_VIOLATION, "nameConstraint"},
      {net::CERT_STATUS_VALIDITY_TOO_LONG, "validityTooLong"},
      {net::CERT_STATUS_CERTIFICATE_TRANSPARENCY_REQUIRED, "certificateTransparency"}};
  base::ListValue result;
  for (const auto& [flag, name] : names) if (status & flag) result.Append(name);
  return result;
}

std::string Protocol(int status) {
  switch (net::SSLConnectionStatusToVersion(status)) {
    case net::SSL_CONNECTION_VERSION_TLS1: return "TLS 1.0";
    case net::SSL_CONNECTION_VERSION_TLS1_1: return "TLS 1.1";
    case net::SSL_CONNECTION_VERSION_TLS1_2: return "TLS 1.2";
    case net::SSL_CONNECTION_VERSION_TLS1_3: return "TLS 1.3";
    case net::SSL_CONNECTION_VERSION_QUIC: return "QUIC";
    default: return {};
  }
}

}

LinuxSecurity::LinuxSecurity(base::WeakPtr<LinuxPageLease> lease)
    : content::WebContentsObserver(lease ? lease->observed_contents() : nullptr), lease_(lease) {}

LinuxSecurity::~LinuxSecurity() { Reset(); }

base::DictValue LinuxSecurity::Snapshot() const {
  auto* contents = lease_ ? lease_->contents() : nullptr;
  auto* entry = contents ? contents->GetController().GetLastCommittedEntry() : nullptr;
  GURL url = entry ? entry->GetURL() : GURL();
  auto result = base::DictValue().Set("level", "none").Set("url", url.spec())
      .Set("origin", base::Value());
  if (!entry || entry->IsInitialEntry() || !url.is_valid()) return result;
  if (url.SchemeIsHTTPOrHTTPS()) result.Set("origin", url::Origin::Create(url).Serialize());
  if (url.SchemeIs("http")) { result.Set("level", "insecure"); return result; }
  if (url.SchemeIs("file") || url.SchemeIs("chrome") || url.SchemeIs("chrome-untrusted") ||
      url.SchemeIs("devtools")) { result.Set("level", "local"); return result; }
  if (!url.SchemeIs("https") || contents->GetController().GetVisibleEntry() != entry) return result;
  auto state = security_state::GetVisibleSecurityState(contents);
  if (!state || !state->connection_info_initialized) return result;
  constexpr auto mask = net::CERT_STATUS_ALL_ERRORS &
      ~(net::CERT_STATUS_NO_REVOCATION_MECHANISM | net::CERT_STATUS_UNABLE_TO_CHECK_REVOCATION);
  const auto errors = state->cert_status & mask;
  const bool ran = state->ran_mixed_content || state->ran_content_with_cert_errors;
  const bool displayed = state->displayed_mixed_content || state->displayed_content_with_cert_errors || state->contained_mixed_form;
  const char* level = errors ? "certificateError" : ran || displayed ? "mixed" :
      state->certificate && !state->is_error_page ? "secure" : "none";
  result.Set("level", level);
  result.Set("certificateErrors", Errors(errors));
  result.Set("mixedContent", ran ? base::Value("ran") : displayed ? base::Value("displayed") : base::Value());
  result.Set("isEV", (state->cert_status & net::CERT_STATUS_IS_EV) != 0);
  auto protocol = Protocol(state->connection_status);
  if (!protocol.empty()) result.Set("protocol", std::move(protocol));
  if (state->certificate) result.Set("certificate", Certificate(*state->certificate));
  return result;
}

bool LinuxSecurity::Emit() {
  auto request = lease_ ? lease_->Capture() : std::nullopt;
  if (!request) return false;
  auto snapshot = Snapshot();
  return request->lease && request->lease->Emit(*request, "security", base::Value(std::move(snapshot)));
}

void LinuxSecurity::Reset() { lease_.reset(); Observe(nullptr); }
void LinuxSecurity::DidChangeVisibleSecurityState() { Emit(); }
void LinuxSecurity::WebContentsDestroyed() { Reset(); }

}
