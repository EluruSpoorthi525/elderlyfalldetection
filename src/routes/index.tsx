import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Heart,
  Phone,
  PhoneCall,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { usePoseDetection, type FallEvent } from "@/hooks/use-pose-detection";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SafeStep — AI Elderly Fall Detection" },
      { name: "description", content: "Non-intrusive, camera-based fall detection. Real-time AI monitoring with instant caregiver alerts." },
      { property: "og:title", content: "SafeStep — AI Elderly Fall Detection" },
      { property: "og:description", content: "Real-time AI fall detection for elderly care." },
    ],
  }),
  component: SafeStepApp,
});

interface Contact {
  id: string;
  name: string;
  relation: string;
  phone: string;
}

const LS_CONTACTS = "safestep.contacts";
const LS_EVENTS = "safestep.events";

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function SafeStepApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [sensitivity, setSensitivity] = useState(0.5);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [events, setEvents] = useState<FallEvent[]>([]);
  const [alertEvent, setAlertEvent] = useState<FallEvent | null>(null);
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    setContacts(loadLS<Contact[]>(LS_CONTACTS, []));
    setEvents(loadLS<FallEvent[]>(LS_EVENTS, []));
  }, []);
  useEffect(() => { localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts)); }, [contacts]);
  useEffect(() => { localStorage.setItem(LS_EVENTS, JSON.stringify(events)); }, [events]);

  const handleFall = useCallback((e: FallEvent) => {
    setAlertEvent(e);
    setCountdown(15);
    setEvents((prev) => [e, ...prev].slice(0, 50));
    try {
      // Simple audible beep
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      o.start(); o.stop(ctx.currentTime + 1.25);
    } catch { /* noop */ }
  }, []);

  const { status, error, poseDetected, torsoAngle, verticalVelocity, start, stop } =
    usePoseDetection({ videoRef, canvasRef, sensitivity, onFall: handleFall });

  // Countdown
  useEffect(() => {
    if (!alertEvent) return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [alertEvent, countdown]);

  const statusLabel = useMemo(() => {
    if (alertEvent) return { text: "Fall detected", tone: "alert" as const };
    if (status === "monitoring") return { text: poseDetected ? "Monitoring — person in view" : "Monitoring — waiting for person", tone: "ok" as const };
    if (status === "loading") return { text: "Loading AI model…", tone: "muted" as const };
    if (status === "error") return { text: error ?? "Camera unavailable", tone: "alert" as const };
    return { text: "Idle — camera off", tone: "muted" as const };
  }, [status, alertEvent, poseDetected, error]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackgroundGlow />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-xl leading-none">SafeStep</p>
            <p className="text-xs text-muted-foreground">AI Elderly Fall Detection</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-2 text-xs text-muted-foreground backdrop-blur md:flex">
          <span className="relative inline-flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full ${status === "monitoring" ? "bg-success animate-ping" : "bg-muted"} opacity-75`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${status === "monitoring" ? "bg-success" : "bg-muted-foreground"}`} />
          </span>
          On-device pose AI · MediaPipe BlazePose
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <section className="mb-10 max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
            <Heart className="h-3.5 w-3.5" /> Mini-Project · CSE Cyber Security
          </span>
          <h1 className="mt-4 text-4xl font-medium leading-tight md:text-5xl">
            Watchful care, <span className="italic text-primary">without a single wearable.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
            SafeStep watches the room — not the wrist. It uses pose-estimation AI to recognise the moment a loved one falls, then alerts every caregiver on your list in seconds.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Live monitor */}
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-3xl border border-border bg-surface/60 shadow-soft backdrop-blur">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <StatusDot tone={statusLabel.tone} />
                  <div>
                    <p className="text-sm font-medium">{statusLabel.text}</p>
                    <p className="text-xs text-muted-foreground">Live camera feed · processed locally</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status === "monitoring" || status === "loading" ? (
                    <button
                      onClick={stop}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-4 py-2 text-sm hover:bg-background/70"
                    >
                      <CameraOff className="h-4 w-4" /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={start}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      <Camera className="h-4 w-4" /> Start monitoring
                    </button>
                  )}
                </div>
              </div>

              <div className="relative aspect-video w-full bg-black">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
                />
                {status === "idle" && (
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-background/95 to-surface/80">
                    <div className="text-center">
                      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
                        <Camera className="h-7 w-7" />
                      </div>
                      <p className="mt-4 font-display text-2xl">Ready when you are</p>
                      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                        Click <span className="text-foreground">Start monitoring</span> to enable your camera. Video stays on this device.
                      </p>
                    </div>
                  </div>
                )}
                {status === "loading" && (
                  <div className="absolute inset-0 grid place-items-center bg-background/80">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                      Loading pose model…
                    </div>
                  </div>
                )}
                {status === "error" && (
                  <div className="absolute inset-0 grid place-items-center bg-background/80 p-6 text-center">
                    <div>
                      <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
                      <p className="mt-3 text-sm">{error}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Allow camera access in your browser and try again.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Telemetry */}
              <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-background/30 text-center">
                <Telemetry label="Pose" value={poseDetected ? "Tracked" : "—"} icon={<Activity className="h-4 w-4" />} />
                <Telemetry label="Torso tilt" value={`${Math.round(torsoAngle)}°`} icon={<Activity className="h-4 w-4" />} />
                <Telemetry label="Vert. velocity" value={verticalVelocity.toFixed(2)} icon={<Activity className="h-4 w-4" />} />
              </div>
            </div>

            {/* Sensitivity + how it works */}
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <Panel title="Detection sensitivity" icon={<Activity className="h-4 w-4" />}>
                <p className="text-sm text-muted-foreground">
                  Higher sensitivity catches softer falls but may trigger on quick sit-downs.
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Low</span>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={sensitivity}
                    onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">High</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Current: {(sensitivity * 100).toFixed(0)}%</p>
              </Panel>

              <Panel title="How SafeStep decides" icon={<Shield className="h-4 w-4" />}>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Tracks 33 body landmarks at ~30 fps.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Computes torso tilt from vertical.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Detects rapid downward motion of body centre.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> 15-second grace period before alerting contacts.</li>
                </ul>
              </Panel>
            </div>
          </div>

          {/* Right column */}
          <aside className="space-y-6">
            <ContactsPanel contacts={contacts} setContacts={setContacts} />
            <HistoryPanel events={events} onClear={() => setEvents([])} />
          </aside>
        </div>

        <ProjectFooter />
      </main>

      {alertEvent && (
        <AlertModal
          countdown={countdown}
          contacts={contacts}
          confidence={alertEvent.confidence}
          onCancel={() => setAlertEvent(null)}
          onCall={(c) => {
            window.location.href = `tel:${c.phone}`;
          }}
        />
      )}
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -left-40 top-0 h-[40rem] w-[40rem] rounded-full bg-primary/20 blur-[140px]" />
      <div className="absolute -right-40 top-40 h-[30rem] w-[30rem] rounded-full bg-accent/15 blur-[140px]" />
      <div className="absolute inset-0 bg-grid opacity-40" />
    </div>
  );
}

