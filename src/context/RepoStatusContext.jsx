import { createContext, useContext, useState, useCallback } from 'react';

const RepoStatusContext = createContext();

/**
 * Provider component for sharing repo status across multiple components
 * This prevents duplicate polling when multiple components need the same repo status
 */
export function RepoStatusProvider({ children }) {
  const [statusCache, setStatusCache] = useState({});

  const updateStatusCache = useCallback((repoId, statusData) => {
    setStatusCache(prev => ({
      ...prev,
      [repoId]: statusData
    }));
  }, []);

  const getCachedStatus = useCallback((repoId) => {
    return statusCache[repoId] || null;
  }, [statusCache]);

  return (
    <RepoStatusContext.Provider value={{ statusCache, updateStatusCache, getCachedStatus }}>
      {children}
    </RepoStatusContext.Provider>
  );
}

/**
 * Hook to access repo status cache
 */
export function useRepoStatusCache() {
  const context = useContext(RepoStatusContext);
  if (!context) {
    throw new Error('useRepoStatusCache must be used within RepoStatusProvider');
  }
  return context;
}
