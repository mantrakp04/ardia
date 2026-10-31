#ifndef ARDIA_LINUX_AC_LINUX_LAUNCH_CONFIG_H_
#define ARDIA_LINUX_AC_LINUX_LAUNCH_CONFIG_H_

#include "base/files/file_path.h"
#include "base/values.h"

namespace ardiacore {

void InitializeLinuxLaunchConfig();

base::DictValue LinuxLaunchConfig(const base::FilePath& data_directory,
                                 const base::FilePath& user_data_directory);

}

#endif
