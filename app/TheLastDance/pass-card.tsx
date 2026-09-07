import { ImageResponse } from "next/og";

export const lastDancePassImageSize = { width: 1200, height: 630 };
export const lastDancePassImageAlt = "Confirmed BunnyHood GTD spot for The Last Dance";

type PassCardData = {
  xUsername: string;
  maskedWallet: string;
  mintOpensAt: string | null;
};

function mintLabel(value: string | null) {
  if (!value) return "MINT TIME ANNOUNCING SOON";
  const date = new Date(value);
  if (date.getTime() <= Date.now()) return "OPENSEA MINT IS LIVE";
  return `MINT · ${date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).toUpperCase()} UTC`;
}

export function renderLastDancePassCard(pass: PassCardData) {
  return new ImageResponse(
    (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(138deg, #070719 0%, #18134a 58%, #09081f 100%)",
        color: "#f7f2e9",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}>
        <div style={{
          position: "absolute",
          top: -270,
          right: -100,
          width: 650,
          height: 650,
          display: "flex",
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(88,237,255,.42), rgba(128,87,255,.16) 47%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute",
          left: -130,
          bottom: -280,
          width: 640,
          height: 640,
          display: "flex",
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(255,92,125,.31), transparent 68%)",
        }} />
        <div style={{
          position: "absolute",
          top: 50,
          left: 57,
          right: 57,
          bottom: 50,
          display: "flex",
          border: "1px solid rgba(255,255,255,.22)",
          borderRadius: 32,
        }} />

        <div style={{
          width: "48%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "75px 0 69px 82px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 15,
              background: "linear-gradient(135deg, #58edff, #8057ff 55%, #ff5c7d)",
              color: "#15122d",
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: -1,
            }}>BH</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "#58edff", fontSize: 18, fontWeight: 900, letterSpacing: 4 }}>BUNNY HOOD</span>
              <span style={{ color: "#8e87ab", fontSize: 10, fontWeight: 700, letterSpacing: 3 }}>ROBINHOOD CHAIN · 4663</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", marginBottom: 33 }}>
            <span style={{ color: "#ffdf6b", fontSize: 14, fontWeight: 900, letterSpacing: 4, marginBottom: 12 }}>THE LAST DANCE</span>
            <span style={{ fontSize: 63, fontWeight: 900, lineHeight: .84, letterSpacing: -5 }}>CONFIRMED</span>
            <span style={{
              color: "#58edff",
              fontSize: 66,
              fontWeight: 900,
              lineHeight: .88,
              letterSpacing: -5,
            }}>GTD SPOT.</span>
            <span style={{ width: 450, color: "#b6afca", fontSize: 18, lineHeight: 1.45, marginTop: 22 }}>
              Your wallet will be added soon. Keep this pass for the BunnyHood OpenSea mint.
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ color: "#ff8da4", fontSize: 12, fontWeight: 900, letterSpacing: 3 }}>{mintLabel(pass.mintOpensAt)}</span>
            <span style={{ color: "#77708e", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>BUNNYHOOD.XYZ</span>
          </div>
        </div>

        <div style={{
          position: "relative",
          width: "52%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={{
            width: 430,
            height: 500,
            display: "flex",
            position: "relative",
            overflow: "hidden",
            flexDirection: "column",
            border: "2px solid rgba(255,255,255,.72)",
            borderRadius: 32,
            background: "linear-gradient(145deg, rgba(255,255,255,.88), rgba(196,183,255,.94) 38%, rgba(88,237,255,.86) 70%, rgba(255,127,153,.93))",
            padding: 28,
            color: "#15122d",
            boxShadow: "0 38px 80px rgba(0,0,0,.38)",
            transform: "rotate(3deg)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2 }}>FINAL ACCESS PASS</span>
              <span style={{ borderRadius: 999, background: "#15122d", padding: "7px 10px", color: "#58edff", fontSize: 9, fontWeight: 900, letterSpacing: 2 }}>VERIFIED</span>
            </div>

            <div style={{
              height: 164,
              display: "flex",
              position: "relative",
              alignItems: "flex-end",
              justifyContent: "center",
              marginTop: 23,
            }}>
              <div style={{
                position: "absolute",
                top: 0,
                left: 135,
                width: 42,
                height: 112,
                display: "flex",
                border: "5px solid #15122d",
                borderRadius: 999,
                transform: "rotate(-11deg)",
              }} />
              <div style={{
                position: "absolute",
                top: 0,
                right: 135,
                width: 42,
                height: 112,
                display: "flex",
                border: "5px solid #15122d",
                borderRadius: 999,
                transform: "rotate(11deg)",
              }} />
              <div style={{
                width: 122,
                height: 94,
                display: "flex",
                position: "relative",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background: "#15122d",
                color: "#fff",
                fontSize: 35,
                fontWeight: 900,
                letterSpacing: -3,
              }}>BH</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 17 }}>
              <span style={{ color: "rgba(21,18,45,.55)", fontSize: 10, fontWeight: 900, letterSpacing: 3 }}>CONFIRMED FOR</span>
              <span style={{ maxWidth: 340, overflow: "hidden", fontSize: 37, fontWeight: 900, letterSpacing: -2, marginTop: 5 }}>@{pass.xUsername}</span>
              <span style={{ color: "rgba(21,18,45,.63)", fontSize: 15, fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>{pass.maskedWallet}</span>
            </div>

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "auto",
              borderTop: "1px solid rgba(21,18,45,.22)",
              paddingTop: 15,
            }}>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2 }}>NFT FOUND ✓</span>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2 }}>TX FOUND ✓</span>
              <span style={{ fontSize: 21, fontWeight: 900 }}>GTD</span>
            </div>
          </div>
        </div>
      </div>
    ),
    lastDancePassImageSize,
  );
}
