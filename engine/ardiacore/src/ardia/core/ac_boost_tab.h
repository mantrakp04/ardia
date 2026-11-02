// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_BOOST_TAB_H_
#define ARDIA_CORE_AC_BOOST_TAB_H_

#include <string>

class Profile;

namespace content {
class WebContents;
}

namespace ardiacore {

void AttachBoosts(content::WebContents* contents);

bool SetProfileBoosts(Profile* profile, const std::string& json);
const std::string& ProfileBoostsJson(Profile* profile);

bool PreviewBoost(content::WebContents* contents, const std::string& json);
void ClearBoostPreview(content::WebContents* contents);

}

#endif
