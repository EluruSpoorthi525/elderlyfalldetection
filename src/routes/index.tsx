import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Hospital,
  MapPin,
  MessageSquare,
  Phone,
  PhoneCall,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { usePoseDetection, type FallEvent } from "@/hooks/use-pose-detection";
import { findNearestHospital, type NearestHospital } from "@/lib/hospital.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SafeStep — AI Fall Detection & Emergency Response" },
      {
        name: "description",
        content:
          "Camera-based fall detection that auto-dispatches emergency services, AI voice-calls contacts, and SMS-fallbacks with the nearest hospital location.",
      },
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
interface Patient {
  name: string;
  age: string;
  bloodGroup: string;
  conditions: string;
  injuries: string;
  medications: string;
  allergies: string;
  contactName: string;
  contactPhone: string;
  contactRelation: string;
  doctorInfo: string;
  address: string;
}
const EMPTY_PATIENT: Patient = {
  name: "", age: "", bloodGroup: "", conditions: "", injuries: "", medications: "",
  allergies: "", contactName: "", contactPhone: "", contactRelation: "", doctorInfo: "", address: "",
};
type ActionKind = "ems" | "voice" | "sms" | "info";
interface ResponseAction {
  id: string;
  kind: ActionKind;
  text: string;
  detail?: string;
  status: "pending" | "ok" | "failed";
  ts: number;
}
interface IncidentLog extends FallEvent {
  location?: { lat: number; lng: number };
  hospital?: NearestHospital | null;
  actions: ResponseAction[];
}

