import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  RefreshControl,
  StyleSheet,
  View,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Keyboard,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import type { Job, JobStatus, JobFilterOptions } from '@/services/jobService';
import type { User } from '@/store/useAuthStore';
import { jobService, type CreateJobRequest } from '@/services/jobService';
import { usersService } from '@/services/usersService';
import { posthog, PostHogEvents, getCompanyIdForTracking } from '@/lib/posthog';

type Props = {
  onRefresh: (filters?: JobFilterOptions) => void;
  onJobPress?: (job: Job) => void;
  jobs: Job[];
  loading: boolean;
  error?: string | null;
  currentUser?: User | null;
  currentFilters?: JobFilterOptions;
  onFiltersChange?: (filters: JobFilterOptions | undefined) => void;
};

const STATUS_CONFIG: Record<
  JobStatus,
  { icon: keyof typeof Ionicons.glyphMap; variant: 'default' | 'success' | 'warning'; label: string }
> = {
  scheduled: { icon: 'calendar-outline', variant: 'default', label: 'Scheduled' },
  ongoing: { icon: 'radio-button-on', variant: 'warning', label: 'In Progress' },
  completed: { icon: 'checkmark-circle', variant: 'success', label: 'Completed' },
};

interface JobCardProps {
  job: Job;
  onPress?: () => void;
}

