#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_page_prompt_policy.h"
#include "ardia/linux/ac_linux_page_prompts_internal.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/ui/autofill/address_bubbles_controller.h"
#include "chrome/browser/ui/autofill/autofill_bubble_base.h"
#include "chrome/browser/ui/autofill/autofill_bubble_handler.h"
#include "chrome/browser/ui/autofill/payments/iban_bubble_controller_impl.h"
#include "chrome/browser/ui/autofill/payments/offer_notification_bubble_controller_impl.h"
#include "chrome/browser/ui/autofill/payments/save_card_bubble_controller.h"
#include "chrome/browser/ui/autofill/payments/save_card_bubble_controller_impl.h"
#include "chrome/browser/ui/autofill/payments/save_card_ui.h"
#include "chrome/browser/ui/autofill/save_address_bubble_controller.h"
#include "chrome/browser/ui/autofill/update_address_bubble_controller.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile_comparator.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"
#include "components/autofill/core/browser/foundations/autofill_client.h"
#include "components/autofill/core/browser/ui/addresses/autofill_address_util.h"
#include "components/autofill/core/browser/ui/payments/payments_ui_closed_reasons.h"
#include "components/strings/grit/components_strings.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/l10n/l10n_util.h"
#include "url/origin.h"

namespace autofill {
extern AutofillBubbleHandler* (*g_ardia_linux_autofill_bubble_handler)(content::WebContents* web_contents);
}

namespace ardiacore::linux_page_prompts {
namespace {

using autofill::AutofillClient;
using Decision = AutofillClient::AddressPromptUserDecision;

base::ListValue Lines(const std::u16string& text) {
  base::ListValue lines;
  size_t start = 0;
  while (start <= text.size()) {
    const size_t end = std::min(text.find(u'\n', start), text.size());
    if (end > start) lines.Append(base::UTF16ToUTF8(text.substr(start, end - start)));
    start = end + 1;
  }
  return lines;
}

int g_last_prompt_id = 0;

class Prompt;

struct PromptSlot : public base::SupportsUserData::Data {
  base::WeakPtr<Prompt> prompt;
};
const char kSlotKey[] = "ardia_linux_autofill_prompt";

class Prompt : public autofill::AutofillBubbleBase {
 public:
  explicit Prompt(content::WebContents* contents) : contents_(contents->GetWeakPtr()), id_(++g_last_prompt_id) {}
  Prompt(const Prompt&) = delete;
  Prompt& operator=(const Prompt&) = delete;
  ~Prompt() override = default;

  int prompt_id() const { return id_; }
  bool closed() const { return closed_; }
  base::WeakPtr<Prompt> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  virtual base::DictValue Describe() const = 0;

  base::DictValue Payload() const {
    base::DictValue payload = Describe();
    payload.Set("id", id_);
    payload.Set("origin",
                contents_ ? contents_->GetPrimaryMainFrame()->GetLastCommittedOrigin().Serialize() : std::string());
    return payload;
  }

  autofill::AutofillBubbleBase* Show() {
    auto slot = std::make_unique<PromptSlot>();
    slot->prompt = GetWeakPtr();
    contents_->SetUserData(kSlotKey, std::move(slot));
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<Prompt> prompt) {
                         if (prompt && !prompt->closed()) prompt->Notify(prompt->Payload());
                       },
                       GetWeakPtr()));
    return this;
  }

  void Answer(AutofillAnswer answer) {
    if (closed_) return;
    if (answer == AutofillAnswer::kAccept) {
      Accept();
    } else if (answer == AutofillAnswer::kDecline) {
      Decline();
    }
    Close(ClosedBy::kUser, answer);
  }

  void Hide() override { Close(ClosedBy::kChrome, AutofillAnswer::kDismiss); }
  bool IsMouseHovered() const override { return false; }

 protected:
  enum class ClosedBy { kUser, kChrome };

  virtual void Accept() = 0;
  virtual void Decline() = 0;
  virtual void Closed(ClosedBy by, AutofillAnswer answer) = 0;

 private:
  void Close(ClosedBy by, AutofillAnswer answer) {
    if (closed_) return;
    closed_ = true;
    if (contents_) {
      auto* slot = static_cast<PromptSlot*>(contents_->GetUserData(kSlotKey));
      if (slot && slot->prompt.get() == this) contents_->RemoveUserData(kSlotKey);
    }
    Notify(base::DictValue().Set("id", id_).Set("closed", true));
    Closed(by, answer);
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
  }

  void Notify(base::DictValue payload) const {
    if (contents_) PageEvent(contents_.get(), "autofillPrompt", base::Value(std::move(payload)));
  }

  base::WeakPtr<content::WebContents> contents_;
  const int id_;
  bool closed_ = false;
  base::WeakPtrFactory<Prompt> weak_factory_{this};
};

