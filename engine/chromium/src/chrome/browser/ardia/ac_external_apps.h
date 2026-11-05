// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_EXTERNAL_APPS_H_
#define CHROME_BROWSER_ARDIA_AC_EXTERNAL_APPS_H_

#import <Foundation/Foundation.h>

namespace ardia {

struct ExternalApp {
  NSString* name;
  NSString* icon;
};

ExternalApp DescribeExternalApp(NSURL* app);

}

#endif
