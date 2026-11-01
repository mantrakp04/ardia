#ifndef ARDIA_LINUX_AC_LINUX_PAGE_PROMPTS_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_PROMPTS_H_

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/functional/callback.h"
#include "base/values.h"

namespace content {
class WebContents;
}

namespace ardiacore {

struct LinuxPromptTab {
  int window = 0;
  std::string key;
  int shown = -1;
};

struct LinuxPagePromptsDelegate {
  base::RepeatingCallback<LinuxPromptTab(content::WebContents*)> tab_for;
  base::RepeatingCallback<bool(int window, std::string_view name, base::DictValue data)> deliver;
  base::RepeatingCallback<bool(content::WebContents*, std::string_view name, base::Value data)> page_event;
};

void StartLinuxPagePrompts(LinuxPagePromptsDelegate delegate);

bool LinuxPagePromptCallHandles(std::string_view name);
std::string LinuxPagePromptCall(int window, std::string_view name, const base::DictValue& input);

bool LinuxPagePromptCommandHandles(std::string_view command);
std::string LinuxPagePromptCommand(content::WebContents* contents, std::string_view command,
                                   const base::ListValue& args);

std::vector<std::pair<std::string, base::Value>> LinuxPagePromptSnapshot(content::WebContents* contents);
void RedeliverLinuxPermissionPrompts(content::WebContents* contents);

void TrackLinuxAutofillFocus(content::WebContents* contents);
bool ShowLinuxAutofillSuggestions(content::WebContents* contents, bool passwords);

}

#endif