const JobCard: React.FC<JobCardProps> = ({ job, onPress }) => {
  const { colors } = useTheme();
  const statusConfig = STATUS_CONFIG[job.status];

  return (
    <Card pressable onPress={onPress} style={styles.jobCard}>
      <CardHeader style={styles.jobCardHeader}>
        <ThemedText style={styles.jobTitle} numberOfLines={1}>
          {job.job_target_name || 'Untitled job'}
        </ThemedText>
        <Badge variant={statusConfig.variant} icon={statusConfig.icon} size="sm">
          {statusConfig.label}
        </Badge>
      </CardHeader>

      <CardBody>
        <View style={styles.jobInfoRow}>
          <Ionicons name="location-outline" size={14} color={colors.icon} />
          <ThemedText
            style={[styles.jobInfoText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {job.address}
          </ThemedText>
        </View>
        <View style={styles.jobInfoRow}>
          <Ionicons name="time-outline" size={14} color={colors.icon} />
          <ThemedText style={[styles.jobInfoText, { color: colors.textSecondary }]}>
            {new Date(job.start_timestamp).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </ThemedText>
        </View>
      </CardBody>

      <CardFooter>
        <ThemedText style={[styles.viewDetailsText, { color: colors.primary }]}>
          View Details
        </ThemedText>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </CardFooter>
    </Card>
  );
};

export const JobsList: React.FC<Props> = ({ 
  onRefresh, 
  onJobPress, 
  jobs, 
  loading, 
  error, 
  currentUser,
  currentFilters,
  onFiltersChange 
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<JobStatus | 'all'>('all');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTechSelectOpen, setIsTechSelectOpen] = useState(false);
  
  // Date picker states
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  
  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Initialize filter state from currentFilters prop
  useEffect(() => {
    if (currentFilters) {
      if (currentFilters.status) {
        setFilterStatus(currentFilters.status);
      }
      if (currentFilters.start_timestamp_from) {
        const dateStr = currentFilters.start_timestamp_from.split('T')[0];
        setFilterFrom(dateStr);
      }
      if (currentFilters.start_timestamp_to) {
        const dateStr = currentFilters.start_timestamp_to.split('T')[0];
        setFilterTo(dateStr);
      }
      if (currentFilters.job_target_name) {
        setSearch(currentFilters.job_target_name);
        setDebouncedSearch(currentFilters.job_target_name);
      }
    }
  }, []); // Only run once on mount

  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 16)); // yyyy-mm-ddThh:mm
  const [startDateValue, setStartDateValue] = useState<Date>(new Date()); // Date object for picker
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [description, setDescription] = useState('');
  const [technicianId, setTechnicianId] = useState<string>(currentUser?.id ?? 'unassigned');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  type TechnicianOption = { id?: string; first_name?: string; last_name?: string };
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [techniciansError, setTechniciansError] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const isTechnician = currentUser?.role === 'technician';

  // Track keyboard height on Android to position modal content above keyboard
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const keyboardShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });

    const keyboardHideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, []);

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!customerName.trim()) errors.customerName = 'Customer/Company is required';
    if (!address.trim()) errors.address = 'Address is required';
    if (!startDate) errors.startDate = 'Start date/time is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const loadTechnicians = useCallback(async () => {
    if (isTechnician) return;
    setTechniciansLoading(true);
    setTechniciansError(null);
    try {
      const res = await usersService.listUsers({ role: 'technician', limit: 100 });
      const mapped =
        res.users?.map((u) => ({
          id: u.id,
          first_name: u.first_name ?? undefined,
          last_name: u.last_name ?? undefined,
        })) ?? [];
      setTechnicians(mapped);
    } catch (err: any) {
      setTechniciansError(err?.message || 'Unable to load technicians');
    } finally {
      setTechniciansLoading(false);
    }
  }, [isTechnician]);

  useEffect(() => {
    if (isCreateModalOpen && !isTechnician) {
      loadTechnicians();
    }
    // Reset date picker state when modal closes (only relevant for iOS now)
    if (!isCreateModalOpen && Platform.OS === 'ios') {
      setShowStartDatePicker(false);
    }
  }, [isCreateModalOpen, isTechnician, loadTechnicians]);

  // Debounce search input - update debouncedSearch after 500ms of no typing
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [search]);
  
  // Track previous debouncedSearch to avoid unnecessary API calls
  const prevDebouncedSearchRef = useRef<string>('');
  const isInitialMountRef = useRef(true);
  
  // Trigger server-side search when debouncedSearch changes
  useEffect(() => {
    // Skip on initial mount (filters are already applied from props)
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevDebouncedSearchRef.current = debouncedSearch;
      return;
    }
    
    // Skip if debouncedSearch hasn't actually changed
    if (prevDebouncedSearchRef.current === debouncedSearch) {
      return;
    }
    
    prevDebouncedSearchRef.current = debouncedSearch;
    
    // Build filter options with current filters + search
    const filterOptions: JobFilterOptions = { ...currentFilters };
    
    if (debouncedSearch.trim()) {
      filterOptions.job_target_name = debouncedSearch.trim();
    } else {
      // Remove job_target_name if search is cleared
      delete filterOptions.job_target_name;
    }
    
    // Update parent's filter state and trigger refresh
    onFiltersChange?.(Object.keys(filterOptions).length > 0 ? filterOptions : undefined);
    onRefresh(filterOptions);
  }, [debouncedSearch, onRefresh, onFiltersChange, currentFilters]); // Only trigger on debouncedSearch change
  
  // No client-side filtering - all filtering is server-side
  const filteredJobs = jobs;

  // Blur search input when keyboard hides (fixes Android caret lingering)
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      searchInputRef.current?.blur();
    });
    return () => sub.remove();
  }, []);

  const groupedJobs = useMemo(() => {
    const scheduled = filteredJobs.filter((j) => j.status === 'scheduled');
    const ongoing = filteredJobs.filter((j) => j.status === 'ongoing');
    const completed = filteredJobs.filter((j) => j.status === 'completed');
    // sort by start time desc
    const sortByDate = (arr: Job[]) =>
      [...arr].sort((a, b) => new Date(b.start_timestamp).getTime() - new Date(a.start_timestamp).getTime());
    return {
      scheduled: sortByDate(scheduled),
      ongoing: sortByDate(ongoing),
      completed: sortByDate(completed),
    };
  }, [filteredJobs]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      // Use startDateValue (Date object) instead of startDate (string)
      const startDateISO = startDateValue.toISOString();
      const payload: CreateJobRequest = {
        job_target_name: customerName.trim(),
        address: address.trim(),
        start_timestamp: startDateISO,
        description: description.trim() || undefined,
      };
      if (!isTechnician && technicianId && technicianId !== 'unassigned') {
        payload.technician_id = technicianId;
      }
      if (isTechnician && currentUser?.id) {
        payload.technician_id = currentUser.id;
      }

      const createdJob = await jobService.createJob(payload);
      
      // Track job creation event
      if (posthog) {
        const companyId = createdJob.company_id ? Number(createdJob.company_id) : getCompanyIdForTracking();
        posthog.capture(PostHogEvents.JOB_CREATED, {
          job_id: createdJob.id,
          ...(companyId !== undefined && { company_id: companyId }),
          ...(createdJob.technician_id && { technician_id: createdJob.technician_id }),
        });
      }
      
      // reset form
      setCustomerName('');
      setAddress('');
      setDescription('');
      const now = new Date();
      setStartDate(now.toISOString().slice(0, 16));
      setStartDateValue(now);
      if (!isTechnician) {
        setTechnicianId('unassigned');
      } else if (currentUser?.id) {
        setTechnicianId(currentUser.id);
      }
      setFormErrors({});
      setIsCreateModalOpen(false);
      onRefresh();
    } catch (err) {
      console.error('Error creating job:', err);
    } finally {
      setSubmitting(false);
    }
  }, [customerName, address, startDateValue, description, technicianId, isTechnician, currentUser, onRefresh]);

  const renderSection = (title: string, data: Job[]) => {
    if (data.length === 0) return null;
    return (
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            {title} ({data.length})
          </ThemedText>
        </View>
        {data.map((job) => (
          <JobCard key={job.id} job={job} onPress={onJobPress ? () => onJobPress(job) : undefined} />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <ThemedText type="title" style={styles.title}>
            Jobs
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
            Manage your service jobs
          </ThemedText>
        </View>
        <Button 
          size="sm" 
          variant="primary" 
          onPress={() => {
            setIsCreateModalOpen(true);
            // Track job creation started
            if (posthog) {
              const companyId = getCompanyIdForTracking();
              posthog.capture(PostHogEvents.JOB_CREATION_STARTED, {
                ...(companyId !== undefined && { company_id: companyId }),
              });
            }
          }} 
          icon="add"
        >
          New Job
        </Button>
      </View>

      {error && (
        <ThemedText style={[styles.feedbackText, { color: colors.error }]}>{error}</ThemedText>
      )}

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            ref={searchInputRef}
            placeholder="Search jobs..."
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
          onPress={() => setIsFilterModalOpen(true)}
        >
          <Ionicons name="filter" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.jobsList}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              // Use current filters when refreshing
              onRefresh(currentFilters);
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressViewOffset={Spacing.lg}
          />
        }
      >
        {renderSection('Upcoming', groupedJobs.scheduled)}
        {renderSection('Ongoing', groupedJobs.ongoing)}
        {renderSection('Completed', groupedJobs.completed)}
        {!loading && filteredJobs.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="cloud-download-outline" size={48} color={colors.iconSecondary} />
            <ThemedText style={[styles.emptyTitle, { color: colors.textSecondary }]}>No jobs found</ThemedText>
            <ThemedText style={[styles.mutedText, { color: colors.textTertiary }]}>
              Pull down to refresh or adjust filters
            </ThemedText>
          </View>
        )}
      </ScrollView>

      {/* Filter Modal */}
      <Modal
        visible={isFilterModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFilterModalOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsFilterModalOpen(false)}>
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.backgroundSecondary }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ThemedText type="subtitle" style={styles.modalTitle}>
              Filters
            </ThemedText>
            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>Status</ThemedText>
            <View style={styles.statusRow}>
              {(['all', 'scheduled', 'ongoing', 'completed'] as const).map((statusKey) => (
                <TouchableOpacity
                  key={statusKey}
                  onPress={() => setFilterStatus(statusKey)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        filterStatus === statusKey ? colors.primary : colors.backgroundSecondary,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <ThemedText
                    style={{
                      color: filterStatus === statusKey ? '#fff' : colors.text,
                      fontWeight: '600',
                    }}
                  >
                    {statusKey === 'all' ? 'All' : STATUS_CONFIG[statusKey as JobStatus].label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>From Date</ThemedText>
            <TouchableOpacity
              style={[styles.modalInput, styles.datePickerButton, { borderColor: colors.border }]}
              onPress={() => setShowFromPicker(true)}
            >
              <ThemedText style={{ color: filterFrom ? colors.text : colors.textTertiary }}>
                {filterFrom || 'Select start date'}
              </ThemedText>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {filterFrom && (
              <TouchableOpacity
                onPress={() => setFilterFrom('')}
                style={{ alignSelf: 'flex-start', marginTop: -Spacing.xs }}
              >
                <ThemedText style={{ color: colors.primary, fontSize: FontSizes.sm }}>Clear</ThemedText>
              </TouchableOpacity>
            )}
            {showFromPicker && (
              <DateTimePicker
                value={fromDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selectedDate) => {
                  setShowFromPicker(Platform.OS === 'ios');
                  if (selectedDate) {
                    setFromDate(selectedDate);
                    setFilterFrom(selectedDate.toISOString().split('T')[0]); // YYYY-MM-DD
                  }
                }}
              />
            )}

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>To Date</ThemedText>
            <TouchableOpacity
              style={[styles.modalInput, styles.datePickerButton, { borderColor: colors.border }]}
              onPress={() => setShowToPicker(true)}
            >
              <ThemedText style={{ color: filterTo ? colors.text : colors.textTertiary }}>
                {filterTo || 'Select end date'}
              </ThemedText>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {filterTo && (
              <TouchableOpacity
                onPress={() => setFilterTo('')}
                style={{ alignSelf: 'flex-start', marginTop: -Spacing.xs }}
              >
                <ThemedText style={{ color: colors.primary, fontSize: FontSizes.sm }}>Clear</ThemedText>
              </TouchableOpacity>
            )}
            {showToPicker && (
              <DateTimePicker
                value={toDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selectedDate) => {
                  setShowToPicker(Platform.OS === 'ios');
                  if (selectedDate) {
                    setToDate(selectedDate);
                    setFilterTo(selectedDate.toISOString().split('T')[0]); // YYYY-MM-DD
                  }
                }}
              />
            )}

            <View style={styles.modalButtons}>
              <Button 
                variant="secondary" 
                size="sm" 
                onPress={() => {
                  setIsFilterModalOpen(false);
                  // Track filter cancelled
                  if (posthog) {
                    const companyId = getCompanyIdForTracking();
                    posthog.capture(PostHogEvents.JOB_FILTER_CANCELLED, {
                      ...(companyId !== undefined && { company_id: companyId }),
                    });
                  }
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onPress={() => {
                  setIsFilterModalOpen(false);
                  
                  // Build filter options for server-side filtering
                  const filterOptions: JobFilterOptions = { ...currentFilters };
                  
                  if (filterStatus !== 'all') {
                    filterOptions.status = filterStatus as JobStatus;
                  } else {
                    // Remove status filter if 'all' is selected
                    delete filterOptions.status;
                  }
                  
                  if (filterFrom) {
                    // Convert YYYY-MM-DD to ISO 8601 with time
                    filterOptions.start_timestamp_from = `${filterFrom}T00:00:00Z`;
                  } else {
                    // Remove date filter if cleared
                    delete filterOptions.start_timestamp_from;
                  }
                  
                  if (filterTo) {
                    // Convert YYYY-MM-DD to ISO 8601 with time (end of day)
                    filterOptions.start_timestamp_to = `${filterTo}T23:59:59Z`;
                  } else {
                    // Remove date filter if cleared
                    delete filterOptions.start_timestamp_to;
                  }
                  
                  // Preserve search if it exists
                  if (debouncedSearch.trim()) {
                    filterOptions.job_target_name = debouncedSearch.trim();
                  }
                  
                  // Track filter applied
                  if (posthog) {
                    const companyId = getCompanyIdForTracking();
                    posthog.capture(PostHogEvents.JOB_FILTER_APPLIED, {
                      ...(companyId !== undefined && { company_id: companyId }),
                      ...(filterOptions.status && { status: filterOptions.status }),
                      ...(filterOptions.start_timestamp_from && { has_date_from: true }),
                      ...(filterOptions.start_timestamp_to && { has_date_to: true }),
                      ...(filterOptions.job_target_name && { has_search: true }),
                    });
                  }
                  
                  // Update parent's filter state
                  onFiltersChange?.(Object.keys(filterOptions).length > 0 ? filterOptions : undefined);
                  
                  // Apply server-side filters
                  onRefresh(filterOptions);
                }}
              >
                Apply Filters
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create Job Modal */}
      <Modal
        visible={isCreateModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsCreateModalOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsCreateModalOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1, justifyContent: 'flex-end' }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.backgroundSecondary }}>
              <Pressable
                style={[
                  styles.modalContent,
                  styles.createJobModalContent,
                  { backgroundColor: colors.backgroundSecondary },
                  {
                    maxHeight: Platform.OS === 'android' && keyboardHeight > 0
                      ? Dimensions.get('window').height - keyboardHeight - insets.top - 20 // Account for keyboard + top safe area
                      : Dimensions.get('window').height - insets.top - insets.bottom - 20, // Account for top + bottom safe areas
                  },
                  Platform.OS === 'android' && keyboardHeight > 0 && {
                    marginBottom: keyboardHeight,
                  },
                ]}
                onPress={(e) => e.stopPropagation()}
              >
              <ScrollView
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.modalScrollContent}
                bounces={false}
                style={[
                  styles.modalScrollView,
                  {
                    // Calculate maxHeight dynamically: window height - top safe area - bottom safe area - footer height (approx 80px) - padding
                    maxHeight: Platform.OS === 'android' && keyboardHeight > 0
                      ? Dimensions.get('window').height - keyboardHeight - insets.top - 80 - 40
                      : Dimensions.get('window').height - insets.top - insets.bottom - 80 - 40,
                  },
                ]}
                nestedScrollEnabled={true}
                scrollEnabled={true}
              >
            <ThemedText type="subtitle" style={styles.modalTitle}>
              Add New Service Job
            </ThemedText>
            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>
              Create a new service job. Fill in the details to get started.
            </ThemedText>

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>Customer/Company *</ThemedText>
            <TextInput
              value={customerName}
              onChangeText={setCustomerName}
              placeholder="e.g., Acme Corporation"
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.modalInput,
                { borderColor: formErrors.customerName ? colors.error : colors.border, color: colors.text },
              ]}
            />
            {formErrors.customerName && (
              <ThemedText style={[styles.errorText, { color: colors.error }]}>{formErrors.customerName}</ThemedText>
            )}

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>Address *</ThemedText>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="e.g., 123 Main St, City"
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.modalInput,
                { borderColor: formErrors.address ? colors.error : colors.border, color: colors.text },
              ]}
            />
            {formErrors.address && (
              <ThemedText style={[styles.errorText, { color: colors.error }]}>{formErrors.address}</ThemedText>
            )}

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>Start Date & Time *</ThemedText>
            <TouchableOpacity
              style={[
                styles.modalInput,
                styles.datePickerButton,
                { borderColor: formErrors.startDate ? colors.error : colors.border },
              ]}
              onPress={() => {
                if (Platform.OS === 'android') {
                  // Use imperative API on Android to avoid unmount errors
                  // First show date picker
                  DateTimePickerAndroid.open({
                    value: startDateValue,
                    mode: 'date',
                    onChange: (dateEvent, selectedDate) => {
                      if (dateEvent.type === 'set' && selectedDate) {
                        // After date is selected, show time picker
                        DateTimePickerAndroid.open({
                          value: selectedDate,
                          mode: 'time',
                          onChange: (timeEvent, selectedTime) => {
                            if (timeEvent.type === 'set' && selectedTime) {
                              setStartDateValue(selectedTime);
                              setStartDate(selectedTime.toISOString().slice(0, 16));
                            } else if (timeEvent.type === 'dismissed') {
                              // If time picker was dismissed, still use the date selected
                              setStartDateValue(selectedDate);
                              setStartDate(selectedDate.toISOString().slice(0, 16));
                            }
                          },
                        });
                      }
                    },
                  });
                } else {
                  // On iOS, show the picker component
                  setShowStartDatePicker(true);
                }
              }}
            >
              <ThemedText style={{ color: colors.text }}>
                {startDateValue.toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </ThemedText>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {/* Only render DateTimePicker component on iOS */}
            {Platform.OS === 'ios' && showStartDatePicker && (
              <DateTimePicker
                value={startDateValue}
                mode="datetime"
                display="spinner"
                onChange={(event, selectedDate) => {
                  // On iOS, hide after selection
                  setShowStartDatePicker(false);
                  if (selectedDate) {
                    setStartDateValue(selectedDate);
                    setStartDate(selectedDate.toISOString().slice(0, 16));
                  }
                }}
              />
            )}
            {formErrors.startDate && (
              <ThemedText style={[styles.errorText, { color: colors.error }]}>{formErrors.startDate}</ThemedText>
            )}

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>Assign Technician</ThemedText>
            {isTechnician ? (
              <View
                style={[
                  styles.modalInput,
                  styles.disabledInput,
                  { borderColor: colors.border, backgroundColor: colors.background },
                ]}
              >
                <ThemedText style={{ color: colors.text }}>
                  {currentUser?.first_name || currentUser?.last_name || 'Technician'}
                </ThemedText>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={[
                    styles.modalInput,
                    styles.selectInput,
                    { borderColor: colors.border, backgroundColor: colors.backgroundSecondary },
                  ]}
                  onPress={() => setIsTechSelectOpen(true)}
                >
                  <ThemedText style={{ color: colors.text }}>
                    {techniciansLoading
                      ? 'Loading...'
                      : technicianId === 'unassigned'
                        ? 'Unassigned'
                        : technicians.find((t) => t.id === technicianId)?.first_name ||
                          technicians.find((t) => t.id === technicianId)?.last_name ||
                          'Select technician'}
                  </ThemedText>
                  <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                {techniciansError && (
                  <ThemedText style={[styles.errorText, { color: colors.error }]}>{techniciansError}</ThemedText>
                )}
              </>
            )}

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>Description</ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Brief description of the work to be done..."
              placeholderTextColor={colors.textTertiary}
              style={[styles.modalInput, styles.textArea, { borderColor: colors.border, color: colors.text }]}
              multiline
            />
              </ScrollView>
              
              {/* Sticky Footer */}
              <View style={[styles.modalFooter, { 
                backgroundColor: colors.backgroundSecondary,
                borderTopColor: colors.border,
              }]}>
              <Button 
                variant="secondary" 
                size="sm" 
                onPress={() => {
                  setIsCreateModalOpen(false);
                  // Track job creation cancelled
                  if (posthog) {
                    const companyId = getCompanyIdForTracking();
                    posthog.capture(PostHogEvents.JOB_CREATION_CANCELLED, {
                      ...(companyId !== undefined && { company_id: companyId }),
                    });
                  }
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={submitting} onPress={handleSubmit}>
                Create Job
              </Button>
              </View>
            </Pressable>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Technician Select Modal */}
      <Modal
        visible={isTechSelectOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsTechSelectOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsTechSelectOpen(false)}>
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.backgroundSecondary }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeaderRow}>
              <ThemedText type="subtitle">Select Technician</ThemedText>
              <TouchableOpacity onPress={() => setIsTechSelectOpen(false)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity
                style={[
                  styles.techRow,
                  {
                    borderColor: colors.border,
                    backgroundColor: technicianId === 'unassigned' ? colors.primary + '22' : colors.background,
                  },
                ]}
                onPress={() => {
                  setTechnicianId('unassigned');
                  setIsTechSelectOpen(false);
                }}
              >
                <ThemedText style={{ color: colors.text }}>Unassigned</ThemedText>
              </TouchableOpacity>
              {technicians.map((tech) => {
                const name = `${tech.first_name || ''} ${tech.last_name || ''}`.trim() || 'Technician';
                const selected = technicianId === tech.id;
                return (
                  <TouchableOpacity
                    key={tech.id}
                    style={[
                      styles.techRow,
                      {
                        borderColor: colors.border,
                        backgroundColor: selected ? colors.primary + '22' : colors.background,
                      },
                    ]}
                    onPress={() => {
                      setTechnicianId(tech.id || 'unassigned');
                      setIsTechSelectOpen(false);
                    }}
                  >
                    <ThemedText style={{ color: colors.text }}>{name}</ThemedText>
                    {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
              {techniciansLoading && (
                <View style={styles.techRow}>
                  <ThemedText style={{ color: colors.textSecondary }}>Loading technicians...</ThemedText>
                </View>
              )}
              {techniciansError && (
                <View style={styles.techRow}>
                  <ThemedText style={{ color: colors.error }}>{techniciansError}</ThemedText>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing['5xl'],
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSizes.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSizes.md,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobCard: {
    gap: 0,
  },
  jobCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  jobTitle: {
    flex: 1,
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  jobInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  jobInfoText: {
    flex: 1,
    fontSize: FontSizes.sm,
  },
  viewDetailsText: {
    fontSize: FontSizes.sm,
    fontWeight: '500',
  },
  jobsList: {
    gap: Spacing.md,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing['4xl'],
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  mutedText: {
    textAlign: 'center',
    fontSize: FontSizes.md,
  },
  sectionBlock: {
    marginBottom: Spacing['2xl'],
    gap: Spacing.md,
  },
  sectionHeader: {
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    padding: Spacing.lg,
    borderTopLeftRadius: BorderRadius['2xl'],
    borderTopRightRadius: BorderRadius['2xl'],
    gap: Spacing.sm,
  },
  createJobModalContent: {
    flexDirection: 'column',
    padding: 0, // Remove padding, we add it to ScrollView content
    // maxHeight is set dynamically to account for safe areas
  },
  modalScrollView: {
    // No flex: 1 - let it size naturally based on content
    // maxHeight will constrain it when content is too large
    // Max height is calculated dynamically to account for safe areas and footer
  },
  modalScrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.md,
    // No flexGrow - let content size naturally, ScrollView will scroll only when needed
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderTopWidth: 1,
  },
  modalTitle: {
    marginBottom: Spacing.xs,
  },
  modalLabel: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSizes.md,
  },
  datePickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  modalSection: {
    gap: Spacing.sm,
  },
  disabledInput: {
    justifyContent: 'center',
    height: 48,
  },
  errorText: {
    fontSize: FontSizes.xs,
    marginTop: Spacing.xs / 2,
  },
  feedbackText: {
    fontSize: FontSizes.md,
    marginBottom: Spacing.sm,
  },
  techRow: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

export default JobsList;
