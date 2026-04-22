"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// ── Config ────────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const ACCENT_HUE = 41;
const COMPACT_SIDEBAR = true;
const SHOW_PIPELINE = true;

// ── Known-destination metadata (purely cosmetic: emoji/country) ───────────
const DESTINATIONS: Record<string, { name: string; country: string; emoji: string }> = {
  tokyo: { name: "Tokyo", country: "Japan", emoji: "🗼" },
  london: { name: "London", country: "UK", emoji: "🎡" },
  paris: { name: "Paris", country: "France", emoji: "🗽" },
  bali: { name: "Bali", country: "Indonesia", emoji: "🌴" },
  kyoto: { name: "Kyoto", country: "Japan", emoji: "⛩️" },
  barcelona: { name: "Barcelona", country: "Spain", emoji: "🏛️" },
  rome: { name: "Rome", country: "Italy", emoji: "🏛️" },
  nyc: { name: "New York", country: "USA", emoji: "🗽" },
  "new york": { name: "New York", country: "USA", emoji: "🗽" },
};

function destMeta(name?: string | null) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (DESTINATIONS[key]) return DESTINATIONS[key];
  const partial = Object.entries(DESTINATIONS).find(([k]) =>
    key.includes(k) || k.includes(key.split(",")[0].trim()),
  );
  if (partial) return partial[1];
  return { name, country: "", emoji: "✈️" };
}

const WEATHER_ICONS: Record<string, string> = {
  Clear: "☀️",
  Clouds: "⛅",
  Cloudy: "☁️",
  Rain: "🌧️",
  Drizzle: "🌦️",
  Thunderstorm: "⛈️",
  Snow: "❄️",
  Mist: "🌫️",
  Fog: "🌫️",
  Haze: "🌫️",
};

function weatherIcon(condition?: string | null) {
  if (!condition) return "☀️";
  return WEATHER_ICONS[condition] || "🌤️";
}

// ── Pipeline stages ───────────────────────────────────────────────────────
type StageId = "memory_loader" | "extractor" | "drafter" | "checker" | "validator" | "memory_saver";
interface Stage {
  id: StageId;
  label: string;
  icon: string;
}
const STAGES: Stage[] = [
  { id: "memory_loader", label: "Memory", icon: "◈" },
  { id: "extractor", label: "Extract", icon: "◎" },
  { id: "drafter", label: "Draft", icon: "◐" },
  { id: "checker", label: "Check", icon: "◉" },
  { id: "validator", label: "Validate", icon: "✦" },
];

// ── Types ─────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

interface Itinerary {
  recommendation?: string;
  location_type?: string;
  reasoning?: string;
}

interface TripState {
  destination: string | null;
  max_budget: number;
  dates: string | null;
  current_itinerary: Itinerary;
}

interface Proposal {
  dest: { name: string; country: string; emoji: string };
  weather: { condition: string; icon: string };
  rec: { recommendation: string; type: string; cost: number; reasoning: string };
  budget: number;
  validationPassed: boolean;
  overBudget: boolean;
  isBad: boolean;
  errors: string[];
}

interface MemoryState {
  past_destinations: string[];
  past_activities: string[];
}

// ── Streaming event types ─────────────────────────────────────────────────
type StreamEvent =
  | { type: "stage"; name: StageId; state: Record<string, unknown> }
  | {
      type: "final";
      reply: string;
      destination: string | null;
      max_budget: number;
      dates: string | null;
      current_itinerary: Itinerary;
      weather_forecast: string | null;
      total_estimated_cost: number | null;
      validation_errors: string[];
      memory: MemoryState;
    }
  | { type: "error"; message: string };

// ── Theme ─────────────────────────────────────────────────────────────────
const css = {
  accent: `oklch(0.62 0.16 ${ACCENT_HUE})`,
  accentLight: `oklch(0.95 0.04 ${ACCENT_HUE})`,
  accentMid: `oklch(0.80 0.09 ${ACCENT_HUE})`,
  accentDark: `oklch(0.48 0.16 ${ACCENT_HUE})`,
};

const INITIAL_TRIP: TripState = {
  destination: null,
  max_budget: 0,
  dates: null,
  current_itinerary: {},
};

const INITIAL_MEMORY: MemoryState = { past_destinations: [], past_activities: [] };

