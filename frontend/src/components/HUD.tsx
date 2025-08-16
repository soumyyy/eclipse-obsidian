"use client";
export default function HUD() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-0 opacity-[0.06]" style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
        backgroundSize: "60px 60px, 60px 60px",
        backgroundPosition: "-1px -1px",
      }} />
      <div className="absolute inset-0 opacity-[0.08]" style={{
        background:
          "radial-gradient(600px 300px at 10% 0%, rgba(0,255,255,.12), transparent), radial-gradient(600px 300px at 90% 100%, rgba(0,255,255,.12), transparent)"
      }} />
    </div>
  );
}


