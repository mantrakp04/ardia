#pragma once

#import <Foundation/Foundation.h>

namespace ac::nativemessaging {

bool ApplePasswordsHelperAllowed();
void SyncHosts(NSString *userDataDir);

}
