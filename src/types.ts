export type MemoryType = 'general' | 'where_kept' | 'person' | 'routine' | 'medical';

export type Memory = {
  id: string;
  title: string;
  body: string;
  type: MemoryType;
  created_at: string;
};

export type DailyBoardItem = {
  id: string;
  label: string;
  detail: string;
  time?: string;
  kind: 'medicine' | 'appointment' | 'routine' | 'family' | 'note';
  completed?: boolean;
};

export type PhotoCard = {
  id: string;
  name: string;
  relationship: string;
  note: string;
  image_url?: string;
};

export type EmergencyContact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
};

export type Reminder = {
  id: string;
  title: string;
  detail: string;
  scheduled_for: string;
  category: 'medicine' | 'appointment' | 'hydration' | 'meal' | 'custom';
  acknowledged: boolean;
};