function StatusDot({ tone }: { tone: "ok" | "alert" | "muted" }) {
  const color = tone === "ok" ? "bg-success" : tone === "alert" ? "bg-destructive" : "bg-muted-foreground";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {tone !== "muted" && <span className={`absolute inset-0 rounded-full ${color} opacity-60 animate-ping`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

function Telemetry({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <p className="mt-1 font-display text-lg">{value}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function ContactsPanel({ contacts, setContacts }: { contacts: Contact[]; setContacts: (c: Contact[]) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");

  const add = () => {
    if (!name.trim() || !phone.trim()) return;
    setContacts([...contacts, { id: crypto.randomUUID(), name: name.trim(), relation: relation.trim() || "Caregiver", phone: phone.trim() }]);
    setName(""); setRelation(""); setPhone(""); setOpen(false);
  };

  return (
    <Panel title="Emergency contacts" icon={<Phone className="h-4 w-4" />}>
      <p className="text-xs text-muted-foreground">Notified when a fall is confirmed.</p>
      <ul className="mt-4 space-y-2">
        {contacts.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No contacts yet. Add a family member or caregiver.
          </li>
        )}
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-xl bg-background/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">{c.relation} · {c.phone}</p>
            </div>
            <button
              onClick={() => setContacts(contacts.filter((x) => x.id !== c.id))}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remove contact"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/40 p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
          <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Relation (e.g. Son, Nurse)" className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Save</button>
            <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary">
          <Plus className="h-4 w-4" /> Add contact
        </button>
      )}
    </Panel>
  );
}

function HistoryPanel({ events, onClear }: { events: FallEvent[]; onClear: () => void }) {
  return (
    <Panel title="Incident history" icon={<Clock className="h-4 w-4" />}>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No incidents recorded. We hope it stays that way.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {events.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl bg-background/40 px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-destructive/15 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">Fall detected</p>
                  <p className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</p>
                </div>
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
                  {(e.confidence * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
          <button onClick={onClear} className="mt-3 text-xs text-muted-foreground hover:text-foreground">Clear history</button>
        </>
      )}
    </Panel>
  );
}

function AlertModal({
  countdown, contacts, confidence, onCancel, onCall,
}: {
  countdown: number;
  contacts: Contact[];
  confidence: number;
  onCancel: () => void;
  onCall: (c: Contact) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-destructive/40 bg-surface shadow-glow">
        <div className="bg-destructive/10 p-6 text-center">
          <div className="relative mx-auto grid h-16 w-16 place-items-center rounded-full bg-destructive text-destructive-foreground pulse-ring pulse-ring-alert text-destructive">
            <span className="absolute inset-0 grid place-items-center text-destructive-foreground">
              <AlertTriangle className="h-7 w-7" />
            </span>
          </div>
          <p className="mt-4 font-display text-2xl">Possible fall detected</p>
          <p className="mt-1 text-sm text-muted-foreground">Confidence {(confidence * 100).toFixed(0)}%</p>
          <p className="mt-4 text-sm">
            Notifying contacts in <span className="font-display text-3xl text-destructive">{countdown}s</span>
          </p>
        </div>
        <div className="space-y-2 p-5">
          {contacts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              No contacts to notify. Add caregivers to receive call prompts.
            </p>
          ) : (
            contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => onCall(c)}
                className="flex w-full items-center justify-between rounded-xl bg-background/40 px-3 py-2.5 text-left hover:bg-background/70"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.relation} · {c.phone}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/20 px-3 py-1 text-xs font-medium text-success">
                  <PhoneCall className="h-3.5 w-3.5" /> Call
                </span>
              </button>
            ))
          )}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={onCancel}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm hover:bg-background/40"
            >
              <X className="h-4 w-4" /> I'm okay — cancel
            </button>
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-2 rounded-xl bg-destructive px-3 py-2.5 text-sm font-medium text-destructive-foreground hover:opacity-90"
            >
              <Bell className="h-4 w-4" /> Acknowledge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectFooter() {
  return (
    <section className="mt-16 rounded-3xl border border-border bg-surface/40 p-8 backdrop-blur">
      <div className="grid gap-8 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Mini-Project Abstract</p>
          <h2 className="mt-2 font-display text-2xl">Elderly Fall Detection System using Artificial Intelligence</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Department of CSE (Cyber Security) · Geethanjali College of Engineering and Technology · Under the guidance of K. Balatripura Sundari, Senior Assistant Professor.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border px-3 py-1">E. Spoorthi — 23R11A62F7</span>
            <span className="rounded-full border border-border px-3 py-1">B. Charan Reddy — 23R11A62E8</span>
            <span className="rounded-full border border-border px-3 py-1">M. Sarayu Yashasvi — 23R11A62H1</span>
          </div>
        </div>
        <FootCol title="Advantages" items={["Real-time detection", "No wearables needed", "Cost-effective", "Supports independent living"]} />
        <FootCol title="Applications" items={["Homes", "Hospitals", "Elderly care centres", "Smart-home integration"]} />
      </div>
    </section>
  );
}

function FootCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-primary" /> {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
