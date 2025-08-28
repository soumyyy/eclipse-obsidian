// Configuration utility for dynamic backend URL detection
export const getBackendUrl = (): string => {
  // Check if we're in the browser
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
  }

  // Get the current hostname
  const hostname = window.location.hostname;
  
  // If accessing from mobile device (different IP), use mobile backend URL
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // Extract the IP from the current hostname and use it for backend
    return `http://${hostname}:8000`;
  }
  
  // Default to local backend for localhost access
  return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
};

export const getFrontendUrl = (): string => {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
  }
  
  return window.location.origin;
};

// Utility function to safely parse JSON responses
export const safeJsonParse = (data: string): any | null => {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn('Failed to parse JSON:', data, error);
    return null;
  }
};

// Utility function to validate streaming response data
export const isValidStreamingData = (data: string): boolean => {
  if (!data || typeof data !== 'string') return false;
  
  // Check if it's a complete JSON object
  if (data.trim().startsWith('{') && data.trim().endsWith('}')) {
    try {
      JSON.parse(data);
      return true;
    } catch {
      return false;
    }
  }
  
  // Check if it's a special command
  if (data === '[DONE]' || data.startsWith('{"type":')) {
    return true;
  }
  
  return false;
};
