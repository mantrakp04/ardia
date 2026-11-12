// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_engine.h"

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/net/dns_probe_runner.h"
#include "chrome/browser/net/secure_dns_config.h"
#include "chrome/browser/net/secure_dns_util.h"
#include "chrome/browser/net/stub_resolver_config_reader.h"
#include "chrome/browser/net/system_network_context_manager.h"
#include "chrome/common/pref_names.h"
#include "components/country_codes/country_codes.h"
#include "components/prefs/pref_change_registrar.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/storage_partition.h"
#include "net/dns/public/dns_over_https_config.h"
#include "net/dns/public/doh_provider_entry.h"
#include "net/dns/public/secure_dns_mode.h"
#include "services/network/public/mojom/network_context.mojom.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace ardia {
namespace {

namespace secure_dns = chrome_browser_net::secure_dns;
using ProbeResult = chrome_browser_net::DnsProbeRunner::Result;

constexpr char kTopic[] = "secureDns";
constexpr size_t kMaxTemplatesBytes = 4096;
constexpr bool kCheckParentalControlsNow = true;
constexpr base::TimeDelta kProbeDeadline = base::Seconds(15);
constexpr char kHeliumSubstitutedDomain[] = "qjz9zk";

PrefService* LocalState() {
  return g_browser_process && SystemNetworkContextManager::GetInstance()
             ? g_browser_process->local_state()
             : nullptr;
}

SecureDnsConfig EffectiveConfig() {
  return SystemNetworkContextManager::GetStubResolverConfigReader()
      ->GetSecureDnsConfiguration(kCheckParentalControlsNow);
}

bool Enforced(PrefService* local_state, const char* name) {
  const PrefService::Preference* pref = local_state->FindPreference(name);
  return !pref || pref->IsManaged() || !pref->IsUserModifiable();
}

bool SetByPolicy(PrefService* local_state) {
  return Enforced(local_state, prefs::kDnsOverHttpsMode) ||
         Enforced(local_state, prefs::kDnsOverHttpsTemplates);
}

bool Locked(PrefService* local_state, SecureDnsConfig& config) {
  return SetByPolicy(local_state) ||
         config.management_mode() !=
             SecureDnsConfig::ManagementMode::kNoOverride;
}

const char* OverrideName(SecureDnsConfig::ManagementMode mode) {
  switch (mode) {
    case SecureDnsConfig::ManagementMode::kDisabledManaged:
      return "managed";
    case SecureDnsConfig::ManagementMode::kDisabledParentalControls:
      return "parentalControls";
    case SecureDnsConfig::ManagementMode::kNoOverride:
      return "none";
  }
  return "none";
}

const char* ProbeResultName(ProbeResult result) {
  switch (result) {
    case ProbeResult::CORRECT:
      return "correct";
    case ProbeResult::INCORRECT:
      return "incorrect";
    case ProbeResult::FAILING:
      return "failing";
    case ProbeResult::UNREACHABLE:
      return "unreachable";
    case ProbeResult::UNKNOWN:
      return "unknown";
  }
  return "unknown";
}

std::optional<net::DnsOverHttpsConfig> ParseTemplates(std::string_view text) {
  if (text.size() > kMaxTemplatesBytes) {
    return std::nullopt;
  }
  std::optional<net::DnsOverHttpsConfig> config =
      net::DnsOverHttpsConfig::FromString(text);
  if (!config || config->servers().empty()) {
    return std::nullopt;
  }
  return config;
}

std::string OpenablePrivacyPolicy(std::string_view url) {
  GURL policy(url);
  return policy.SchemeIs(url::kHttpsScheme) &&
                 !policy.DomainIs(kHeliumSubstitutedDomain)
             ? policy.spec()
             : std::string();
}

base::ListValue Providers() {
  base::ListValue providers;
  for (const net::DohProviderEntry* entry :
       secure_dns::SelectEnabledProviders(secure_dns::ProvidersForCountry(
           net::DohProviderEntry::GetList(),
           country_codes::GetCurrentCountryID()))) {
    providers.Append(
        base::DictValue()
            .Set("id", entry->provider)
            .Set("name", entry->ui_name)
            .Set("templates",
                 net::DnsOverHttpsConfig({entry->doh_server_config}).ToString())
            .Set("privacyPolicy",
                 OpenablePrivacyPolicy(entry->privacy_policy)));
  }
  return providers;
}

base::DictValue State(PrefService* local_state) {
  SecureDnsConfig config = EffectiveConfig();
  return base::DictValue()
      .Set("prefMode", local_state->GetString(prefs::kDnsOverHttpsMode))
      .Set("prefTemplates",
           net::DnsOverHttpsConfig::FromStringLax(
               local_state->GetString(prefs::kDnsOverHttpsTemplates))
               .ToString())
      .Set("effectiveMode", SecureDnsConfig::ModeToString(config.mode()))
      .Set("effectiveTemplates", config.doh_servers().ToString())
      .Set("policy", SetByPolicy(local_state))
      .Set("override", OverrideName(config.management_mode()))
      .Set("providers", Providers());
}

std::optional<std::string> Apply(PrefService* local_state,
                                 std::string_view mode_name,
                                 std::string_view templates) {
  SecureDnsConfig config = EffectiveConfig();
  if (Locked(local_state, config)) {
    return "secure DNS is locked on this Mac";
  }
  const std::optional<net::SecureDnsMode> mode =
      SecureDnsConfig::ParseMode(mode_name);
  if (!mode) {
    return "mode is off, automatic or secure";
  }
  if (*mode != net::SecureDnsMode::kSecure) {
    local_state->SetString(prefs::kDnsOverHttpsMode,
                           SecureDnsConfig::ModeToString(*mode));
    local_state->SetString(prefs::kDnsOverHttpsTemplates, std::string());
    return std::nullopt;
  }
  const std::optional<net::DnsOverHttpsConfig> parsed =
      ParseTemplates(templates);
  if (!parsed) {
    return "templates aren't a valid DNS-over-HTTPS address";
  }
  local_state->SetString(prefs::kDnsOverHttpsTemplates, parsed->ToString());
  local_state->SetString(prefs::kDnsOverHttpsMode,
                         SecureDnsConfig::kModeSecure);
  return std::nullopt;
}

class SecureDnsWatch : public ProfileState {
 public:
  explicit SecureDnsWatch(Profile* profile) : ProfileState(profile) {}

