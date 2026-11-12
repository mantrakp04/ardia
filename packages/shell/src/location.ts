export type LocationPermission = "granted" | "denied" | "restricted" | "notDetermined" | "servicesOff";

export type LocationNative = {
  locationPermission(): Promise<LocationPermission>;
  requestLocationPermission(): Promise<LocationPermission>;
  openLocationSettings(): Promise<void>;
  devLocationRequests(): Promise<number>;
};