class SaveAddressPrompt : public Prompt {
 public:
  SaveAddressPrompt(content::WebContents* contents, std::unique_ptr<autofill::SaveAddressBubbleController> controller)
      : Prompt(contents), controller_(std::move(controller)) {}

  base::DictValue Describe() const override {
    base::ListValue lines = Lines(controller_->GetAddressSummary());
    for (const std::u16string& extra : {controller_->GetProfileEmail(), controller_->GetProfilePhone()}) {
      if (!extra.empty()) lines.Append(base::UTF16ToUTF8(extra));
    }
    return base::DictValue()
        .Set("kind", "saveAddress")
        .Set("title", controller_->GetWindowTitle())
        .Set("message", controller_->GetBodyText())
        .Set("accept", controller_->GetOkButtonLabel())
        .Set("decline", controller_->GetNegativeButtonLabel())
        .Set("footer", controller_->GetFooterMessage())
        .Set("lines", std::move(lines));
  }

 protected:
  void Accept() override { controller_->OnUserDecision(Decision::kAccepted, controller_->GetAutofillProfile()); }
  void Decline() override { controller_->OnUserDecision(controller_->GetCancelCallbackValue(), std::nullopt); }
  void Closed(ClosedBy, AutofillAnswer) override { controller_->OnBubbleClosed(); }

 private:
  std::unique_ptr<autofill::SaveAddressBubbleController> controller_;
};

class UpdateAddressPrompt : public Prompt {
 public:
  UpdateAddressPrompt(content::WebContents* contents,
                      std::unique_ptr<autofill::UpdateAddressBubbleController> controller)
      : Prompt(contents), controller_(std::move(controller)) {}

  base::DictValue Describe() const override {
    const std::string& locale = g_browser_process->GetApplicationLocale();
    const std::vector<autofill::ProfileValueDifference> diff = autofill::GetProfileDifferenceForUi(
        controller_->GetProfileToSave(), controller_->GetOriginalProfile(), locale);
    bool adds_only = true;
    bool has_address = false;
    base::ListValue changes;
    for (const autofill::ProfileValueDifference& entry : diff) {
      adds_only = adds_only && entry.second_value.empty();
      has_address = has_address || entry.type == autofill::ADDRESS_HOME_ADDRESS;
      std::string field = "other";
      switch (autofill::GetAddressUIComponentIconTypeForFieldType(entry.type)) {
        case autofill::AddressUIComponentIconType::kName:
          field = "name";
          break;
        case autofill::AddressUIComponentIconType::kAddress:
          field = "address";
          break;
        case autofill::AddressUIComponentIconType::kEmail:
          field = "email";
          break;
        case autofill::AddressUIComponentIconType::kPhone:
          field = "phone";
          break;
        case autofill::AddressUIComponentIconType::kNoIcon:
          break;
      }
      changes.Append(base::DictValue()
                         .Set("field", field)
                         .Set("to", entry.first_value)
                         .Set("from", entry.second_value));
    }
    return base::DictValue()
        .Set("kind", "updateAddress")
        .Set("title", controller_->GetWindowTitle(adds_only))
        .Set("message", autofill::GetProfileDescription(controller_->GetOriginalProfile(), locale, !has_address))
        .Set("accept", controller_->GetPositiveButtonText(adds_only))
        .Set("decline", controller_->GetNegativeButtonText(adds_only))
        .Set("footer", controller_->GetFooterMessage())
        .Set("lines", base::ListValue())
        .Set("changes", std::move(changes))
        .Set("newLabel", adds_only ? std::u16string()
                                   : l10n_util::GetStringUTF16(
                                         IDS_AUTOFILL_UPDATE_ADDRESS_PROMPT_NEW_VALUES_SECTION_LABEL))
        .Set("oldLabel", adds_only ? std::u16string()
                                   : l10n_util::GetStringUTF16(
                                         IDS_AUTOFILL_UPDATE_ADDRESS_PROMPT_OLD_VALUES_SECTION_LABEL));
  }

 protected:
  void Accept() override { controller_->OnUserDecision(Decision::kAccepted, controller_->GetProfileToSave()); }
  void Decline() override { controller_->OnUserDecision(Decision::kDeclined, std::nullopt); }
  void Closed(ClosedBy, AutofillAnswer) override { controller_->OnBubbleClosed(); }

 private:
  std::unique_ptr<autofill::UpdateAddressBubbleController> controller_;
};

