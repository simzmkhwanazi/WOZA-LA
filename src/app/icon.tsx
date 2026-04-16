import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: '#2ABFBF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '-0.5px',
            fontFamily: 'sans-serif',
          }}
        >
          WL
        </span>
      </div>
    ),
    { ...size },
  );
}
