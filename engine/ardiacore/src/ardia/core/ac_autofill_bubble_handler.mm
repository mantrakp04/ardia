#include "ardia/core/ac_browser_window.h"

#include "chrome/browser/ui/autofill/save_address_bubble_controller.h"
#include "chrome/browser/ui/autofill/update_address_bubble_controller.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_autofill_prompt.h"

namespace ardiacore {

ACAutofillBubbleHandler::ACAutofillBubbleHandler() = default;
ACAutofillBubbleHandler::~ACAutofillBubbleHandler() = default;

#define AC_NO_BUBBLE(...) \
  {                       \
    return nullptr;       \
  }
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::ShowSaveCreditCardBubble(
    content::WebContents* web_contents,
    autofill::SaveCardBubbleController* controller,
    bool) {
  return ShowSaveCardPrompt(web_contents, controller);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::ShowIbanBubble(
    content::WebContents* web_contents,
    autofill::IbanBubbleController*,
    bool,
    autofill::IbanBubbleType) {
  return SkipIbanBubble(web_contents);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowOfferNotificationBubble(content::WebContents* web_contents,
                                autofill::OfferNotificationBubbleController*,
                                bool) {
  return SkipOfferNotification(web_contents);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveAutofillAiDataBubble(content::WebContents*,
                                 autofill::AutofillAiImportDataController*)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowAutofillAiLocalSaveNotification(
        content::WebContents*,
        autofill::AutofillAiImportDataController*) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveAddressProfileBubble(
        content::WebContents* web_contents,
        std::unique_ptr<autofill::SaveAddressBubbleController> controller,
        bool) {
  return ShowSaveAddressPrompt(web_contents, std::move(controller));
}
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::ShowAddressSignInPromo(
    content::WebContents* web_contents,
    const autofill::AutofillProfile&) {
  return SkipAddressSignInPromo(web_contents);
}
#endif
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowUpdateAddressProfileBubble(
        content::WebContents* web_contents,
        std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
        bool) {
  return ShowUpdateAddressPrompt(web_contents, std::move(controller));
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowFilledCardInformationBubble(
        content::WebContents*,
        autofill::FilledCardInformationBubbleController*,
        bool) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowVirtualCardEnrollBubble(content::WebContents*,
                                autofill::VirtualCardEnrollBubbleController*,
                                bool) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowVirtualCardEnrollConfirmationBubble(
        content::WebContents*,
        autofill::VirtualCardEnrollBubbleController*) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowMandatoryReauthBubble(content::WebContents*,
                              autofill::MandatoryReauthBubbleController*,
                              bool,
                              autofill::MandatoryReauthBubbleType)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveCardConfirmationBubble(
        content::WebContents* web_contents,
        autofill::SaveCardBubbleController* controller) {
  return ShowSaveCardPrompt(web_contents, controller);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveIbanConfirmationBubble(content::WebContents*,
                                   autofill::IbanBubbleController*)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowOmniboxAutofillBubble(content::WebContents*,
                              autofill::OmniboxAutofillBubbleController*)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowPaymentsChurnedUsersBubble(
        content::WebContents*,
        autofill::PaymentsChurnedUsersBubbleController*,
        bool) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowPaymentsChurnedUsersConfirmationBubble(
        content::WebContents*,
        autofill::PaymentsChurnedUsersBubbleController*) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowWalletReminderNoticeBubble(
        content::WebContents*,
        autofill::WalletReminderNoticeBubbleController*,
        bool) AC_NO_BUBBLE()
#undef AC_NO_BUBBLE

}