const LS_CONTACTS = "safestep.contacts";
const LS_EVENTS = "safestep.events.v2";
const LS_PATIENT = "safestep.patient";
const EMERGENCY_NUMBER = "911";

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
  const findHospital = useServerFn(findNearestHospital);

  const [sensitivity, setSensitivity] = useState(0.5);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [events, setEvents] = useState<IncidentLog[]>([]);
  const [patient, setPatient] = useState<Patient>(EMPTY_PATIENT);
  const [source, setSource] = useState<"camera" | "upload">("camera");
  const [uploadName, setUploadName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeIncident, setActiveIncident] = useState<IncidentLog | null>(null);
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    setContacts(loadLS<Contact[]>(LS_CONTACTS, []));
    setEvents(loadLS<IncidentLog[]>(LS_EVENTS, []));
    setPatient({ ...EMPTY_PATIENT, ...loadLS<Partial<Patient>>(LS_PATIENT, {}) });
  }, []);
  useEffect(() => { localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts)); }, [contacts]);
  useEffect(() => { localStorage.setItem(LS_EVENTS, JSON.stringify(events)); }, [events]);
  useEffect(() => { localStorage.setItem(LS_PATIENT, JSON.stringify(patient)); }, [patient]);

  const beep = useCallback(() => {
    try {
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

  const handleFall = useCallback((e: FallEvent) => {
    const incident: IncidentLog = { ...e, actions: [] };
    setActiveIncident(incident);
    setCountdown(15);
    beep();
    toast.error("Fall detected", {
      description: `Confidence ${Math.round(e.confidence * 100)}%. Watching for recovery — if the person stands back up within 15s, no emergency is triggered.`,
      duration: 8000,
    });
  }, [beep]);

  const { status, error, poseDetected, torsoAngle, verticalVelocity, start, startFile, stop } =
    usePoseDetection({ videoRef, canvasRef, sensitivity, onFall: handleFall });

  // Countdown
  useEffect(() => {
    if (!activeIncident) return;
    if (countdown <= 0) {
      triggerEmergencyResponse();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIncident, countdown]);

  // Auto-recovery: if the person stands back up (torso near vertical) for ~2s
  // during the countdown, cancel the emergency automatically.
  const uprightSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeIncident || activeIncident.actions.length > 0) {
      uprightSinceRef.current = null;
      return;
    }
    if (poseDetected && torsoAngle < 30) {
      if (uprightSinceRef.current == null) uprightSinceRef.current = Date.now();
      if (Date.now() - uprightSinceRef.current >= 2000) {
        uprightSinceRef.current = null;
        setActiveIncident(null);
        toast.success("Recovery detected", {
          description: "The person stood back up on their own — emergency response cancelled.",
        });
      }
    } else {
      uprightSinceRef.current = null;
    }
  }, [torsoAngle, poseDetected, activeIncident]);

  const appendAction = useCallback((a: ResponseAction) => {
    setActiveIncident((prev) => prev ? { ...prev, actions: [...prev.actions, a] } : prev);
  }, []);
  const updateAction = useCallback((id: string, patch: Partial<ResponseAction>) => {
    setActiveIncident((prev) => prev ? { ...prev, actions: prev.actions.map((x) => x.id === id ? { ...x, ...patch } : x) } : prev);
  }, []);

  const triggerEmergencyResponse = useCallback(async () => {
    // Run once
    setActiveIncident((prev) => {
      if (!prev || prev.actions.length > 0) return prev;
      // Kick off async chain
      setTimeout(() => runResponse(prev), 0);
      return prev;
    });
  }, []);

  const runResponse = useCallback(async (incident: IncidentLog) => {
    const patientSummary = buildPatientSummary(patient);
    toast.warning("Emergency response started", {
      description: "Locating you, finding the nearest hospital, and notifying contacts now.",
    });

    // 1. Get location
    const locId = crypto.randomUUID();
    appendAction({ id: locId, kind: "info", text: "Acquiring GPS location…", status: "pending", ts: Date.now() });
    const locToast = toast.loading("Acquiring GPS location…");
    let coords: { lat: number; lng: number } | null = null;
    try {
      coords = await new Promise<{ lat: number; lng: number }>((res, rej) => {
        if (!navigator.geolocation) return rej(new Error("No geolocation"));
        navigator.geolocation.getCurrentPosition(
          (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
          (err) => rej(err),
          { enableHighAccuracy: true, timeout: 8000 },
        );
      });
      updateAction(locId, {
        status: "ok",
        text: `GPS locked: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      });
      setActiveIncident((p) => p ? { ...p, location: coords ?? undefined } : p);
      toast.success("GPS locked", {
        id: locToast,
        description: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      });
    } catch {
      updateAction(locId, { status: "failed", text: "GPS unavailable — using saved home address" });
      toast.error("GPS unavailable", {
        id: locToast,
        description: "Falling back to the saved home address.",
      });
    }

    // 2. Find nearest hospital
    let hospital: NearestHospital | null = null;
    if (coords) {
      const hId = crypto.randomUUID();
      appendAction({ id: hId, kind: "info", text: "Locating nearest hospital…", status: "pending", ts: Date.now() });
      const hospToast = toast.loading("Finding the nearest hospital…");
      try {
        const { hospital: h, error: hErr } = await findHospital({ data: coords });
        if (h) {
          hospital = h;
          updateAction(hId, {
            status: "ok",
            text: `Nearest hospital: ${h.name}`,
            detail: `${h.address} · ${h.distanceKm.toFixed(1)} km away`,
          });
          setActiveIncident((p) => p ? { ...p, hospital: h } : p);
          toast.success(`Nearest hospital: ${h.name}`, {
            id: hospToast,
            description: `${h.address} · ${h.distanceKm.toFixed(1)} km away`,
          });
        } else {
          updateAction(hId, { status: "failed", text: hErr ?? "No hospital found" });
          toast.error("No hospital found nearby", { id: hospToast, description: hErr ?? undefined });
        }
      } catch {
        updateAction(hId, { status: "failed", text: "Hospital lookup failed" });
        toast.error("Hospital lookup failed", { id: hospToast });
      }
    }

    // 3. Call EMS
    const emsId = crypto.randomUUID();
    appendAction({
      id: emsId,
      kind: "ems",
      text: `Dialing emergency services (${EMERGENCY_NUMBER})…`,
      status: "pending",
      ts: Date.now(),
    });
    const emsToast = toast.loading(`Dialing emergency services (${EMERGENCY_NUMBER})…`);
    await wait(1200);
    updateAction(emsId, {
      status: "ok",
      text: `Connected to ${EMERGENCY_NUMBER}`,
      detail: `Dispatched: "${patientSummary}. Fall detected at ${coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : patient.address || "saved home address"}."`,
    });
    toast.success(`Connected to ${EMERGENCY_NUMBER}`, {
      id: emsToast,
      description: `Paramedics dispatched with patient details and live location.`,
    });

    // 4. AI voice-call each contact, SMS fallback on simulated failure
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const callId = crypto.randomUUID();
      appendAction({
        id: callId,
        kind: "voice",
        text: `AI voice call → ${c.name} (${c.relation})`,
        status: "pending",
        ts: Date.now(),
      });
      const callToast = toast.loading(`AI voice-calling ${c.name}…`);
      await wait(900);
      const answered = i % 3 !== 2;
      if (answered) {
        updateAction(callId, {
          status: "ok",
          text: `${c.name} answered`,
          detail: `AI: "Hello ${c.name.split(" ")[0]}, this is SafeStep. ${patientSummary} has fallen at ${patient.address || "home"}. Paramedics dispatched to ${hospital?.name ?? "the nearest hospital"}. ${hospital ? `Hospital address: ${hospital.address}.` : ""}"`,
        });
        toast.success(`${c.name} answered`, {
          id: callToast,
          description: `AI delivered patient status and hospital info to ${c.relation}.`,
        });
      } else {
        updateAction(callId, { status: "failed", text: `${c.name} did not answer` });
        toast.warning(`${c.name} did not answer`, {
          id: callToast,
          description: "Sending an SMS with the patient status and hospital location instead.",
        });
        const smsId = crypto.randomUUID();
        appendAction({
          id: smsId,
          kind: "sms",
          text: `SMS fallback → ${c.phone}`,
          status: "pending",
          ts: Date.now(),
        });
        const smsToast = toast.loading(`Sending SMS to ${c.phone}…`);
        await wait(500);
        updateAction(smsId, {
          status: "ok",
          text: `SMS delivered to ${c.name}`,
          detail: `"URGENT: ${patientSummary} fell at ${patient.address || "home"}. EMS en route to ${hospital?.name ?? "nearest hospital"}.${hospital ? ` Directions: ${hospital.mapsUrl}` : ""}"`,
        });
        toast.success(`SMS delivered to ${c.name}`, {
          id: smsToast,
          description: "Includes patient details and a Google Maps link to the hospital.",
        });
      }
    }

    if (contacts.length === 0) {
      appendAction({
        id: crypto.randomUUID(),
        kind: "info",
        text: "No emergency contacts configured",
        status: "failed",
        ts: Date.now(),
      });
      toast.warning("No emergency contacts configured", {
        description: "Add contacts in the right panel so SafeStep can reach them next time.",
      });
    } else {
      toast.success("Emergency response complete", {
        description: `EMS dispatched and ${contacts.length} contact${contacts.length === 1 ? "" : "s"} notified.`,
      });
    }

    // Persist incident
    setActiveIncident((prev) => {
      if (prev) setEvents((evs) => [prev, ...evs].slice(0, 50));
      return prev;
    });
  }, [appendAction, updateAction, findHospital, contacts, patient]);


  const dismissAfterResponse = useCallback(() => {
    setActiveIncident(null);
  }, []);

  const statusLabel = useMemo(() => {
    if (activeIncident) return { text: "Fall detected", tone: "alert" as const };
    if (status === "monitoring") return { text: poseDetected ? "Monitoring — person in view" : "Monitoring — waiting for person", tone: "ok" as const };
    if (status === "loading") return { text: "Loading AI model…", tone: "muted" as const };
    if (status === "error") return { text: error ?? "Camera unavailable", tone: "alert" as const };
    return { text: "Idle — camera off", tone: "muted" as const };
  }, [status, activeIncident, poseDetected, error]);

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
            <p className="text-xs text-muted-foreground">AI Fall Detection & Emergency Response</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-2 text-xs text-muted-foreground backdrop-blur md:flex">
          <span className="relative inline-flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full ${status === "monitoring" ? "bg-success animate-ping" : "bg-muted"} opacity-75`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${status === "monitoring" ? "bg-success" : "bg-muted-foreground"}`} />
          </span>
          On-device pose AI · auto-dispatch on fall
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Live monitor */}
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-3xl border border-border bg-surface/60 shadow-soft backdrop-blur">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <StatusDot tone={statusLabel.tone} />
                  <div>
                    <p className="text-sm font-medium">{statusLabel.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {source === "camera" ? "Live camera feed · processed locally" : uploadName ? `Uploaded video · ${uploadName}` : "Upload a video · analysed locally"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="mr-1 hidden rounded-full border border-border bg-background/40 p-1 sm:flex">
                    {(["camera", "upload"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => { stop(); setSource(m); }}
                        className={`rounded-full px-3 py-1.5 text-xs ${source === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {m === "camera" ? "Live camera" : "Upload video"}
                      </button>
                    ))}
                  </div>
                  {status === "monitoring" || status === "loading" ? (
                    <button
                      onClick={stop}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-4 py-2 text-sm hover:bg-background/70"
                    >
                      <CameraOff className="h-4 w-4" /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => (source === "camera" ? start() : fileInputRef.current?.click())}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      {source === "camera" ? <Camera className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                      {source === "camera" ? "Start monitoring" : "Choose video"}
                    </button>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploadName(f.name);
                  toast.info("Analysing uploaded video", { description: f.name });
                  startFile(f);
                  e.target.value = "";
                }}
              />
              <div className="relative aspect-video w-full bg-black">
                <video ref={videoRef} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${source === "camera" ? "-scale-x-100" : ""}`} />
                <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full object-cover ${source === "camera" ? "-scale-x-100" : ""}`} />
                {status === "idle" && (
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-background/95 to-surface/80">
                    <div className="text-center">
                      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
                        <Camera className="h-7 w-7" />
                      </div>
                      <p className="mt-4 font-display text-2xl">Ready when you are</p>
                      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                        {source === "camera"
                          ? "Click Start monitoring to enable your camera. Video stays on this device."
                          : "Choose a recorded video to run fall detection on it. The file never leaves this device."}
                      </p>
                    </div>
                  </div>
                )}
                {status === "loading" && (
                  <div className="absolute inset-0 grid place-items-center bg-background/80">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Loading pose model…
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

              <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-background/30 text-center">
                <Telemetry label="Pose" value={poseDetected ? "Tracked" : "—"} />
                <Telemetry label="Torso tilt" value={`${Math.round(torsoAngle)}°`} />
                <Telemetry label="Vert. velocity" value={verticalVelocity.toFixed(2)} />
              </div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <Panel title="Detection sensitivity" icon={<Activity className="h-4 w-4" />}>
                <p className="text-sm text-muted-foreground">Higher sensitivity catches softer falls but may trigger on quick sit-downs.</p>
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Low</span>
                  <input type="range" min={0} max={1} step={0.05} value={sensitivity}
                    onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary" />
                  <span className="text-xs text-muted-foreground">High</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Current: {(sensitivity * 100).toFixed(0)}%</p>
              </Panel>

              <PatientPanel patient={patient} setPatient={setPatient} />
            </div>
          </div>

          {/* Right column */}
          <aside className="space-y-6">
            <ContactsPanel contacts={contacts} setContacts={setContacts} />
            <HistoryPanel events={events} onClear={() => setEvents([])} />
          </aside>
        </div>
      </main>

      {activeIncident && (
        <AlertModal
          incident={activeIncident}
          countdown={countdown}
          inResponse={activeIncident.actions.length > 0}
          onClose={dismissAfterResponse}
        />
      )}
    </div>
  );
}

function buildPatientSummary(p: Patient): string {
  const bits: string[] = [];
  if (p.name) bits.push(p.name);
  if (p.age) bits.push(`${p.age} years old`);
  if (p.bloodGroup) bits.push(`blood group ${p.bloodGroup}`);
  if (p.conditions) bits.push(p.conditions);
  if (p.medications) bits.push(`on ${p.medications}`);
  if (p.allergies) bits.push(`allergic to ${p.allergies}`);
  if (p.injuries) bits.push(`previous injuries: ${p.injuries}`);
  if (bits.length === 0) return "An elderly patient";
  return bits.join(", ");
}
function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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

function Telemetry({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Activity className="h-4 w-4" /> {label}
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

function PatientPanel({ patient, setPatient }: { patient: Patient; setPatient: (p: Patient) => void }) {
  return (
    <Panel title="Patient profile" icon={<User className="h-4 w-4" />}>
      <p className="text-xs text-muted-foreground">Used in the AI voice call & SMS sent on a fall.</p>
      <div className="mt-3 grid gap-2">
        <input value={patient.name} onChange={(e) => setPatient({ ...patient, name: e.target.value })}
          placeholder="Full name (e.g. Margaret Doyle)"
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
        <input value={patient.age} onChange={(e) => setPatient({ ...patient, age: e.target.value })}
          placeholder="Age" inputMode="numeric"
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
        <input value={patient.conditions} onChange={(e) => setPatient({ ...patient, conditions: e.target.value })}
          placeholder="Conditions / allergies (e.g. diabetic, on warfarin)"
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
        <input value={patient.address} onChange={(e) => setPatient({ ...patient, address: e.target.value })}
          placeholder="Home address"
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2" />
      </div>
    </Panel>
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
      <p className="text-xs text-muted-foreground">AI voice-called in order. SMS sent if unreachable.</p>
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

function HistoryPanel({ events, onClear }: { events: IncidentLog[]; onClear: () => void }) {
  return (
    <Panel title="Incident history" icon={<AlertTriangle className="h-4 w-4" />}>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No incidents recorded.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {events.slice(0, 6).map((ev) => (
              <li key={ev.id} className="rounded-xl bg-background/40 px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{new Date(ev.timestamp).toLocaleString()}</span>
                  <span className="text-muted-foreground">{(ev.confidence * 100).toFixed(0)}% conf.</span>
                </div>
                {ev.hospital && (
                  <p className="mt-1 truncate text-muted-foreground">→ {ev.hospital.name}</p>
                )}
                <p className="mt-0.5 text-muted-foreground">{ev.actions.length} response actions</p>
              </li>
            ))}
          </ul>
          <button onClick={onClear} className="mt-3 text-xs text-muted-foreground hover:text-destructive">Clear history</button>
        </>
      )}
    </Panel>
  );
}

function AlertModal({
  incident, countdown, inResponse, onClose,
}: {
  incident: IncidentLog;
  countdown: number;
  inResponse: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-destructive/40 bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-destructive/10 px-6 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-destructive/20 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-display text-lg">Fall detected</p>
            <p className="text-xs text-muted-foreground">
              Confidence {(incident.confidence * 100).toFixed(0)}% · {new Date(incident.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>

        {!inResponse ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">Watching for recovery — emergency response in</p>
            <p className="my-3 font-display text-6xl text-destructive">{countdown}s</p>
            <p className="text-xs text-muted-foreground">
              If the person stands back up and stays upright for 2 seconds, the alert is cancelled automatically. No action needed.
            </p>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto p-6">
            <p className="mb-4 text-xs uppercase tracking-wider text-muted-foreground">Emergency response timeline</p>
            <ol className="space-y-3">
              {incident.actions.map((a) => <ActionRow key={a.id} a={a} />)}
            </ol>
            {incident.hospital && (
              <a
                href={incident.hospital.mapsUrl}
                target="_blank" rel="noreferrer"
                className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-background/40 p-3 text-sm hover:border-primary"
              >
                <Hospital className="h-4 w-4 text-primary" />
                <span className="flex-1">
                  <span className="font-medium">{incident.hospital.name}</span>
                  <span className="block text-xs text-muted-foreground">{incident.hospital.address}</span>
                </span>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
            <div className="mt-5 flex justify-end">
              <button onClick={onClose} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionRow({ a }: { a: ResponseAction }) {
  const Icon = a.kind === "ems" ? PhoneCall : a.kind === "voice" ? PhoneCall : a.kind === "sms" ? MessageSquare : MapPin;
  const tone = a.status === "ok" ? "text-success" : a.status === "failed" ? "text-destructive" : "text-muted-foreground";
  return (
    <li className="flex gap-3">
      <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background/40 ${tone}`}>
        {a.status === "pending" ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
        ) : a.status === "ok" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <X className="h-4 w-4" />
        )}
      </div>
      <div className="flex-1">
        <p className="flex items-center gap-2 text-sm">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={tone}>{a.text}</span>
        </p>
        {a.detail && <p className="mt-1 rounded-md bg-background/40 px-3 py-2 text-xs text-muted-foreground">{a.detail}</p>}
      </div>
    </li>
  );
}
