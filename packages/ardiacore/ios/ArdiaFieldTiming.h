#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

BOOL ArdiaFieldTimingEnabled(void);
double ArdiaFieldNow(void);
void ArdiaFieldMark(NSString *_Nullable key, NSString *kind, double at);
void ArdiaFieldMarkNow(NSString *_Nullable key, NSString *kind);
void ArdiaFieldMarkAtCommit(NSString *_Nullable key, NSString *kind);
void ArdiaWebViewsSetFieldTiming(BOOL on);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
