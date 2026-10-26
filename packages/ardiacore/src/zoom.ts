import { call } from "./engine/call";

export const setZoom = (profile: string, host: string, zoom: number) => call("sites.setZoom", { profile, host, zoom });
export const getZoomLevels = (profile: string) => call("sites.zoomLevels", { profile });
