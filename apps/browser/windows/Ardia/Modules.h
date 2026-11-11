#pragma once

#include "AppModule.h"
#include "ConfigModule.h"
#include "DialogsModule.h"
#include "DocumentsModule.h"
#include "EngineHostModule.h"
#include "FileDropModule.h"
#include "FocusModule.h"
#include "KeychainModule.h"
#include "MaterialViews.h"
#include "MaterialsModule.h"
#include "MenusModule.h"
#include "NotificationsModule.h"
#include "ShellModule.h"
#include "SystemModule.h"
#include "SystemSignalsModule.h"
#include "TelemetryLocalModule.h"
#include "VectorIconView.h"
#include "WindowsHostModule.h"
#include "WindowsModule.h"

namespace Ardia {

inline void RegisterViews(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
  RegisterVectorIconView(packageBuilder);
  RegisterMaterialViews(packageBuilder);
}

}
