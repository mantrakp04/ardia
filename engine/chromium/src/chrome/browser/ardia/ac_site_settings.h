// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_SITE_SETTINGS_H_
#define CHROME_BROWSER_ARDIA_AC_SITE_SETTINGS_H_

#include "chrome/browser/ardia/ac_engine.h"

AC_ENGINE_CALL(ac_site_settings_get);
AC_ENGINE_CALL(ac_site_settings_set);
AC_ENGINE_CALL(ac_site_settings_reset);
AC_ENGINE_CALL(ac_site_settings_origins);
AC_ENGINE_CALL(ac_site_data_clear);
AC_ENGINE_CALL(ac_privacy_settings);

#endif
