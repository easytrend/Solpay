import { useState, useEffect } from 'react';

const SUPPORT_LINKS = [
  {
    id: 'telegram',
    name: 'Telegram',
    href: 'https://t.me/fiatwalletApp',
    color: '#2AABEE',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.19 13.697 4.23 12.82c-.654-.204-.666-.654.136-.967l10.83-4.175c.55-.204 1.027.12.698.543z"/>
      </svg>
    ),
  },
  {
    id: 'x',
    name: 'FiatWallet on X',
    href: 'https://x.com/fiatwallet',
    color: '#ffffff',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    href: 'https://chat.whatsapp.com/DaG8EHRv7xl1Zx7JunmPy4',
    color: '#25D366',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    href: 'https://www.linkedin.com/in/easytrend-fiatwallet-370179414',
    color: '#0A66C2',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
];

// Typing animation messages
const BOT_MESSAGES = [
  { id: 1, text: "👋 Hey! Welcome to FiatWallet Support.", delay: 0 },
  { id: 2, text: "Need help? Connect with our community on any of the platforms below 👇", delay: 800 },
];

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [pulse, setPulse] = useState(true);

  // Stop pulsing badge after first open
  useEffect(() => {
    if (open) setPulse(false);
  }, [open]);

  // Simulate auto-response typing when chat opens
  useEffect(() => {
    if (!open) {
      setVisibleMessages([]);
      return;
    }
    let timeouts = [];
    setVisibleMessages([]);
    setTyping(true);

    BOT_MESSAGES.forEach((msg, i) => {
      const t = setTimeout(() => {
        if (i === BOT_MESSAGES.length - 1) setTyping(false);
        setVisibleMessages(prev => [...prev, msg]);
      }, 400 + msg.delay + i * 200);
      timeouts.push(t);
    });

    return () => timeouts.forEach(clearTimeout);
  }, [open]);

  return (
    <>
      {/* Floating chat button */}
      <button
        id="support-chat-btn"
        onClick={() => setOpen(v => !v)}
        aria-label="Open support chat"
        style={{
          position: 'fixed',
          bottom: '84px',
          right: '18px',
          zIndex: 9000,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--lime, #a3e635) 0%, #65a30d 100%)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(163,230,53,0.45), 0 2px 8px rgba(0,0,0,0.4)',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {open ? (
          /* Close X icon */
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a1628" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          /* Chat bubble icon */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0a1628" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}

        {/* Notification pulse dot */}
        {pulse && !open && (
          <span style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: '#f87171',
            border: '2px solid #0a1628',
            animation: 'pulse 1.5s infinite',
          }} />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          id="support-chat-panel"
          style={{
            position: 'fixed',
            bottom: '148px',
            right: '18px',
            zIndex: 8999,
            width: '300px',
            background: 'var(--card, #111e38)',
            border: '1px solid var(--border, rgba(255,255,255,0.09))',
            borderRadius: '20px',
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
            animation: 'chatSlideUp 0.22s ease',
          }}
        >
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(163,230,53,0.12) 0%, rgba(163,230,53,0.04) 100%)',
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.09))',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            {/* Avatar */}
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--lime, #a3e635), #65a30d)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              fontSize: '16px',
            }}>
              💬
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text, #f0f6ff)' }}>
                FiatWallet Support
              </div>
              <div style={{ fontSize: '10px', color: 'var(--lime, #a3e635)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                Always here to help
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ padding: '14px 14px 10px', minHeight: '80px' }}>
            {visibleMessages.map(msg => (
              <div
                key={msg.id}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '12px 12px 12px 4px',
                  padding: '9px 12px',
                  fontSize: '12px',
                  color: 'var(--text, #f0f6ff)',
                  lineHeight: '1.5',
                  marginBottom: '8px',
                  animation: 'msgFadeIn 0.25s ease',
                }}
              >
                {msg.text}
              </div>
            ))}

            {/* Typing indicator */}
            {typing && (
              <div style={{
                display: 'flex', gap: '4px', alignItems: 'center',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '12px 12px 12px 4px',
                width: 'fit-content',
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: 'var(--text2, rgba(240,246,255,0.55))',
                    animation: `typingDot 1s ${i * 0.2}s infinite ease-in-out`,
                    display: 'inline-block',
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'var(--border, rgba(255,255,255,0.09))', margin: '0 14px' }} />

          {/* Community Links */}
          <div style={{ padding: '10px 8px 12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text2, rgba(240,246,255,0.55))', padding: '0 8px 8px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Join our community
            </div>
            {SUPPORT_LINKS.map(link => (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 10px',
                  borderRadius: '12px',
                  textDecoration: 'none',
                  transition: 'background 0.15s',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Icon circle */}
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: `${link.color}18`,
                  border: `1px solid ${link.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: link.color,
                  flexShrink: 0,
                }}>
                  {link.icon}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text, #f0f6ff)' }}>
                    {link.name}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text2, rgba(240,246,255,0.55))' }}>
                    Tap to connect
                  </div>
                </div>
                {/* Arrow */}
                <svg style={{ marginLeft: 'auto', color: 'var(--text3, rgba(240,246,255,0.28))' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Keyframe animations injected once */}
      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes typingDot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </>
  );
}
