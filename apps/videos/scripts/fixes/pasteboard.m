#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static NSPasteboard *gPrivate;

static NSPasteboard *PrivatePasteboard(id self, SEL _cmd) { return gPrivate; }

__attribute__((constructor)) static void PasteboardInit(void) {
  const char *name = getenv("FIXES_PASTEBOARD_NAME");
  if (!name) return;
  gPrivate = [NSPasteboard pasteboardWithName:[NSString stringWithUTF8String:name]];
  [gPrivate clearContents];
  Method general = class_getClassMethod([NSPasteboard class], @selector(generalPasteboard));
  method_setImplementation(general, (IMP)PrivatePasteboard);
}
