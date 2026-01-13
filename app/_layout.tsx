import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useLocalSearchParams, usePathname, useGlobalSearchParams } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Linking from 'expo-linking';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/providers/AuthProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemedStatusBar } from '@/components/ThemedStatusBar';
import { getNotificationService, initializeNotificationHandler } from '@/services/notificationService';
import { getPermissionService } from '@/services/permissionService';
import { useRecordingStore } from '@/store/useRecordingStore';
import { config } from '@/lib/config';

// Import PostHog (enabled when EXPO_PUBLIC_POSTHOG_API_KEY is set)
import { usePostHog, PostHogProvider } from 'posthog-react-native';
import { posthog } from '@/lib/posthog';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Component to track screen views for expo-router (must be inside PostHogProvider)
// As per Expo Router docs: https://docs.expo.dev/router/reference/screen-tracking/
// and PostHog docs: https://posthog.com/docs/libraries/react-native#with-expo-router
function ScreenTracker() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const posthog = usePostHog();

  useEffect(() => {
    if (!posthog || typeof posthog?.screen !== 'function') return;

    // Track screen view with actual pathname (e.g., 'jobs/123' instead of 'jobs/[id]')
    // pathname includes resolved dynamic segments
    // For job detail pages, include tab parameter (default to 'askAI' if not present)
    let screenName = pathname || '(tabs)';
    
    // If we're on a job detail page, append tab to the screen name
    if (pathname?.startsWith('/jobs/') && pathname !== '/jobs' && pathname !== '/jobs/') {
      const validTabs = ['transcription', 'askAI', 'checklist', 'insights'];
      const tabParam = params.tab && typeof params.tab === 'string' ? params.tab : 'askAI';
      
      // Only append if it's a valid tab (default to 'askAI' to match job detail page default)
      if (validTabs.includes(tabParam)) {
        screenName = `${pathname}/${tabParam}`;
      }
    }
    
    posthog.screen(screenName);
    
    if (__DEV__) {
      console.log('[ScreenTracker] Screen tracked:', screenName, params);
    }
  }, [pathname, params, posthog]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const searchParams = useLocalSearchParams();
  const initialUrlProcessedRef = useRef(false);
  const initialNotificationProcessedRef = useRef(false);

  // Initialize notification handler first (must be done before using notification APIs)
  useEffect(() => {
    initializeNotificationHandler();
  }, []);

  // Initialize all permissions on app start
  // Requests microphone first, then notifications right after
  useEffect(() => {
    const initPermissions = async () => {
      try {
        const permissionService = getPermissionService();

        // Request all required permissions sequentially:
        // 1. Microphone permission
        // 2. Notification permission (right after microphone)
        // 3. Background permissions check
        const permissions = await permissionService.requestAllPermissions();

        if (__DEV__) {
          console.log('[RootLayout] ✅ Permissions initialized:', {
            microphone: permissions.microphone.granted,
            notifications: permissions.notifications.granted,
            background: permissions.background.granted,
          });
        }
      } catch (error) {
        console.warn('[RootLayout] Failed to initialize permissions:', error);
      }
    };

    initPermissions();
  }, []);

  // Handle deep links (from background service notification or other sources)
  useEffect(() => {
    const handleDeepLink = (url: string, isInitial = false) => {
      if (__DEV__) {
        console.log('[RootLayout] Deep link received:', url, isInitial ? '(initial)' : '(runtime)');
      }

      try {
        const parsedUrl = Linking.parse(url);
        let jobId: string | null = null;
        
        if (__DEV__) {
          console.log('[RootLayout] Parsed URL:', {
            scheme: parsedUrl.scheme,
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            queryParams: parsedUrl.queryParams,
          });
        }
        
        // Handle field://jobs/{id} format
        // The path might be "jobs/123" or just "jobs" with id in queryParams
        if (parsedUrl.path) {
          const pathParts = parsedUrl.path.split('/').filter(Boolean);
          if (__DEV__) {
            console.log('[RootLayout] Path parts:', pathParts);
          }
          if (pathParts[0] === 'jobs' && pathParts[1]) {
            // Format: field://jobs/123
            jobId = pathParts[1];
          }
        }
        
        // Fallback: check queryParams
        if (!jobId && parsedUrl.queryParams?.id) {
          jobId = parsedUrl.queryParams.id as string;
        }
        
        // Also check if the path itself contains the job ID (e.g., field://jobs/123)
        if (!jobId && parsedUrl.path) {
          const match = parsedUrl.path.match(/\/jobs\/([^\/]+)/);
          if (match && match[1]) {
            jobId = match[1];
          }
        }

        if (jobId) {
          if (__DEV__) {
            console.log('[RootLayout] Navigating to job:', jobId, isInitial ? '(initial - using replace)' : '(runtime)');
          }
          
          // Check current route to see if we need to navigate
          const currentPath = segments.join('/');
          const targetPath = `jobs/${jobId}`;
          
          if (__DEV__) {
            console.log('[RootLayout] Current path:', currentPath, 'Target path:', targetPath);
          }
          
          // Only navigate if we're not already on the target page
          if (!currentPath.includes(targetPath)) {
            // For initial URL, use replace immediately to prevent showing default route
            // For runtime URLs, also use replace to avoid navigation stack issues
            if (isInitial) {
              // Use setTimeout to ensure router is ready, but do it immediately
              setTimeout(() => {
                router.replace(`/jobs/${jobId}` as any);
              }, 0);
            } else {
              // For runtime deep links, navigate immediately
              router.replace(`/jobs/${jobId}` as any);
            }
          } else {
            if (__DEV__) {
              console.log('[RootLayout] Already on target page, skipping navigation');
            }
          }
        } else {
          if (__DEV__) {
            console.warn('[RootLayout] No jobId found in deep link:', url);
          }
        }
      } catch (error) {
        console.error('[RootLayout] Error parsing deep link:', error);
        if (__DEV__) {
          console.error('[RootLayout] URL that failed:', url);
        }
      }
    };

    // Handle initial URL (when app is opened from a deep link) - do this immediately
    // This needs to happen before the router initializes to prevent showing default route
    Linking.getInitialURL()
      .then((url) => {
        if (url && !initialUrlProcessedRef.current) {
          initialUrlProcessedRef.current = true;
          // Process immediately to prevent default route from showing
          handleDeepLink(url, true);
        }
      })
      .catch((error) => {
        console.error('[RootLayout] Error getting initial URL:', error);
      });

    // Handle deep links while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      // Check if we're on the jobs list and should navigate to a specific job
      const currentPath = segments.join('/');
      if (__DEV__) {
        console.log('[RootLayout] Deep link event, current path:', currentPath);
      }
      
      // Only handle if not already processed as initial URL
      if (!initialUrlProcessedRef.current) {
        handleDeepLink(event.url, false);
      } else {
        // If already processed initial URL, still handle runtime deep links
        handleDeepLink(event.url, false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [router, segments]);

  // Helper to navigate to job detail, avoiding re-navigation if already there
  const navigateToJobDetail = useCallback((jobId: string, tab?: string) => {
    const currentPath = segments.join('/');
    const targetPath = `jobs/${jobId}`;
    
    // Check if we're already on this exact job page
    const isOnJobPage = currentPath.includes(targetPath);
    
    // If a tab is specified, always navigate to ensure tab change happens
    // (searchParams might not be updated yet if we're navigating from a different route)
    if (isOnJobPage && !tab) {
      if (__DEV__) {
        console.log('[RootLayout] Already on job page without tab param, skipping navigation');
      }
      return;
    }
    
    if (__DEV__) {
      console.log('[RootLayout] Navigating to job:', jobId, 'Tab:', tab, 'Current path:', currentPath);
    }
    
    // Include tab parameter in URL if provided
    const url = tab ? `/jobs/${jobId}?tab=${tab}` : `/jobs/${jobId}`;
    router.replace(url as any);
  }, [router, segments]);

  // Handle notification responses (when user taps on notification)
  // Use dynamic import to avoid native module initialization errors at import time
  useEffect(() => {
    let subscription: any;
    
    const setupNotifications = async () => {
      try {
        // Dynamically import to avoid native module errors at top-level
        const Notifications = await import('expo-notifications');
        
        // Handle initial notification (when app is opened from a notification)
        // Only process once on app startup, not on every remount
        if (initialNotificationProcessedRef.current) {
          if (__DEV__) {
            console.log('[RootLayout] Initial notification already processed, skipping');
          }
        } else {
          // Mark as processed immediately to prevent duplicate calls
          initialNotificationProcessedRef.current = true;
          
          // Get the last notification response (synchronous replacement for deprecated async method)
          try {
            const response = Notifications.getLastNotificationResponse();
            if (response) {
              const data = response.notification.request.content.data;
              if (__DEV__) {
                console.log('[RootLayout] App opened from notification:', data);
              }

              // Handle different notification types
              const jobId = data?.jobId;
              if (jobId && typeof jobId === 'string') {
                if (data?.type === 'recording' || data?.type === 'proactive_suggestion') {
                  // For proactive suggestions, navigate to AskAI tab
                  const tab = data?.type === 'proactive_suggestion' && typeof data?.tab === 'string' ? data.tab : undefined;
                  
                  // If it's a proactive_suggestion notification, set flag to suppress recording confirmation
                  // Then set it back to true after a timeout to allow normal behavior
                  if (data?.type === 'proactive_suggestion') {
                    useRecordingStore.getState().setShouldShowRecordingConfirmation(false);
                    
                    // Set flag back to true after navigation completes (2 seconds should be enough)
                    setTimeout(() => {
                      useRecordingStore.getState().setShouldShowRecordingConfirmation(true);
                      if (__DEV__) {
                        console.log('[RootLayout] Recording confirmation flag reset to true after proactive_suggestion navigation');
                      }
                    }, 200);
                  }
                  
                  navigateToJobDetail(jobId, tab);
                } else {
                  // Fallback: if jobId exists, navigate to job detail
                  navigateToJobDetail(jobId);
                }
              }
            }
          } catch (error) {
            console.error('[RootLayout] Error getting last notification response:', error);
          }
        }

        // Handle notification clicks while app is running
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data;
          
          if (__DEV__) {
            console.log('[RootLayout] Notification clicked:', data);
          }

          // Handle different notification types
          const jobId = data?.jobId;
          if (jobId && typeof jobId === 'string') {
            if (data?.type === 'recording' || data?.type === 'proactive_suggestion') {
              // For proactive suggestions, navigate to AskAI tab
              const tab = data?.type === 'proactive_suggestion' && typeof data?.tab === 'string' ? data.tab : undefined;
              
              // If it's a proactive_suggestion notification, set flag to suppress recording confirmation
              // Then set it back to true after a timeout to allow normal behavior
              if (data?.type === 'proactive_suggestion') {
                useRecordingStore.getState().setShouldShowRecordingConfirmation(false);
                
                // Set flag back to true after navigation completes (2 seconds should be enough)
                setTimeout(() => {
                  useRecordingStore.getState().setShouldShowRecordingConfirmation(true);
                  if (__DEV__) {
                    console.log('[RootLayout] Recording confirmation flag reset to true after proactive_suggestion navigation');
                  }
                }, 2000);
              }
              
              navigateToJobDetail(jobId, tab);
            } else {
              // Fallback: if jobId exists, navigate to job detail
              navigateToJobDetail(jobId);
            }
          }
        });
      } catch (error) {
        console.error('[RootLayout] Error setting up notifications:', error);
      }
    };

    setupNotifications();

    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, [router, navigateToJobDetail]);


  const appContent = (
    <QueryProvider>
      <ThemeProvider>
        <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="jobs/index" options={{ headerShown: false, title: 'Jobs' }} />
              <Stack.Screen 
                name="jobs/[id]" 
                options={{ 
                  headerShown: false,
                  // Disable iOS native back button menu for better prevention control
                  headerBackButtonMenuEnabled: false,
                }} 
              />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            {/* StatusBar that responds to app theme (not system theme) */}
            <ThemedStatusBar />
          </AuthProvider>
        </NavigationThemeProvider>
      </ThemeProvider>
    </QueryProvider>
  );

  // Wrap with PostHogProvider using our instance (enabled when EXPO_PUBLIC_POSTHOG_API_KEY is set)
  if (posthog) {
    return (
      <PostHogProvider
          client={posthog}
          options={{
            captureAppLifecycleEvents: true, // Enable Application Opened, Became Active, Backgrounded, Installed, Updated events
            sessionExpirationTimeSeconds: 900, // 15 minutes
          }}
          autocapture={{
            captureTouches: true,
            captureScreens: false, // Disabled for expo-router - we track manually using ScreenTracker component
            ignoreLabels: [],
            customLabelProp: 'ph-label',
            maxElementsCaptured: 20,
            noCaptureProp: 'ph-no-capture',
            propsToCapture: ['testID'],
          }}
        >
          <ScreenTracker />
          {appContent}
        </PostHogProvider>
      );
    }

  return appContent;
}
