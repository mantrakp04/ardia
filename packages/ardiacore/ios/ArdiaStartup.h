#import <Foundation/Foundation.h>

#include <string>
#include <vector>

namespace ardia_host {

void PrepareStartup(NSString *userDataDir, std::vector<std::string> &switches);

}
