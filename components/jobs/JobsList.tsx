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
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { Spacing, FontSizes, BorderRadius } from '@/constants/theme';
import type { Job, JobStatus } from '@/services/jobService';
import type { User } from '@/store/useAuthStore';
import { jobService, type CreateJobRequest } from '@/services/jobService';
import { usersService } from '@/services/usersService';

type Props = {
  onRefresh: () => void;
  onJobPress?: (job: Job) => void;
  jobs: Job[];
  loading: boolean;
  error?: string | null;
  currentUser?: User | null;
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

export const JobsList: React.FC<Props> = ({ onRefresh, onJobPress, jobs, loading, error, currentUser }) => {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<JobStatus | 'all'>('all');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTechSelectOpen, setIsTechSelectOpen] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 16)); // yyyy-mm-ddThh:mm
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
  }, [isCreateModalOpen, isTechnician, loadTechnicians]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSearch =
        search.trim().length === 0 ||
        job.job_target_name?.toLowerCase().includes(search.toLowerCase()) ||
        job.address?.toLowerCase().includes(search.toLowerCase());

      const matchesStatus = filterStatus === 'all' ? true : job.status === filterStatus;

      const start = new Date(job.start_timestamp).getTime();
      const fromOk = filterFrom ? start >= new Date(filterFrom).getTime() : true;
      const toOk = filterTo ? start <= new Date(filterTo).getTime() : true;

      return matchesSearch && matchesStatus && fromOk && toOk;
    });
  }, [jobs, search, filterStatus, filterFrom, filterTo]);

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
      const startDateISO = new Date(startDate).toISOString();
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

      await jobService.createJob(payload);
      // reset form
      setCustomerName('');
      setAddress('');
      setDescription('');
      setStartDate(new Date().toISOString().slice(0, 16));
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
  }, [customerName, address, startDate, description, technicianId, isTechnician, currentUser, onRefresh]);

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
        <Button size="sm" variant="primary" onPress={() => setIsCreateModalOpen(true)} icon="add">
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
            onRefresh={onRefresh}
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

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>From (YYYY-MM-DD)</ThemedText>
            <TextInput
              value={filterFrom}
              onChangeText={setFilterFrom}
              placeholder="e.g., 2025-12-01"
              placeholderTextColor={colors.textTertiary}
              style={[styles.modalInput, { borderColor: colors.border, color: colors.text }]}
            />

            <ThemedText style={[styles.modalLabel, { color: colors.textSecondary }]}>To (YYYY-MM-DD)</ThemedText>
            <TextInput
              value={filterTo}
              onChangeText={setFilterTo}
              placeholder="e.g., 2025-12-31"
              placeholderTextColor={colors.textTertiary}
              style={[styles.modalInput, { borderColor: colors.border, color: colors.text }]}
            />

            <View style={styles.modalButtons}>
              <Button variant="secondary" size="sm" onPress={() => setIsFilterModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onPress={() => {
                  setIsFilterModalOpen(false);
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
          >
          <Pressable
              style={[
                styles.modalContent,
                { backgroundColor: colors.backgroundSecondary },
                Platform.OS === 'android' && keyboardHeight > 0 && { paddingBottom: keyboardHeight },
              ]}
            onPress={(e) => e.stopPropagation()}
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
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DDTHH:mm"
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.modalInput,
                { borderColor: formErrors.startDate ? colors.error : colors.border, color: colors.text },
              ]}
            />
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

            <View style={styles.modalButtons}>
              <Button variant="secondary" size="sm" onPress={() => setIsCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={submitting} onPress={handleSubmit}>
                Create Job
              </Button>
            </View>
          </Pressable>
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
