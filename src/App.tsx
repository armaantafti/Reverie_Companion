import { useMemo, useState } from 'react';
import { Bell, CalendarDays, HeartHandshake, Home, MapPin, Mic, Phone, Search, Users } from 'lucide-react';
import type { DailyBoardItem, EmergencyContact, Memory, PhotoCard, Reminder } from './types';

type Section = 'home' | 'remember' | 'ask' | 'today' | 'people' | 'caregiver' | 'reminders' | 'where' | 'help';

const todayItems: DailyBoardItem[] = [
  { id: '1', label: 'Morning medicine', detail: 'Take after breakfast', time: '9:00 AM', kind: 'medicine' },
  { id: '2', label: 'Doctor appointment', detail: 'Cardiology follow-up', time: '5:30 PM', kind: 'appointment' },
  { id: '3', label: 'Family call', detail: 'Armaan will call in the evening', time: '7:00 PM', kind: 'family' }
];

const demoMemories: Memory[] = [
  { id: 'm1', title: 'Reading glasses', body: 'You kept your reading glasses near the sofa.', type: 'where_kept', created_at: new Date().toISOString() },
  { id: 'm2', title: 'Bank passbook', body: 'The bank passbook is in the second drawer of the bedroom cupboard.', type: 'where_kept', created_at: new Date().toISOString() },
  { id: 'm3', title: 'Doctor instruction', body: 'Walk slowly for 20 minutes after breakfast, unless feeling dizzy.', type: 'medical', created_at: new Date().toISOString() }
];

const peopleCards: PhotoCard[] = [
  { id: 'p1', name: 'Armaan', relationship: 'Son', note: 'Usually calls in the evening. Studies engineering.' },
  { id: 'p2', name: 'Primary caregiver', relationship: 'Family support', note: 'Can add reminders and check missed acknowledgements.' }
];

const emergencyContacts: EmergencyContact[] = [
  { id: 'e1', name: 'Primary caregiver', relationship: 'Family', phone: '+91 00000 00000' },
  { id: 'e2', name: 'Doctor', relationship: 'Physician', phone: '+91 00000 00001' }
];

const reminders: Reminder[] = [
  { id: 'r1', title: 'Morning medicine', detail: '1 tablet after breakfast', scheduled_for: '09:00', category: 'medicine', acknowledged: false },
  { id: 'r2', title: 'Drink water', detail: 'Have one glass of water', scheduled_for: '11:30', category: 'hydration', acknowledged: true }
];

function speak(text: string) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
}

