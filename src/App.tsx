import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  Bell,
  CalendarDays,
  Check,
  HeartHandshake,
  HelpCircle,
  Home,
  ImagePlus,
  LogOut,
  MapPin,
  Mic,
  Phone,
  Search,
  Settings,
  SkipForward,
  UserPlus,
  Users
} from 'lucide-react';
import { db, isDatabaseConfigured } from './lib/supabaseClient';
import {
  acceptCaregiverInvite,
  acknowledgeReminder,
  addDailyBoardItem,
  addEmergencyContact,
  addMemory,
  addPhotoCard,
  addReminder,
  createCaregiverInvite,
  createOwnProfile,
  getCurrentUser,
  loadCachedProfileData,
  loadCaregiverLinks,
  loadLinkedCaregivers,
  loadOwnProfile,
  loadProfileData,
  revokeCaregiverAccess,
  searchProfileData,
  signIn,
  signOut,
  signUp,
  todayIso,
  toggleBoardItem,
  updateProfile,
  uploadCompanionPhoto,
  upsertObjectLocation
} from './companionData';
import type {
  AckStatus,
  BoardItemType,
  CaregiverLink,
  DailyBoardItem,
  EmergencyContact,
  LinkedCaregiver,
  Memory,
  ObjectLocation,
  PhotoCard,
  Profile,
  Reminder,
  ReminderCategory,
  SearchResult
} from './types';

type Section = 'home' | 'remember' | 'ask' | 'today' | 'where' | 'people' | 'reminders' | 'help' | 'caregiver' | 'settings';
type Mode = 'login' | 'signup';
type ProfileData = Awaited<ReturnType<typeof loadProfileData>>;
type ProfileOption = { profile: Profile; label: string };

const emptyData: ProfileData = {
  memories: [],
  objects: [],
  board: [],
  reminders: [],
  photos: [],
  contacts: []
};

