#include "ardia/core/ac_autofill_prompt.h"

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/sys_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/ui/autofill/address_bubbles_controller.h"
#include "chrome/browser/ui/autofill/autofill_bubble_base.h"
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
#include "components/autofill/core/browser/payments/payments_autofill_client.h"
#include "components/autofill/core/browser/ui/addresses/autofill_address_util.h"
#include "components/autofill/core/browser/ui/payments/payments_ui_closed_reasons.h"
#include "components/strings/grit/components_strings.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#import "ardia/core/ardiacore_internal.h"
#include "ardia/core/ac_browser.h"
#include "ui/base/l10n/l10n_util.h"
#include "url/origin.h"

namespace ardiacore {

namespace {

using autofill::AutofillClient;
using Decision = AutofillClient::AddressPromptUserDecision;

NSString* NS(const std::u16string& text) {
  return base::SysUTF16ToNSString(text);
}

NSArray<NSString*>* Lines(const std::u16string& text) {
  NSMutableArray<NSString*>* lines = [NSMutableArray array];
  for (NSString* line in [NS(text) componentsSeparatedByString:@"\n"]) {
    if (line.length) {
      [lines addObject:line];
    }
  }
  return lines;
}

int g_last_prompt_id = 0;

class Prompt;

struct PromptSlot : public base::SupportsUserData::Data {
  base::WeakPtr<Prompt> prompt;
};
const char kSlotKey[] = "ardiacore_autofill_prompt";

class Prompt : public autofill::AutofillBubbleBase {
 public:
  explicit Prompt(content::WebContents* contents)
      : contents_(contents->GetWeakPtr()), id_(++g_last_prompt_id) {}
  Prompt(const Prompt&) = delete;
  Prompt& operator=(const Prompt&) = delete;
  ~Prompt() override = default;

  int prompt_id() const { return id_; }
  bool closed() const { return closed_; }
  base::WeakPtr<Prompt> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  virtual NSDictionary<NSString*, id>* Describe() const = 0;

  NSDictionary<NSString*, id>* Payload() const {
    NSMutableDictionary<NSString*, id>* payload = [Describe() mutableCopy];
    payload[@"id"] = @(id_);
    payload[@"origin"] =
        contents_ ? base::SysUTF8ToNSString(
                        contents_->GetPrimaryMainFrame()->GetLastCommittedOrigin().Serialize())
                  : @"";
    return payload;
  }

  autofill::AutofillBubbleBase* Show() {
    auto slot = std::make_unique<PromptSlot>();
    slot->prompt = GetWeakPtr();
    contents_->SetUserData(kSlotKey, std::move(slot));
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<Prompt> prompt) {
                         if (prompt && !prompt->closed()) {
                           prompt->Notify(prompt->Payload());
                         }
                       },
                       GetWeakPtr()));
    return this;
  }

  void Answer(NSString* action) {
    if (closed_) {
      return;
    }
    if ([action isEqualToString:@"accept"]) {
      Accept();
    } else if ([action isEqualToString:@"decline"]) {
      Decline();
    } else if (![action isEqualToString:@"dismiss"]) {
      return;
    }
    Close(ClosedBy::kUser, action);
  }

  void Hide() override { Close(ClosedBy::kChrome, nil); }
  bool IsMouseHovered() const override { return false; }

 protected:
  enum class ClosedBy { kUser, kChrome };

  virtual void Accept() = 0;
  virtual void Decline() = 0;
  virtual void Closed(ClosedBy by, NSString* action) = 0;

 private:
  void Close(ClosedBy by, NSString* action) {
    if (closed_) {
      return;
    }
    closed_ = true;
    if (contents_) {
      auto* slot = static_cast<PromptSlot*>(contents_->GetUserData(kSlotKey));
      if (slot && slot->prompt.get() == this) {
        contents_->RemoveUserData(kSlotKey);
      }
    }
    Notify(@{@"id" : @(id_), @"closed" : @YES});
    Closed(by, action);
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
  }

  void Notify(NSDictionary<NSString*, id>* payload) const {
    if (!contents_) {
      return;
    }
    WindowHost* host = WindowHost::ForContents(contents_.get());
    ArdiaCoreWindow* owner = host ? host->owner() : nil;
    id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
    TabBridge* bridge = TabBridge::FromWebContents(contents_.get());
    if (!bridge || ![delegate respondsToSelector:@selector(window:autofillPrompt:forTab:)]) {
      return;
    }
    [delegate window:owner autofillPrompt:payload forTab:bridge->tab()];
  }

  base::WeakPtr<content::WebContents> contents_;
  const int id_;
  bool closed_ = false;
  base::WeakPtrFactory<Prompt> weak_factory_{this};
};

class SaveAddressPrompt : public Prompt {
 public:
  SaveAddressPrompt(content::WebContents* contents,
                    std::unique_ptr<autofill::SaveAddressBubbleController> controller)
      : Prompt(contents), controller_(std::move(controller)) {}