function App() {
  const [section, setSection] = useState<Section>('home');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [captured, setCaptured] = useState<Memory[]>(demoMemories);

  const answer = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return '';
    const hit = captured.find((item) => `${item.title} ${item.body}`.toLowerCase().includes(q));
    return hit ? hit.body : 'I could not find that memory yet. You can ask a caregiver to add it.';
  }, [query, captured]);

  const addMemory = () => {
    if (!note.trim()) return;
    const memory: Memory = {
      id: crypto.randomUUID(),
      title: note.slice(0, 40),
      body: note,
      type: note.toLowerCase().includes('kept') ? 'where_kept' : 'general',
      created_at: new Date().toISOString()
    };
    setCaptured((items) => [memory, ...items]);
    setNote('');
    speak('I have saved this memory.');
  };

  const startSpeechCapture = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speak('Voice capture is not available on this device yet. Please type the memory.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (event: any) => setNote(event.results[0][0].transcript);
    recognition.start();
  };

  return (
    <main className="app-shell">
      <header className="top-card">
        <p className="eyebrow">Private Memory Workspace</p>
        <h1>Reverie Companion</h1>
        <p className="subtle">Simple memory help for seniors, families, and caregivers.</p>
      </header>

      {section === 'home' && (
        <section className="grid-actions" aria-label="Main actions">
          <BigButton icon={<Mic />} label="Remember something" hint="Speak or type a memory" onClick={() => setSection('remember')} />
          <BigButton icon={<Search />} label="Ask my memory" hint="Find something saved" onClick={() => setSection('ask')} />
          <BigButton icon={<CalendarDays />} label="Today" hint="Medicines, visits, routine" onClick={() => setSection('today')} />
          <BigButton icon={<MapPin />} label="Where did I keep it?" hint="Keys, glasses, documents" onClick={() => setSection('where')} />
          <BigButton icon={<Users />} label="People & photos" hint="Family memory cards" onClick={() => setSection('people')} />
          <BigButton icon={<HeartHandshake />} label="Caregiver" hint="Family support mode" onClick={() => setSection('caregiver')} />
          <BigButton icon={<Bell />} label="Reminders" hint="Medicine and appointments" onClick={() => setSection('reminders')} />
          <BigButton icon={<Phone />} label="Help" hint="Emergency contacts" onClick={() => setSection('help')} />
        </section>
      )}

      {section !== 'home' && <button className="back-button" onClick={() => setSection('home')}><Home size={22} /> Back home</button>}

      {section === 'remember' && (
        <Panel title="Remember something" intro="Tap the microphone or type a simple note. The app confirms it slowly and clearly.">
          <button className="primary-wide" onClick={startSpeechCapture}><Mic /> Tap and speak</button>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Example: I kept my bank passbook in the second drawer." />
          <button className="primary-wide" onClick={addMemory}>Save this memory</button>
        </Panel>
      )}

      {section === 'ask' && (
        <Panel title="Ask my memory" intro="Ask using simple words. The answer can also be read aloud.">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Example: glasses" />
          {answer && <div className="answer-card"><strong>Answer</strong><p>{answer}</p><button onClick={() => speak(answer)}>Read aloud</button></div>}
        </Panel>
      )}

      {section === 'today' && (
        <Panel title="Today’s memory board" intro="A calming orientation screen with the day’s most important items.">
          <div className="date-card">Today is {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {todayItems.map((item) => <ListCard key={item.id} title={`${item.time} — ${item.label}`} body={item.detail} />)}
        </Panel>
      )}

      {section === 'where' && (
        <Panel title="Where did I keep it?" intro="A dedicated object-location memory list for everyday items.">
          {captured.filter((m) => m.type === 'where_kept').map((m) => <ListCard key={m.id} title={m.title} body={m.body} />)}
        </Panel>
      )}

      {section === 'people' && (
        <Panel title="People & photo memory cards" intro="Family can add photos, names, relationships, and reassuring notes.">
          {peopleCards.map((p) => <ListCard key={p.id} title={`${p.name} — ${p.relationship}`} body={p.note} />)}
        </Panel>
      )}

      {section === 'caregiver' && (
        <Panel title="Caregiver mode" intro="Permission-based support for trusted family members.">
          <ListCard title="Remote reminders" body="Caregivers can add medicines, appointments, routines, and check-ins." />
          <ListCard title="Missed acknowledgement alerts" body="The data model supports escalation if a reminder is not marked done." />
          <ListCard title="Memory support" body="Caregivers can add family photos, people cards, and important household information." />
        </Panel>
      )}

      {section === 'reminders' && (
        <Panel title="Medicine & appointment reminders" intro="Large reminders with acknowledgement status and escalation-ready records.">
          {reminders.map((r) => <ListCard key={r.id} title={`${r.scheduled_for} — ${r.title}`} body={`${r.detail} · ${r.acknowledged ? 'Done' : 'Not yet confirmed'}`} />)}
        </Panel>
      )}

      {section === 'help' && (
        <Panel title="Emergency help" intro="One large, visible place for family, doctor, and safety information.">
          {emergencyContacts.map((c) => <a key={c.id} className="call-card" href={`tel:${c.phone}`}><strong>{c.name}</strong><span>{c.relationship}</span><span>{c.phone}</span></a>)}
        </Panel>
      )}
    </main>
  );
}

function BigButton({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return <button className="big-button" onClick={onClick}><span className="button-icon">{icon}</span><strong>{label}</strong><small>{hint}</small></button>;
}

function Panel({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2><p className="subtle">{intro}</p>{children}</section>;
}

function ListCard({ title, body }: { title: string; body: string }) {
  return <article className="list-card"><h3>{title}</h3><p>{body}</p></article>;
}

export default App;