const WELCOME: ChatMessage = {
  id: 0,
  role: "assistant",
  text: "Hello! I'm your AI travel planner. Tell me where you'd like to go, your budget, and when — I'll handle the rest.",
  ts: Date.now(),
};

// ── Main ──────────────────────────────────────────────────────────────────
export default function Page() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [activeStage, setActiveStage] = useState<StageId | null>(null);
  const [completedStages, setCompletedStages] = useState<StageId[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [memory, setMemory] = useState<MemoryState>(INITIAL_MEMORY);
  const [trip, setTrip] = useState<TripState>(INITIAL_TRIP);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Rehydrate on first mount
  useEffect(() => {
    try {
      const m = localStorage.getItem("travelPlannerMsgs");
      if (m) {
        const parsed = JSON.parse(m) as ChatMessage[];
        if (parsed.length > 1) setMessages(parsed);
      }
    } catch {}
    try {
      const t = localStorage.getItem("travelPlannerTrip");
      if (t) setTrip(JSON.parse(t));
    } catch {}
    try {
      const p = localStorage.getItem("travelPlannerProposal");
      if (p) setProposal(JSON.parse(p));
    } catch {}

    // Memory lives on the backend (preferences.json); fetch once
    fetch(`${API_URL}/api/memory`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setMemory({
            past_destinations: data.past_destinations || [],
            past_activities: data.past_activities || [],
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, processing]);

  useEffect(() => {
    localStorage.setItem("travelPlannerMsgs", JSON.stringify(messages));
  }, [messages]);

  const addMessage = (role: "user" | "assistant", text: string) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), role, text, ts: Date.now() }]);
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || processing) return;
    setInput("");
    addMessage("user", text);
    setProcessing(true);
    setCompletedStages([]);
    setActiveStage(null);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          trip: {
            destination: trip.destination && trip.destination !== "Not set" ? trip.destination : null,
            max_budget: trip.max_budget || 0,
            dates: trip.dates && trip.dates !== "Not set" ? trip.dates : null,
            current_itinerary: trip.current_itinerary || {},
          },
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`API error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const clean = line.trim();
          if (!clean) continue;
          try {
            const evt = JSON.parse(clean) as StreamEvent;
            handleStreamEvent(evt);
          } catch (e) {
            console.error("bad chunk", clean, e);
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addMessage(
        "assistant",
        `Sorry — I couldn't reach the travel agent. (${msg}) Make sure the backend is running at ${API_URL}.`,
      );
    } finally {
      setProcessing(false);
      setActiveStage(null);
    }
  }, [input, processing, trip]);

  const handleStreamEvent = (evt: StreamEvent) => {
    if (evt.type === "stage") {
      if (evt.name === "memory_saver") {
        // cosmetic: not in the displayed pipeline; treated as completion
        return;
      }
      setCompletedStages((prev) => {
        if (prev.includes(evt.name)) return prev;
        return [...prev, evt.name];
      });
      setActiveStage(evt.name);
    } else if (evt.type === "final") {
      const destName = evt.destination && evt.destination !== "Not set" ? evt.destination : null;
      const dest = destMeta(destName) || { name: destName || "Unknown", country: "", emoji: "✈️" };
      const condition = evt.weather_forecast || "Clear";
      const itinerary = evt.current_itinerary || {};
      const cost = evt.total_estimated_cost ?? 0;
      const budget = evt.max_budget || 0;
      const overBudget = budget > 0 && cost > budget;
      const locType = itinerary.location_type || "";
      const isBad = ["Rain", "Drizzle", "Thunderstorm", "Snow"].includes(condition);
      const validationPassed = (evt.validation_errors || []).length === 0;

      const newTrip: TripState = {
        destination: evt.destination || null,
        max_budget: evt.max_budget || 0,
        dates: evt.dates || null,
        current_itinerary: itinerary,
      };
      setTrip(newTrip);
      localStorage.setItem("travelPlannerTrip", JSON.stringify(newTrip));

      if (itinerary.recommendation) {
        const newProposal: Proposal = {
          dest,
          weather: { condition, icon: weatherIcon(condition) },
          rec: {
            recommendation: itinerary.recommendation,
            type: locType,
            cost,
            reasoning: itinerary.reasoning || "",
          },
          budget,
          validationPassed,
          overBudget,
          isBad,
          errors: evt.validation_errors || [],
        };
        setProposal(newProposal);
        localStorage.setItem("travelPlannerProposal", JSON.stringify(newProposal));
      }

      if (evt.memory) {
        setMemory({
          past_destinations: evt.memory.past_destinations || [],
          past_activities: evt.memory.past_activities || [],
        });
      }

      addMessage("assistant", evt.reply);
    } else if (evt.type === "error") {
      addMessage("assistant", `The agent ran into a problem: ${evt.message}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearMemory = async () => {
    try {
      await fetch(`${API_URL}/api/memory/clear`, { method: "POST" });
    } catch {}
    setMemory(INITIAL_MEMORY);
    setTrip(INITIAL_TRIP);
    setProposal(null);
    setMessages([
      {
        id: 0,
        role: "assistant",
        text: "Memory cleared. Hello again! Where would you like to explore?",
        ts: Date.now(),
      },
    ]);
    localStorage.removeItem("travelPlannerTrip");
    localStorage.removeItem("travelPlannerProposal");
    localStorage.removeItem("travelPlannerMsgs");
  };

  const tripDest = trip.destination && trip.destination !== "Not set" ? trip.destination : null;
  const tripEmoji = destMeta(tripDest)?.emoji || "✈️";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "oklch(0.97 0.01 60)",
      }}
    >
      <Sidebar
        memory={memory}
        tripDest={tripDest}
        tripBudget={trip.max_budget}
        tripEmoji={tripEmoji}
        onClear={clearMemory}
        compact={COMPACT_SIDEBAR}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          borderRight: "1px solid oklch(0.90 0.02 50)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid oklch(0.90 0.02 50)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "oklch(0.99 0.005 60)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: css.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            ✦
          </div>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "oklch(0.18 0.02 50)",
                letterSpacing: "-0.01em",
              }}
            >
              Travel Planner
            </div>
            <div style={{ fontSize: 11, color: "oklch(0.55 0.03 50)" }}>
              Powered by LangGraph · Ollama llama3.1
            </div>
          </div>
          {tripDest && (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 20,
                background: css.accentLight,
                fontSize: 12,
                fontWeight: 500,
                color: css.accentDark,
              }}
            >
              <span>{tripEmoji}</span>
              <span>{tripDest}</span>
              {trip.max_budget > 0 && (
                <span style={{ opacity: 0.7 }}>· ${trip.max_budget}</span>
              )}
            </div>
          )}
        </div>

        {SHOW_PIPELINE && (
          <Pipeline active={activeStage} completed={completedStages} processing={processing} />
        )}

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {messages.map((msg) => (
            <Message key={msg.id} msg={msg} />
          ))}
          {processing && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid oklch(0.90 0.02 50)",
            background: "oklch(0.99 0.005 60)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Try: 'I want to visit Tokyo for $300. I love history but hate rain.'"
              disabled={processing}
              rows={2}
              style={{
                flex: 1,
                resize: "none",
                border: "1.5px solid oklch(0.87 0.03 50)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 14,
                fontFamily: "'DM Sans', sans-serif",
                background: "white",
                color: "oklch(0.18 0.02 50)",
                outline: "none",
                lineHeight: 1.5,
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = css.accent)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "oklch(0.87 0.03 50)")}
            />
            <button
              onClick={handleSend}
              disabled={processing || !input.trim()}
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                border: "none",
                cursor: processing || !input.trim() ? "default" : "pointer",
                background: processing || !input.trim() ? "oklch(0.87 0.02 50)" : css.accent,
                color: "white",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s",
                flexShrink: 0,
              }}
            >
              ↑
            </button>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              "Tokyo for $300, I love history",
              "London for $200, hate rain",
              "Bali for $400, 5 days",
              "Kyoto for $150",
            ].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setInput(s);
                  inputRef.current?.focus();
                }}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 20,
                  border: `1px solid ${css.accentMid}`,
                  background: css.accentLight,
                  color: css.accentDark,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ProposalPanel proposal={proposal} />
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────
interface SidebarProps {
  memory: MemoryState;
  tripDest: string | null;
  tripBudget: number;
  tripEmoji: string;
  onClear: () => void;
  compact: boolean;
}

function Sidebar({ memory, tripDest, tripBudget, tripEmoji, onClear, compact }: SidebarProps) {
  return (
    <div
      style={{
        width: compact ? 220 : 260,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid oklch(0.90 0.02 50)",
        background: "oklch(0.99 0.005 60)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid oklch(0.90 0.02 50)" }}>
        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 17,
            fontWeight: 500,
            color: "oklch(0.18 0.02 50)",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Agentic
          <br />
          Travel Planner
        </div>
        <div
          style={{
            fontSize: 10,
            color: "oklch(0.60 0.03 50)",
            marginTop: 4,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          LangGraph · RAG · Self-correcting
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {tripDest && (
          <Section label="Current Trip">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: css.accentLight,
              }}
            >
              <span style={{ fontSize: 18 }}>{tripEmoji}</span>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: css.accentDark,
                    fontFamily: "'Playfair Display', serif",
                  }}
                >
                  {tripDest}
                </div>
                {tripBudget > 0 && (
                  <div style={{ fontSize: 11, color: "oklch(0.55 0.03 50)" }}>
                    Budget: ${tripBudget}
                  </div>
                )}
              </div>
            </div>
          </Section>
        )}

        <Section label="Past Destinations">
          {memory.past_destinations.length === 0 ? (
            <div style={{ fontSize: 12, color: "oklch(0.65 0.03 50)", fontStyle: "italic" }}>
              No trips yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {memory.past_destinations.map((d) => (
                <div
                  key={d}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 6,
                    background: "oklch(0.95 0.01 60)",
                    fontSize: 12,
                  }}
                >
                  <span>{destMeta(d)?.emoji || "📍"}</span>
                  <span style={{ color: "oklch(0.28 0.02 50)", fontWeight: 500 }}>{d}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section label="Visited">
          {memory.past_activities.length === 0 ? (
            <div style={{ fontSize: 12, color: "oklch(0.65 0.03 50)", fontStyle: "italic" }}>
              Nothing yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {memory.past_activities.map((a) => (
                <div
                  key={a}
                  style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 0" }}
                >
                  <span style={{ color: css.accentMid, marginTop: 2, fontSize: 10 }}>✓</span>
                  <span
                    style={{ fontSize: 11.5, color: "oklch(0.40 0.02 50)", lineHeight: 1.4 }}
                  >
                    {a}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section label="Agent Architecture">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { label: "LLM", val: "llama3.1 (Ollama)" },
              { label: "Graph", val: "LangGraph" },
              { label: "Memory", val: "preferences.json" },
              { label: "RAG", val: "ChromaDB" },
              { label: "Weather", val: "OpenWeatherMap" },
            ].map(({ label, val }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 11, color: "oklch(0.60 0.03 50)" }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: "oklch(0.35 0.02 50)" }}>
                  {val}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div style={{ padding: "12px 20px", borderTop: "1px solid oklch(0.90 0.02 50)" }}>
        <button
          onClick={onClear}
          style={{
            width: "100%",
            padding: "7px",
            borderRadius: 8,
            border: "1px solid oklch(0.87 0.02 50)",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12,
            color: "oklch(0.55 0.03 50)",
            fontFamily: "'DM Sans', sans-serif",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "oklch(0.93 0.01 50)";
            e.currentTarget.style.color = "oklch(0.35 0.02 50)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "oklch(0.55 0.03 50)";
          }}
        >
          Clear Memory
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "oklch(0.65 0.03 50)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Pipeline ──────────────────────────────────────────────────────────────
interface PipelineProps {
  active: StageId | null;
  completed: StageId[];
  processing: boolean;
}

function Pipeline({ active, completed, processing }: PipelineProps) {
  if (!processing && completed.length === 0) return null;
  return (
    <div
      style={{
        padding: "10px 24px",
        borderBottom: "1px solid oklch(0.90 0.02 50)",
        background: "white",
        display: "flex",
        alignItems: "center",
        gap: 0,
      }}
    >
      {STAGES.map((stage, i) => {
        const isDone = completed.includes(stage.id);
        const isActive = active === stage.id;
        return (
          <React.Fragment key={stage.id}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                animation: isActive ? "nodePop 0.3s ease" : "none",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  transition: "all 0.3s",
                  background: isDone
                    ? css.accent
                    : isActive
                    ? css.accentLight
                    : "oklch(0.93 0.01 50)",
                  color: isDone ? "white" : isActive ? css.accentDark : "oklch(0.70 0.02 50)",
                  border: isActive ? `2px solid ${css.accent}` : "2px solid transparent",
                  boxShadow: isActive ? `0 0 0 3px ${css.accentLight}` : "none",
                }}
              >
                {isDone ? "✓" : stage.icon}
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 500,
                  color: isDone
                    ? css.accentDark
                    : isActive
                    ? "oklch(0.30 0.03 50)"
                    : "oklch(0.68 0.02 50)",
                  letterSpacing: "0.02em",
                }}
              >
                {stage.label}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1.5,
                  background: isDone ? css.accentMid : "oklch(0.88 0.02 50)",
                  margin: "0 2px 14px",
                  transition: "background 0.3s",
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Messages ──────────────────────────────────────────────────────────────
function Message({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const parts = msg.text.split(/\*\*(.*?)\*\*/g);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 6,
        animation: "fadeUp 0.25s ease",
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: css.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
            marginRight: 8,
            marginTop: 2,
          }}
        >
          ✦
        </div>
      )}
      <div
        style={{
          maxWidth: "72%",
          padding: "10px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isUser ? css.accent : "white",
          color: isUser ? "white" : "oklch(0.22 0.02 50)",
          fontSize: 13.5,
          lineHeight: 1.6,
          boxShadow: isUser ? "none" : "0 1px 4px oklch(0.85 0.02 50 / 0.5)",
          border: isUser ? "none" : "1px solid oklch(0.91 0.02 50)",
        }}
      >
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <strong
              key={i}
              style={{ fontWeight: 600, color: isUser ? "white" : css.accentDark }}
            >
              {part}
            </strong>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: css.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        ✦
      </div>
      <div
        style={{
          display: "flex",
          gap: 5,
          padding: "10px 14px",
          background: "white",
          borderRadius: "14px 14px 14px 4px",
          border: "1px solid oklch(0.91 0.02 50)",
          boxShadow: "0 1px 4px oklch(0.85 0.02 50 / 0.5)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: css.accent,
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Proposal Panel ────────────────────────────────────────────────────────
function ProposalPanel({ proposal }: { proposal: Proposal | null }) {
  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "oklch(0.99 0.005 60)",
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: "1px solid oklch(0.90 0.02 50)" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "oklch(0.60 0.03 50)",
          }}
        >
          Latest Proposal
        </div>
      </div>

      {!proposal ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            textAlign: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "oklch(0.93 0.02 60)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
          >
            ✈️
          </div>
          <div style={{ fontSize: 13, color: "oklch(0.60 0.03 50)", lineHeight: 1.5 }}>
            Your travel proposal
            <br />
            will appear here
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            animation: "slideIn 0.4s ease",
          }}
        >
          {/* Hero */}
          <div
            style={{
              borderRadius: 12,
              overflow: "hidden",
              background: css.accentLight,
              padding: "20px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>{proposal.dest.emoji}</div>
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 22,
                fontWeight: 500,
                color: "oklch(0.18 0.02 50)",
                letterSpacing: "-0.02em",
              }}
            >
              {proposal.dest.name}
            </div>
            {proposal.dest.country && (
              <div style={{ fontSize: 12, color: "oklch(0.50 0.03 50)", marginTop: 2 }}>
                {proposal.dest.country}
              </div>
            )}
          </div>

          {/* Validation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: proposal.validationPassed
                ? "oklch(0.95 0.05 145)"
                : "oklch(0.96 0.05 25)",
              border: `1px solid ${
                proposal.validationPassed ? "oklch(0.82 0.08 145)" : "oklch(0.85 0.08 25)"
              }`,
            }}
          >
            <span style={{ fontSize: 14 }}>{proposal.validationPassed ? "✅" : "⚠️"}</span>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: proposal.validationPassed ? "oklch(0.35 0.10 145)" : "oklch(0.42 0.12 25)",
              }}
            >
              {proposal.validationPassed
                ? "Validation passed"
                : proposal.errors[0] || "Needs re-draft"}
            </div>
          </div>

          {/* Recommendation */}
          <div
            style={{
              borderRadius: 10,
              border: "1px solid oklch(0.90 0.02 50)",
              overflow: "hidden",
              background: "white",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                background: "oklch(0.96 0.01 60)",
                borderBottom: "1px solid oklch(0.91 0.02 50)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "oklch(0.60 0.03 50)",
                }}
              >
                Recommendation
              </div>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  borderRadius: 10,
                  background:
                    proposal.rec.type === "indoor" ? "oklch(0.93 0.04 220)" : css.accentLight,
                  color:
                    proposal.rec.type === "indoor" ? "oklch(0.40 0.12 220)" : css.accentDark,
                  fontWeight: 500,
                }}
              >
                {proposal.rec.type === "indoor"
                  ? "🏛 indoor"
                  : proposal.rec.type === "outdoor"
                  ? "🌿 outdoor"
                  : "— type"}
              </span>
            </div>
            <div style={{ padding: 14 }}>
              <div
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: 16,
                  fontWeight: 500,
                  color: "oklch(0.18 0.02 50)",
                  lineHeight: 1.3,
                  marginBottom: 8,
                }}
              >
                {proposal.rec.recommendation}
              </div>
              {proposal.rec.reasoning && (
                <div
                  style={{ fontSize: 12, color: "oklch(0.45 0.03 50)", lineHeight: 1.6 }}
                >
                  {proposal.rec.reasoning}
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <StatCard
              label="Est. Cost"
              value={`$${proposal.rec.cost}`}
              sub="per person"
              color={proposal.overBudget ? "oklch(0.96 0.05 25)" : css.accentLight}
              textColor={proposal.overBudget ? "oklch(0.42 0.12 25)" : css.accentDark}
            />
            <StatCard
              label="Budget"
              value={proposal.budget > 0 ? `$${proposal.budget}` : "—"}
              sub="your limit"
              color="oklch(0.95 0.01 60)"
              textColor="oklch(0.35 0.02 50)"
            />
          </div>

          {/* Weather */}
          <div
            style={{
              borderRadius: 10,
              border: "1px solid oklch(0.90 0.02 50)",
              padding: "12px 14px",
              background: "white",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 26 }}>{proposal.weather.icon}</span>
            <div>
              <div
                style={{ fontSize: 13, fontWeight: 600, color: "oklch(0.28 0.02 50)" }}
              >
                {proposal.weather.condition}
              </div>
              <div style={{ fontSize: 12, color: "oklch(0.55 0.03 50)" }}>
                in {proposal.dest.name}
              </div>
            </div>
            {proposal.isBad && proposal.rec.type === "indoor" && (
              <div
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: "oklch(0.45 0.12 220)",
                  padding: "3px 8px",
                  background: "oklch(0.93 0.04 220)",
                  borderRadius: 6,
                  fontWeight: 500,
                }}
              >
                Auto-corrected
              </div>
            )}
          </div>

          {/* Trace */}
          <div
            style={{
              borderRadius: 8,
              border: "1px solid oklch(0.90 0.02 50)",
              padding: "10px 12px",
              background: "oklch(0.97 0.01 60)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "oklch(0.60 0.03 50)",
                marginBottom: 8,
              }}
            >
              Graph Trace
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[
                { node: "memory_loader", detail: "Preferences loaded" },
                {
                  node: "extractor",
                  detail: `→ ${proposal.dest.name} · $${proposal.budget || "?"}`,
                },
                { node: "drafter", detail: proposal.rec.type || "draft" },
                {
                  node: "checker",
                  detail: `${proposal.weather.condition} · $${proposal.rec.cost}`,
                },
                {
                  node: "validator",
                  detail: proposal.validationPassed ? "✓ passed" : "⟳ re-drafted",
                },
              ].map(({ node, detail }) => (
                <div
                  key={node}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}
                >
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: css.accentMid,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: "oklch(0.40 0.02 50)", fontWeight: 500 }}>{node}</span>
                  <span style={{ color: "oklch(0.62 0.03 50)", marginLeft: "auto" }}>
                    {detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
  textColor,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  textColor: string;
}) {
  const style: CSSProperties = {
    borderRadius: 8,
    padding: "10px 12px",
    background: color,
  };
  return (
    <div style={style}>
      <div
        style={{
          fontSize: 10,
          color: "oklch(0.60 0.03 50)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: textColor,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: "oklch(0.62 0.03 50)", marginTop: 1 }}>{sub}</div>
    </div>
  );
}
