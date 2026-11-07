#include "ardia/linux/ac_linux_search_engines.h"

#include <map>
#include <memory>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_search_engine_policy.h"
#include "base/callback_list.h"
#include "base/check.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_data.h"
#include "components/search_engines/template_url_service.h"
#include "components/search_engines/template_url_starter_pack_data.h"
#include "content/public/browser/browser_thread.h"
#include "url/gurl.h"

namespace ardiacore {
namespace {

namespace policy = linux_search_engines;

enum class Outcome { kApplied, kQueued, kSkipped, kNoMatch };

class SearchEngineProfiles : public ProfileManagerObserver {
 public:
  std::optional<std::string> Set(policy::Request request) {
    ProfileManager* manager = Manager();
    if (manager && !observation_.IsObserving()) observation_.Observe(manager);
    request_ = std::move(request);
    bool reached = false;
    bool missed = false;
    if (manager) {
      for (Profile* profile : manager->GetLoadedProfiles()) {
        const Outcome outcome = Apply(profile);
        reached = reached || outcome == Outcome::kApplied || outcome == Outcome::kQueued;
        missed = missed || outcome == Outcome::kNoMatch;
      }
    }
    if (missed && !reached) return "No installed search engine named " + request_->name;
    return std::nullopt;
  }

 private:
  static ProfileManager* Manager() {
    return g_browser_process ? g_browser_process->profile_manager() : nullptr;
  }

  static bool Usable(Profile* profile) {
    return profile && profile->IsRegularProfile() && !profile->ShutdownStarted();
  }

  Outcome Apply(Profile* profile) {
    if (!request_ || !Usable(profile)) return Outcome::kSkipped;
    TemplateURLService* service = TemplateURLServiceFactory::GetForProfile(profile);
    if (!service) return Outcome::kSkipped;
    const base::FilePath path = profile->GetPath();
    if (!service->loaded()) {
      waiting_[path] = service->RegisterOnLoadedCallback(
          base::BindOnce(&SearchEngineProfiles::Loaded, base::Unretained(this), path));
      service->Load();
      return Outcome::kQueued;
    }
    waiting_.erase(path);
    return ApplyLoaded(service, *request_);
  }

  void Loaded(base::FilePath path) {
    ProfileManager* manager = Manager();
    Profile* profile = manager ? manager->GetProfileByPath(path) : nullptr;
    if (!Usable(profile)) {
      waiting_.erase(path);
      return;
    }
    Apply(profile);
  }

  static Outcome ApplyLoaded(TemplateURLService* service, const policy::Request& request) {
    if (service->is_default_search_managed() || service->IsExtensionControlledDefaultSearch()) {
      return Outcome::kSkipped;
    }
    const SearchTermsData& terms = service->search_terms_data();
    TemplateURLData desired;
    std::string host;
    if (!request.url.empty()) {
      desired.SetShortName(base::UTF8ToUTF16(request.name));
      desired.SetKeyword(policy::kOwnedEngineKeyword);
      desired.SetURL(policy::ChromeTemplate(request.url));
      desired.sync_guid = policy::kOwnedEngineGuid;
      const GURL search = TemplateURL(desired).GenerateSearchURL(terms);
      if (!search.is_valid() || desired.keyword().empty()) return Outcome::kSkipped;
      host = std::string(search.host());
    }

    std::vector<TemplateURL*> turls;
    std::vector<policy::Engine> engines;
    for (TemplateURL* turl : service->GetTemplateURLs()) {
      const bool normal = turl->type() == TemplateURL::NORMAL;
      const GURL search = turl->GenerateSearchURL(terms);
      turls.push_back(turl);
      engines.push_back(policy::Engine{
          base::UTF16ToUTF8(turl->short_name()),
          std::string(search.host()),
          normal && turl->starter_pack_id() == template_url_starter_pack_data::StarterPackId::kNone &&
              !turl->CreatedByNonDefaultSearchProviderPolicy() && turl->SupportsReplacement(terms),
          normal && turl->sync_guid() == policy::kOwnedEngineGuid,
      });
    }

    bool owned_current = false;
    if (const TemplateURL* owned = service->GetTemplateURLForGUID(policy::kOwnedEngineGuid);
        owned && !request.url.empty()) {
      owned_current = owned->short_name() == desired.short_name() && owned->keyword() == desired.keyword() &&
                      owned->url() == desired.url();
    }

    const policy::Plan plan = policy::Decide(request, host, engines, owned_current);
    switch (plan.step) {
      case policy::Step::kNoMatch:
        return Outcome::kNoMatch;
      case policy::Step::kSelectExisting:
      case policy::Step::kSelectOwned:
        MakeDefault(service, turls[*plan.engine]);
        if (plan.remove_owned) RemoveOwnedUnlessDefault(service);
        return Outcome::kApplied;
      case policy::Step::kUpdateOwned:
        service->ResetTemplateURL(turls[*plan.engine], desired.short_name(), desired.keyword(), desired.url(),
                                  std::string());
        MakeDefault(service, turls[*plan.engine]);
        return Outcome::kApplied;
      case policy::Step::kAddOwned: {
        TemplateURL* added = service->Add(std::make_unique<TemplateURL>(desired));
        if (!added) return Outcome::kSkipped;
        MakeDefault(service, added);
        return Outcome::kApplied;
      }
      case policy::Step::kNothing:
        break;
    }
    return Outcome::kSkipped;
  }

  static void MakeDefault(TemplateURLService* service, TemplateURL* engine) {
    if (service->CanMakeDefault(engine)) service->SetUserSelectedDefaultSearchProvider(engine);
  }

  static void RemoveOwnedUnlessDefault(TemplateURLService* service) {
    TemplateURL* owned = service->GetTemplateURLForGUID(policy::kOwnedEngineGuid);
    const TemplateURL* current = service->GetDefaultSearchProvider();
    if (!owned || owned == current || (current && current->sync_guid() == owned->sync_guid())) return;
    service->Remove(owned);
  }

  void OnProfileAdded(Profile* profile) override {
    Apply(profile);
  }

  void OnProfileManagerDestroying() override {
    waiting_.clear();
    observation_.Reset();
  }

  std::optional<policy::Request> request_;
  std::map<base::FilePath, base::CallbackListSubscription> waiting_;
  base::ScopedObservation<ProfileManager, ProfileManagerObserver> observation_{this};
};

}

std::optional<std::string> SetLinuxDefaultSearchEngine(std::string name, std::string keyword, std::string url) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  policy::Request request{std::move(name), std::move(keyword), std::move(url)};
  if (std::optional<std::string> error = policy::Validate(request)) return error;
  static base::NoDestructor<SearchEngineProfiles> profiles;
  return profiles->Set(std::move(request));
}

}
