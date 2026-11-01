#ifndef ARDIA_LINUX_AC_LINUX_PAGE_PROMPTS_INTERNAL_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_PROMPTS_INTERNAL_H_

#include <optional>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_page_prompts.h"
#include "base/values.h"

namespace content {
class WebContents;
}

namespace ardiacore::linux_page_prompts {

LinuxPromptTab TabFor(content::WebContents* contents);
bool Deliver(int window, std::string_view name, base::DictValue data);
bool PageEvent(content::WebContents* contents, std::string_view name, base::Value data);

void InstallPermissionPrompts();
std::string ResolvePermission(int window, const base::DictValue& input);
void RedeliverPermissions(content::WebContents* contents);

void InstallPasswordPrompts();
std::string ResolvePasswordPrompt(content::WebContents* contents, const base::ListValue& args);
std::optional<base::DictValue> OpenPasswordPrompt(content::WebContents* contents);

void InstallAutofillPrompts();
std::string ResolveAutofillPrompt(content::WebContents* contents, const base::ListValue& args);
std::optional<base::DictValue> OpenAutofillPrompt(content::WebContents* contents);

void InstallExternalAppPrompts();
std::string ResolveExternalApp(int window, const base::DictValue& input);
std::optional<base::DictValue> OpenExternalApp(content::WebContents* contents);

}

#endif
