let required = false;

export const sharingRequired = () => required;
export const requireSharing = () => void (required = true);
