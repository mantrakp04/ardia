#include "chrome/browser/ardia/ac_engine.h"

#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/shell_integration.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "url/gurl.h"

namespace ardia {
namespace {

constexpr char const* kPairs =
    prefs::kProtocolHandlerPerOriginAllowedProtocols;

base::ListValue ResolveAllowances(base::ListValue allowances) {
  for (base::Value& value : allowances) {
    base::DictValue& allowance = value.GetDict();
    const GURL probe(*allowance.FindString("scheme") + ":");
    const std::u16string app =
        probe.is_valid() ? shell_integration::GetApplicationNameForScheme(probe)
                         : std::u16string();
    const bool identified = !app.empty() && app != u"xdg-open";
    allowance.Set("app", identified ? base::Value(app) : base::Value());
    allowance.Set("icon", base::Value());
  }
  return allowances;
}

}
}

AC_PROFILE_CALL(ac_external_apps_allowances) {
  base::ListValue allowances;
  for (const auto [origin, schemes] :
       call.profile()->GetPrefs()->GetDict(ardia::kPairs)) {
    if (!schemes.is_dict()) {
      continue;
    }
    for (const auto [scheme, allowed] : schemes.GetDict()) {
      if (allowed.is_bool() && allowed.GetBool()) {
        allowances.Append(
            base::DictValue().Set("origin", origin).Set("scheme", scheme));
      }
    }
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce(&ardia::ResolveAllowances, std::move(allowances)),
      base::BindOnce(
          [](ardia::Reply reply, base::ListValue allowances) {
            reply.Send(base::DictValue().Set("allowances", std::move(allowances)));
          },
          call.TakeReply()));
}

AC_PROFILE_CALL(ac_external_apps_remove) {
  const std::string origin = call.String("origin");
  const std::string scheme = call.String("scheme");
  if (origin.empty() || scheme.empty()) {
    return call.TakeReply().Error("origin and scheme required");
  }
  ScopedDictPrefUpdate pairs(call.profile()->GetPrefs(), ardia::kPairs);
  if (base::DictValue* schemes = pairs->FindDict(origin)) {
    schemes->Remove(scheme);
    if (schemes->empty()) {
      pairs->Remove(origin);
    }
  }
  call.TakeReply().Ok();
}