class SaveCardPrompt : public Prompt {
 public:
  SaveCardPrompt(content::WebContents* contents, autofill::SaveCardBubbleController* controller)
      : Prompt(contents), controller_(controller), on_closed_(controller->GetOnBubbleClosedCallback()) {}

  base::DictValue Describe() const override {
    const autofill::CreditCard& card = controller_->GetCard();
    std::u16string identifier = card.CardNameAndLastFourDigits(u"", 2);
    if (!card.IsExpired(base::Time::Now())) identifier += u" • " + card.AbbreviatedExpirationDateForDisplay(false);
    return base::DictValue()
        .Set("kind", "saveCard")
        .Set("title", controller_->GetWindowTitle())
        .Set("message", controller_->GetExplanatoryMessage())
        .Set("accept", controller_->GetAcceptButtonText())
        .Set("decline", controller_->GetDeclineButtonText())
        .Set("footer", "")
        .Set("lines", base::ListValue().Append(identifier));
  }

 protected:
  void Accept() override { controller_->OnSaveButton({}); }
  void Decline() override {}
  void Closed(ClosedBy by, AutofillAnswer answer) override {
    autofill::PaymentsUiClosedReason reason = autofill::PaymentsUiClosedReason::kNotInteracted;
    if (by == ClosedBy::kUser) {
      reason = answer == AutofillAnswer::kAccept    ? autofill::PaymentsUiClosedReason::kAccepted
               : answer == AutofillAnswer::kDecline ? autofill::PaymentsUiClosedReason::kCancelled
                                                    : autofill::PaymentsUiClosedReason::kClosed;
    }
    std::move(on_closed_).Run(reason);
  }

 private:
  raw_ptr<autofill::SaveCardBubbleController> controller_;
  base::OnceCallback<void(autofill::PaymentsUiClosedReason)> on_closed_;
};

class SkippedBubble : public autofill::AutofillBubbleBase {
 public:
  using CloseCallback = base::OnceCallback<void(content::WebContents*, autofill::AutofillBubbleBase*)>;

  SkippedBubble(content::WebContents* contents, CloseCallback close)
      : contents_(contents->GetWeakPtr()), close_(std::move(close)) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&SkippedBubble::CloseNow, weak_factory_.GetWeakPtr()));
  }

  void Hide() override {
    if (hidden_) return;
    hidden_ = true;
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
  }
  bool IsMouseHovered() const override { return false; }

 private:
  void CloseNow() {
    if (hidden_) return;
    hidden_ = true;
    if (contents_) std::move(close_).Run(contents_.get(), this);
    delete this;
  }

  base::WeakPtr<content::WebContents> contents_;
  CloseCallback close_;
  bool hidden_ = false;
  base::WeakPtrFactory<SkippedBubble> weak_factory_{this};
};

Prompt* PendingPrompt(content::WebContents* contents) {
  auto* slot = contents ? static_cast<PromptSlot*>(contents->GetUserData(kSlotKey)) : nullptr;
  Prompt* prompt = slot ? slot->prompt.get() : nullptr;
  return prompt && !prompt->closed() ? prompt : nullptr;
}

autofill::AutofillBubbleBase* ShowSaveCard(content::WebContents* contents,
                                           autofill::SaveCardBubbleController* controller) {
  using autofill::PaymentsBubbleType;
  switch (controller->GetPaymentsBubbleType()) {
    case PaymentsBubbleType::kLocalSave:
    case PaymentsBubbleType::kLocalCvcSave:
      return (new SaveCardPrompt(contents, controller))->Show();
    default:
      return new SkippedBubble(
          contents, base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
            auto* controller = autofill::SaveCardBubbleControllerImpl::FromWebContents(contents);
            if (controller && controller->GetPaymentBubbleView() == bubble) {
              controller->OnBubbleClosed(autofill::PaymentsUiClosedReason::kNotInteracted);
            }
          }));
  }
}

