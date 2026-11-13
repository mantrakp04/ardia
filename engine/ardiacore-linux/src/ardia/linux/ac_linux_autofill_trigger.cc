#include "ardia/linux/ac_linux_page_prompts.h"

#include "base/memory/weak_ptr.h"
#include "components/autofill/content/browser/content_autofill_client.h"
#include "components/autofill/content/browser/content_autofill_driver.h"
#include "components/autofill/core/browser/foundations/autofill_driver.h"
#include "components/autofill/core/browser/foundations/autofill_manager.h"
#include "components/autofill/core/browser/foundations/scoped_autofill_managers_observation.h"
#include "components/autofill/core/common/aliases.h"
#include "components/autofill/core/common/unique_ids.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"

namespace ardiacore {
namespace {

using autofill::AutofillManager;
using autofill::AutofillSuggestionTriggerSource;
using autofill::FieldGlobalId;
using autofill::FormGlobalId;

class FocusedField : public content::WebContentsUserData<FocusedField>, public AutofillManager::Observer {
 public:
  FocusedField(const FocusedField&) = delete;
  FocusedField& operator=(const FocusedField&) = delete;
  ~FocusedField() override = default;

  bool Trigger(AutofillSuggestionTriggerSource source) {
    AutofillManager* manager = manager_.get();
    content::RenderFrameHost* frame = GetWebContents().GetFocusedFrame();
    auto* driver = frame ? autofill::ContentAutofillDriver::GetForRenderFrameHost(frame) : nullptr;
    if (!manager || !driver || !driver->IsActive() || &driver->GetAutofillManager() != manager) return false;
    static_cast<autofill::AutofillDriver*>(driver)->RendererShouldTriggerSuggestions(field_, source);
    return true;
  }

 private:
  friend class content::WebContentsUserData<FocusedField>;

  FocusedField(content::WebContents* web_contents, autofill::ContentAutofillClient* client)
      : content::WebContentsUserData<FocusedField>(*web_contents) {
    observation_.Observe(client,
                         autofill::ScopedAutofillManagersObservation::InitializationPolicy::kObservePreexistingManagers);
  }

  void OnAfterFocusOnFormField(AutofillManager& manager, FormGlobalId, FieldGlobalId field) override {
    Focused(manager, field);
  }
  void OnAfterAskForValuesToFill(AutofillManager& manager, FormGlobalId, FieldGlobalId field) override {
    Focused(manager, field);
  }
  void OnAfterFocusOnNonFormField(AutofillManager& manager) override {
    if (manager_.get() == &manager) manager_.reset();
  }

  void Focused(AutofillManager& manager, FieldGlobalId field) {
    manager_ = manager.GetWeakPtr();
    field_ = field;
  }

  base::WeakPtr<AutofillManager> manager_;
  FieldGlobalId field_;
  autofill::ScopedAutofillManagersObservation observation_{this};

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(FocusedField);

}

void TrackLinuxAutofillFocus(content::WebContents* contents) {
  auto* client = contents ? autofill::ContentAutofillClient::FromWebContents(contents) : nullptr;
  if (client && !FocusedField::FromWebContents(contents)) FocusedField::CreateForWebContents(contents, client);
}

bool ShowLinuxAutofillSuggestions(content::WebContents* contents, bool passwords) {
  if (!contents) return false;
  TrackLinuxAutofillFocus(contents);
  auto* focused = FocusedField::FromWebContents(contents);
  return focused && focused->Trigger(passwords ? AutofillSuggestionTriggerSource::kManualFallbackPasswords
                                               : AutofillSuggestionTriggerSource::kFormControlElementClicked);
}

}
