"use client";
export default function HUD() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)",
        backgroundSize: "100px 100px, 100px 100px",
        backgroundPosition: "-1px -1px",
      }} />
      <div className="absolute inset-0 opacity-[0.01]" style={{
        background:
          "radial-gradient(1000px 500px at 10% 0%, rgba(255,255,255,.04), transparent), radial-gradient(1000px 500px at 90% 100%, rgba(255,255,255,.04), transparent)"
      }} />
    </div>
  );
}


