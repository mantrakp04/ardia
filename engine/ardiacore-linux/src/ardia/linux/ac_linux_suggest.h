#ifndef ARDIA_LINUX_AC_LINUX_SUGGEST_H_
#define ARDIA_LINUX_AC_LINUX_SUGGEST_H_

#include <map>
#include <memory>
#include <optional>
#include <string>

#include "ardia/linux/ac_linux_suggest_policy.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/values.h"

class Profile;

namespace ardia::linux_suggest {

using SuggestionReply = base::OnceCallback<void(std::optional<std::string>)>;

class SuggestionFetch;

void NoteSuggestionsSetting(const base::FilePath& profile_path,
                            const base::DictValue& session);

base::OnceCallback<void(bool, base::Value)> NoteSuggestionsOnWrite(
    base::FilePath profile_path, base::OnceCallback<void(bool, base::Value)> done);

bool CanFetchSuggestions(Profile* setting_profile, Profile* network_profile, const std::string& url);

class SuggestionClient {
 public:
  SuggestionClient();
  SuggestionClient(const SuggestionClient&) = delete;
  SuggestionClient& operator=(const SuggestionClient&) = delete;
  ~SuggestionClient();

  void Fetch(Profile* setting_profile, Profile* network_profile, const std::string& id,
             const std::string& url, SuggestionReply reply);
  void Cancel(const std::string& id);

 private:
  friend class SuggestionFetch;
  void Finish(const std::string& id, std::optional<std::string> body);

  ardia::linux_suggest_policy::SuggestionSlots slots_;
  std::map<std::string, std::unique_ptr<SuggestionFetch>> fetches_;
};

}

#endif
