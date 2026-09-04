import { ImageResponse } from "next/og";

export const spinSocialImageAlt = "Bunny Hood Spin the Wheel — complete tasks, earn points, and win access";
export const spinSocialImageSize = { width: 1200, height: 630 };

export function renderSpinSocialCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#080a07",
          color: "#f0eee5",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at 83% 44%, rgba(202,255,0,.25), transparent 34%), linear-gradient(125deg, #11170d 0%, #080a07 50%, #0d100b 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 58,
            right: 58,
            top: 46,
            bottom: 46,
            display: "flex",
            border: "2px solid rgba(202,255,0,.34)",
            borderRadius: 34,
          }}
        />

        <div
          style={{
            width: "59%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "70px 0 68px 82px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 13,
                background: "#caff00",
                color: "#080a07",
                fontSize: 19,
                fontWeight: 900,
              }}
            >
              BH
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ color: "#caff00", fontSize: 21, fontWeight: 900, letterSpacing: 5 }}>BUNNY HOOD</span>
              <span style={{ color: "#788171", fontSize: 11, fontWeight: 700, letterSpacing: 4 }}>THE HOOD REWARDS HUB</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#caff00", fontSize: 16, fontWeight: 900, letterSpacing: 5, marginBottom: 17 }}>ENTER · EARN · SPIN</span>
            <span style={{ fontSize: 85, fontWeight: 900, lineHeight: 0.83, letterSpacing: -7 }}>SPIN THE</span>
            <span style={{ color: "#caff00", fontSize: 103, fontWeight: 900, lineHeight: 0.88, letterSpacing: -8 }}>WHEEL.</span>
            <span style={{ width: 535, color: "#aeb5a8", fontSize: 20, lineHeight: 1.4, marginTop: 24 }}>
              Complete tasks, earn points, and win GTD or FCFS access with the Bunny Hood community.
            </span>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            width: "41%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 410,
              height: 410,
              display: "flex",
              position: "relative",
              alignItems: "center",
              justifyContent: "center",
              border: "13px solid #151a12",
              borderRadius: 999,
              background: "#10140e",
              boxShadow: "0 0 0 2px rgba(202,255,0,.48), 0 34px 95px rgba(0,0,0,.7), 0 0 85px rgba(202,255,0,.2)",
            }}
          >
            {Array.from({ length: 12 }, (_, index) => (
              <div
                key={index}
                style={{
                  position: "absolute",
                  top: 14,
                  left: 184,
                  width: 28,
                  height: 82,
                  display: "flex",
                  borderRadius: "10px 10px 4px 4px",
                  background: index % 3 === 0 ? "#f0eee5" : index % 2 === 0 ? "#caff00" : "#293021",
                  transform: `rotate(${index * 30}deg)`,
                  transformOrigin: "14px 184px",
                }}
              />
            ))}
            <div
              style={{
                width: 176,
                height: 176,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                border: "8px solid #caff00",
                borderRadius: 999,
                background: "#080a07",
                color: "#caff00",
                boxShadow: "0 0 38px rgba(202,255,0,.32)",
              }}
            >
              <span style={{ fontSize: 29, fontWeight: 900, letterSpacing: -2 }}>BH</span>
              <span style={{ color: "#f0eee5", fontSize: 13, fontWeight: 900, letterSpacing: 3, marginTop: 5 }}>SPIN</span>
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              top: 83,
              left: 225,
              width: 34,
              height: 34,
              display: "flex",
              borderRadius: 5,
              background: "#f0eee5",
              transform: "rotate(45deg)",
              filter: "drop-shadow(0 8px 10px rgba(0,0,0,.55))",
            }}
          />
        </div>

        <div
          style={{
            position: "absolute",
            right: 84,
            bottom: 66,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "#caff00",
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          <span>●</span>
          <span>BUNNYHOOD.XYZ</span>
        </div>
      </div>
    ),
    spinSocialImageSize,
  );
}
