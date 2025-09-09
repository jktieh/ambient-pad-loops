import { useEffect, useRef, useState, useCallback } from "react";

/* ------------ Config ------------ */
const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const AUDIO_BASE = "/sounds/";
const AUDIO_EXT = ".mp3";
const FADE_MS = 1200;

/* ------------ Hook: usePadEngine ------------ */
function usePadEngine({
  fadeMs = FADE_MS,
  basePath = AUDIO_BASE,
  ext = AUDIO_EXT,
} = {}) {
  const ctxRef = useRef(null);
  const currentRef = useRef({ key: null, src: null, gain: null });
  const [activeKey, setActiveKey] = useState(null);
  const cacheRef = useRef(new Map()); // key -> AudioBuffer

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const loadBuffer = useCallback(async (key) => {
    const cached = cacheRef.current.get(key);
    if (cached) return cached;

    // Encode filename so "C#.mp3" -> "C%23.mp3" (works reliably with '#')
    const filename = `${key}${ext}`;
    const url = basePath + encodeURIComponent(filename);

    const ctx = ensureCtx();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    cacheRef.current.set(key, buf);
    return buf;
  }, [basePath, ext, ensureCtx]);

  const fade = (gainNode, from, to, ms) => {
    const ctx = ctxRef.current;
    const t0 = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(t0);
    gainNode.gain.setValueAtTime(from, t0);
    gainNode.gain.linearRampToValueAtTime(to, t0 + ms / 1000);
  };

  
const playKey = useCallback(async (key) => {
  // 1) Visually highlight immediately
  setActiveKey(key);

  try {
    const ctx = ensureCtx();
    const buffer = await loadBuffer(key);

    // New source + gain
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(gain).connect(ctx.destination);
    src.start();

    // Crossfade old -> new
    const old = currentRef.current;
    if (old.src && old.gain) {
      fade(old.gain, old.gain.gain.value, 0, fadeMs);
      setTimeout(() => { try { old.src.stop(); } catch {} }, fadeMs + 60);
    }

    fade(gain, 0, 1, fadeMs);
    currentRef.current = { key, src, gain };
  } catch (err) {
    console.error(err);
    // If loading failed, remove the highlight
    setActiveKey((k) => (k === key ? null : k));
  }
}, [ensureCtx, loadBuffer, fadeMs]);


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { currentRef.current.src?.stop?.(); } catch {}
      ctxRef.current?.close?.();
    };
  }, []);

  return { activeKey, playKey, stop };
}

/* ------------ UI ------------ */
export default function App() {
  const { activeKey, playKey, stop } = usePadEngine();

  return (
    <div className="app">
      <h1>Ambient Pad Player</h1>
      <p>
        Click a button to play a looping ambient pad. Click <strong>Stop</strong> to fade out.
      </p>

      <div className="row">
        <span className="badge">Active: {activeKey ?? "None"}</span>
        <button className="badge" onClick={stop}>Stop</button>
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

      <div className="footer">
        Put audio files in <code>/public/sounds/</code> named like
        {" "} <code>C.mp3</code>, <code>C#.mp3</code>, <code>D.mp3</code>, <code>D#.mp3</code>, …  
      </div>
    </div>
  );
}
