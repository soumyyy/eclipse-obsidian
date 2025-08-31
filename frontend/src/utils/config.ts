// Backend URL resolution from env only (no hardcoded IPs)
export const getBackendUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;
  return url || 'http://localhost:8000';
};

export const getFrontendUrl = (): string => {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
};
