#import "ArdiaSavedDocument.h"

#include <cmath>

@implementation ArdiaSavedDocument

+ (NSDictionary *)read:(NSString *)name in:(NSString *)directory oldest:(NSInteger)oldest newest:(NSInteger)newest {
  NSData *data = directory.length ? [NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:name]] : nil;
  return [self parse:data oldest:oldest newest:newest];
}

+ (NSDictionary *)parse:(NSData *)data oldest:(NSInteger)oldest newest:(NSInteger)newest {
  id document = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![document isKindOfClass:NSDictionary.class]) return nil;
  id saved = document[@"version"];
  if (!saved) return oldest == 0 ? document : nil;
  if (![saved isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)saved) == CFBooleanGetTypeID()) return nil;
  const double version = [saved doubleValue];
  if (!std::isfinite(version) || version != std::floor(version) || version < oldest || version > newest) return nil;
  return document;
}

@end