  NSDictionary<NSString*, id>* Describe() const override {
    NSMutableArray<NSString*>* lines = [Lines(controller_->GetAddressSummary()) mutableCopy];
    for (const std::u16string& extra :
         {controller_->GetProfileEmail(), controller_->GetProfilePhone()}) {
      if (!extra.empty()) {
        [lines addObject:NS(extra)];
      }
    }
    return @{
      @"kind" : @"saveAddress",
      @"title" : NS(controller_->GetWindowTitle()),
      @"message" : NS(controller_->GetBodyText()),
      @"accept" : NS(controller_->GetOkButtonLabel()),
      @"decline" : NS(controller_->GetNegativeButtonLabel()),
      @"footer" : NS(controller_->GetFooterMessage()),
      @"lines" : lines,
    };
  }

 protected:
  void Accept() override {
    controller_->OnUserDecision(Decision::kAccepted, controller_->GetAutofillProfile());
  }
  void Decline() override {
    controller_->OnUserDecision(controller_->GetCancelCallbackValue(), std::nullopt);
  }
  void Closed(ClosedBy, NSString*) override { controller_->OnBubbleClosed(); }

 private:
  std::unique_ptr<autofill::SaveAddressBubbleController> controller_;
};

class UpdateAddressPrompt : public Prompt {
 public:
  UpdateAddressPrompt(content::WebContents* contents,
                      std::unique_ptr<autofill::UpdateAddressBubbleController> controller)
      : Prompt(contents), controller_(std::move(controller)) {}

  NSDictionary<NSString*, id>* Describe() const override {
    const std::string& locale = g_browser_process->GetApplicationLocale();
    const std::vector<autofill::ProfileValueDifference> diff = autofill::GetProfileDifferenceForUi(
        controller_->GetProfileToSave(), controller_->GetOriginalProfile(), locale);
    bool adds_only = true;
    bool has_address = false;
    NSMutableArray<NSDictionary<NSString*, NSString*>*>* changes = [NSMutableArray array];
    for (const autofill::ProfileValueDifference& entry : diff) {
      adds_only = adds_only && entry.second_value.empty();
      has_address = has_address || entry.type == autofill::ADDRESS_HOME_ADDRESS;
      NSString* field = @"other";
      switch (autofill::GetAddressUIComponentIconTypeForFieldType(entry.type)) {
        case autofill::AddressUIComponentIconType::kName:
          field = @"name";
          break;
        case autofill::AddressUIComponentIconType::kAddress:
          field = @"address";
          break;
        case autofill::AddressUIComponentIconType::kEmail:
          field = @"email";
          break;
        case autofill::AddressUIComponentIconType::kPhone:
          field = @"phone";
          break;
        case autofill::AddressUIComponentIconType::kNoIcon:
          break;
      }
      [changes addObject:@{@"field" : field, @"to" : NS(entry.first_value), @"from" : NS(entry.second_value)}];
    }
    return @{
      @"kind" : @"updateAddress",
      @"title" : NS(controller_->GetWindowTitle(adds_only)),
      @"message" : NS(autofill::GetProfileDescription(controller_->GetOriginalProfile(), locale,
                                                      !has_address)),
      @"accept" : NS(controller_->GetPositiveButtonText(adds_only)),
      @"decline" : NS(controller_->GetNegativeButtonText(adds_only)),
      @"footer" : NS(controller_->GetFooterMessage()),
      @"lines" : @[],
      @"changes" : changes,
      @"newLabel" : adds_only ? @"" : NS(l10n_util::GetStringUTF16(IDS_AUTOFILL_UPDATE_ADDRESS_PROMPT_NEW_VALUES_SECTION_LABEL)),
      @"oldLabel" : adds_only ? @"" : NS(l10n_util::GetStringUTF16(IDS_AUTOFILL_UPDATE_ADDRESS_PROMPT_OLD_VALUES_SECTION_LABEL)),
    };
  }

 protected:
  void Accept() override {
    controller_->OnUserDecision(Decision::kAccepted, controller_->GetProfileToSave());
  }
  void Decline() override { controller_->OnUserDecision(Decision::kDeclined, std::nullopt); }
  void Closed(ClosedBy, NSString*) override { controller_->OnBubbleClosed(); }

 private:
  std::unique_ptr<autofill::UpdateAddressBubbleController> controller_;
};

class SaveCardPrompt : public Prompt {
 public:
  SaveCardPrompt(content::WebContents* contents, autofill::SaveCardBubbleController* controller)
      : Prompt(contents),
        controller_(controller),
        on_closed_(controller->GetOnBubbleClosedCallback()) {}

