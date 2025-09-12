import { useState, useEffect, useCallback } from "react";
import { getBackendUrl } from "@/utils/config";

export function useHealthCheck() {
  const [healthy, setHealthy] = useState<boolean | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(`${getBackendUrl()}/api/health`);
      const data = await response.json();
      setHealthy(data.status === "ok");
    } catch (error) {
      setHealthy(false);
      console.error("Health check failed:", error);
    }
  }, []);

  useEffect(() => {
    // Initial health check
    checkHealth();
    
    // Set up periodic health checks every 30 seconds
    const healthInterval = setInterval(checkHealth, 30000);
    
    return () => clearInterval(healthInterval);
  }, [checkHealth]);

  return {
    healthy,
    setHealthy,
    checkHealth
  };
}