class LinuxAutofillBubbleHandler : public autofill::AutofillBubbleHandler {
 public:
  autofill::AutofillBubbleBase* ShowSaveCreditCardBubble(content::WebContents* web_contents,
                                                         autofill::SaveCardBubbleController* controller,
                                                         bool) override {
    return ShowSaveCard(web_contents, controller);
  }
  autofill::AutofillBubbleBase* ShowIbanBubble(content::WebContents* web_contents, autofill::IbanBubbleController*,
                                               bool, autofill::IbanBubbleType) override {
    return new SkippedBubble(
        web_contents, base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
          auto* controller = autofill::IbanBubbleControllerImpl::FromWebContents(contents);
          if (controller && controller->GetPaymentBubbleView() == bubble) {
            controller->OnBubbleClosed(autofill::PaymentsUiClosedReason::kNotInteracted);
          }
        }));
  }
  autofill::AutofillBubbleBase* ShowOfferNotificationBubble(content::WebContents* web_contents,
                                                            autofill::OfferNotificationBubbleController*,
                                                            bool) override {
    return new SkippedBubble(
        web_contents, base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
          auto* controller = autofill::OfferNotificationBubbleControllerImpl::FromWebContents(contents);
          if (controller && controller->GetOfferNotificationBubbleView() == bubble) {
            controller->OnBubbleClosed(autofill::PaymentsUiClosedReason::kNotInteracted);
          }
        }));
  }
  autofill::AutofillBubbleBase* ShowSaveAutofillAiDataBubble(content::WebContents*,
                                                             autofill::AutofillAiImportDataController*) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowAutofillAiLocalSaveNotification(
      content::WebContents*, autofill::AutofillAiImportDataController*) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowSaveAddressProfileBubble(
      content::WebContents* web_contents, std::unique_ptr<autofill::SaveAddressBubbleController> controller,
      bool) override {
    return (new SaveAddressPrompt(web_contents, std::move(controller)))->Show();
  }
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
  autofill::AutofillBubbleBase* ShowAddressSignInPromo(content::WebContents* web_contents,
                                                       const autofill::AutofillProfile&) override {
    return new SkippedBubble(
        web_contents, base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
          auto* controller = autofill::AddressBubblesController::FromWebContents(contents);
          if (controller && controller->GetBubbleView() == bubble) controller->OnBubbleClosed();
        }));
  }
#endif
  autofill::AutofillBubbleBase* ShowUpdateAddressProfileBubble(
      content::WebContents* web_contents, std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
      bool) override {
    return (new UpdateAddressPrompt(web_contents, std::move(controller)))->Show();
  }
  autofill::AutofillBubbleBase* ShowFilledCardInformationBubble(content::WebContents*,
                                                                autofill::FilledCardInformationBubbleController*,
                                                                bool) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowVirtualCardEnrollBubble(content::WebContents*,
                                                            autofill::VirtualCardEnrollBubbleController*,
                                                            bool) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowVirtualCardEnrollConfirmationBubble(
      content::WebContents*, autofill::VirtualCardEnrollBubbleController*) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowMandatoryReauthBubble(content::WebContents*,
                                                          autofill::MandatoryReauthBubbleController*, bool,
                                                          autofill::MandatoryReauthBubbleType) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowSaveCardConfirmationBubble(
      content::WebContents* web_contents, autofill::SaveCardBubbleController* controller) override {
    return ShowSaveCard(web_contents, controller);
  }
  autofill::AutofillBubbleBase* ShowSaveIbanConfirmationBubble(content::WebContents*,
                                                               autofill::IbanBubbleController*) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowOmniboxAutofillBubble(content::WebContents*,
                                                          autofill::OmniboxAutofillBubbleController*) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowPaymentsChurnedUsersBubble(content::WebContents*,
                                                               autofill::PaymentsChurnedUsersBubbleController*,
                                                               bool) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowPaymentsChurnedUsersConfirmationBubble(
      content::WebContents*, autofill::PaymentsChurnedUsersBubbleController*) override {
    return nullptr;
  }
  autofill::AutofillBubbleBase* ShowWalletReminderNoticeBubble(content::WebContents*,
                                                               autofill::WalletReminderNoticeBubbleController*,
                                                               bool) override {
    return nullptr;
  }
};

autofill::AutofillBubbleHandler* HandlerFor(content::WebContents* contents) {
  static base::NoDestructor<LinuxAutofillBubbleHandler> handler;
  return contents && TabFor(contents).window ? handler.get() : nullptr;
}

}

void InstallAutofillPrompts() {
  autofill::g_ardia_linux_autofill_bubble_handler = &HandlerFor;
}

std::optional<base::DictValue> OpenAutofillPrompt(content::WebContents* contents) {
  Prompt* prompt = PendingPrompt(contents);
  if (!prompt) return std::nullopt;
  return prompt->Payload();
}

std::string ResolveAutofillPrompt(content::WebContents* contents, const base::ListValue& args) {
  if (args.size() != 2 || !args[0].is_int() || !args[1].is_string()) {
    return "resolveAutofillPrompt requires a prompt id and accept, decline or dismiss";
  }
  const auto answer = ParseAutofillAnswer(args[1].GetString());
  if (!answer) return "resolveAutofillPrompt requires accept, decline or dismiss";
  Prompt* prompt = PendingPrompt(contents);
  if (prompt && prompt->prompt_id() == args[0].GetInt()) prompt->Answer(*answer);
  return std::string();
}

}
