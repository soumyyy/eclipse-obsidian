// Configuration utility for dynamic backend URL detection
export const getBackendUrl = (): string => {
  // Check if we're in the browser
  if (typeof window === 'undefined') {
    // Server-side: use environment variable or default
    return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
  }

  // Client-side: check environment variable first
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }

  // Get the current hostname
  const hostname = window.location.hostname;
  
  // Development: localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8000';
  }
  
  // Production: Vercel deployment
  if (hostname.includes('vercel.app') || hostname.includes('vercel.com')) {
    // Use your custom VPS backend URL
    return 'https://134.209.147.97.nip.io:8000'; // Added port 8000
  }
  
  // Custom domain or other hosting
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // For custom domains, you might want to use a subdomain or different port
    return `https://api.${hostname}`; // or your specific backend URL
  }
  
  // Fallback
  return 'http://127.0.0.1:8000';
};

export const getFrontendUrl = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  return process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
};
