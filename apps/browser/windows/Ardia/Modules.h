#pragma once

#include "AppModule.h"
#include "ConfigModule.h"
#include "DialogsModule.h"
#include "DocumentsModule.h"
#include "KeychainModule.h"
#include "NotificationsModule.h"
#include "ShellModule.h"
#include "SystemModule.h"
#include "SystemSignalsModule.h"
#include "TelemetryLocalModule.h"
#include "WindowsHostModule.h"
#include "WindowsModule.h"

namespace Ardia {

inline void RegisterViews(winrt::Microsoft::ReactNative::IReactPackageBuilder const &) noexcept {}

}
