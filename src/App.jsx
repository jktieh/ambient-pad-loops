import { useEffect, useRef, useState, useCallback } from "react";

/* ------------ Config ------------ */
const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const AUDIO_BASE = "/sounds/";
const AUDIO_EXT = ".mp3";
const FADE_MS = 2000;        
const DEFAULT_VOL = 0.8;      // 0.0 - 1.0

/* ------------ Hook: usePadEngine ------------ */
function usePadEngine({
  fadeMs = FADE_MS,
  basePath = AUDIO_BASE,
  ext = AUDIO_EXT,
  initialVolume = DEFAULT_VOL,
} = {}) {
  const ctxRef = useRef(null);
  const masterGainRef = useRef(null);                // master volume node
  const currentRef = useRef({ key: null, src: null, gain: null });
  const [activeKey, setActiveKey] = useState(null);
  const [volume, setVolume] = useState(initialVolume);
  const cacheRef = useRef(new Map());                // key -> AudioBuffer
  const actionIdRef = useRef(0);                     // latest click id

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new Ctor();

      // create master gain once
      masterGainRef.current = ctxRef.current.createGain();
      masterGainRef.current.gain.value = initialVolume;
      masterGainRef.current.connect(ctxRef.current.destination);
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, [initialVolume]);

  // Apply volume updates to master gain
  useEffect(() => {
    if (masterGainRef.current && ctxRef.current) {
      const t0 = ctxRef.current.currentTime;
      masterGainRef.current.gain.cancelScheduledValues(t0);
      masterGainRef.current.gain.setValueAtTime(volume, t0);
    }
  }, [volume]);

  // Load buffer with Asharp/Dsharp/etc naming (no '#')
  const loadBuffer = useCallback(async (key) => {
    const cached = cacheRef.current.get(key);
    if (cached) return cached;

    const filename = key.replace("#", "sharp") + ext;   // e.g., "Asharp.mp3"
    const url = basePath + filename;

    const ctx = ensureCtx();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    cacheRef.current.set(key, buf);
    return buf;
  }, [basePath, ext, ensureCtx]);

  const stop = useCallback(() => {
    const ctx = ctxRef.current;
    const old = currentRef.current;
    if (!ctx || !old?.gain || !old?.src) {
      setActiveKey(null);
      return;
    }

    const t0 = ctx.currentTime;
    const fadeSec = fadeMs / 1000;
    old.gain.gain.cancelScheduledValues(t0);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t0);
    old.gain.gain.linearRampToValueAtTime(0, t0 + fadeSec);
    setTimeout(() => { try { old.src.stop(); } catch {} }, fadeMs + 60);

    currentRef.current = { key: null, src: null, gain: null };
    setActiveKey(null);
  }, [fadeMs]);

  const playKey = useCallback(async (key) => {
    // If same key pressed → stop instead
    if (currentRef.current.key === key) {
      stop();
      return;
    }

    const myId = ++actionIdRef.current;
    setActiveKey(key); // instant visual feedback

    try {
      const ctx = ensureCtx();
      const buffer = await loadBuffer(key);
      if (myId !== actionIdRef.current) return; // stale request

      // New source at 0 gain, connect -> master -> destination
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(masterGainRef.current);
      src.connect(gain);
      src.start();

      // Simultaneous crossfade
      const old = currentRef.current;
      const t0 = ctx.currentTime;
      const fadeSec = fadeMs / 1000;

      // New: 0 -> 1
      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + fadeSec);

      // Old: current -> 0
      if (old?.gain && old?.src) {
        const startVal = old.gain.gain.value;
        old.gain.gain.cancelScheduledValues(t0);
        old.gain.gain.setValueAtTime(startVal, t0);
        old.gain.gain.linearRampToValueAtTime(0, t0 + fadeSec);
        setTimeout(() => { try { old.src.stop(); } catch {} }, fadeMs + 60);
      }

      currentRef.current = { key, src, gain };
    } catch (err) {
      console.error(err);
      if (myId === actionIdRef.current) setActiveKey(null);
    }
  }, [ensureCtx, loadBuffer, fadeMs, stop]);

  return { activeKey, playKey, stop, volume, setVolume };
}

/* ------------ UI ------------ */
export default function App() {
  const { activeKey, playKey, stop, volume, setVolume } = usePadEngine();

  return (
    <div className="app">
      <h1>Ambient Pad Player</h1>
      <p>
        Click a key to play a looping pad. Click the <strong>same key</strong> again or the{" "}
        <strong>Stop</strong> button to fade out.
      </p>

      <div className="row">
        <span className="badge">Active: {activeKey ?? "None"}</span>
        <button className="badge" onClick={stop}>Stop</button>

        <div className="vol">
          <label htmlFor="vol">Volume</label>
          <input
            id="vol"
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
          />
          <span className="volval">{Math.round(volume * 100)}%</span>
        </div>
      </div>

      <div className="grid">
        {KEYS.map((k) => (
          <button
            key={k}
            className={`keybtn ${activeKey === k ? "active" : ""}`}
            onClick={() => playKey(k)}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
