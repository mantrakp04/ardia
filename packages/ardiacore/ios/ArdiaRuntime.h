#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

namespace ardia_runtime {

inline bool ReplaceMethod(Class cls, SEL sel, id (^make)(IMP original)) {
  Method method = cls ? class_getInstanceMethod(cls, sel) : nullptr;
  if (!method) return false;
  const IMP ours = imp_implementationWithBlock(make(method_getImplementation(method)));
  if (!class_addMethod(cls, sel, ours, method_getTypeEncoding(method))) method_setImplementation(method, ours);
  return true;
}

template <typename Block>
bool ReplaceMethodWith(Class cls, SEL sel, Block block) {
  return ReplaceMethod(cls, sel, ^id(IMP) { return block; });
}

inline void WithoutActions(void (^block)(void)) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  block();
  [CATransaction commit];
}

inline id JSONObject(NSString *json) {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
}

inline NSString *JSONText(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

inline void WipeSecret(NSMutableData *data) {
  volatile unsigned char *bytes = (volatile unsigned char *)data.mutableBytes;
  for (NSUInteger i = 0; i < data.length; i++) bytes[i] = 0;
}

}