function speak(text: string, enabled = true) {
  if (!enabled || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function App() {
  const [booting, setBooting] = useState(true);
  const [userId, setUserId] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<Mode>('login');
  const [profileName, setProfileName] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [caregiverLinks, setCaregiverLinks] = useState<CaregiverLink[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [section, setSection] = useState<Section>('home');
  const [data, setData] = useState<ProfileData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const alertedReminderKeys = useRef(new Set<string>());
  const scheduledNotificationKeys = useRef(new Set<string>());

  const activeIsOwnProfile = Boolean(profile && activeProfile && profile.id === activeProfile.id);
  const voiceEnabled = activeProfile?.voice_reply_enabled ?? true;
  const profileOptions: ProfileOption[] = profile
    ? [
        { profile, label: 'You' },
        ...caregiverLinks
          .map((link) => link.companion_profiles)
          .filter(Boolean)
          .map((linkedProfile) => ({ profile: linkedProfile as Profile, label: 'Caregiver for' }))
      ]
    : [];
  const defaultProfileId = userId ? localStorage.getItem(defaultProfileStorageKey(userId)) || '' : '';

  useEffect(() => {
    void boot(true);
    if (!db) return;
    const { data: authListener } = db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        void boot(false);
      }
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (activeProfile) {
      const cached = loadCachedProfileData(activeProfile.id);
      if (cached) setData(cached);
      void refreshData(activeProfile.id);
    }
  }, [activeProfile?.id]);

  useEffect(() => {
    if (!activeProfile) return;

    const tick = () => {
      const now = new Date();
      const dueReminders = data.reminders.filter((reminder) => {
        if (reminder.last_acknowledged_at) return false;
        const dueAt = parseReminderDate(reminder);
        if (!dueAt) return false;
        const ageMs = now.getTime() - dueAt.getTime();
        return ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;
      });

      for (const reminder of dueReminders) {
        const key = reminderOccurrenceKey(activeProfile.id, reminder);
        if (alertedReminderKeys.current.has(key) || localStorage.getItem(key) === '1') continue;
        alertedReminderKeys.current.add(key);
        localStorage.setItem(key, '1');
        playReminderAlarm();
        window.setTimeout(() => {
          const detail = reminder.detail ? `. ${reminder.detail}` : '';
          speak(`${reminder.title}${detail}`, voiceEnabled);
        }, 1200);
      }
    };

    tick();
    const interval = window.setInterval(tick, 20000);
    return () => window.clearInterval(interval);
  }, [activeProfile?.id, data.reminders, voiceEnabled]);

  useEffect(() => {
    if (!activeProfile || !Capacitor.isNativePlatform()) return;
    void scheduleNativeReminderNotifications(activeProfile.id, data.reminders, scheduledNotificationKeys.current);
  }, [activeProfile?.id, data.reminders]);

  useEffect(() => {
    const handleShareIntent = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; uris?: string[] }>).detail;
      setSection('remember');
      if (detail?.text) {
        setMessage(`Shared text received: ${detail.text}`);
      } else if (detail?.uris?.length) {
        setMessage('Shared file received. Use People, Where, or Remember to save it to the active profile.');
      } else {
        setMessage('Shared item received.');
      }
    };
    window.addEventListener('reverieShareIntent', handleShareIntent);
    return () => window.removeEventListener('reverieShareIntent', handleShareIntent);
  }, []);

  const todayBoard = useMemo(
    () => data.board.filter((item) => item.board_date === todayIso()),
    [data.board]
  );

  const upcomingReminders = useMemo(
    () => data.reminders.filter((item) => item.scheduled_date >= todayIso()),
    [data.reminders]
  );

  async function boot(showBooting = false) {
    if (showBooting) setBooting(true);
    setError('');
    try {
      if (!isDatabaseConfigured) {
        setBooting(false);
        return;
      }
      const user = await getCurrentUser();
      if (!user) {
        setUserId('');
        setProfile(null);
        setActiveProfile(null);
        setBooting(false);
        return;
      }
      setUserId(user.id);
      const ownProfile = await loadOwnProfile(user.id);
      const links = await loadCaregiverLinks();
      const linkedProfiles = links.map((link) => link.companion_profiles).filter(Boolean) as Profile[];
      const availableProfiles = ownProfile ? [ownProfile, ...linkedProfiles] : linkedProfiles;
      const savedDefaultProfileId = localStorage.getItem(defaultProfileStorageKey(user.id));
      const preferredProfile = availableProfiles.find((item) => item.id === savedDefaultProfileId) || ownProfile || availableProfiles[0] || null;
      setProfile(ownProfile);
      setCaregiverLinks(links);
      setActiveProfile((current) => {
        if (current && availableProfiles.some((item) => item.id === current.id)) return current;
        return preferredProfile;
      });
    } catch (exc) {
      setError(readError(exc));
    } finally {
      setBooting(false);
    }
  }

  async function refreshData(profileId = activeProfile?.id) {
    if (!profileId) return;
    setLoading(true);
    try {
      const next = await loadProfileData(profileId);
      setData(next);
    } catch (exc) {
      const cached = loadCachedProfileData(profileId);
      if (cached) {
        setData(cached);
        setMessage('Showing the last saved copy while the connection recovers.');
      } else {
        setError(readError(exc));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleAuth() {
    setError('');
    try {
      if (authMode === 'login') await signIn(authEmail, authPassword);
      else await signUp(authEmail, authPassword);
      setAuthPassword('');
      await boot();
    } catch (exc) {
      setError(readError(exc));
    }
  }

  async function handleCreateProfile() {
    if (!userId || !profileName.trim()) return;
    setError('');
    try {
      const next = await createOwnProfile(userId, profileName);
      setProfile(next);
      setActiveProfile(next);
      setMessage('Profile is ready.');
    } catch (exc) {
      setError(readError(exc));
    }
  }

  async function handleSignOut() {
    await signOut();
    setProfile(null);
    setActiveProfile(null);
    setUserId('');
    setSection('home');
  }

  if (booting) {
    return <main className="app-shell"><StatusCard title="Starting Reverie Companion" body="Preparing your private memory workspace..." /></main>;
  }

  if (!isDatabaseConfigured) {
    return (
      <main className="app-shell">
        <StatusCard title="Setup needed" body="Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then rebuild the app." />
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="app-shell">
        <Header title="Reverie Companion" subtitle="Simple memory help for seniors, families, and caregivers." />
        <section className="panel">
          <p className="eyebrow">Private family workspace</p>
          <h2>{authMode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p className="subtle">Use one account for senior mode and caregiver mode. The app saves memories, reminders, people cards, and emergency contacts securely in Supabase.</p>
          <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email" type="email" />
          <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" type="password" />
          <button className="primary-wide" onClick={handleAuth}>{authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          <button className="secondary-wide" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
            {authMode === 'login' ? 'Create a new account' : 'I already have an account'}
          </button>
          <Notice error={error} message={message} />
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="app-shell">
        <Header title="Set up senior profile" subtitle="Create the main memory profile. Caregivers can be invited later." />
        <section className="panel">
          <h2>Who is this for?</h2>
          <p className="subtle">Use the senior's name or a familiar family name. This keeps the app calm and personal.</p>
          <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Example: Papa" />
          <button className="primary-wide" onClick={handleCreateProfile}>Create profile</button>
          <button className="secondary-wide" onClick={handleSignOut}>Sign out</button>
          <Notice error={error} message={message} />
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${activeProfile?.large_text_enabled ? 'large-text' : ''} ${activeProfile?.high_contrast_enabled ? 'high-contrast' : ''}`}>
      <Header title={activeProfile?.display_name || 'Reverie Companion'} subtitle={activeIsOwnProfile ? 'Senior memory workspace' : 'Caregiver view'} />

      <ProfileSwitcher
        ownProfile={profile}
        activeProfile={activeProfile}
        caregiverLinks={caregiverLinks}
        onSelect={(next) => {
          setActiveProfile(next);
          setSection('home');
        }}
      />

      <Notice error={error} message={message} loading={loading} />

      {section === 'home' && (
        <HomeScreen
          reminders={upcomingReminders}
          memories={data.memories}
          board={todayBoard}
          onNavigate={setSection}
        />
      )}

      {section !== 'home' && <button className="back-button" onClick={() => setSection('home')}><Home size={22} /> Back home</button>}

      {activeProfile && section === 'remember' && (
        <RememberPanel
          profile={activeProfile}
          userId={userId}
          voiceEnabled={voiceEnabled}
          onSaved={async (text) => {
            setMessage(text);
            await refreshData();
          }}
          onError={(text) => setError(text)}
        />
      )}

      {section === 'ask' && (
        <AskPanel data={data} voiceEnabled={voiceEnabled} />
      )}

      {section === 'today' && activeProfile && (
        <TodayPanel
          items={todayBoard}
          reminders={upcomingReminders.filter((item) => item.scheduled_date === todayIso())}
          onToggle={async (item) => {
            try {
              await toggleBoardItem(item.id, !item.completed);
              await refreshData();
            } catch (exc) {
              setError(readError(exc));
            }
          }}
        />
      )}

      {section === 'where' && activeProfile && (
        <WherePanel profile={activeProfile} userId={userId} objects={data.objects} onRefresh={refreshData} onError={setError} />
      )}

      {section === 'people' && activeProfile && (
        <PeoplePanel profile={activeProfile} userId={userId} photos={data.photos} voiceEnabled={voiceEnabled} onRefresh={refreshData} onError={setError} />
      )}

      {section === 'reminders' && activeProfile && (
        <RemindersPanel profile={activeProfile} userId={userId} reminders={upcomingReminders} onRefresh={refreshData} onError={setError} voiceEnabled={voiceEnabled} />
      )}

      {section === 'help' && activeProfile && (
        <HelpPanel profile={activeProfile} contacts={data.contacts} onRefresh={refreshData} onError={setError} />
      )}

      {section === 'caregiver' && activeProfile && (
        <CaregiverPanel
          profile={activeProfile}
          userId={userId}
          data={data}
          ownProfile={profile}
          onRefresh={async () => {
            await boot();
            await refreshData();
          }}
          onInviteAccepted={async (profileId) => {
            const links = await loadCaregiverLinks();
            setCaregiverLinks(links);
            const acceptedProfile = links
              .map((link) => link.companion_profiles)
              .find((linkedProfile): linkedProfile is Profile => Boolean(linkedProfile && linkedProfile.id === profileId));
            if (acceptedProfile) {
              setActiveProfile(acceptedProfile);
              setSection('home');
              await refreshData(acceptedProfile.id);
            } else {
              await boot();
            }
          }}
          onError={setError}
          onMessage={setMessage}
        />
      )}

      {section === 'settings' && activeProfile && (
        <SettingsPanel
          profile={activeProfile}
          profileOptions={profileOptions}
          defaultProfileId={defaultProfileId}
          onDefaultProfileChange={(profileId) => {
            localStorage.setItem(defaultProfileStorageKey(userId), profileId);
            setMessage('Default profile updated.');
          }}
          onUpdated={(next) => { setActiveProfile(next); if (profile.id === next.id) setProfile(next); }}
          onSignOut={handleSignOut}
          onError={setError}
        />
      )}
    </main>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="top-card">
      <p className="eyebrow">Reverie Companion</p>
      <h1>{title}</h1>
      <p className="subtle">{subtitle}</p>
    </header>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return <section className="panel"><h2>{title}</h2><p className="subtle">{body}</p></section>;
}

function Notice({ error, message, loading }: { error?: string; message?: string; loading?: boolean }) {
  if (!error && !message && !loading) return null;
  return <div className={`notice ${error ? 'error' : ''}`}>{loading ? 'Loading latest information...' : error || message}</div>;
}

function defaultProfileStorageKey(userId: string) {
  return `companion:defaultProfile:${userId}`;
}

function parseReminderDate(reminder: Reminder) {
  if (!reminder.scheduled_date || !reminder.scheduled_time) return null;
  const value = new Date(`${reminder.scheduled_date}T${reminder.scheduled_time}`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function reminderOccurrenceKey(profileId: string, reminder: Reminder) {
  return `companion:reminderAlarm:${profileId}:${reminder.id}:${reminder.scheduled_date}:${reminder.scheduled_time}`;
}

function playReminderAlarm() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const playTone = (start: number, frequency: number) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
    gain.gain.setValueAtTime(0.0001, context.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + 0.38);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime + start);
    oscillator.stop(context.currentTime + start + 0.42);
  };

  playTone(0, 880);
  playTone(0.48, 880);
  playTone(0.96, 988);
  window.setTimeout(() => void context.close(), 1800);
}

function reminderNotificationId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 2147483647) || 1;
}

async function scheduleNativeReminderNotifications(profileId: string, reminders: Reminder[], scheduledKeys: Set<string>) {
  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== 'granted') return;

  const now = Date.now();
  const notifications = reminders
    .filter((reminder) => !reminder.last_acknowledged_at)
    .map((reminder) => {
      const dueAt = parseReminderDate(reminder);
      if (!dueAt || dueAt.getTime() <= now) return null;
      const key = reminderOccurrenceKey(profileId, reminder);
      if (scheduledKeys.has(key)) return null;
      scheduledKeys.add(key);
      return {
        id: reminderNotificationId(key),
        title: reminder.title,
        body: reminder.detail || 'Reminder due now.',
        schedule: { at: dueAt },
        extra: {
          profileId,
          reminderId: reminder.id
        }
      };
    })
    .filter((notification): notification is NonNullable<typeof notification> => Boolean(notification));

  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
  }
}

function ProfileSwitcher({ ownProfile, activeProfile, caregiverLinks, onSelect }: {
  ownProfile: Profile;
  activeProfile: Profile | null;
  caregiverLinks: CaregiverLink[];
  onSelect: (profile: Profile) => void;
}) {
  const [open, setOpen] = useState(false);
  const profiles: ProfileOption[] = [
    { profile: ownProfile, label: 'You' },
    ...caregiverLinks
      .map((link) => link.companion_profiles)
      .filter(Boolean)
      .map((linkedProfile) => ({ profile: linkedProfile as Profile, label: 'Caregiver for' }))
  ];
  if (profiles.length <= 1) return null;

  const selected = profiles.find((item) => item.profile.id === (activeProfile?.id || ownProfile.id)) || profiles[0];
  return (
    <section className="profile-strip">
      <label>Active profile</label>
      <div className="profile-select-wrap">
        <button className="profile-select-button" type="button" onClick={() => setOpen((value) => !value)}>
          <strong>{selected.profile.display_name}</strong>
          <em>({selected.label})</em>
          <span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <div className="profile-menu" role="listbox">
            {profiles.map((item) => (
              <button
                key={item.profile.id}
                className={selected.profile.id === item.profile.id ? 'selected' : ''}
                onClick={() => {
                  onSelect(item.profile);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>{item.profile.display_name}</strong>
                <em>({item.label})</em>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HomeScreen({ reminders, memories, board, onNavigate }: {
  reminders: Reminder[];
  memories: Memory[];
  board: DailyBoardItem[];
  onNavigate: (section: Section) => void;
}) {
  return (
    <>
      <section className="quick-summary">
        <SummaryTile label="Today" value={board.length} />
        <SummaryTile label="Reminders" value={reminders.length} />
        <SummaryTile label="Memories" value={memories.length} />
      </section>
      <section className="grid-actions" aria-label="Main actions">
        <BigButton icon={<Mic />} label="Remember something" hint="Speak or type a memory" onClick={() => onNavigate('remember')} />
        <BigButton icon={<Search />} label="Ask my memory" hint="Find something saved" onClick={() => onNavigate('ask')} />
        <BigButton icon={<CalendarDays />} label="Today" hint="Medicines, visits, routine" onClick={() => onNavigate('today')} />
        <BigButton icon={<MapPin />} label="Where did I keep it?" hint="Keys, glasses, documents" onClick={() => onNavigate('where')} />
        <BigButton icon={<Users />} label="People & photos" hint="Family memory cards" onClick={() => onNavigate('people')} />
        <BigButton icon={<Bell />} label="Reminders" hint="Medicine and appointments" onClick={() => onNavigate('reminders')} />
        <BigButton icon={<Phone />} label="Help" hint="Emergency contacts" onClick={() => onNavigate('help')} />
        <BigButton icon={<HeartHandshake />} label="Caregiver" hint="Invite family and manage support" onClick={() => onNavigate('caregiver')} />
        <BigButton icon={<Settings />} label="Settings" hint="Voice, display, and safety note" onClick={() => onNavigate('settings')} />
      </section>
    </>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return <article><strong>{value}</strong><span>{label}</span></article>;
}

function RememberPanel({ profile, userId, voiceEnabled, onSaved, onError }: {
  profile: Profile;
  userId: string;
  voiceEnabled: boolean;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [note, setNote] = useState('');

  const startSpeechCapture = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onError('Voice capture is not available on this device. Please type the memory.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = profile.preferred_language || 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (event: any) => setNote(event.results[0][0].transcript);
    recognition.onerror = () => onError('Voice capture could not hear clearly. Please try again or type.');
    recognition.start();
  };

  const save = async () => {
    if (!note.trim()) return;
    try {
      await addMemory(profile.id, userId, note.trim());
      setNote('');
      speak('I have saved this memory.', voiceEnabled);
      await onSaved('I have saved this memory.');
    } catch (exc) {
      onError(readError(exc));
    }
  };

  return (
    <Panel title="Remember something" intro="Tap the microphone or type a simple note. Reverie will save it to this profile.">
      <button className="primary-wide" onClick={startSpeechCapture}><Mic /> Tap and speak</button>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: I kept my bank passbook in the second drawer." />
      <button className="primary-wide" onClick={save}>Save this memory</button>
    </Panel>
  );
}

function AskPanel({ data, voiceEnabled }: { data: ProfileData; voiceEnabled: boolean }) {
  const [query, setQuery] = useState('');
  const result: SearchResult = useMemo(() => searchProfileData(query, data), [query, data]);
  return (
    <Panel title="Ask my memory" intro="Ask using simple words. Reverie answers first and shows matching items below.">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Example: glasses" />
      {result.answer && (
        <div className="answer-card">
          <strong>Answer</strong>
          <p>{result.answer}</p>
          <button onClick={() => speak(result.answer, voiceEnabled)}>Read aloud</button>
        </div>
      )}
      {query && !result.answer && <p className="subtle">I could not find that yet. You can save it or ask a caregiver to add it.</p>}
      <ResultList result={result} />
    </Panel>
  );
}

function ResultList({ result }: { result: SearchResult }) {
  const total = result.memories.length + result.objectLocations.length + result.photoCards.length + result.reminders.length;
  if (!total) return null;
  return (
    <div className="stack">
      {result.objectLocations.map((item) => <ListCard key={item.id} title={item.object_name} body={item.location_text} />)}
      {result.memories.map((item) => <ListCard key={item.id} title={item.title} body={item.body} />)}
      {result.photoCards.map((item) => <ListCard key={item.id} title={item.name} body={`${item.relationship || ''} ${item.note || ''}`.trim()} />)}
      {result.reminders.map((item) => <ListCard key={item.id} title={item.title} body={`${item.scheduled_date} ${item.scheduled_time}`} />)}
    </div>
  );
}

function TodayPanel({ items, reminders, onToggle }: {
  items: DailyBoardItem[];
  reminders: Reminder[];
  onToggle: (item: DailyBoardItem) => void;
}) {
  return (
    <Panel title="Today's memory board" intro="A calming orientation screen with today's most important items.">
      <div className="date-card">Today is {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      {items.length === 0 && reminders.length === 0 && <p className="subtle">No board items yet. A caregiver can add medicines, appointments, routines, and reassurance notes.</p>}
      {items.map((item) => (
        <article className="list-card action-card" key={item.id}>
          <div>
            <h3>{item.scheduled_time ? `${item.scheduled_time.slice(0, 5)} - ${item.label}` : item.label}</h3>
            <p>{item.detail}</p>
          </div>
          <button onClick={() => onToggle(item)}>{item.completed ? 'Done' : 'Mark done'}</button>
        </article>
      ))}
      {reminders.map((item) => <ListCard key={item.id} title={`${item.scheduled_time.slice(0, 5)} - ${item.title}`} body={item.detail || item.category} />)}
    </Panel>
  );
}

function WherePanel({ profile, userId, objects, onRefresh, onError }: {
  profile: Profile;
  userId: string;
  objects: ObjectLocation[];
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [objectName, setObjectName] = useState('');
  const [locationText, setLocationText] = useState('');
  const save = async () => {
    try {
      await upsertObjectLocation(profile.id, userId, objectName, locationText);
      setObjectName('');
      setLocationText('');
      await onRefresh();
    } catch (exc) {
      onError(readError(exc));
    }
  };
  return (
    <Panel title="Where did I keep it?" intro="Save everyday object locations in plain language.">
      <input value={objectName} onChange={(event) => setObjectName(event.target.value)} placeholder="Object name, e.g. reading glasses" />
      <input value={locationText} onChange={(event) => setLocationText(event.target.value)} placeholder="Location, e.g. near the sofa" />
      <button className="primary-wide" onClick={save}>Save location</button>
      {objects.map((item) => <ListCard key={item.id} title={item.object_name} body={item.location_text} />)}
    </Panel>
  );
}

function PeoplePanel({ profile, userId, photos, voiceEnabled, onRefresh, onError }: {
  profile: Profile;
  userId: string;
  photos: PhotoCard[];
  voiceEnabled: boolean;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const choosePhoto = async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const photo = await Camera.getPhoto({
        quality: 82,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        allowEditing: false
      });
      if (!photo.webPath) return;
      const response = await fetch(photo.webPath);
      const blob = await response.blob();
      const extension = photo.format || 'jpg';
      setFile(new File([blob], `companion-photo.${extension}`, { type: blob.type || `image/${extension}` }));
    } catch (exc) {
      onError(readError(exc));
    }
  };

  const save = async () => {
    try {
      const imageUrl = file ? await uploadCompanionPhoto(profile.id, file) : undefined;
      await addPhotoCard(profile.id, userId, name, relationship, note, imageUrl);
      setName('');
      setRelationship('');
      setNote('');
      setFile(null);
      await onRefresh();
    } catch (exc) {
      onError(readError(exc));
    }
  };

  return (
    <Panel title="People & photo memory cards" intro="Family can add photos, relationships, and reassuring notes.">
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
      <input value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="Relationship" />
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="A short reassuring note" />
      {Capacitor.isNativePlatform() ? (
        <button className="secondary-wide" type="button" onClick={choosePhoto}><ImagePlus /> Add photo</button>
      ) : (
        <label className="file-button"><ImagePlus /> Add photo<input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      )}
      {file && <p className="subtle">Selected: {file.name}</p>}
      <button className="primary-wide" onClick={save}>Save person card</button>
      {photos.map((item) => (
        <article className="person-card" key={item.id}>
          {item.image_url && <img src={item.image_url} alt="" />}
          <h3>{item.name}</h3>
          <p>{item.relationship}</p>
          <p>{item.note}</p>
          <button onClick={() => speak(`${item.name}. ${item.relationship || ''}. ${item.note || ''}`, voiceEnabled)}>Read about this person</button>
        </article>
      ))}
    </Panel>
  );
}

function RemindersPanel({ profile, userId, reminders, onRefresh, onError, voiceEnabled }: {
  profile: Profile;
  userId: string;
  reminders: Reminder[];
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  voiceEnabled: boolean;
}) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [category, setCategory] = useState<ReminderCategory>('medicine');
  const [dateValue, setDateValue] = useState(todayIso());
  const [timeValue, setTimeValue] = useState('09:00');
  const [repeatRule, setRepeatRule] = useState('none');

  const save = async () => {
    try {
      await addReminder(profile.id, userId, {
        title,
        detail,
        category,
        scheduled_date: dateValue,
        scheduled_time: timeValue,
        repeat_rule: repeatRule,
        escalation_minutes: 10,
        caregiver_escalation_enabled: true
      });
      setTitle('');
      setDetail('');
      await onRefresh();
    } catch (exc) {
      onError(readError(exc));
    }
  };

  const ack = async (reminder: Reminder, status: AckStatus) => {
    try {
      await acknowledgeReminder(reminder, status);
      speak(status === 'done' ? 'Marked done.' : status === 'needs_help' ? 'I will let your caregiver know.' : 'Skipped.', voiceEnabled);
      await onRefresh();
    } catch (exc) {
      onError(readError(exc));
    }
  };

  return (
    <Panel title="Medicine & appointment reminders" intro="Large reminders with simple acknowledgement buttons.">
      <div className="form-grid">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Reminder title" />
        <input value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Details" />
        <select value={category} onChange={(event) => setCategory(event.target.value as ReminderCategory)}>
          <option value="medicine">Medicine</option>
          <option value="appointment">Appointment</option>
          <option value="hydration">Hydration</option>
          <option value="meal">Meal</option>
          <option value="custom">Custom</option>
        </select>
        <input value={dateValue} onChange={(event) => setDateValue(event.target.value)} type="date" />
        <input value={timeValue} onChange={(event) => setTimeValue(event.target.value)} type="time" />
        <select value={repeatRule} onChange={(event) => setRepeatRule(event.target.value)}>
          <option value="none">No repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <button className="primary-wide" onClick={save}>Save reminder</button>
      {reminders.map((item) => (
        <article className="reminder-card" key={item.id}>
          <h3>{item.title}</h3>
          <p>{item.detail}</p>
          <p>{item.scheduled_date} at {item.scheduled_time.slice(0, 5)} - {item.last_acknowledgement_status || 'not confirmed'}</p>
          <div className="button-row">
            <button onClick={() => ack(item, 'done')}><Check /> Done</button>
            <button onClick={() => ack(item, 'skipped')}><SkipForward /> Skip</button>
            <button onClick={() => ack(item, 'needs_help')}><HelpCircle /> Need help</button>
          </div>
        </article>
      ))}
    </Panel>
  );
}

function HelpPanel({ profile, contacts, onRefresh, onError }: {
  profile: Profile;
  contacts: EmergencyContact[];
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const save = async () => {
    try {
      await addEmergencyContact(profile.id, name, relationship, phone, contacts.length);
      setName('');
      setRelationship('');
      setPhone('');
      await onRefresh();
    } catch (exc) {
      onError(readError(exc));
    }
  };
  return (
    <Panel title="Emergency help" intro="One large, visible place for family, doctor, and safety information.">
      {profile.emergency_note && <div className="date-card">{profile.emergency_note}</div>}
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Contact name" />
      <input value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="Relationship" />
      <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone number" />
      <button className="primary-wide" onClick={save}>Save contact</button>
      {contacts.map((contact) => (
        <a key={contact.id} className="call-card" href={`tel:${contact.phone}`}>
          <strong>{contact.name}</strong>
          <span>{contact.relationship}</span>
          <span>{contact.phone}</span>
        </a>
      ))}
    </Panel>
  );
}

function CaregiverPanel({ profile, userId, data, ownProfile, onRefresh, onInviteAccepted, onError, onMessage }: {
  profile: Profile;
  userId: string;
  data: ProfileData;
  ownProfile: Profile;
  onRefresh: () => Promise<void>;
  onInviteAccepted: (profileId: string) => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [inviteCode, setInviteCode] = useState('');
  const [acceptCode, setAcceptCode] = useState('');
  const [linkedCaregivers, setLinkedCaregivers] = useState<LinkedCaregiver[]>([]);
  const [loadingCaregivers, setLoadingCaregivers] = useState(false);
  const missed = data.reminders.filter((item) => !item.last_acknowledged_at && item.scheduled_date <= todayIso());
  const isOwnProfile = profile.id === ownProfile.id;

  useEffect(() => {
    if (!isOwnProfile) {
      setLinkedCaregivers([]);
      return;
    }
    void refreshLinkedCaregivers();
  }, [isOwnProfile, profile.id]);

  const refreshLinkedCaregivers = async () => {
    setLoadingCaregivers(true);
    try {
      const links = await loadLinkedCaregivers(profile.id);
      setLinkedCaregivers(links);
    } catch (exc) {
      onError(readError(exc));
    } finally {
      setLoadingCaregivers(false);
    }
  };

  const createInvite = async () => {
    try {
      const invite = await createCaregiverInvite(profile.id);
      setInviteCode(invite.invite_code);
      onMessage('Caregiver invite created.');
    } catch (exc) {
      onError(readError(exc));
    }
  };
  const acceptInvite = async () => {
    try {
      const acceptedProfileId = await acceptCaregiverInvite(acceptCode);
      setAcceptCode('');
      await onInviteAccepted(acceptedProfileId);
      onMessage('Caregiver invite accepted.');
    } catch (exc) {
      onError(readError(exc));
    }
  };
  const revokeAccess = async (link: LinkedCaregiver) => {
    try {
      await revokeCaregiverAccess(link.link_id);
      await refreshLinkedCaregivers();
      await onRefresh();
      onMessage('Caregiver access revoked.');
    } catch (exc) {
      onError(readError(exc));
    }
  };
  return (
    <Panel title="Caregiver mode" intro="Manage reminders, board items, family cards, and safety information for linked profiles.">
      <div className="quick-summary">
        <SummaryTile label="Missed" value={missed.length} />
        <SummaryTile label="People" value={data.photos.length} />
        <SummaryTile label="Objects" value={data.objects.length} />
      </div>
      {isOwnProfile && (
        <>
          <button className="primary-wide" onClick={createInvite}><UserPlus /> Create caregiver invite</button>
          {inviteCode && <div className="date-card">Invite code: <strong>{inviteCode}</strong></div>}
          <h3>Linked caregivers</h3>
          {loadingCaregivers && <p className="subtle">Loading caregivers...</p>}
          {!loadingCaregivers && !linkedCaregivers.length && <p className="subtle">No caregivers are linked yet.</p>}
          {linkedCaregivers.map((link) => (
            <article className="list-card action-card" key={link.link_id}>
              <div>
                <h3>{link.display_name || 'Caregiver account'}</h3>
                <p>{link.role} - linked {new Date(link.created_at).toLocaleDateString()}</p>
              </div>
              <button onClick={() => revokeAccess(link)}>Revoke</button>
            </article>
          ))}
        </>
      )}
      <input value={acceptCode} onChange={(event) => setAcceptCode(event.target.value.toUpperCase())} placeholder="Accept caregiver invite code" />
      <button className="secondary-wide" onClick={acceptInvite}>Accept invite</button>
      <h3>Pending attention</h3>
      {missed.length ? missed.map((item) => <ListCard key={item.id} title={item.title} body={`${item.scheduled_date} ${item.scheduled_time}`} />) : <p className="subtle">No missed reminders recorded.</p>}
    </Panel>
  );
}

function SettingsPanel({ profile, profileOptions, defaultProfileId, onDefaultProfileChange, onUpdated, onSignOut, onError }: {
  profile: Profile;
  profileOptions: ProfileOption[];
  defaultProfileId: string;
  onDefaultProfileChange: (profileId: string) => void;
  onUpdated: (profile: Profile) => void;
  onSignOut: () => void;
  onError: (message: string) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [voiceReply, setVoiceReply] = useState(profile.voice_reply_enabled);
  const [largeText, setLargeText] = useState(profile.large_text_enabled);
  const [highContrast, setHighContrast] = useState(Boolean(profile.high_contrast_enabled));
  const [emergencyNote, setEmergencyNote] = useState(profile.emergency_note || '');
  const save = async () => {
    try {
      const next = await updateProfile(profile.id, {
        display_name: displayName,
        voice_reply_enabled: voiceReply,
        large_text_enabled: largeText,
        high_contrast_enabled: highContrast,
        emergency_note: emergencyNote
      });
      onUpdated(next);
    } catch (exc) {
      onError(readError(exc));
    }
  };
  return (
    <Panel title="Settings" intro="Control voice, display, and emergency information.">
      <label className="field-label">Default profile on login</label>
      {profileOptions.length > 1 ? (
        <select value={defaultProfileId || profile.id} onChange={(event) => onDefaultProfileChange(event.target.value)}>
          {profileOptions.map((item) => (
            <option key={item.profile.id} value={item.profile.id}>
              {item.profile.display_name} ({item.label})
            </option>
          ))}
        </select>
      ) : (
        <p className="subtle">Your own profile is the default.</p>
      )}
      <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" />
      <label className="toggle"><input type="checkbox" checked={voiceReply} onChange={(event) => setVoiceReply(event.target.checked)} /> Voice replies</label>
      <label className="toggle"><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} /> Large text</label>
      <label className="toggle"><input type="checkbox" checked={highContrast} onChange={(event) => setHighContrast(event.target.checked)} /> High contrast</label>
      <textarea value={emergencyNote} onChange={(event) => setEmergencyNote(event.target.value)} placeholder="Emergency note, allergies, instructions" />
      <button className="primary-wide" onClick={save}>Save settings</button>
      <button className="secondary-wide" onClick={onSignOut}><LogOut /> Sign out</button>
    </Panel>
  );
}

function BigButton({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return <button className="big-button" onClick={onClick}><span className="button-icon">{icon}</span><strong>{label}</strong><small>{hint}</small></button>;
}

function Panel({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2><p className="subtle">{intro}</p>{children}</section>;
}

function ListCard({ title, body }: { title: string; body?: string | null }) {
  return <article className="list-card"><h3>{title}</h3>{body && <p>{body}</p>}</article>;
}

function readError(exc: unknown) {
  return exc instanceof Error ? exc.message : 'Something went wrong. Please try again.';
}

export default App;
