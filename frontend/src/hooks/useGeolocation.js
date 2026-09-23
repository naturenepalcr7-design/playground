'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * GPS Geolocation Hook
 * Tracks live device position with accuracy monitoring.
 */
export default function useGeolocation(options = {}) {
  const {
    enableHighAccuracy = true,
    maximumAge = 5000,
    timeout = 15000,
    watch = true,
  } = options;

  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef(null);

  const handleSuccess = useCallback((pos) => {
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      altitude: pos.coords.altitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: pos.timestamp,
    });
    setError(null);
    setIsTracking(true);
  }, []);

  const handleError = useCallback((err) => {
    setError({
      code: err.code,
      message: err.message,
    });
    setIsTracking(false);
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError({ code: 0, message: 'Geolocation not supported' });
      return;
    }

    const geoOptions = { enableHighAccuracy, maximumAge, timeout };

    if (watch) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess, handleError, geoOptions
      );
    } else {
      navigator.geolocation.getCurrentPosition(
        handleSuccess, handleError, geoOptions
      );
    }
  }, [enableHighAccuracy, maximumAge, timeout, watch, handleSuccess, handleError]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  }, []);

  useEffect(() => {
    startTracking();
    return () => stopTracking();
  }, [startTracking, stopTracking]);

  return {
    position,
    error,
    isTracking,
    startTracking,
    stopTracking,
  };
}
