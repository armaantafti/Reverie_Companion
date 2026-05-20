export type MemoryType = 'general' | 'where_kept' | 'person' | 'routine' | 'medical';
export type BoardItemType = 'medicine' | 'appointment' | 'routine' | 'family' | 'note';
export type ReminderCategory = 'medicine' | 'appointment' | 'hydration' | 'meal' | 'custom';
export type AckStatus = 'done' | 'skipped' | 'needs_help';
export type CaregiverRole = 'owner' | 'caregiver' | 'viewer';

export type Profile = {
  id: string;
  auth_user_id: string;
  display_name: string;
  preferred_language: string | null;
  voice_reply_enabled: boolean;
  large_text_enabled: boolean;
  high_contrast_enabled?: boolean;
  emergency_note: string | null;
  created_at: string;
  updated_at?: string;
};

export type CaregiverLink = {
  id: string;
  senior_profile_id: string;
  caregiver_user_id: string;
  role: CaregiverRole;
  can_manage_reminders: boolean;
  can_view_daily_summary: boolean;
  can_manage_people_cards: boolean;
  created_at: string;
  companion_profiles?: Profile;
};

export type LinkedCaregiver = {
  link_id: string;
  caregiver_user_id: string;
  display_name: string | null;
  role: CaregiverRole;
  created_at: string;
};

export type Memory = {
  id: string;
  profile_id: string;
  title: string;
  body: string;
  memory_type: MemoryType;
  source: string | null;
  created_by: string | null;
  created_at: string;
};

export type ObjectLocation = {
  id: string;
  profile_id: string;
  object_name: string;
  location_text: string;
  photo_url: string | null;
  last_confirmed_at: string;
  created_by: string | null;
  created_at: string;
};

export type DailyBoardItem = {
  id: string;
  profile_id: string;
  board_date: string;
  label: string;
  detail: string | null;
  scheduled_time: string | null;
  item_type: BoardItemType;
  completed: boolean;
  created_by: string | null;
  created_at: string;
};

export type PhotoCard = {
  id: string;
  profile_id: string;
  name: string;
  relationship: string | null;
  note: string | null;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
};

export type EmergencyContact = {
  id: string;
  profile_id: string;
  name: string;
  relationship: string | null;
  phone: string;
  sort_order: number;
  created_at: string;
};

export type Reminder = {
  id: string;
  profile_id: string;
  title: string;
  detail: string | null;
  category: ReminderCategory;
  scheduled_date: string;
  scheduled_time: string;
  repeat_rule: string | null;
  escalation_minutes: number;
  caregiver_escalation_enabled: boolean;
  last_acknowledged_at: string | null;
  last_acknowledgement_status: AckStatus | null;
  created_by: string | null;
  created_at: string;
};

export type DeviceToken = {
  id: string;
  auth_user_id: string;
  profile_id: string | null;
  platform: string;
  token: string;
  enabled: boolean;
  created_at: string;
  updated_at?: string;
};

export type SearchResult = {
  answer: string;
  memories: Memory[];
  objectLocations: ObjectLocation[];
  photoCards: PhotoCard[];
  reminders: Reminder[];
};
