#include <algorithm>
#include <optional>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_page_prompt_policy.h"
#include "ardia/linux/ac_linux_page_prompts_internal.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/password_manager/core/browser/password_string.h"
#include "components/password_manager/core/common/password_manager_ui.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/origin.h"

extern bool (*g_ardia_password_bubble)(content::WebContents* web_contents);
extern void (*g_ardia_linux_password_bubble_hidden)(content::WebContents* web_contents);

namespace ardiacore::linux_page_prompts {
namespace {

using password_manager::ui::State;

class OpenPrompt : public content::WebContentsUserData<OpenPrompt> {
 public:
  ~OpenPrompt() override = default;
  content::WeakDocumentPtr document;
  std::string offer;
  std::string id;

 private:
  friend class content::WebContentsUserData<OpenPrompt>;
  explicit OpenPrompt(content::WebContents* contents) : content::WebContentsUserData<OpenPrompt>(*contents) {}
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(OpenPrompt);

PasswordState StateOf(State state) {
  switch (state) {
    case State::PENDING_PASSWORD_STATE:
      return PasswordState::kSave;
    case State::PENDING_PASSWORD_UPDATE_STATE:
      return PasswordState::kUpdate;
    default:
      return PasswordState::kOther;
  }
}

base::WeakPtr<PasswordsModelDelegate> ModelFor(content::WebContents* contents) {
  return contents ? PasswordsModelDelegateFromWebContents(contents) : nullptr;
}

std::optional<base::DictValue> Describe(content::WebContents* contents) {
  base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents);
  if (!model) return std::nullopt;
  const State state = model->GetState();
  std::string name;
  switch (state) {
    case State::PENDING_PASSWORD_STATE:
      name = "save";
      break;
    case State::PENDING_PASSWORD_UPDATE_STATE:
      name = "update";
      break;
    case State::SAVE_CONFIRMATION_STATE:
    case State::UPDATE_CONFIRMATION_STATE:
      name = "saved";
      break;
    default:
      return std::nullopt;
  }
  std::string username;
  int length = 0;
  std::string federation;
  if (state != State::UPDATE_CONFIRMATION_STATE) {
    const password_manager::PasswordForm& form = model->GetPendingPassword();
    username = base::UTF16ToUTF8(form.username_value);
    length = static_cast<int>(std::min<size_t>(form.password_value.size(), 4096));
    if (form.federation_origin.IsValid()) federation = form.federation_origin.Serialize();
  }
  base::ListValue usernames;
  for (const auto& form : model->GetCurrentForms()) {
    if (form && !form->username_value.empty()) usernames.Append(base::UTF16ToUTF8(form->username_value));
  }
  return base::DictValue()
      .Set("state", name)
      .Set("origin", model->GetOrigin().Serialize())
      .Set("username", username)
      .Set("passwordLength", length)
      .Set("federation", federation)
      .Set("usernames", std::move(usernames));
}

std::string OfferOf(const base::DictValue& prompt) {
  const std::string* state = prompt.FindString("state");
  const std::string* origin = prompt.FindString("origin");
  const std::string* username = prompt.FindString("username");
  const std::string* federation = prompt.FindString("federation");
  return *state + '\n' + *origin + '\n' + *username + '\n' + *federation + '\n' +
         std::to_string(prompt.FindInt("passwordLength").value_or(0));
}

void CloseOpenPrompt(content::WebContents* contents) {
  if (contents) contents->RemoveUserData(OpenPrompt::UserDataKey());
}

void PasswordBubbleHidden(content::WebContents* contents) {
  if (!contents || !OpenPrompt::FromWebContents(contents)) return;
  CloseOpenPrompt(contents);
  PageEvent(contents, "passwordPrompt", base::Value(base::DictValue()
      .Set("state", "saved").Set("origin", "").Set("username", "").Set("passwordLength", 0)
      .Set("federation", "").Set("usernames", base::ListValue())));
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce([](base::WeakPtr<PasswordsModelDelegate> model) {
        if (model) model->OnBubbleHidden();
      }, ModelFor(contents)));
}

bool HandlePasswordBubble(content::WebContents* contents) {
  if (!contents || !TabFor(contents).window) return false;
  std::optional<base::DictValue> prompt = Describe(contents);
  if (!prompt) return false;
  base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents);
  if (!model) return false;
  const bool offers = *prompt->FindString("state") != "saved";
  model->OnBubbleShown();
  if (offers) {
    OpenPrompt::CreateForWebContents(contents);
    OpenPrompt* open = OpenPrompt::FromWebContents(contents);
    open->document = contents->GetPrimaryMainFrame()->GetWeakDocumentPtr();
    open->offer = OfferOf(*prompt);
    static uint64_t last_offer = 0;
    open->id = "o" + std::to_string(++last_offer);
    prompt->Set("offer", open->id);
  } else {
    CloseOpenPrompt(contents);
  }
  const auto weak = contents->GetWeakPtr();
  PageEvent(contents, "passwordPrompt", base::Value(std::move(*prompt)));
  if (!weak) return true;
  model = ModelFor(weak.get());
  if (model && (model->GetState() == State::SAVE_CONFIRMATION_STATE ||
                model->GetState() == State::UPDATE_CONFIRMATION_STATE)) {
    model->OnBubbleHidden();
  }
  return true;
}

}

