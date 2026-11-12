#ifndef ARDIA_WIN_PROFILES_H_
#define ARDIA_WIN_PROFILES_H_

#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/callback.h"

class Profile;

namespace ardia_win {

struct ProfileName {
  std::string directory;
  bool off_the_record = false;
};

ProfileName ParseProfileName(std::string_view name);

base::FilePath ProfilePath(const ProfileName& name);

void WithProfile(std::string_view name,
                 base::OnceCallback<void(Profile*)> callback);

std::string NameOfProfile(Profile* profile);

std::string NameOfProfilePath(const base::FilePath& path);

}

#endif
