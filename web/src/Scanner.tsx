import { useEffect, useRef, useState } from "react";

export interface ScanResult {
  ok: boolean;
  message: string;
  /** set when the barcode is unknown, so the user can name it */
  raw?: string;
}

interface Props {
  onCode: (raw: string) => ScanResult;
  onUnknownNamed: (raw: string, name: string) => void;
  onClose: () => void;
}

type BarcodeDetectorLike = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * Camera barcode scanner. Uses the browser's built-in BarcodeDetector where it exists (Chrome on Android)
 * and falls back to ZXing (loaded on demand) for Safari/iPhone and others.
 */
export default function Scanner({ onCode, onUnknownNamed, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [error, setError] = useState("");
  const [log, setLog] = useState<ScanResult[]>([]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;
    let timer: number | undefined;
    const seen = new Map<string, number>();

    const handle = (raw: string) => {
      const now = Date.now();
      if (now - (seen.get(raw) ?? 0) < 3000) return; // the same product stays in view for a moment
      seen.set(raw, now);
      const res = onCodeRef.current(raw);
      setLog((l) => [res, ...l].slice(0, 6));
      navigator.vibrate?.(res.ok ? 60 : [40, 40, 40]);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("הדפדפן הזה לא תומך בגישה למצלמה (נדרש חיבור מאובטח, https).");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        setError("אין גישה למצלמה. אשרו את ההרשאה בדפדפן ונסו שוב.");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => undefined);

      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
      if (BD) {
        const det = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        timer = window.setInterval(async () => {
          try { const r = await det.detect(video); if (r[0]) handle(r[0].rawValue); } catch { /* frame not ready */ }
        }, 300);
      } else {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"), import("@zxing/library"),
        ]);
        if (stopped) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250 });
        controls = await reader.decodeFromVideoElement(video, (result) => { if (result) handle(result.getText()); });
        if (stopped) controls.stop();
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-label="סריקת ברקוד">
      <video ref={videoRef} muted playsInline />
      <div className="frame" />
      <div className="panel">
        {error ? <p className="err">{error}</p> : <p>כוונו את הברקוד למסגרת. אפשר לסרוק כמה מוצרים ברצף.</p>}
        <ul>
          {log.map((l, i) => (
            <li key={i} className={l.ok ? "ok" : "bad"}>
              <span>{l.message}</span>
              {!l.ok && l.raw && (
                <button onClick={() => { const n = window.prompt("איך קוראים למוצר?"); if (n?.trim()) onUnknownNamed(l.raw!, n.trim()); }}>
                  הוסף בשם
                </button>
              )}
            </li>
          ))}
        </ul>
        <button className="done" onClick={onClose}>סיום</button>
      </div>
    </div>
  );
}