  NSDictionary<NSString*, id>* Describe() const override {
    const autofill::CreditCard& card = controller_->GetCard();
    std::u16string identifier = card.CardNameAndLastFourDigits(u"",
                                                               2);
    if (!card.IsExpired(base::Time::Now())) {
      identifier += u" • " + card.AbbreviatedExpirationDateForDisplay(false);
    }
    return @{
      @"kind" : @"saveCard",
      @"title" : NS(controller_->GetWindowTitle()),
      @"message" : NS(controller_->GetExplanatoryMessage()),
      @"accept" : NS(controller_->GetAcceptButtonText()),
      @"decline" : NS(controller_->GetDeclineButtonText()),
      @"footer" : @"",
      @"lines" : @[ NS(identifier) ],
    };
  }

 protected:
  void Accept() override { controller_->OnSaveButton({}); }
  void Decline() override {}
  void Closed(ClosedBy by, NSString* action) override {
    autofill::PaymentsUiClosedReason reason = autofill::PaymentsUiClosedReason::kNotInteracted;
    if (by == ClosedBy::kUser) {
      reason = [action isEqualToString:@"accept"]    ? autofill::PaymentsUiClosedReason::kAccepted
               : [action isEqualToString:@"decline"] ? autofill::PaymentsUiClosedReason::kCancelled
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
  using CloseCallback =
      base::OnceCallback<void(content::WebContents*, autofill::AutofillBubbleBase*)>;

  SkippedBubble(content::WebContents* contents, CloseCallback close)
      : contents_(contents->GetWeakPtr()), close_(std::move(close)) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&SkippedBubble::CloseNow, weak_factory_.GetWeakPtr()));
  }

  void Hide() override {
    if (!hidden_) {
      hidden_ = true;
      base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
    }
  }
  bool IsMouseHovered() const override { return false; }

 private:
  void CloseNow() {
    if (hidden_) {
      return;
    }
    hidden_ = true;
    if (contents_) {
      std::move(close_).Run(contents_.get(), this);
    }
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

}

autofill::AutofillBubbleBase* ShowSaveAddressPrompt(
    content::WebContents* contents,
    std::unique_ptr<autofill::SaveAddressBubbleController> controller) {
  return (new SaveAddressPrompt(contents, std::move(controller)))->Show();
}

autofill::AutofillBubbleBase* ShowUpdateAddressPrompt(
    content::WebContents* contents,
    std::unique_ptr<autofill::UpdateAddressBubbleController> controller) {
  return (new UpdateAddressPrompt(contents, std::move(controller)))->Show();
}

autofill::AutofillBubbleBase* ShowSaveCardPrompt(content::WebContents* contents,
                                                 autofill::SaveCardBubbleController* controller) {
  using autofill::PaymentsBubbleType;
  switch (controller->GetPaymentsBubbleType()) {
    case PaymentsBubbleType::kLocalSave:
    case PaymentsBubbleType::kLocalCvcSave:
      return (new SaveCardPrompt(contents, controller))->Show();
    default:
      return new SkippedBubble(
          contents, base::BindOnce([](content::WebContents* contents,
                                      autofill::AutofillBubbleBase* bubble) {
            auto* controller = autofill::SaveCardBubbleControllerImpl::FromWebContents(contents);
            if (controller && controller->GetPaymentBubbleView() == bubble) {
              controller->OnBubbleClosed(autofill::PaymentsUiClosedReason::kNotInteracted);
            }
          }));
  }
}

autofill::AutofillBubbleBase* SkipIbanBubble(content::WebContents* contents) {
  return new SkippedBubble(
      contents,
      base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
        auto* controller = autofill::IbanBubbleControllerImpl::FromWebContents(contents);
        if (controller && controller->GetPaymentBubbleView() == bubble) {
          controller->OnBubbleClosed(autofill::PaymentsUiClosedReason::kNotInteracted);
        }
      }));
}

autofill::AutofillBubbleBase* SkipOfferNotification(content::WebContents* contents) {
  return new SkippedBubble(
      contents,
      base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
        auto* controller =
            autofill::OfferNotificationBubbleControllerImpl::FromWebContents(contents);
        if (controller && controller->GetOfferNotificationBubbleView() == bubble) {
          controller->OnBubbleClosed(autofill::PaymentsUiClosedReason::kNotInteracted);
        }
      }));
}

autofill::AutofillBubbleBase* SkipAddressSignInPromo(content::WebContents* contents) {
  return new SkippedBubble(
      contents,
      base::BindOnce([](content::WebContents* contents, autofill::AutofillBubbleBase* bubble) {
        auto* controller = autofill::AddressBubblesController::FromWebContents(contents);
        if (controller && controller->GetBubbleView() == bubble) {
          controller->OnBubbleClosed();
        }
      }));
}

NSDictionary<NSString*, id>* AutofillPrompt(content::WebContents* contents) {
  Prompt* prompt = PendingPrompt(contents);
  return prompt ? prompt->Payload() : nil;
}

void ResolveAutofillPrompt(content::WebContents* contents, NSInteger prompt_id, NSString* action) {
  Prompt* prompt = PendingPrompt(contents);
  if (prompt && prompt->prompt_id() == prompt_id) {
    prompt->Answer(action);
  }
}

}
