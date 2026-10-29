import { useEffect, useState, useRef } from 'react';
import { api } from '../utils/api';

export const READY_REPO_STATUS = 'READY';
export const FAILED_REPO_STATUS = 'FAILED';

const TERMINAL_REPO_STATUSES = new Set([READY_REPO_STATUS, FAILED_REPO_STATUS]);

/**
 * Module-level caching to deduplicate polling across multiple
 * instances of the hook for the same repoId
 */
const statusCache = new Map();
const pollersMap = new Map(); // Track active pollers per repoId

const REPO_STATUS_LABELS = {
  RECEIVED: 'Analysis queued',
  CLONING: 'Cloning repository',
  SCANNING: 'Scanning files',
  PARSING: 'Parsing functions and symbols',
  GRAPHING: 'Building graphs and summaries',
  READY: 'Analysis complete',
  FAILED: 'Analysis failed',
};

export function getRepoStatusLabel(status) {
  return REPO_STATUS_LABELS[status] || 'Preparing analysis';
}

export function useRepoStatus(repoId, options = {}) {
  const { enabled = true, pollIntervalMs = 3000 } = options;
  const [status, setStatus] = useState(() => statusCache.get(repoId)?.status || null);
  const [meta, setMeta] = useState(() => statusCache.get(repoId)?.meta || null);
  const [loading, setLoading] = useState(Boolean(enabled && repoId && !statusCache.has(repoId)));
  const [error, setError] = useState(null);

  const pollerRef = useRef(null);

  useEffect(() => {
    if (!enabled || !repoId) {
      setLoading(false);
      return undefined;
    }

    // Check if we already have cached data
    if (statusCache.has(repoId)) {
      const cached = statusCache.get(repoId);
      setStatus(cached.status);
      setMeta(cached.meta);
      setError(cached.error || null);
      setLoading(false);
      
      // If status is terminal, don't poll again
      if (TERMINAL_REPO_STATUSES.has(cached.status)) {
        return undefined;
      }
    }

    // Check if there's already an active poller for this repoId
    if (pollersMap.has(repoId)) {
      // Subscribe to existing poller
      const poller = pollersMap.get(repoId);
      poller.subscribers.add(setStatus);
      poller.subscribers.add(setMeta);

      return () => {
        poller.subscribers.delete(setStatus);
        poller.subscribers.delete(setMeta);
      };
    }

    // Create new poller for this repoId
    let active = true;
    let timeoutId = null;
    let lastStatus = null;
    let consecutiveReceivedCount = 0;

    const getBackoffInterval = (status) => {
      // If stuck in RECEIVED state, use exponential backoff (3s, 6s, 12s, 30s max)
      if (status === 'RECEIVED') {
        const backoffMs = Math.min(pollIntervalMs * Math.pow(2, consecutiveReceivedCount), 30000);
        return backoffMs;
      }
      return pollIntervalMs;
    };

    const notifySubscribers = (nextStatus, nextMeta, nextError) => {
      // Update all subscriber callbacks
      pollersMap.get(repoId)?.subscribers.forEach(sub => {
        try {
          if (sub === setStatus) sub(nextStatus);
          else if (sub === setMeta) sub(nextMeta);
        } catch (e) {
          // Ignore errors from notify
        }
      });
    };

    const scheduleNextPoll = (nextStatus) => {
      if (!active) return;
      // Don't schedule if in terminal state
      if (TERMINAL_REPO_STATUSES.has(nextStatus)) {
        return;
      }
      const interval = getBackoffInterval(nextStatus);
      timeoutId = window.setTimeout(loadStatus, interval);
    };

    const loadStatus = async () => {
      if (!active) return;
      
      try {
        const response = await api.get(`/${repoId}/status`, { cache: 'no-store' });

        if (!active) return;

        const nextMeta = response?.data || null;
        const nextStatus = nextMeta?.status || null;

        // Track consecutive RECEIVED states for exponential backoff
        if (nextStatus === 'RECEIVED') {
          consecutiveReceivedCount += 1;
        } else {
          consecutiveReceivedCount = 0;
        }

        // Update cache
        statusCache.set(repoId, {
          status: nextStatus,
          meta: nextMeta,
          error: null,
          timestamp: Date.now(),
        });

        // Only notify if status changed to prevent unnecessary renders
        if (nextStatus !== lastStatus) {
          lastStatus = nextStatus;
          setStatus(nextStatus);
          setMeta(nextMeta);
          setError(null);
          setLoading(false);
          notifySubscribers(nextStatus, nextMeta, null);
        }

        // Schedule next poll only if not terminal state
        scheduleNextPoll(nextStatus);
      } catch (err) {
        if (!active) return;
        const errMsg = err.message || 'Failed to load repository status.';
        setError(errMsg);
        setLoading(false);
        
        // Update cache with error
        statusCache.set(repoId, {
          status: lastStatus,
          meta,
          error: errMsg,
          timestamp: Date.now(),
        });
        
        // Retry on error with same interval
        scheduleNextPoll(lastStatus);
      }
    };

    // Create poller object
    const poller = {
      subscribers: new Set([setStatus, setMeta]),
      timeoutId,
    };
    pollersMap.set(repoId, poller);

    setLoading(true);
    loadStatus();

    return () => {
      active = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      
      // Remove this component from subscribers
      poller.subscribers.delete(setStatus);
      poller.subscribers.delete(setMeta);
      
      // If no more subscribers, remove the poller
      if (poller.subscribers.size === 0) {
        pollersMap.delete(repoId);
      }
    };
  }, [enabled, repoId, pollIntervalMs]);

  return {
    status,
    meta,
    loading,
    error,
    isReady: status === READY_REPO_STATUS,
    isFailed: status === FAILED_REPO_STATUS,
    isProcessing: Boolean(status) && !TERMINAL_REPO_STATUSES.has(status),
  };
}
