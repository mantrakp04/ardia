#pragma once
#include "base/memory/scoped_refptr.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/password_manager/core/browser/password_store/password_store_interface.h"
struct ProfilePasswordStoreFactory {
  static scoped_refptr<password_manager::PasswordStoreInterface> GetForProfile(Profile* profile, ServiceAccessType) {
    return profile->profile_store;
  }
};