  void Start(PrefService* local_state) {
    if (!registrar_.IsEmpty()) {
      return;
    }
    registrar_.Init(local_state);
    const base::RepeatingClosure changed = base::BindRepeating(
        &SecureDnsWatch::Changed, weak_factory_.GetWeakPtr());
    registrar_.Add(prefs::kDnsOverHttpsMode, changed);
    registrar_.Add(prefs::kDnsOverHttpsTemplates, changed);
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    registrar_.RemoveAll();
  }

  void Changed() {
    if (pending_) {
      return;
    }
    pending_ = true;
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&SecureDnsWatch::Announce, weak_factory_.GetWeakPtr()));
  }

  void Announce() {
    pending_ = false;
    Emit(kTopic, nullptr, base::DictValue());
  }

  PrefChangeRegistrar registrar_;
  bool pending_ = false;
  base::WeakPtrFactory<SecureDnsWatch> weak_factory_{this};
};

class SecureDnsProbe : public ProfileState {
 public:
  explicit SecureDnsProbe(Profile* profile) : ProfileState(profile) {}

  void Run(net::DnsOverHttpsConfig config, Reply reply) {
    Settle(base::DictValue().Set("cancelled", true));
    reply_.emplace(std::move(reply));
    runner_ = secure_dns::MakeProbeRunner(
        std::move(config),
        base::BindRepeating(&SecureDnsProbe::NetworkContext,
                            base::Unretained(this)));
    deadline_.Start(FROM_HERE, kProbeDeadline,
                    base::BindOnce(&SecureDnsProbe::Settle,
                                   base::Unretained(this),
                                   Outcome(false, "timeout")));
    runner_->RunProbe(
        base::BindOnce(&SecureDnsProbe::Done, base::Unretained(this)));
  }

 private:
  static base::DictValue Outcome(bool ok, std::string_view result) {
    return base::DictValue()
        .Set("valid", true)
        .Set("ok", ok)
        .Set("result", result);
  }

  network::mojom::NetworkContext* NetworkContext() {
    return profile()->GetDefaultStoragePartition()->GetNetworkContext();
  }

  void Settle(base::DictValue outcome) {
    deadline_.Stop();
    runner_.reset();
    if (std::optional<Reply> reply = std::exchange(reply_, std::nullopt)) {
      reply->Send(std::move(outcome));
    }
  }

  void Release() override {
    deadline_.Stop();
    runner_.reset();
    reply_.reset();
  }

  void Done() {
    const ProbeResult result = runner_->result();
    Settle(Outcome(result == ProbeResult::CORRECT, ProbeResultName(result)));
  }

  std::unique_ptr<chrome_browser_net::DnsProbeRunner> runner_;
  std::optional<Reply> reply_;
  base::OneShotTimer deadline_;
};

}
}

AC_PROFILE_CALL(ac_secure_dns) {
  ardia::Reply out = call.TakeReply();
  PrefService* local_state = ardia::LocalState();
  if (!local_state || call.profile()->ShutdownStarted()) {
    return out.Error("no local state");
  }
  ardia::StateFor<ardia::SecureDnsWatch>(call.profile()).Start(local_state);
  if (const std::string* mode = call.args().FindString("mode")) {
    if (std::optional<std::string> problem =
            ardia::Apply(local_state, *mode, call.String("templates"))) {
      return out.Error(*problem);
    }
  }
  out.Send(ardia::State(local_state));
}

AC_PROFILE_CALL(ac_secure_dns_probe) {
  PrefService* local_state = ardia::LocalState();
  if (!local_state || call.profile()->ShutdownStarted()) {
    return call.TakeReply().Error("no local state");
  }
  SecureDnsConfig config = ardia::EffectiveConfig();
  if (ardia::Locked(local_state, config)) {
    return call.TakeReply().Error("secure DNS is locked on this Mac");
  }
  std::optional<net::DnsOverHttpsConfig> parsed =
      ardia::ParseTemplates(call.String("templates"));
  if (!parsed) {
    return call.TakeReply().Send(base::DictValue()
                                     .Set("valid", false)
                                     .Set("ok", false)
                                     .Set("result", "invalid"));
  }
  ardia::StateFor<ardia::SecureDnsProbe>(call.profile())
      .Run(std::move(*parsed), call.TakeReply());
}
