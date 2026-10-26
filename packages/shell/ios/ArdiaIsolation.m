#import "ArdiaIsolation.h"

#import <ArdiaCore/ArdiaLaunchConfig.h>

#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static NSString *gDataDirectory;
static NSUserDefaults *gDefaults;

NSString *ArdiaIsolatedDataDirectory(void) { return gDataDirectory; }

static NSUserDefaults *IsolatedStandardUserDefaults(id self, SEL _cmd) { return gDefaults; }

#if DEBUG
static NSString *gPasteboardName;
static IMP gPasteboardWithName;

static NSPasteboard *SystemPasteboardWithName(NSPasteboardName name) {
  return ((NSPasteboard * (*)(id, SEL, NSPasteboardName)) gPasteboardWithName)(NSPasteboard.class, @selector(pasteboardWithName:), name);
}

static NSPasteboard *IsolatedGeneralPasteboard(id self, SEL _cmd) { return SystemPasteboardWithName(gPasteboardName); }

static NSPasteboard *IsolatedPasteboardWithName(id self, SEL _cmd, NSPasteboardName name) {
  return SystemPasteboardWithName([name isEqualToString:NSPasteboardNameGeneral] ? gPasteboardName : name);
}

static void IsolatePasteboard(NSString *dataDirectory) {
  gPasteboardName = [@"com.ardia.scratch:" stringByAppendingString:dataDirectory];
  Method withName = class_getClassMethod(NSPasteboard.class, @selector(pasteboardWithName:));
  gPasteboardWithName = method_getImplementation(withName);
  method_setImplementation(withName, (IMP)IsolatedPasteboardWithName);
  method_setImplementation(class_getClassMethod(NSPasteboard.class, @selector(generalPasteboard)), (IMP)IsolatedGeneralPasteboard);
}
#endif

@interface ArdiaIsolation : NSObject
@end

@implementation ArdiaIsolation

+ (void)load {
  gDataDirectory = ArdiaLaunchConfig.shared.dataDirectory;
  if (!gDataDirectory) return;
#if DEBUG
  IsolatePasteboard(gDataDirectory);
#endif
  NSString *domain = NSBundle.mainBundle.bundleIdentifier ?: @"com.ardia.browser";
  gDefaults = [[NSUserDefaults alloc]
      initWithSuiteName:[[gDataDirectory stringByAppendingPathComponent:@"Preferences"] stringByAppendingPathComponent:domain]];
  if (!gDefaults) return;
  method_setImplementation(class_getClassMethod(NSUserDefaults.class, @selector(standardUserDefaults)),
                           (IMP)IsolatedStandardUserDefaults);
}

@end