void InstallPasswordPrompts() {
  g_ardia_password_bubble = &HandlePasswordBubble;
  g_ardia_linux_password_bubble_hidden = &PasswordBubbleHidden;
}

std::optional<base::DictValue> OpenPasswordPrompt(content::WebContents* contents) {
  auto* open = contents ? OpenPrompt::FromWebContents(contents) : nullptr;
  if (!open) return std::nullopt;
  content::RenderFrameHost* shown = open->document.AsRenderFrameHostIfValid();
  if (!shown || shown != contents->GetPrimaryMainFrame()) return std::nullopt;
  std::optional<base::DictValue> prompt = Describe(contents);
  if (!prompt || *prompt->FindString("state") == "saved" || OfferOf(*prompt) != open->offer) return std::nullopt;
  prompt->Set("offer", open->id);
  return prompt;
}

std::string ResolvePasswordPrompt(content::WebContents* contents, const base::ListValue& args) {
  if (args.empty() || args.size() > 2 || !args[0].is_string()) {
    return "resolvePasswordPrompt requires an action and optional {username}";
  }
  const auto answer = ParsePasswordAnswer(args[0].GetString());
  if (!answer) return "resolvePasswordPrompt requires save, update, never, nope or dismiss";
  std::optional<std::u16string> username;
  std::string offer;
  if (args.size() == 2 && !args[1].is_none()) {
    if (!args[1].is_dict()) return "resolvePasswordPrompt edits must be an object";
    const base::DictValue& edits = args[1].GetDict();
    for (const auto [key, value] : edits) {
      if (key == "password") return "Passwords never travel on the page command route";
      if ((key != "username" && key != "offer") || !(value.is_string() || value.is_none())) {
        return "resolvePasswordPrompt accepts only {username, offer}";
      }
    }
    if (const std::string* id = edits.FindString("offer")) offer = *id;
    if (const std::string* name = edits.FindString("username")) {
      if (name->size() > kMaxUsernameLength) return "The username is too long";
      if (!name->empty()) username = base::UTF8ToUTF16(*name);
    }
  }
  base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents);
  OpenPrompt* open = OpenPrompt::FromWebContents(contents);
  if (!model || !open || offer.empty() || offer != open->id) return std::string();
  content::RenderFrameHost* shown = open->document.AsRenderFrameHostIfValid();
  if (!shown || shown != contents->GetPrimaryMainFrame()) return std::string();
  std::optional<base::DictValue> current = Describe(contents);
  if (!current || OfferOf(*current) != open->offer) return std::string();
  if (!PasswordAnswerFits(*answer, StateOf(model->GetState()))) return std::string();
  CloseOpenPrompt(contents);
  switch (*answer) {
    case PasswordAnswer::kSave:
    case PasswordAnswer::kUpdate: {
      const password_manager::PasswordForm& pending = model->GetPendingPassword();
      model->SavePassword(username ? *username : pending.username_value, pending.password_value);
      break;
    }
    case PasswordAnswer::kNever:
      model->NeverSavePassword();
      break;
    case PasswordAnswer::kNope:
      model->OnNopeUpdateClicked();
      break;
    case PasswordAnswer::kDismiss:
      break;
  }
  if (model) model->OnBubbleHidden();
  return std::string();
}

}
